import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAbiParameters, getAddress, hashDomain, parseAbiParameters, recoverAddress, size, slice, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  X402Error,
  buildX402Authorization,
  kernelWrappedHash,
  signX402Authorization,
  x402AuthorizationDigest,
  x402MaxOutflowPer24h,
  x402Nonce,
  x402ValidatorInstallData,
  type SettlementAssetDomain,
  type X402ValidatorConfig,
} from "../src/index.js";

const ACCOUNT = getAddress("0x900502071558dc2131b23b314454242d17d77ee8");
const VALIDATOR = getAddress("0x4024024024024024024024024024024024024024");
const USDC: SettlementAssetDomain = { address: getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603"), chainId: 143, name: "USDC", version: "2" };
const NANSEN = getAddress("0x85a6cb8303cd90f4a1a1005c04e66ad4d2370b18");
const DEFILLAMA = getAddress("0x2222222222222222222222222222222222222222");
const NOW = 1_790_000_000n;

function config(signer: Address): X402ValidatorConfig {
  return { signer, maxValue: 50_000n, paymentsPerEpoch: 4, maxValidity: 600, payees: [NANSEN, DEFILLAMA] };
}

test("the nonce matches the validator's nonceFor (Solidity vector in X402PaymentValidator.t.sol)", () => {
  assert.equal(
    x402Nonce("0x1111111111111111111111111111111111111111", 497_222n, 3n),
    "0xc1c67eea652684d482617edec0152657c12d7eb312167f0ee10746c74ef5acb1",
  );
});

test("the USDC domain matches Monad mainnet USDC's DOMAIN_SEPARATOR, read 2026-10-10", () => {
  const separator = hashDomain({
    domain: { name: USDC.name, version: USDC.version, chainId: BigInt(USDC.chainId), verifyingContract: USDC.address },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  });
  assert.equal(separator, "0xfe22123edc0dd4aeb912eb7948c5f0e531592c2053b3067612f427db342c93c6");
});

test("an authorization is built inside every bound, with the slot's nonce for the hour of validAfter", () => {
  const key = privateKeyToAccount(generatePrivateKey());
  const auth = buildX402Authorization({ account: ACCOUNT, payTo: NANSEN, value: 50_000n, nowSeconds: NOW, validitySeconds: 300n, slot: 2, config: config(key.address) });
  assert.equal(auth.from, ACCOUNT);
  assert.equal(auth.validAfter, NOW - 5n);
  assert.equal(auth.validBefore - auth.validAfter, 300n);
  assert.equal(auth.nonce, x402Nonce(ACCOUNT, (NOW - 5n) / 3600n, 2n));
});

test("out-of-bound authorizations are refused before signing", () => {
  const c = config(privateKeyToAccount(generatePrivateKey()).address);
  const base = { account: ACCOUNT, payTo: NANSEN, value: 1n, nowSeconds: NOW, validitySeconds: 60n, slot: 0, config: c };
  const cases: Array<Partial<typeof base>> = [
    { payTo: getAddress("0x3333333333333333333333333333333333333333") },
    { value: 0n },
    { value: 50_001n },
    { validitySeconds: 0n },
    { validitySeconds: 601n },
    { slot: 4 },
    { slot: -1 },
    { slot: 1.5 },
  ];
  for (const override of cases) {
    assert.throws(() => buildX402Authorization({ ...base, ...override }), X402Error, JSON.stringify(override, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  }
});

test("the ERC-1271 signature is validator mode with the fields and the x402 key's signature of Kernel's wrapped hash", async () => {
  const key = privateKeyToAccount(generatePrivateKey());
  const auth = buildX402Authorization({ account: ACCOUNT, payTo: DEFILLAMA, value: 7n, nowSeconds: NOW, validitySeconds: 60n, slot: 1, config: config(key.address) });
  const sig = await signX402Authorization({ key, validator: VALIDATOR, asset: USDC, authorization: auth, slot: 1 });

  assert.equal(size(sig), 1 + 20 + 160 + 65);
  assert.equal(slice(sig, 0, 1), "0x01");
  assert.equal(getAddress(slice(sig, 1, 21)), VALIDATOR);
  const [to, value, validAfter, validBefore, slot] = decodeAbiParameters(parseAbiParameters("address, uint256, uint256, uint256, uint256"), slice(sig, 21, 181));
  assert.deepEqual([to, value, validAfter, validBefore, slot], [DEFILLAMA, 7n, auth.validAfter, auth.validBefore, 1n]);

  const wrapped = kernelWrappedHash(ACCOUNT, USDC.chainId, x402AuthorizationDigest(USDC, auth));
  const ecdsa = slice(sig, 181);
  assert.ok(["0x1b", "0x1c"].includes(slice(ecdsa, 64)), "v is 27 or 28");
  assert.equal(await recoverAddress({ hash: wrapped, signature: ecdsa }), key.address);
});

test("install data encodes the configuration and refuses what the contract refuses", () => {
  const signer = privateKeyToAccount(generatePrivateKey()).address;
  const ctx = { account: ACCOUNT, settlementAsset: USDC.address, validator: VALIDATOR };
  const data = x402ValidatorInstallData(config(signer), ctx);
  const [s, maxValue, slots, validity, payees] = decodeAbiParameters(parseAbiParameters("address, uint128, uint32, uint32, address[]"), data);
  assert.deepEqual([s, maxValue, slots, validity, payees], [signer, 50_000n, 4, 600, [NANSEN, DEFILLAMA]]);

  const bad: Array<Partial<X402ValidatorConfig>> = [
    { signer: "0x0000000000000000000000000000000000000000" },
    { maxValue: 0n },
    { paymentsPerEpoch: 0 },
    { maxValidity: 0 },
    { maxValidity: 3601 },
    { payees: [] },
    { payees: Array.from({ length: 9 }, (_, i) => getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`)) },
    { payees: [ACCOUNT] },
    { payees: [USDC.address] },
    { payees: [VALIDATOR] },
    { payees: [NANSEN, NANSEN] },
  ];
  for (const override of bad) {
    assert.throws(() => x402ValidatorInstallData({ ...config(signer), ...override }, ctx), X402Error);
  }
});

test("the 24-hour bound is 26 hours of slots at maxValue", () => {
  assert.equal(x402MaxOutflowPer24h({ maxValue: 50_000n, paymentsPerEpoch: 4 }), 26n * 4n * 50_000n);
});
