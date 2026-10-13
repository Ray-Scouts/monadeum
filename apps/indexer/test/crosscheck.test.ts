import assert from "node:assert/strict";
import { test } from "node:test";
import type { AbiEvent, Address } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { crosscheck, type LogSource } from "../src/crosscheck/compare.js";
import { HyperSyncLogSource, type HyperSyncClientLike, type HyperSyncQuery, type HyperSyncResponse } from "../src/crosscheck/hypersync.js";
import { exitCode, parseArgs, redact, runCrosscheck } from "../src/crosscheck/main.js";
import { entryPointEvents, reallocationEvents, spendPolicyEvents } from "../src/handlers/abi.js";
import { defaultRegistry } from "../src/handlers/index.js";
import { Indexer, type SyncOptions } from "../src/indexer.js";
import { InMemoryReadModelStore } from "../src/store.js";
import type { LogQuery, RawLog } from "../src/types.js";
import { MockChain, type LogSpec } from "./mock-chain.js";

const POLICY = "0x1111111111111111111111111111111111111111" as Address;
const ENTRY_POINT = entryPoint07Address.toLowerCase() as Address;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as Address;
const FACTORY = "0xd703aae79538628d27099b8c4f621be4ccd142d5" as Address;
const USDC = "0x4444444444444444444444444444444444444444" as Address;

const options: SyncOptions = { startBlock: 1n, batchSize: 100n, syncTo: "confirmations", confirmations: 0n, reorgWindow: 50n };
const registryInput = { spendPolicy: POLICY, entryPoint: ENTRY_POINT, kernelFactory: FACTORY, settlementAsset: USDC };
const registry = defaultRegistry(registryInput);

const named = (events: readonly AbiEvent[], name: string) => events.find((e) => e.name === name)!;
const policy = (name: string, args: Record<string, unknown>): LogSpec => ({ address: POLICY, event: named(spendPolicyEvents, name), args });
const deployed: LogSpec = {
  address: ENTRY_POINT,
  event: entryPointEvents[0]!,
  args: { userOpHash: `0x${"ab".repeat(32)}`, sender: ACCOUNT, factory: FACTORY, paymaster: "0x0000000000000000000000000000000000000000" },
};

/** Blocks 1 and 2 hold the account's deployment, limits, and one spend. */
function scenario(overrides: { perTxCap?: bigint; extraSpend?: boolean; dropSpend?: boolean } = {}): MockChain {
  const first = [deployed, policy("LimitsSet", { account: ACCOUNT, perTxCap: overrides.perTxCap ?? 5_000_000n, dailyCap: 20_000_000n })];
  const second: LogSpec[] = [];
  if (!overrides.dropSpend) second.push(policy("Spent", { account: ACCOUNT, amount: 1_000_000n, windowTotal: 1_000_000n }));
  if (overrides.extraSpend) second.push(policy("Spent", { account: ACCOUNT, amount: 2_000_000n, windowTotal: 3_000_000n }));
  return new MockChain().mine(1, [first]).mine(1, [second]).mine(3);
}

/** What the indexer stores from `chain`, synced to the head. */
async function indexed(chain: MockChain) {
  const store = new InMemoryReadModelStore();
  const indexer = new Indexer(chain, store, defaultRegistry(registryInput), options);
  for (let i = 0; i < 100; i++) if ((await indexer.syncOnce()).status === "idle") return store;
  throw new Error("did not converge");
}

/** An independent source backed by an in-memory chain. */
function sourceOf(chain: MockChain, behaviour: { height?: () => Promise<bigint>; logs?: (q: LogQuery) => Promise<RawLog[]> } = {}): LogSource {
  return {
    name: "fake-source",
    height: behaviour.height ?? (async () => chain.headBlockNumber()),
    logs: behaviour.logs ?? ((q) => chain.logs(q)),
  };
}

test("identical sets over the range are a match", async () => {
  const chain = scenario();
  const store = await indexed(chain);
  const report = await crosscheck({ source: sourceOf(chain), store, registry, from: 1n, to: 4n });
  assert.equal(report.status, "match");
  assert.deepEqual(report.counts, { indexer: 3, source: 3 });
  assert.equal(report.matched, 3);
  assert.deepEqual([report.missingInSource, report.missingInIndexer, report.fieldMismatches], [[], [], []]);
  assert.equal(exitCode(report), 0);
});

test("the report is deterministic: the same inputs give the same JSON", async () => {
  const chain = scenario();
  const store = await indexed(chain);
  const run = async () => JSON.stringify(await crosscheck({ source: sourceOf(chain), store, registry, from: 1n, to: 4n }));
  assert.equal(await run(), await run());
});

test("a row the indexer stored that the source lacks is reported as missing in the source", async () => {
  const store = await indexed(scenario());
  const report = await crosscheck({ source: sourceOf(scenario({ dropSpend: true })), store, registry, from: 1n, to: 4n });
  assert.equal(report.status, "mismatch");
  assert.equal(report.matched, 2);
  assert.deepEqual(report.missingInSource.map((r) => [r.kind, r.blockNumber, r.logIndex]), [["spend.spent", 2, 0]]);
  assert.deepEqual(report.missingInIndexer, []);
  assert.equal(exitCode(report), 1);
});

test("a row the source has that the indexer did not store is reported as missing in the indexer", async () => {
  const store = await indexed(scenario());
  const report = await crosscheck({ source: sourceOf(scenario({ extraSpend: true })), store, registry, from: 1n, to: 4n });
  assert.equal(report.status, "mismatch");
  assert.deepEqual(report.missingInIndexer.map((r) => [r.kind, r.blockNumber, r.logIndex]), [["spend.spent", 2, 1]]);
  assert.deepEqual(report.missingInSource, []);
});

test("a differing field is reported with both values", async () => {
  const store = await indexed(scenario());
  const report = await crosscheck({ source: sourceOf(scenario({ perTxCap: 6_000_000n })), store, registry, from: 1n, to: 4n });
  assert.equal(report.status, "mismatch");
  assert.equal(report.matched, 2);
  assert.deepEqual(
    report.fieldMismatches.map((m) => [m.kind, m.field, m.indexer, m.source]),
    [["spend.limits-set", "data.perTxCap", "5000000", "6000000"]],
  );
});

test("a different block hash for the same row is a field mismatch", async () => {
  const chain = scenario();
  const store = await indexed(chain);
  const forked = scenario();
  forked.reorg(1, 5, [[deployed, policy("LimitsSet", { account: ACCOUNT, perTxCap: 5_000_000n, dailyCap: 20_000_000n })], [policy("Spent", { account: ACCOUNT, amount: 1_000_000n, windowTotal: 1_000_000n })]], "other");
  const report = await crosscheck({ source: sourceOf(forked), store, registry, from: 1n, to: 4n });
  assert.equal(report.status, "mismatch");
  assert.ok(report.fieldMismatches.some((m) => m.field === "blockHash"));
});

test("rows outside the range are not compared", async () => {
  const chain = scenario();
  const store = await indexed(chain);
  const report = await crosscheck({ source: sourceOf(chain), store, registry, from: 2n, to: 4n });
  assert.equal(report.status, "match");
  assert.equal(report.counts.indexer, 1);
});

test("an unreachable source is unverified, never a match", async () => {
  const chain = scenario();
  const store = await indexed(chain);
  const height = await crosscheck({ source: sourceOf(chain, { height: async () => Promise.reject(new Error("connect ECONNREFUSED")) }), store, registry, from: 1n, to: 4n });
  assert.equal(height.status, "unverified");
  assert.match(height.reason!, /ECONNREFUSED/);
  assert.equal(exitCode(height), 2);
  const logs = await crosscheck({ source: sourceOf(chain, { logs: async () => Promise.reject(new Error("429 rate limited")) }), store, registry, from: 1n, to: 4n });
  assert.equal(logs.status, "unverified");
  assert.deepEqual([logs.matched, logs.missingInSource, logs.missingInIndexer, logs.fieldMismatches], [0, [], [], []]);
});

test("a source that has not reached the range is unverified", async () => {
  const chain = scenario();
  const store = await indexed(chain);
  const report = await crosscheck({ source: sourceOf(chain, { height: async () => 2n }), store, registry, from: 1n, to: 4n });
  assert.equal(report.status, "unverified");
  assert.match(report.reason!, /below 4/);
});

test("a range above the stored cursor, an empty store, a wide range, and too many logs are unverified", async () => {
  const chain = scenario();
  const store = await indexed(chain);
  const above = await crosscheck({ source: sourceOf(chain), store, registry, from: 1n, to: 99n });
  assert.match(above.reason!, /above the stored cursor/);
  const none = await crosscheck({ source: sourceOf(chain), store: new InMemoryReadModelStore(), registry, from: 1n, to: 4n });
  assert.match(none.reason!, /no cursor/);
  const wide = await crosscheck({ source: sourceOf(chain), store, registry, from: 1n, to: 4n, maxBlocks: 3n });
  assert.match(wide.reason!, /wider than 3/);
  const many = await crosscheck({ source: sourceOf(chain), store, registry, from: 1n, to: 4n, maxLogs: 1 });
  assert.match(many.reason!, /more than 1 logs/);
  const backwards = await crosscheck({ source: sourceOf(chain), store, registry, from: 4n, to: 1n });
  assert.equal(backwards.status, "unverified");
});

test("the cross-check never writes the store", async () => {
  const chain = scenario();
  const store = await indexed(chain);
  const before = JSON.stringify([await store.cursor(), await store.events(), await store.trackedAccounts()], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  await crosscheck({ source: sourceOf(scenario({ perTxCap: 1n })), store, registry, from: 1n, to: 4n });
  const after = JSON.stringify([await store.cursor(), await store.events(), await store.trackedAccounts()], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  assert.equal(after, before);
});

// HyperSyncLogSource over a fake client.

const SPEND_QUERY: LogQuery = { fromBlock: 1n, toBlock: 4n, address: [POLICY], topics: [[`0x${"aa".repeat(32)}`]] };

function goodLog(overrides: Record<string, unknown> = {}) {
  return {
    removed: false,
    logIndex: 0,
    transactionHash: `0x${"11".repeat(32)}`,
    blockHash: `0x${"22".repeat(32)}`,
    blockNumber: 2,
    address: POLICY.toUpperCase().replace("0X", "0x"),
    data: "0x",
    topics: [`0x${"AA".repeat(32)}`, null, undefined, null],
    ...overrides,
  };
}

function clientOf(pages: HyperSyncResponse[], seen: HyperSyncQuery[] = []): HyperSyncClientLike {
  let i = 0;
  return { getHeight: async () => 10, get: async (q) => (seen.push(q), pages[Math.min(i++, pages.length - 1)]!) };
}

test("HyperSync: follows nextBlock across pages, sends an exclusive toBlock, and normalizes logs", async () => {
  const seen: HyperSyncQuery[] = [];
  const source = new HyperSyncLogSource(
    clientOf(
      [
        { nextBlock: 3, data: { logs: [goodLog({ blockNumber: 2 })] } },
        { nextBlock: 5, data: { logs: [goodLog({ blockNumber: 4, logIndex: 1 })] } },
      ],
      seen,
    ),
  );
  const logs = await source.logs(SPEND_QUERY);
  assert.deepEqual(seen.map((q) => [q.fromBlock, q.toBlock]), [[1, 5], [3, 5]]);
  assert.deepEqual(seen[0]!.logs, [{ address: [POLICY], topics: [[`0x${"aa".repeat(32)}`]] }]);
  assert.deepEqual(logs.map((l) => [l.blockNumber, l.logIndex]), [[2n, 0], [4n, 1]]);
  assert.equal(logs[0]!.address, POLICY);
  assert.deepEqual(logs[0]!.topics, [`0x${"aa".repeat(32)}`]);
  assert.equal(await source.height(), 10n);
});

test("HyperSync: a null topic position is sent as match-anything", async () => {
  const seen: HyperSyncQuery[] = [];
  const source = new HyperSyncLogSource(clientOf([{ nextBlock: 5, data: { logs: [] } }], seen));
  await source.logs({ ...SPEND_QUERY, topics: [[`0x${"aa".repeat(32)}`], null, [`0x${"BB".repeat(32)}`]] });
  assert.deepEqual(seen[0]!.logs[0]!.topics, [[`0x${"aa".repeat(32)}`], [], [`0x${"bb".repeat(32)}`]]);
});

test("HyperSync: malformed or unexpected responses throw", async () => {
  const bad: [string, HyperSyncResponse | unknown][] = [
    ["a page that does not advance", { nextBlock: 1, data: { logs: [] } }],
    ["no data", { nextBlock: 5 }],
    ["a removed log", { nextBlock: 5, data: { logs: [goodLog({ removed: true })] } }],
    ["a log outside the range", { nextBlock: 5, data: { logs: [goodLog({ blockNumber: 9 })] } }],
    ["a log from another address", { nextBlock: 5, data: { logs: [goodLog({ address: USDC })] } }],
    ["a bad block hash", { nextBlock: 5, data: { logs: [goodLog({ blockHash: "0x12" })] } }],
    ["a missing log index", { nextBlock: 5, data: { logs: [goodLog({ logIndex: undefined })] } }],
    ["a bad topic", { nextBlock: 5, data: { logs: [goodLog({ topics: ["nope"] })] } }],
  ];
  for (const [label, response] of bad) {
    const source = new HyperSyncLogSource(clientOf([response as HyperSyncResponse]));
    await assert.rejects(() => source.logs(SPEND_QUERY), `${label} should throw`);
  }
});

test("HyperSync: page and log bounds fail closed", async () => {
  const forever: HyperSyncResponse[] = [1, 2, 3, 4, 5].map((n) => ({ nextBlock: n + 1, data: { logs: [] } }));
  await assert.rejects(() => new HyperSyncLogSource(clientOf(forever), { maxPages: 2 }).logs({ ...SPEND_QUERY, toBlock: 100n }), /2 pages/);
  const two = { nextBlock: 5, data: { logs: [goodLog(), goodLog({ logIndex: 1 })] } };
  await assert.rejects(() => new HyperSyncLogSource(clientOf([two]), { maxLogs: 1 }).logs(SPEND_QUERY), /more than 1 logs/);
  const broken: HyperSyncClientLike = { getHeight: async () => Promise.reject(new Error("timeout")), get: async () => Promise.reject(new Error("timeout")) };
  await assert.rejects(() => new HyperSyncLogSource(broken).height(), /timeout/);
  await assert.rejects(() => new HyperSyncLogSource({ ...broken, getHeight: async () => -1 }).height(), /invalid height/);
});

test("end to end: the HyperSync source over a fake client matches the indexer, and a tampered log does not", async () => {
  const chain = scenario();
  const store = await indexed(chain);
  const clientFor = (tamper: boolean): HyperSyncClientLike => ({
    getHeight: async () => chain.headBlockNumber().then(Number),
    get: async (q) => {
      const filter = q.logs[0]!;
      const topics = (filter.topics ?? []).map((t) => (t.length === 0 ? null : (t as `0x${string}`[])));
      const raw = await chain.logs({ fromBlock: BigInt(q.fromBlock), toBlock: BigInt(q.toBlock! - 1), address: (filter.address ?? []) as Address[], topics });
      return {
        nextBlock: q.toBlock!,
        data: {
          logs: raw.map((l) => ({
            logIndex: l.logIndex,
            blockNumber: Number(l.blockNumber),
            blockHash: l.blockHash,
            transactionHash: l.transactionHash,
            address: l.address,
            data: tamper && l.logIndex === 1 ? l.data.replace(/0$/, "1") : l.data,
            topics: l.topics,
          })),
        },
      };
    },
  });
  const good = await crosscheck({ source: new HyperSyncLogSource(clientFor(false)), store, registry, from: 1n, to: 4n });
  assert.equal(good.status, "match");
  assert.equal(good.source, "envio-hypersync");
  const bad = await crosscheck({ source: new HyperSyncLogSource(clientFor(true)), store, registry, from: 1n, to: 4n });
  assert.equal(bad.status, "mismatch");
});

// CLI helpers.

test("parseArgs reads the range, ignores a bare --, and rejects anything else", () => {
  assert.deepEqual(parseArgs(["--", "--from", "70167444", "--to", "70167999"]), { from: 70167444n, to: 70167999n, maxBlocks: undefined });
  assert.equal(parseArgs(["--from", "1", "--to", "2", "--max-blocks", "5"]).maxBlocks, 5n);
  assert.throws(() => parseArgs(["--from", "1"]), /usage/);
  assert.throws(() => parseArgs(["--from", "x", "--to", "2"]), /integer/);
  assert.throws(() => parseArgs(["--token", "abc"]), /unexpected/);
});

const env = {
  INDEXER_CHAIN_ID: "10143",
  INDEXER_SPEND_POLICY_ADDRESS: POLICY,
  INDEXER_SETTLEMENT_ASSET_ADDRESS: USDC,
  INDEXER_START_BLOCK: "1",
};

test("runCrosscheck without a token or a database is unverified and never reaches the network", async () => {
  const noToken = await runCrosscheck({ env, args: { from: 1n, to: 2n } });
  assert.equal(noToken.status, "unverified");
  assert.match(noToken.reason!, /ENVIO_API_TOKEN is not set/);
  const plain = await runCrosscheck({ env: { ...env, ENVIO_API_TOKEN: "secret-token" }, args: { from: 1n, to: 2n }, source: sourceOf(scenario()) });
  assert.equal(plain.status, "unverified");
  assert.match(plain.reason!, /DATABASE_URL is not set/);
  const insecure = await runCrosscheck({ env: { ...env, ENVIO_API_TOKEN: "secret-token", ENVIO_HYPERSYNC_URL: "http://example.com" }, args: { from: 1n, to: 2n } });
  assert.match(insecure.reason!, /https/);
});

test("runCrosscheck over an injected store and source reports a match", async () => {
  const chain = scenario();
  const report = await runCrosscheck({ env, args: { from: 1n, to: 4n }, source: sourceOf(chain), store: await indexed(chain) });
  assert.equal(report.status, "match");
});

test("redact removes the token from an error message and the report never carries it", async () => {
  assert.equal(redact(new Error("401 for token abc123 at url"), "abc123"), "401 for token [redacted] at url");
  const chain = scenario();
  const leak = sourceOf(chain, { height: async () => Promise.reject(new Error("bad token abc123")) });
  const report = await runCrosscheck({ env: { ...env, ENVIO_API_TOKEN: "abc123" }, args: { from: 1n, to: 4n }, source: leak, store: await indexed(chain) });
  assert.equal(report.status, "unverified");
  assert.ok(!JSON.stringify(report).includes("abc123"));
});

// Reallocation handlers, registered when INDEXER_REALLOCATION_ADDRESS is set.

test("with the reallocation handlers registered, its rows are cross-checked and a changed amount is reported", async () => {
  const REALLOCATION = "0x5555555555555555555555555555555555555555" as Address;
  const OWNER = "0x6666666666666666666666666666666666666666" as Address;
  const SINK = "0x7777777777777777777777777777777777777777" as Address;
  const realloc = (name: string, args: Record<string, unknown>): LogSpec => ({ address: REALLOCATION, event: named(reallocationEvents, name), args });
  const deployment = (account: Address): LogSpec[] => [
    { ...deployed, args: { ...deployed.args, sender: account } },
    policy("LimitsSet", { account, perTxCap: 5_000_000n, dailyCap: 20_000_000n }),
  ];
  const build = (amount: bigint, withMove = true) =>
    new MockChain().mine(4, [
      [...deployment(ACCOUNT), ...deployment(SINK)],
      [realloc("AgentRegistered", { account: ACCOUNT, owner: OWNER, principal: 10_000_000n }), realloc("PolicyCommitted", { owner: OWNER, policyHash: `0x${"cd".repeat(32)}`, nonce: 0n })],
      withMove ? [realloc("EvaluationAdvanced", { evaluation: 1n }), realloc("Reallocated", { owner: OWNER, source: ACCOUNT, sink: SINK, amount, evaluation: 1n })] : [],
      [],
    ]);
  const withRealloc = defaultRegistry({ ...registryInput, reallocation: REALLOCATION });
  const chain = build(2_000_000n);
  const store = new InMemoryReadModelStore();
  const indexer = new Indexer(chain, store, withRealloc, options);
  for (let i = 0; i < 100 && (await indexer.syncOnce()).status !== "idle"; i++);

  const match = await crosscheck({ source: sourceOf(chain), store, registry: withRealloc, from: 1n, to: 4n });
  assert.equal(match.status, "match");
  // deploy x2, limits x2, registered, committed (no account), advanced (no account), sent, received.
  assert.equal(match.counts.indexer, 9);

  const changed = await crosscheck({ source: sourceOf(build(3_000_000n)), store, registry: withRealloc, from: 1n, to: 4n });
  assert.equal(changed.status, "mismatch");
  assert.deepEqual(changed.fieldMismatches.map((m) => [m.kind, m.field]).sort(), [["reallocation.received", "data.amount"], ["reallocation.sent", "data.amount"]]);

  const lacking = await crosscheck({ source: sourceOf(build(2_000_000n, false)), store, registry: withRealloc, from: 1n, to: 4n });
  assert.deepEqual(lacking.missingInSource.map((r) => r.kind).sort(), ["reallocation.evaluation-advanced", "reallocation.received", "reallocation.sent"]);

  // Without the handlers registered, the reallocation contract is not asked about, so its rows are not compared.
  const without = await crosscheck({ source: sourceOf(chain), store, registry, from: 1n, to: 4n });
  assert.equal(without.counts.source, 4);
});
