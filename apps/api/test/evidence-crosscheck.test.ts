import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { InMemoryReadModelStore, decodeRow, defaultRegistry, spendPolicyEvents, type CrosscheckReport } from "@monadeum/indexer";
import { encodeAbiParameters, encodeEventTopics, keccak256, toHex, type Address, type Hex } from "viem";
import { EvidenceCrossCheck, blockOf, loadEvidenceCrossCheck, reasonCode, type CrossCheckBlock, type CrossCheckRunner } from "../src/evidence-crosscheck.js";
import { boot, call, index, type Booted } from "./harness.js";

// The HyperSync cross-check of the public evidence endpoint, with fakes only: no network and no Envio token.

const TOKEN = "envio-secret-token-value-123";
const POLICY = "0x1111111111111111111111111111111111111111" as Address;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as Address;
const SETTLEMENT = "0x4444444444444444444444444444444444444444" as Address;
const hash = (label: string): Hex => keccak256(toHex(label));

const report = (over: Partial<CrosscheckReport> = {}): CrosscheckReport => ({
  status: "match",
  range: { from: 100, to: 200 },
  source: "envio-hypersync",
  sourceHeight: 205,
  counts: { indexer: 3, source: 3 },
  matched: 3,
  missingInSource: [],
  missingInIndexer: [],
  fieldMismatches: [],
  ...over,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

class Clock {
  now = 1_000_000;
  read = () => this.now;
}

describe("the cache, the single flight, and the rate bound", () => {
  it("answers pending at once and never waits for the run", async () => {
    const clock = new Clock();
    let release: (r: CrosscheckReport) => void = () => undefined;
    const runner: CrossCheckRunner = () => new Promise((resolve) => (release = resolve));
    const check = new EvidenceCrossCheck(runner, clock.read);
    const first = check.snapshot();
    assert.equal(first.status, "unverified");
    assert.equal(first.reason, "pending");
    assert.equal(first.checkedAt, null);
    await tick();
    release(report());
    await check.settled();
    const second = check.snapshot();
    assert.equal(second.status, "match");
    assert.equal(second.reason, undefined);
    assert.deepEqual(second.counts, { indexer: 3, hypersync: 3 });
    assert.deepEqual(second.range, { from: "100", to: "200" });
    assert.equal(second.hypersyncHeight, "205");
    assert.equal(second.checkedAt, new Date(clock.now).toISOString());
  });

  it("starts one run for many callers and none while the cache is fresh", async () => {
    const clock = new Clock();
    let runs = 0;
    const check = new EvidenceCrossCheck(async () => (runs++, report()), clock.read, { freshMs: 60_000 });
    for (let i = 0; i < 50; i++) check.snapshot();
    await check.settled();
    assert.equal(runs, 1);
    clock.now += 59_000;
    for (let i = 0; i < 50; i++) check.snapshot();
    await check.settled();
    assert.equal(runs, 1);
    clock.now += 2_000;
    check.snapshot();
    await check.settled();
    assert.equal(runs, 2);
  });

  it("serves the previous result while a refresh runs", async () => {
    const clock = new Clock();
    let release: (r: CrosscheckReport) => void = () => undefined;
    let n = 0;
    const check = new EvidenceCrossCheck(() => (n++ === 0 ? Promise.resolve(report()) : new Promise((resolve) => (release = resolve))), clock.read, { freshMs: 1000 });
    check.snapshot();
    await check.settled();
    clock.now += 5_000;
    assert.equal(check.snapshot().status, "match");
    assert.equal(check.snapshot().status, "match");
    await tick();
    release(report({ status: "mismatch", fieldMismatches: [{ kind: "spend.spent", blockNumber: 1, logIndex: 0, transactionHash: hash("t"), field: "data.amount", indexer: "1", source: "2" }] }));
    await check.settled();
    const next = check.snapshot();
    assert.equal(next.status, "mismatch");
    assert.equal(next.fieldMismatches, 1);
  });

  it("starts at most maxRunsPerMinute runs in any minute, whatever the request rate", async () => {
    const clock = new Clock();
    let runs = 0;
    const check = new EvidenceCrossCheck(async () => (runs++, report()), clock.read, { freshMs: 0, maxRunsPerMinute: 2 });
    for (let i = 0; i < 100; i++) {
      check.snapshot();
      await check.settled();
      clock.now += 100;
    }
    assert.equal(runs, 2);
    clock.now += 60_000;
    check.snapshot();
    await check.settled();
    assert.equal(runs, 3);
  });

  it("serves a result older than maxStaleMs as unverified, never as a match", async () => {
    const clock = new Clock();
    const check = new EvidenceCrossCheck(async () => report(), clock.read, { maxRunsPerMinute: 1 });
    check.snapshot();
    await check.settled();
    assert.equal(check.snapshot().status, "match");
    clock.now += 601_000;
    const stale = check.snapshot();
    assert.equal(stale.status, "unverified");
    assert.equal(stale.reason, "stale");
  });

  it("records a failing run as unverified without the error text", async () => {
    const check = new EvidenceCrossCheck(async () => Promise.reject(new Error(`connect ECONNREFUSED https://x.example/?token=${TOKEN}`)), new Clock().read);
    check.snapshot();
    await check.settled();
    const block = check.snapshot();
    assert.equal(block.status, "unverified");
    assert.equal(block.reason, "unavailable");
    assert.ok(!JSON.stringify(block).includes(TOKEN));
    assert.ok(!JSON.stringify(block).includes("ECONNREFUSED"));
  });

  it("records a hanging run as a timeout and starts nothing new while it is outstanding", async () => {
    const clock = new Clock();
    let runs = 0;
    let release: (r: CrosscheckReport) => void = () => undefined;
    const check = new EvidenceCrossCheck(() => (runs++, new Promise((resolve) => (release = resolve))), clock.read, { freshMs: 0, maxRunsPerMinute: 10, runTimeoutMs: 20 });
    check.snapshot();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const block = check.snapshot();
    assert.equal(block.status, "unverified");
    assert.equal(block.reason, "timeout");
    clock.now += 1000;
    check.snapshot();
    assert.equal(runs, 1);
    release(report());
    await check.settled();
    // The late result does not overwrite the recorded timeout; the next refresh decides.
    assert.equal(check.snapshot().reason, "timeout");
  });

  it("a synchronous throw in the runner is unavailable, not a crash", async () => {
    const check = new EvidenceCrossCheck(() => {
      throw new Error("boom");
    }, new Clock().read);
    check.snapshot();
    await check.settled();
    assert.equal(check.snapshot().reason, "unavailable");
  });
});

describe("the public form of a report", () => {
  it("carries counts and a range only", () => {
    const withRows = report({
      status: "mismatch",
      missingInSource: [{ kind: "spend.spent", blockNumber: 150, logIndex: 1, transactionHash: hash("a") }],
      missingInIndexer: [{ kind: "spend.spent", blockNumber: 151, logIndex: 0, transactionHash: hash("b") }],
      fieldMismatches: [{ kind: "spend.spent", blockNumber: 152, logIndex: 0, transactionHash: hash("c"), field: "data.amount", indexer: "1", source: "2" }],
    });
    const block = blockOf(withRows, Date.parse("2026-10-13T00:00:00.000Z"));
    assert.deepEqual(block.missing, { inHyperSync: 1, inIndexer: 1 });
    assert.equal(block.fieldMismatches, 1);
    assert.equal(block.checkedAt, "2026-10-13T00:00:00.000Z");
    const text = JSON.stringify(block);
    for (const secret of [hash("a"), hash("b"), hash("c"), "data.amount"]) assert.ok(!text.includes(secret));
  });

  it("maps a report's reason to a stable code and never passes the text through", () => {
    assert.equal(reasonCode("envio-hypersync has indexed up to block 5, below 9"), "lagging");
    assert.equal(reasonCode("the read-model has no cursor yet"), "no-cursor");
    assert.equal(reasonCode("the range is wider than 10 blocks"), "range");
    assert.equal(reasonCode("HyperSync did not finish within 200 pages"), "too-large");
    assert.equal(reasonCode(`401 unauthorized for ${TOKEN}`), "unavailable");
    assert.equal(reasonCode(undefined), "unavailable");
    const block = blockOf(report({ status: "unverified", reason: `bad ${TOKEN}` }), 0);
    assert.equal(block.reason, "unavailable");
  });
});

// The runtime: the real comparison over an in-memory read-model with one stored row, against a fake HyperSync.

const env = {
  ENVIO_API_TOKEN: TOKEN,
  INDEXER_CHAIN_ID: "10143",
  INDEXER_SPEND_POLICY_ADDRESS: POLICY,
  INDEXER_SETTLEMENT_ASSET_ADDRESS: SETTLEMENT,
  INDEXER_START_BLOCK: "1",
};

const registry = defaultRegistry({ spendPolicy: POLICY, entryPoint: "0x0000000071727de22e5e9d8baf0edac6f37da032", kernelFactory: "0xd703aae79538628d27099b8c4f621be4ccd142d5", settlementAsset: SETTLEMENT });

function limitsLog(dailyCap: bigint) {
  return {
    address: POLICY,
    topics: encodeEventTopics({ abi: spendPolicyEvents, eventName: "LimitsSet", args: { account: ACCOUNT } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint128" }, { type: "uint128" }], [5_000_000n, dailyCap]),
    blockNumber: 150n,
    blockHash: hash("block-150"),
    transactionHash: hash("tx-150"),
    logIndex: 0,
  };
}

async function storeWith(dailyCap: bigint): Promise<InMemoryReadModelStore> {
  const store = new InMemoryReadModelStore();
  const log = limitsLog(dailyCap);
  const handler = registry.list().find((h) => h.name === "agent-spend-policy")!;
  const row = decodeRow(handler, log)!;
  await store.apply({
    events: [{ ...row, address: log.address, blockNumber: log.blockNumber, blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: log.logIndex }],
    blocks: [{ number: 200n, hash: hash("block-200") }],
    discovered: [{ account: ACCOUNT, firstBlock: 150n }],
    cursor: { number: 200n, hash: hash("block-200") },
    pruneBelow: 0n,
    finalized: true,
  });
  return store;
}

const fakeSource = (over: { height?: () => Promise<bigint>; logs?: () => Promise<ReturnType<typeof limitsLog>[]> } = {}) => ({
  name: "fake-hypersync",
  height: over.height ?? (async () => 210n),
  logs: over.logs ?? (async () => [limitsLog(20_000_000n)]),
});

async function runtime(store: InMemoryReadModelStore, source: ReturnType<typeof fakeSource>, extraEnv: Record<string, string | undefined> = {}) {
  const lines: string[] = [];
  const clock = new Clock();
  const check = loadEvidenceCrossCheck({ ...env, ...extraEnv }, store, { source, now: clock.read, log: (m) => lines.push(m) });
  assert.ok(check);
  check.snapshot();
  await check.settled();
  return { block: check.snapshot(), lines };
}

describe("the runtime over the read-model and a fake HyperSync", () => {
  it("is a match when both sides hold the same rows", async () => {
    const { block } = await runtime(await storeWith(20_000_000n), fakeSource());
    assert.equal(block.status, "match");
    assert.deepEqual(block.counts, { indexer: 1, hypersync: 1 });
    assert.equal(block.matched, 1);
    assert.deepEqual(block.range, { from: "1", to: "200" });
    assert.equal(block.hypersyncHeight, "210");
  });

  it("is a mismatch when a field differs, and when a row is missing on either side", async () => {
    const field = await runtime(await storeWith(20_000_000n), fakeSource({ logs: async () => [limitsLog(30_000_000n)] }));
    assert.equal(field.block.status, "mismatch");
    assert.equal(field.block.fieldMismatches, 1);
    const missing = await runtime(await storeWith(20_000_000n), fakeSource({ logs: async () => [] }));
    assert.equal(missing.block.status, "mismatch");
    assert.deepEqual(missing.block.missing, { inHyperSync: 1, inIndexer: 0 });
  });

  it("is unverified when HyperSync is unreachable, and the token is neither returned nor logged", async () => {
    const { block, lines } = await runtime(
      await storeWith(20_000_000n),
      fakeSource({ logs: async () => Promise.reject(new Error(`connect ECONNREFUSED, header authorization: Bearer ${TOKEN}`)) }),
    );
    assert.equal(block.status, "unverified");
    assert.equal(block.reason, "unavailable");
    assert.ok(!JSON.stringify(block).includes(TOKEN));
    assert.ok(!lines.join("\n").includes(TOKEN));
  });

  it("is unverified when HyperSync lags behind the range", async () => {
    const { block } = await runtime(await storeWith(20_000_000n), fakeSource({ height: async () => 120n }));
    assert.equal(block.status, "unverified");
    assert.equal(block.reason, "lagging");
    assert.equal(block.hypersyncHeight, "120");
  });

  it("is unverified before the read-model has a cursor", async () => {
    const { block } = await runtime(new InMemoryReadModelStore(), fakeSource());
    assert.equal(block.status, "unverified");
    assert.equal(block.reason, "no-cursor");
  });

  it("caps the window: the range never starts earlier than the window allows", async () => {
    // Like HyperSync, the fake returns only logs inside the asked range.
    const inRange = { height: async () => 210n, name: "fake-hypersync", logs: async (q: { fromBlock?: bigint; toBlock?: bigint }) => [limitsLog(20_000_000n)].filter((l) => l.blockNumber >= (q.fromBlock ?? 0n) && l.blockNumber <= (q.toBlock ?? 0n)) };
    const { block } = await runtime(await storeWith(20_000_000n), inRange as unknown as ReturnType<typeof fakeSource>, { API_CROSSCHECK_WINDOW_BLOCKS: "50" });
    assert.deepEqual(block.range, { from: "151", to: "200" });
    // The only row is at block 150, outside the window: nothing is compared on either side, and the counts say so.
    assert.equal(block.status, "match");
    assert.deepEqual(block.counts, { indexer: 0, hypersync: 0 });
  });

  it("is off without a token, and with a configuration it cannot read", () => {
    const lines: string[] = [];
    assert.equal(loadEvidenceCrossCheck({ ...env, ENVIO_API_TOKEN: undefined }, new InMemoryReadModelStore(), { log: (m) => lines.push(m) }), null);
    assert.equal(loadEvidenceCrossCheck({ ...env, ENVIO_API_TOKEN: "  " }, new InMemoryReadModelStore()), null);
    assert.equal(loadEvidenceCrossCheck({ ENVIO_API_TOKEN: TOKEN }, new InMemoryReadModelStore(), { log: (m) => lines.push(m) }), null);
    assert.equal(loadEvidenceCrossCheck({ ...env, API_CROSSCHECK_WINDOW_BLOCKS: "999999999" }, new InMemoryReadModelStore(), { log: (m) => lines.push(m) }), null);
    assert.equal(loadEvidenceCrossCheck({ ...env, ENVIO_HYPERSYNC_URL: "http://insecure.example" }, new InMemoryReadModelStore(), { log: (m) => lines.push(m) }), null);
    assert.ok(lines.length >= 3);
    assert.ok(!lines.join("\n").includes(TOKEN));
  });
});

describe("GET /public/evidence", () => {
  let off: Booted;
  let on: Booted;
  let runs = 0;
  let down = false;
  let block: CrossCheckBlock | null = null;

  before(async () => {
    off = await boot("memory");
    const check = new EvidenceCrossCheck(async () => {
      runs++;
      if (down) throw new Error(`ECONNREFUSED ${TOKEN}`);
      return report();
    });
    on = await boot("memory", { crossCheck: check });
  });
  after(async () => {
    await off.close();
    await on.close();
  });

  it("has no crossCheck field when the feature is off, and the document is otherwise the same", async () => {
    const res = await call(off.app, "GET", "/public/evidence");
    assert.equal(res.status, 200);
    assert.ok(!("crossCheck" in res.body));
    assert.equal(res.body.chainId, 10143);
  });

  it("answers at once with a pending field, then the result, and the rest of the document is unaffected", async () => {
    await index(on, "0x00000000000000000000000000000000000000ab", [{ kind: "spend.spent", data: { amount: "5", windowTotal: "5" } }]);
    const first = await call(on.app, "GET", "/public/evidence");
    assert.equal(first.status, 200);
    assert.equal(first.body.crossCheck.source, "envio-hypersync");
    assert.equal(first.body.crossCheck.status, "unverified");
    assert.equal(first.body.crossCheck.reason, "pending");
    assert.equal(first.body.events.spent.count, 1);
    await on.deps.crossCheck!.settled();
    const second = await call(on.app, "GET", "/public/evidence");
    block = second.body.crossCheck;
    assert.equal(block!.status, "match");
    assert.deepEqual(Object.keys(block!).sort(), ["checkedAt", "counts", "fieldMismatches", "hypersyncHeight", "matched", "missing", "range", "source", "status"]);
    assert.equal(runs, 1);
  });

  it("does not call the source again for repeated requests", async () => {
    for (let i = 0; i < 20; i++) await call(on.app, "GET", "/public/evidence");
    assert.equal(runs, 1);
  });

  it("keeps serving the evidence when HyperSync is down, and the field is never green then", async () => {
    down = true;
    const clock = { now: Date.now() + 120_000 };
    const check = new EvidenceCrossCheck(async () => {
      throw new Error(`ECONNREFUSED ${TOKEN}`);
    }, () => clock.now);
    const failing = await boot("memory", { crossCheck: check });
    try {
      await index(failing, "0x00000000000000000000000000000000000000ab", [{ kind: "spend.spent", data: { amount: "5", windowTotal: "5" } }]);
      await call(failing.app, "GET", "/public/evidence");
      await check.settled();
      const res = await call(failing.app, "GET", "/public/evidence");
      assert.equal(res.status, 200);
      assert.equal(res.body.events.spent.count, 1);
      assert.equal(res.body.crossCheck.status, "unverified");
      assert.equal(res.body.crossCheck.reason, "unavailable");
      assert.ok(!JSON.stringify(res.body).includes(TOKEN));
    } finally {
      await failing.close();
    }
  });

  it("contains no token, no private data, and no timestamp inside the comparison", async () => {
    const res = await call(on.app, "GET", "/public/evidence");
    const text = JSON.stringify(res.body.crossCheck);
    assert.ok(!text.includes(TOKEN));
    assert.ok(!/0x[0-9a-f]{40}/i.test(text));
    const { checkedAt, ...comparison } = res.body.crossCheck;
    assert.ok(!Number.isNaN(Date.parse(checkedAt)));
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(JSON.stringify(comparison)));
  });
});
