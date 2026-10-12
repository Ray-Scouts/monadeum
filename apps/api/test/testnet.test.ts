import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { fundingTypedData, ViemFundingChain, type FundingAuthorization } from "../src/index.js";

// Opt-in, against Monad testnet. `FUNDING_TESTNET=1` reads the settlement asset's EIP-712 domain and checks it against
// the contract's DOMAIN_SEPARATOR, and simulates a relayed transferWithAuthorization from an empty wallet (which the
// token must refuse). With `FUNDING_TESTNET_OWNER_KEY_FILE` and `FUNDING_TESTNET_RELAYER_KEY_FILE` (files holding test
// keys, never real ones; the owner holds testnet USDC, the relayer testnet MON) and `FUNDING_TESTNET_TO`, it also relays
// one transfer of `FUNDING_TESTNET_VALUE` base units (default 10000, 0.01 USDC) and waits for the receipt.

const enabled = process.env.FUNDING_TESTNET === "1";
const rpc = process.env.MONAD_TESTNET_RPC || monadTestnet.rpcUrls.default.http[0];
const asset = getAddress(process.env.FUNDING_TESTNET_ASSET || "0x534b2f3A21130d7a60830c2Df862319e593943A3");

const readKey = async (file: string) => (await readFile(file, "utf8")).trim() as Hex;

test("testnet: the settlement asset's domain verifies and an unfunded authorization is refused in simulation", { skip: !enabled }, async () => {
  const relayer = privateKeyToAccount(generatePrivateKey());
  const chain = new ViemFundingChain(monadTestnet, rpc, asset, relayer);
  const domain = await chain.assetDomain();
  assert.deepEqual({ name: domain.name, version: domain.version, chainId: domain.chainId, decimals: domain.decimals }, { name: "USDC", version: "2", chainId: 10143, decimals: 6 });
  const owner = privateKeyToAccount(generatePrivateKey());
  const now = BigInt(Math.floor(Date.now() / 1000));
  const authorization: FundingAuthorization = { from: owner.address, to: relayer.address, value: 1n, validAfter: now - 5n, validBefore: now + 300n, nonce: generatePrivateKey() };
  const signature = await owner.signTypedData(fundingTypedData(domain, authorization));
  await assert.rejects(chain.prepareRelay(authorization, signature), "an owner without USDC cannot be relayed");
  assert.equal(await chain.authorizationUsed(owner.address, authorization.nonce), false);
});

const ownerFile = process.env.FUNDING_TESTNET_OWNER_KEY_FILE;
const relayerFile = process.env.FUNDING_TESTNET_RELAYER_KEY_FILE;
const to = process.env.FUNDING_TESTNET_TO;

test("testnet: a relayed transferWithAuthorization lands", { skip: !(enabled && ownerFile && relayerFile && to) }, async () => {
  const owner = privateKeyToAccount(await readKey(ownerFile!));
  const relayer = privateKeyToAccount(await readKey(relayerFile!));
  const chain = new ViemFundingChain(monadTestnet, rpc, asset, relayer);
  const domain = await chain.assetDomain();
  const value = BigInt(process.env.FUNDING_TESTNET_VALUE || "10000");
  const before = await chain.balanceOf(getAddress(to!));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const authorization: FundingAuthorization = { from: owner.address, to: getAddress(to!), value, validAfter: now - 5n, validBefore: now + 600n, nonce: generatePrivateKey() };
  const signature = await owner.signTypedData(fundingTypedData(domain, authorization));
  const prepared = await chain.prepareRelay(authorization, signature);
  assert.ok((await chain.nativeBalance(relayer.address)) >= prepared.maxCost, "the relayer holds enough MON");
  await prepared.send();
  let receipt = null;
  for (let i = 0; i < 30 && !receipt; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    receipt = await chain.receipt(prepared.hash);
  }
  assert.ok(receipt, `no receipt for ${prepared.hash}`);
  assert.equal(receipt.status, "success");
  assert.equal(await chain.authorizationUsed(owner.address, authorization.nonce), true);
  assert.equal(await chain.balanceOf(getAddress(to!)), before + value);
  console.log(`relayed ${value} base units in ${prepared.hash}, block ${receipt.blockNumber}`);
});
