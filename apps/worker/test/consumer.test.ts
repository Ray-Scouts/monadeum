import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryAgentStore } from "@monadeum/agent-registry";
import { EVALUATION_CADENCE, REALLOCATION_DISABLED, ReallocationSwitchError } from "@monadeum/reallocation";
import { WorkerConfigError, loadConsumerConfig } from "../src/config.js";
import { WorkerJobHandlers, type ConsumerSettings, type TickRunner } from "../src/consumer/handlers.js";
import { jobId, parseJob, scheduleId, tickAt } from "../src/consumer/jobs.js";
import { MemoryAgentLocks } from "../src/consumer/locks.js";
import { MemoryJobQueue } from "../src/consumer/queue.js";
import { runWorker } from "../src/main.js";
import { assertOnlyApprovedPlansSent, world } from "./harness.js";

// The consumer's job handlers and idempotency rules, offline: the queue and the locks are in-memory implementations
// of the interfaces the BullMQ consumer uses. `redis.test.ts` runs the same handlers on BullMQ when REDIS_URL is set.

const INTERVAL = 1_000;
const settings: ConsumerSettings = { tickIntervalMs: INTERVAL, evaluationDelayMs: 500, lockTtlMs: 60_000, lockRetryMs: 250 };
/** A clock inside tick `t`. */
const at = (t: number) => new Date(t * INTERVAL + 123);

class RecordingRunner implements TickRunner {
  readonly ticks: string[] = [];
  readonly evaluations: number[] = [];
  async tick(agentId: string, tick: number) {
    this.ticks.push(`${agentId}:${tick}`);
  }
  async evaluate(tick: number) {
    this.evaluations.push(tick);
  }
}

async function setup(ids: string[] = ["a", "b"]) {
  const agents = new MemoryAgentStore();
  for (const id of ids) {
    await agents.add({
      agentId: id, owner: "0x00000000000000000000000000000000000000aa", account: "0x00000000000000000000000000000000000000bb",
      genomeHash: `0x${"11".repeat(32)}`,
      genome: { riskTolerance: 0.1, executionFrequency: 1, informationBudget: 1n, informationSources: [], pair: "MON/USDC", assetUniverse: ["MON/USDC"] },
      principal: 1n, status: "active",
    });
  }
  const queue = new MemoryJobQueue();
  const locks = new MemoryAgentLocks();
  const runner = new RecordingRunner();
  let now = at(1);
  const handlers = new WorkerJobHandlers({ agents, runner, queue, locks, settings, clock: () => now });
  return { agents, queue, locks, runner, handlers, setNow: (d: Date) => { now = d; } };
}

test("job IDs are derived from the tick key and are valid BullMQ custom IDs", () => {
  assert.equal(jobId({ kind: "tick", agentId: "a", tick: 7 }), "tick-a%3A7");
  assert.equal(jobId({ kind: "tick", agentId: "a:b", tick: 7 }), "tick-a%3Ab%3A7");
  assert.equal(jobId({ kind: "evaluate", tick: 40 }), "evaluate-40");
  assert.equal(scheduleId("x y"), "agent-x%20y");
  for (const id of [jobId({ kind: "tick", agentId: "12", tick: 3 }), jobId({ kind: "evaluate", tick: 20 }), scheduleId("12")]) {
    assert.ok(!id.includes(":"), id);
    assert.notEqual(`${parseInt(id, 10)}`, id);
  }
  assert.equal(tickAt(new Date(59_999), 1_000), 59);
  assert.equal(tickAt(new Date(60_000), 1_000), 60);
});

test("a malformed job is rejected, not guessed at", () => {
  assert.deepEqual(parseJob("tick", { agentId: "a", tick: 3 }), { kind: "tick", agentId: "a", tick: 3 });
  assert.deepEqual(parseJob("principal", {}), { kind: "principal" });
  for (const [name, data] of [["tick", { agentId: "a" }], ["tick", { agentId: "", tick: 1 }], ["tick", { agentId: "a", tick: 1.5 }], ["evaluate", { tick: -20 }], ["trigger", {}], ["other", {}]] as const) {
    assert.throws(() => parseJob(name, data), /malformed/, `${name} ${JSON.stringify(data)}`);
  }
});

test("sync keeps exactly one schedule per active agent", async () => {
  const s = await setup(["a", "b", "c"]);
  await s.queue.schedule("gone", INTERVAL);
  await s.handlers.handle({ kind: "sync" });
  assert.deepEqual(await s.queue.scheduled(), ["a", "b", "c"]);
  await s.agents.update({ ...(await s.agents.get("b"))!, status: "retired" });
  const outcome = await s.handlers.handle({ kind: "sync" });
  assert.deepEqual(await s.queue.scheduled(), ["a", "c"]);
  assert.match(outcome.kind === "done" ? outcome.detail : "", /2 active, 0 added, 1 removed/);
});

test("a duplicate trigger in the same interval enqueues nothing, and the evaluation is enqueued once per cadence tick", async () => {
  const s = await setup();
  s.setNow(at(EVALUATION_CADENCE));
  for (let i = 0; i < 3; i++) for (const id of ["a", "b"]) await s.handlers.handle({ kind: "trigger", agentId: id });
  assert.deepEqual([...s.queue.jobs.keys()], [`tick-a%3A${EVALUATION_CADENCE}`, `evaluate-${EVALUATION_CADENCE}`, `tick-b%3A${EVALUATION_CADENCE}`]);
  assert.equal(s.queue.jobs.get(`evaluate-${EVALUATION_CADENCE}`)?.delayMs, settings.evaluationDelayMs);
  assert.equal(await s.queue.enqueue({ kind: "tick", agentId: "a", tick: EVALUATION_CADENCE }), false);
  s.setNow(at(EVALUATION_CADENCE + 1));
  await s.handlers.handle({ kind: "trigger", agentId: "a" });
  assert.equal(s.queue.jobs.size, 4, "the next interval is a new tick, with no evaluation");
});

test("a trigger for a retired or unknown agent removes its schedule and enqueues nothing", async () => {
  const s = await setup(["a"]);
  await s.handlers.handle({ kind: "sync" });
  await s.agents.update({ ...(await s.agents.get("a"))!, status: "retired" });
  await s.handlers.handle({ kind: "trigger", agentId: "a" });
  await s.handlers.handle({ kind: "trigger", agentId: "ghost" });
  assert.deepEqual(await s.queue.scheduled(), []);
  assert.equal(s.queue.jobs.size, 0);
});

test("per-agent concurrency of 1: a tick of a locked agent is retried later, never run alongside", async () => {
  const s = await setup();
  const release = (await s.locks.acquire(["a"], 1_000))!;
  assert.deepEqual(await s.handlers.handle({ kind: "tick", agentId: "a", tick: 5 }), { kind: "retry", afterMs: settings.lockRetryMs, detail: "a is locked" });
  assert.equal((await s.handlers.handle({ kind: "tick", agentId: "b", tick: 5 })).kind, "done", "another agent is not blocked");
  assert.deepEqual(await s.handlers.handle({ kind: "evaluate", tick: EVALUATION_CADENCE }).then((o) => o.kind), "retry");
  await release();
  assert.equal((await s.handlers.handle({ kind: "tick", agentId: "a", tick: 5 })).kind, "done");
  assert.equal((await s.handlers.handle({ kind: "evaluate", tick: EVALUATION_CADENCE })).kind, "done");
  assert.deepEqual(s.runner.ticks, ["b:5", "a:5"]);
  assert.deepEqual(s.runner.evaluations, [EVALUATION_CADENCE]);
  assert.ok(!s.locks.isHeld("a") && !s.locks.isHeld("b"));
});

test("a lock is released when the tick throws, and an off-cadence evaluation is refused", async () => {
  const s = await setup(["a"]);
  const failing = new WorkerJobHandlers({
    agents: s.agents, queue: s.queue, locks: s.locks, settings, clock: () => at(1),
    runner: { tick: async () => { throw new Error("rpc down"); }, evaluate: async () => null },
  });
  await assert.rejects(failing.handle({ kind: "tick", agentId: "a", tick: 1 }), /rpc down/);
  assert.equal(s.locks.isHeld("a"), false);
  await assert.rejects(failing.handle({ kind: "evaluate", tick: EVALUATION_CADENCE + 1 }), /not on the evaluation cadence/);
});

test("the consumer drives the real worker loop: triggers, duplicate triggers, ticks, and the evaluation, each acting once", async () => {
  const w = await world({ reallocationOwners: ["a"] });
  const { worker, risk } = await w.boot();
  const queue = new MemoryJobQueue();
  const locks = new MemoryAgentLocks();
  let now = at(1);
  const handlers = new WorkerJobHandlers({ agents: w.stores.agents, runner: worker, queue, locks, settings, clock: () => now });
  await handlers.handle({ kind: "sync" });
  assert.deepEqual(await queue.scheduled(), ["1", "2", "3"]);

  let evaluations = 0;
  const original = worker.evaluate.bind(worker);
  worker.evaluate = async (tick) => {
    evaluations++;
    return original(tick);
  };
  for (let t = 1; t <= EVALUATION_CADENCE; t++) {
    now = at(t);
    // Every schedule fires twice in the interval, as two processes or a retried trigger would.
    for (let round = 0; round < 2; round++) for (const id of await queue.scheduled()) await handlers.handle({ kind: "trigger", agentId: id });
    for (const job of queue.take()) assert.equal((await handlers.handle(job)).kind, "done");
  }
  // The same totals as one AgentWorker driven directly: three agents trading every other tick, one debit for owner a.
  const filled = [];
  for (const id of ["1", "2", "3"]) for (let t = 1; t <= EVALUATION_CADENCE; t++) if ((await w.stores.trades.get(`${id}:${t}`))?.status === "filled") filled.push(t);
  assert.equal(filled.length, 30);
  assert.equal(w.sessionOps().length, 30);
  assertOnlyApprovedPlansSent(w, risk.approved);
  assert.equal(evaluations, 1);
  assert.equal(w.contract.executed.length, 1);
  for (const id of ["1", "2", "3"]) assert.equal((await w.stores.agents.state(id)).returns.length, EVALUATION_CADENCE);
});

test("with the reallocation switch off, the consumer still runs the evaluation, for fitness and retirement, and nothing is settled", async () => {
  const w = await world({ reallocationOwners: ["a"], reallocation: REALLOCATION_DISABLED });
  const { worker, risk } = await w.boot();
  const queue = new MemoryJobQueue();
  const locks = new MemoryAgentLocks();
  let now = at(1);
  const handlers = new WorkerJobHandlers({ agents: w.stores.agents, runner: worker, queue, locks, settings, clock: () => now });
  await handlers.handle({ kind: "sync" });
  const results: Awaited<ReturnType<typeof worker.evaluate>>[] = [];
  const original = worker.evaluate.bind(worker);
  worker.evaluate = async (tick) => {
    const r = await original(tick);
    results.push(r);
    return r;
  };
  for (let t = 1; t <= EVALUATION_CADENCE; t++) {
    now = at(t);
    for (const id of await queue.scheduled()) await handlers.handle({ kind: "trigger", agentId: id });
    for (const job of queue.take()) assert.equal((await handlers.handle(job)).kind, "done");
  }
  assert.equal(results.length, 1, "the evaluation job is still scheduled on the cadence");
  assert.equal(results[0]!.reallocationEnabled, false);
  assert.equal(results[0]!.fitness.length, 3);
  assert.deepEqual(results[0]!.settled, []);
  assert.equal(w.contract.executed.length, 0);
  assertOnlyApprovedPlansSent(w, risk.approved);
  assert.ok(risk.approved.every((p) => !p.tickKey.includes("realloc")), "only trades were approved");
});

test("production refuses to run with reallocation on unless a new pre-registered study is acknowledged", async () => {
  const prod = { MONADEUM_ENV: "production", DATABASE_URL: "postgres://unused", REDIS_URL: "redis://localhost:6379", WORKER_TICK_INTERVAL_MS: "60000" };
  await assert.rejects(
    runWorker({ env: { ...prod, MONADEUM_REALLOCATION_ENABLED: "true" }, runner: () => new RecordingRunner() }),
    (e: unknown) => e instanceof ReallocationSwitchError && /MONADEUM_REALLOCATION_PRODUCTION_ACK/.test(e.message),
  );
});

test("consumer configuration: REDIS_URL turns it on, the tick interval has no default, and bad values are refused", () => {
  assert.equal(loadConsumerConfig({}), null);
  assert.throws(() => loadConsumerConfig({ REDIS_URL: "redis://localhost:6379" }), /WORKER_TICK_INTERVAL_MS is not set/);
  assert.deepEqual(loadConsumerConfig({ REDIS_URL: "redis://localhost:6379", WORKER_TICK_INTERVAL_MS: "60000" }), {
    redisUrl: "redis://localhost:6379", prefix: "monadeum", concurrency: 1, syncIntervalMs: 60_000,
    settings: { tickIntervalMs: 60_000, evaluationDelayMs: 30_000, lockTtlMs: 600_000, lockRetryMs: 1_000 },
    principal: null,
  });
  const base = { REDIS_URL: "redis://localhost:6379", WORKER_TICK_INTERVAL_MS: "60000" };
  assert.deepEqual(loadConsumerConfig({ ...base, WORKER_SETTLEMENT_ASSET_ADDRESS: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" })?.principal, {
    settlementAsset: "0x754704bc059f8c67012fed69bc8a327a5aafb603", intervalMs: 60_000,
  });
  for (const env of [
    { ...base, REDIS_URL: "http://localhost" },
    { ...base, WORKER_TICK_INTERVAL_MS: "999" },
    { ...base, WORKER_CONCURRENCY: "0" },
    { ...base, WORKER_EVALUATION_DELAY_MS: "60000" },
    { ...base, WORKER_REDIS_PREFIX: "a:b" },
    { ...base, WORKER_SETTLEMENT_ASSET_ADDRESS: "0x12" },
    { ...base, WORKER_SETTLEMENT_ASSET_ADDRESS: "0x754704bc059f8c67012fed69bc8a327a5aafb603", WORKER_PRINCIPAL_INTERVAL_MS: "999" },
  ]) {
    assert.throws(() => loadConsumerConfig(env), WorkerConfigError, JSON.stringify(env));
  }
});

test("production refuses to run without REDIS_URL or without a configured tick runner; development without REDIS_URL runs no consumer", async () => {
  const prod = { MONADEUM_ENV: "production", DATABASE_URL: "postgres://unused" };
  await assert.rejects(runWorker({ env: prod }), /REDIS_URL is not set/);
  await assert.rejects(runWorker({ env: { ...prod, REDIS_URL: "redis://localhost:6379", WORKER_TICK_INTERVAL_MS: "60000" } }), /no tick runner is configured/);
  const runner = () => ({ tick: async () => null, evaluate: async () => null });
  await assert.rejects(
    runWorker({ env: { ...prod, REDIS_URL: "redis://localhost:6379", WORKER_TICK_INTERVAL_MS: "60000" }, runner }),
    /WORKER_SETTLEMENT_ASSET_ADDRESS is not set/,
  );
  const logs: string[] = [];
  assert.equal(await runWorker({ env: {}, log: (m) => logs.push(m) }), null);
  assert.match(logs.join("\n"), /REDIS_URL is not set: no consumer runs/);
});
