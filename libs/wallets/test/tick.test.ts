import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  MemoryAgentWalletStore,
  MemorySessionKeyVault,
  MemorySponsorshipLedger,
  WalletsService,
  buildScope,
  type SponsorshipBudget,
} from "../src/index.js";
import { FakeChain, type FakeOptions } from "../src/testing.js";

// At-most-once execution keyed by tick. A "restart" is a new WalletsService over the same store, vault and ledger:
// nothing held in process memory survives it.

const USDC = getAddress("0x00000000000000000000000000000000000000a1");
const ROUTER = getAddress("0x00000000000000000000000000000000000000b1");
const REALLOC = getAddress("0x00000000000000000000000000000000000000c1");
const scope = buildScope({ settlementAsset: USDC, kuruRouter: ROUTER, kuruRouterSelectors: ["0x12345678"], reallocation: REALLOC, reallocationSelectors: ["0x9abcdef0"] });
const limits = { perTxCap: 1_000_000n, dailyCap: 5_000_000n };
const calls = [
  { to: USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, 10n] }) },
  { to: ROUTER, value: 0n, data: "0x1234567800" as Hex },
];

async function setup(options: FakeOptions = {}, budget: SponsorshipBudget = { operations: 100, gasWei: 1_000_000n }) {
  const chain = new FakeChain();
  const store = new MemoryAgentWalletStore();
  const vault = new MemorySessionKeyVault();
  const ledger = new MemorySponsorshipLedger();
  const make = () => new WalletsService(chain, store, vault, ledger, { scope, budget, paymaster: true });
  const service = make();
  const ownerAccount = privateKeyToAccount(generatePrivateKey());
  const owner = { address: ownerAccount.address, signer: ownerAccount };
  const deployed = await service.deploy({ agentId: "agent-1", owner, index: 0n, limits });
  assert.equal(deployed.ok, true);
  assert.equal((await service.issueSessionKey({ agentId: "agent-1", owner })).ok, true);
  const account = (await store.get("agent-1"))!.account;
  Object.assign(chain.options, options); // applied after setup, so deployment and issuance always succeed
  const sessions = () => chain.submitted.filter((s) => s.kind === "session").length;
  return { chain, store, ledger, service, restart: make, account, sessions };
}

test("a tick's hash is recorded before submission and the receipt carries logs, transaction hash, block and gas", async () => {
  const { chain, store, service, sessions } = await setup();
  let recordedAtSubmit: Hex | undefined;
  const original = chain.prepareSessionOperation.bind(chain);
  chain.prepareSessionOperation = async (input) => {
    const prepared = await original(input);
    const submit = prepared.submit;
    prepared.submit = async () => {
      recordedAtSubmit = (await store.getOperation("agent-1", "agent-1:1"))?.attempts.at(-1)?.userOpHash;
      return submit();
    };
    return prepared;
  };
  const r = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(recordedAtSubmit, r.userOpHash, "the hash was durable before submit was called");
  assert.equal(r.receipt.success, true);
  assert.match(r.receipt.transactionHash, /^0x[0-9a-f]{64}$/);
  assert.ok(r.receipt.blockNumber > 0n);
  assert.equal(r.receipt.logs.length, 1);
  assert.equal(r.receipt.actualGasCost, 900n);
  assert.deepEqual(await service.lookupTick("agent-1", "agent-1:1"), { state: "included", userOpHash: r.userOpHash, receipt: r.receipt });

  const again = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.deepEqual(again, r);
  assert.equal(sessions(), 1);
  assert.deepEqual(await service.lookupTick("agent-1", "agent-1:9"), { state: "absent" });
});

test("crash after record, before submit: the tick is absent, and a retry after restart reuses the nonce and lands once", async () => {
  const { chain, store, ledger, restart, sessions } = await setup({ submit: "unknown" });
  const first = await restart().executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.equal(!first.ok && first.reason, "submission-unknown");
  const recorded = (await store.getOperation("agent-1", "agent-1:1"))!;
  assert.equal(!first.ok && first.userOpHash, recorded.attempts[0]!.userOpHash);
  assert.deepEqual(await ledger.usage("agent-1"), { operations: 2, gasWei: 1900n }, "the unknown attempt's reservation is kept");

  const after = restart();
  assert.deepEqual(await after.lookupTick("agent-1", "agent-1:1"), { state: "absent" });
  chain.options.submit = "ok";
  const retry = await after.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.equal(retry.ok, true);
  const op = (await store.getOperation("agent-1", "agent-1:1"))!;
  assert.equal(op.attempts.length, 2);
  assert.equal(op.attempts[1]!.nonce, op.attempts[0]!.nonce, "the re-attempt excludes the first by nonce");
  assert.equal(sessions(), 1);
  assert.deepEqual(await ledger.usage("agent-1"), { operations: 2, gasWei: 1800n }, "the dead attempt's reservation was released");
});

test("crash after submit: the bundler holds it, restarts see it pending and never resend, then it is found included", async () => {
  const { chain, restart, sessions } = await setup({ submit: "accepted-then-throw" });
  const first = await restart().executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.equal(!first.ok && first.reason, "submission-unknown");
  const hash = !first.ok ? first.userOpHash! : "0x";

  chain.options.submit = "ok";
  const after = restart();
  assert.deepEqual(await after.lookupTick("agent-1", "agent-1:1"), { state: "pending", userOpHash: hash });
  const prepares = chain.prepareCalls;
  assert.deepEqual(await after.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls }), { ok: false, reason: "pending", userOpHash: hash });
  assert.equal(chain.prepareCalls, prepares, "nothing was prepared or resent");

  chain.mine();
  const found = await restart().lookupTick("agent-1", "agent-1:1");
  assert.equal(found.state, "included");
  assert.equal(found.state === "included" && found.userOpHash, hash);
  const again = await restart().executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.equal(again.ok && again.userOpHash, hash);
  assert.equal(sessions(), 1);
});

test("a dropped operation is retried under the same nonce, so the old one can never land after the new one", async () => {
  const { chain, store, service, sessions } = await setup({ submit: "accepted-then-throw" });
  await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  chain.dropMempool();
  chain.options.submit = "pending";
  const retry = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.equal(!retry.ok && retry.reason, "submission-unknown", "waiting for the receipt timed out");
  const op = (await store.getOperation("agent-1", "agent-1:1"))!;
  assert.equal(op.attempts[0]!.nonce, op.attempts[1]!.nonce);
  chain.mine();
  const found = await service.lookupTick("agent-1", "agent-1:1");
  assert.equal(found.state === "included" && found.userOpHash, op.attempts[1]!.userOpHash);
  assert.equal(sessions(), 1);
});

test("a new tick waits while an earlier one may still land", async () => {
  const { chain, service } = await setup({ submit: "pending" });
  await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  const prepares = chain.prepareCalls;
  const blocked = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:2", calls });
  assert.equal(!blocked.ok && blocked.reason, "busy");
  assert.equal(!blocked.ok && blocked.userOpHash, undefined, "busy means nothing was submitted");
  assert.equal(chain.prepareCalls, prepares);
  chain.mine();
  chain.options.submit = "ok";
  assert.equal((await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:2", calls })).ok, true);
});

test("a tick whose nonce another recorded tick consumed is superseded and resent under a fresh nonce", async () => {
  const { chain, store, service, sessions } = await setup({ submit: "unknown" });
  await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  chain.options.submit = "ok";
  // Tick 1 is provably not in flight, so tick 2 proceeds and takes the same nonce.
  assert.equal((await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:2", calls })).ok, true);
  assert.deepEqual(await service.lookupTick("agent-1", "agent-1:1"), { state: "absent" });
  const retry = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.equal(retry.ok, true);
  const op = (await store.getOperation("agent-1", "agent-1:1"))!;
  assert.equal(op.attempts[1]!.nonce, op.attempts[0]!.nonce + 1n);
  assert.equal(sessions(), 2);
});

test("an unidentified use of the tick's nonce, or an unreachable bundler, is unknown, never absent", async () => {
  const { chain, service, account } = await setup({ submit: "unknown" });
  await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  chain.acct(account).sessionNonce++; // something outside this module used the nonce
  await assert.rejects(service.lookupTick("agent-1", "agent-1:1"), /cannot identify/);
  chain.options.submit = "ok";
  const r = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.equal(!r.ok && r.reason, "submission-unknown");
  assert.ok(!r.ok && r.userOpHash);

  const down = await setup({ submit: "accepted-then-throw" });
  await down.service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  down.chain.options.bundlerDown = true;
  await assert.rejects(down.service.lookupTick("agent-1", "agent-1:1"), /bundler unreachable/);
});

test("a tick key is bound to its calls, and definite refusals carry no hash", async () => {
  const { chain, service } = await setup();
  assert.equal((await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls })).ok, true);
  const other = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls: [calls[0]!] });
  assert.equal(!other.ok && other.reason, "conflict");

  const outside = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:2", calls: [{ ...calls[1]!, to: USDC }] });
  assert.deepEqual(outside, { ok: false, reason: "out-of-scope" });

  chain.options.submit = "rejected";
  const rejected = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:3", calls });
  assert.equal(!rejected.ok && rejected.reason, "rejected");
  assert.equal(!rejected.ok && rejected.userOpHash, undefined);
  assert.deepEqual(await service.lookupTick("agent-1", "agent-1:3"), { state: "absent" });
});

test("after revocation a recorded tick can still be looked up, but nothing new is signed", async () => {
  const { chain, store, service, sessions } = await setup({ submit: "accepted-then-throw" });
  await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  const record = (await store.get("agent-1"))!;
  record.session!.status = "revoked";
  await store.update(record);
  const pending = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.equal(!pending.ok && pending.reason, "pending", "the existing operation is reported, not abandoned");
  chain.dropMempool();
  const dead = await service.executeForTick({ agentId: "agent-1", tickKey: "agent-1:1", calls });
  assert.deepEqual(dead, { ok: false, reason: "revoked" });
  assert.equal(sessions(), 0);
});
