import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryAgentStore } from "@monadeum/agent-registry";
import { MemoryPaymentLog, MemoryX402SlotStore, ValidatorPayer, X402PayerError, type ChainLog, type PaymentTerms } from "@monadeum/x402";
import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import {
  DisabledX402Payer,
  MemoryAgentLocks,
  MemoryJobQueue,
  RpcSettlementLogSource,
  WorkerConfigError,
  WorkerJobHandlers,
  X402Reconciler,
  agentOfTickKey,
  buildX402Payer,
  loadX402PayerConfig,
  memoryWorkerStores,
  parseJob,
  type LogReader,
} from "../src/main.js";

const ATTACKER = getAddress("0x3333333333333333333333333333333333333333");

const validator = {
  validator: getAddress("0x4024024024024024024024024024024024024024"),
  settlementAsset: getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603"),
  maxValue: 50_000n, paymentsPerEpoch: 4, maxValidity: 300,
  payees: [getAddress("0x85a6cb8303cd90f4a1a1005c04e66ad4d2370b18")],
};
const keys = { x402SigningKey: async () => null };
const terms: PaymentTerms = {
  scheme: "exact", network: "eip155:143", asset: validator.settlementAsset, payTo: validator.payees[0]!, amount: 1n, maxTimeoutSeconds: 60,
  requirement: {}, resource: null,
};

test("the x402 payer is off by default and signs nothing", async () => {
  const config = loadX402PayerConfig({});
  assert.equal(config.enabled, false);
  const payer = buildX402Payer({ config, wallets: keys, validator, slots: new MemoryX402SlotStore() });
  assert.ok(payer instanceof DisabledX402Payer);
  await assert.rejects(payer.authorize({ key: "k", tickKey: "a:1", terms }), X402PayerError);
  assert.equal(loadX402PayerConfig({ WORKER_X402_PAYER_ENABLED: "false" }).enabled, false);
});

test("enabling it needs the switch exactly, a chain id, and WalletsModule's validator settings", () => {
  assert.throws(() => loadX402PayerConfig({ WORKER_X402_PAYER_ENABLED: "yes" }), WorkerConfigError);
  assert.throws(() => loadX402PayerConfig({ WORKER_X402_PAYER_ENABLED: "true" }), WorkerConfigError);
  const config = loadX402PayerConfig({ WORKER_X402_PAYER_ENABLED: "true", WORKER_X402_CHAIN_ID: "143" });
  assert.deepEqual(config, { enabled: true, chainId: 143, assetName: "USDC", assetVersion: "2", reconcileIntervalMs: 300_000 });
  assert.throws(() => buildX402Payer({ config, wallets: keys, validator: null, slots: new MemoryX402SlotStore() }), WorkerConfigError);
  assert.ok(buildX402Payer({ config, wallets: keys, validator, slots: new MemoryX402SlotStore() }) instanceof ValidatorPayer);
});

test("the agent of a tick key is everything before the last colon", () => {
  assert.equal(agentOfTickKey("agent-1:7"), "agent-1");
  assert.equal(agentOfTickKey("a:b:12"), "a:b");
  for (const bad of ["agent", ":7", "agent:x"]) assert.throws(() => agentOfTickKey(bad), X402PayerError);
});

// Reconciliation job

const ACCOUNT = getAddress("0x00000000000000000000000000000000000000bb");
const ASSET = validator.settlementAsset;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const topic = (a: Address) => encodeAbiParameters(parseAbiParameters("address"), [a]);

function chainLogs(nonce: Hex, to: Address, value: bigint, hash: Hex): ChainLog[] {
  return [
    { address: ASSET, topics: [keccak256(toHex("AuthorizationUsed(address,bytes32)")), topic(ACCOUNT), nonce], data: "0x", transactionHash: hash, blockNumber: 5n, logIndex: 0 },
    { address: ASSET, topics: [keccak256(toHex("Transfer(address,address,uint256)")), topic(ACCOUNT), topic(to)], data: encodeAbiParameters(parseAbiParameters("uint256"), [value]), transactionHash: hash, blockNumber: 5n, logIndex: 1 },
  ];
}

async function reconcileWorld(payerEnabled: boolean, logs: ChainLog[]) {
  const agents = new MemoryAgentStore();
  await agents.add({
    agentId: "a", owner: "0x00000000000000000000000000000000000000aa", account: ACCOUNT, genomeHash: `0x${"11".repeat(32)}`,
    genome: { riskTolerance: 0.1, executionFrequency: 1, informationBudget: 1n, informationSources: [], pair: "WETH/USDC", assetUniverse: ["WETH/USDC"] },
    principal: 1n, status: "active",
  });
  const slots = new MemoryX402SlotStore();
  const payments = new MemoryPaymentLog();
  const asked: Address[][] = [];
  const source = { logs: async (_asset: Address, accounts: readonly Address[]) => { asked.push([...accounts]); return logs; } };
  return { reconciler: new X402Reconciler({ payerEnabled, source, asset: ASSET, agents, slots, payments }), slots, payments, asked };
}

test("reconciliation is a no-op while the payer is disabled", async () => {
  const w = await reconcileWorld(false, chainLogs(tx(9), ATTACKER, 1n, tx(1)));
  assert.deepEqual(await w.reconciler.run(), { skipped: "the x402 payer is disabled", checked: 0, alerts: [] });
  assert.equal(w.asked.length, 0, "no logs are even read");
  const noSource = new X402Reconciler({ payerEnabled: true, source: null, asset: ASSET, agents: new MemoryAgentStore(), slots: w.slots, payments: w.payments });
  assert.equal((await noSource.run()).skipped, "no settlement log source is configured");
});

test("reconciliation raises an unmatched alert for a settlement nobody logged, and none for a logged one", async () => {
  const logged = tx(7);
  const w = await reconcileWorld(true, [...chainLogs(logged, validator.payees[0]!, 50_000n, tx(1)), ...chainLogs(tx(8), ATTACKER, 50_000n, tx(2))]);
  await w.slots.claim({ account: ACCOUNT, epoch: 1n, slot: 0, nonce: logged, paymentKey: "a:1:nansen:/x", payTo: validator.payees[0]!, value: 50_000n, validAfter: 1n, validBefore: 2n, claimedAt: 1 });
  await w.payments.write({ key: "a:1:nansen:/x", provider: "nansen", price: 50_000n, summary: null, settlementRef: tx(1), anomaly: null, influencedDecision: null });
  const r = await w.reconciler.run();
  assert.equal(r.checked, 2);
  assert.deepEqual(r.alerts.map((a) => [a.type, a.settlement.nonce]), [["x402-settlement-unmatched", tx(8)]]);
  assert.deepEqual(w.asked, [[ACCOUNT]], "only active agents' accounts are asked about");
});

test("the x402-reconcile job logs each alert as an ALERT line and reports the count", async () => {
  const lines: string[] = [];
  const settlement = { authorizer: ACCOUNT, nonce: tx(8), to: ATTACKER, value: 1n, transactionHash: tx(2), blockNumber: 5n };
  const handlers = new WorkerJobHandlers({
    agents: new MemoryAgentStore(), runner: { tick: async () => null, evaluate: async () => null }, queue: new MemoryJobQueue(), locks: new MemoryAgentLocks(),
    settings: { tickIntervalMs: 60_000, evaluationDelayMs: 1_000, lockTtlMs: 10_000, lockRetryMs: 100 }, clock: () => new Date(),
    x402Reconciler: { run: async () => ({ skipped: null, checked: 1, alerts: [{ type: "x402-settlement-unmatched" as const, settlement }] }) },
    log: (m) => lines.push(m),
  });
  assert.deepEqual(parseJob("x402-reconcile", {}), { kind: "x402-reconcile" });
  const outcome = await handlers.handle({ kind: "x402-reconcile" });
  assert.deepEqual(outcome, { kind: "done", detail: "x402 reconciliation: 1 settlements checked, 1 alerts" });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^ALERT x402-settlement-unmatched authorizer 0x0+bb nonce 0x0+8 tx 0x0+2$/);
  const unconfigured = new WorkerJobHandlers({
    agents: new MemoryAgentStore(), runner: { tick: async () => null, evaluate: async () => null }, queue: new MemoryJobQueue(), locks: new MemoryAgentLocks(),
    settings: { tickIntervalMs: 60_000, evaluationDelayMs: 1_000, lockTtlMs: 10_000, lockRetryMs: 100 }, clock: () => new Date(),
  });
  assert.equal((await unconfigured.handle({ kind: "x402-reconcile" })).kind, "done");
});

test("the RPC log source reads the lookback window for both events and drops pending logs", async () => {
  const calls: { event: string; fromBlock: bigint; toBlock: bigint; args: Record<string, unknown> }[] = [];
  const client: LogReader = {
    getBlockNumber: async () => 1_000n,
    getLogs: async (a) => {
      calls.push({ event: a.event.name, fromBlock: a.fromBlock, toBlock: a.toBlock, args: a.args });
      const l = chainLogs(tx(3), ATTACKER, 1n, tx(4))[a.event.name === "AuthorizationUsed" ? 0 : 1]!;
      return [l, { ...l, transactionHash: null, blockNumber: null, logIndex: null }];
    },
  };
  const source = new RpcSettlementLogSource(client, 600n);
  assert.deepEqual(await source.logs(ASSET, []), []);
  const logs = await source.logs(ASSET, [ACCOUNT]);
  assert.equal(logs.length, 2);
  assert.deepEqual(calls.map((c) => [c.event, c.fromBlock, c.toBlock]), [["AuthorizationUsed", 400n, 1_000n], ["Transfer", 400n, 1_000n]]);
  assert.deepEqual(calls.map((c) => c.args), [{ authorizer: [ACCOUNT] }, { from: [ACCOUNT] }]);
});

test("the worker stores include the x402 nonce slots", () => {
  assert.ok(memoryWorkerStores().x402Slots instanceof MemoryX402SlotStore);
});
