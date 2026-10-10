import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, erc20Abi, isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  MemoryAgentWalletStore,
  MemorySessionKeyVault,
  MemorySponsorshipLedger,
  WalletsService,
  ZeroDevChain,
  loadWalletsConfig,
} from "../src/index.js";

// Opt-in Monad testnet run of the full flow: deploy twice, issue, use, revoke, verify, and replay the revoked key.
// Skipped unless WALLETS_TESTNET=1. Requires every variable loadWalletsConfig reads, a deployed spend policy
// (issue #25), and WALLETS_TESTNET_OWNER_PRIVATE_KEY: a testnet-only key standing in for the user's embedded wallet.
// Never use a key that holds mainnet assets. If no paymaster is configured, fund the printed account address first.

const enabled = process.env.WALLETS_TESTNET === "1";

test("testnet: deploy, issue, execute, revoke, and replay on Monad testnet", { skip: !enabled && "set WALLETS_TESTNET=1 to run" }, async () => {
  const config = loadWalletsConfig();
  const ownerKey = process.env.WALLETS_TESTNET_OWNER_PRIVATE_KEY as Hex | undefined;
  if (!ownerKey || !isHex(ownerKey)) throw new Error("WALLETS_TESTNET_OWNER_PRIVATE_KEY is not set");
  const ownerAccount = privateKeyToAccount(ownerKey);
  const owner = { address: ownerAccount.address, signer: ownerAccount };
  const index = BigInt(process.env.WALLETS_TESTNET_INDEX ?? Date.now());

  const chain = new ZeroDevChain(config.chain);
  assert.equal(await chain.publicClient.getChainId(), config.chain.chain.id);
  const store = new MemoryAgentWalletStore();
  const vault = new MemorySessionKeyVault();
  const ledger = new MemorySponsorshipLedger();
  const service = new WalletsService(chain, store, vault, ledger, { scope: config.chain.scope, budget: config.budget, paymaster: config.chain.paymasterUrl !== null });
  const limits = { perTxCap: 1n, dailyCap: 1n };
  console.log(`account ${await chain.accountAddress(owner.address, index)} (index ${index})`);

  const first = await service.deploy({ agentId: "testnet-agent", owner, index, limits });
  assert.equal(first.ok && first.created, true, JSON.stringify(first, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  const second = await service.deploy({ agentId: "testnet-agent", owner, index, limits });
  assert.equal(second.ok && second.created, false);

  const issued = await service.issueSessionKey({ agentId: "testnet-agent", owner });
  assert.equal(issued.ok, true);
  const settlement = config.chain.scope.find((c) => c.label === "settlement-asset")!.target;
  const router = config.chain.scope.find((c) => c.label === "kuru-router")!.target;
  // A zero-amount approval to the router: in scope, counted as 0 against the caps.
  const call = { to: settlement, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, 0n] }) };
  const used = await service.execute({ agentId: "testnet-agent", calls: [call] });
  assert.equal(used.ok, true, JSON.stringify(used));

  const record = (await store.get("testnet-agent"))!;
  const key = (await vault.get("testnet-agent"))!;
  const revoked = await service.revokeSessionKey({ agentId: "testnet-agent", owner });
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const status = await service.revocationStatus("testnet-agent");
  assert.equal(status?.revoked, true);

  // Replay the revoked key and the owner's approval directly against the bundler.
  const session = record.session!;
  await assert.rejects(chain.prepareSessionOperation({
    owner: owner.address, index, account: record.account, sessionKey: key, calls: [call], sponsored: false,
    approval: { permissionId: session.permissionId, enableSignature: session.enableSignature, enableNonce: session.enableNonce },
  }));
  console.log(`sponsorship ${JSON.stringify(await service.sponsorship("testnet-agent"), (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
});
