import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvaluationRecord, EvaluationStore } from "@monadeum/agent-registry";
import { EVALUATION_CADENCE, REALLOCATION_DISABLED } from "@monadeum/reallocation";
import { UNIT, world } from "./harness.js";

// The evaluation records the worker writes as the last step of each evaluation (ARCHITECTURE.md section 5).

type World = Awaited<ReturnType<typeof world>>;

const CLOCK = new Date("2026-10-10T12:00:00Z").getTime();

async function seedFitness(w: World, returns: Record<string, number[]>) {
  for (const [agentId, series] of Object.entries(returns)) {
    const state = await w.stores.agents.state(agentId);
    await w.stores.agents.saveState(agentId, { ...state, returns: series, tradeCounts: series.map(() => 1) });
  }
}

const series = (good: boolean) => Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -0.001 : good ? 0.002 : 0.0001));

test("an evaluation records one record per evaluated agent, with the values it computed", async () => {
  const w = await world({
    reallocation: REALLOCATION_DISABLED,
    agents: [{ agentId: "1", owner: "a" }, { agentId: "2", owner: "a", capital: 50n * UNIT }, { agentId: "3", owner: "b" }, { agentId: "4", owner: "b" }],
  });
  await seedFitness(w, { "1": series(true), "2": series(false), "3": series(true) });
  // Agent 4 is unfunded: the evaluation neither ranks nor records it.
  await w.stores.agents.update({ ...(await w.stores.agents.get("4"))!, principal: 0n });
  const { worker } = await w.boot();
  const evaluation = await worker.evaluate(EVALUATION_CADENCE);

  const records = await w.stores.evaluations.latest();
  assert.deepEqual(records.map((r) => r.agentId), ["1", "2", "3"]);
  for (const record of records) {
    const row = evaluation.fitness.find((f) => f.agentId === record.agentId)!;
    const state = await w.stores.agents.state(record.agentId);
    assert.equal(record.sequence, 1);
    assert.equal(record.evaluatedAt, CLOCK);
    assert.equal(record.adjustedFitness, row.adjustedFitness);
    assert.equal(record.rawSortino, row.rawSortino);
    assert.equal(record.zeroDownsideFlag, row.flaggedZeroDownside);
    assert.equal(record.tradeCount, row.tradeCount);
    assert.equal(record.lowWindows, state.lowFitnessWindows, "the starvation count the retirement check carried");
    assert.equal(record.retired, false);
    assert.equal(record.retirementRule, null);
  }
  assert.deepEqual(records.map((r) => r.capital), [100n * UNIT, 50n * UNIT, 100n * UNIT], "each account's balance, base units");
  assert.deepEqual(await w.stores.evaluations.history("4", 50), []);
});

test("the fitness percentile is the one the starvation check uses: within the niche, ties counted half", async () => {
  const w = await world({ reallocation: REALLOCATION_DISABLED, agents: [{ agentId: "1", owner: "a" }, { agentId: "2", owner: "a" }, { agentId: "3", owner: "b" }, { agentId: "4", owner: "b" }] });
  await seedFitness(w, { "1": series(true), "2": series(false), "3": series(true), "4": series(true) });
  // Agent 4 moves to another risk band, so it is alone in its niche.
  const four = (await w.stores.agents.get("4"))!;
  await w.stores.agents.update({ ...four, genome: { ...four.genome, riskTolerance: 0.2 } });
  const { worker } = await w.boot();
  await worker.evaluate(EVALUATION_CADENCE);

  const byAgent = new Map((await w.stores.evaluations.latest()).map((r) => [r.agentId, r]));
  // Niche of 1, 2, 3: agents 1 and 3 tie above agent 2. (below + 0.5 * equal) / n.
  assert.equal(byAgent.get("1")!.fitnessPercentile, (1 + 0.5 * 2) / 3);
  assert.equal(byAgent.get("3")!.fitnessPercentile, (1 + 0.5 * 2) / 3);
  assert.equal(byAgent.get("2")!.fitnessPercentile, (0 + 0.5 * 1) / 3);
  // Alone in its niche: equal only to itself.
  assert.equal(byAgent.get("4")!.fitnessPercentile, 0.5);
});

test("an agent with no adjusted fitness has no percentile, and its starvation count is left as it was", async () => {
  const w = await world({ reallocation: REALLOCATION_DISABLED, agents: [{ agentId: "1", owner: "a" }, { agentId: "2", owner: "a" }] });
  await seedFitness(w, { "1": series(true) });
  const state = await w.stores.agents.state("2");
  await w.stores.agents.saveState("2", { ...state, lowFitnessWindows: 2 });
  const { worker } = await w.boot();
  await worker.evaluate(EVALUATION_CADENCE);
  const [record] = await w.stores.evaluations.history("2", 50);
  assert.equal(record!.adjustedFitness, null);
  assert.equal(record!.fitnessPercentile, null);
  assert.equal(record!.lowWindows, 2);
  assert.equal((await w.stores.evaluations.history("1", 50))[0]!.fitnessPercentile, 0.5);
});

test("a retirement is recorded with its rule, and a retired agent is not recorded again", async () => {
  const w = await world({ reallocation: REALLOCATION_DISABLED, agents: [{ agentId: "1", owner: "a" }, { agentId: "2", owner: "a", capital: UNIT / 100n }] });
  await seedFitness(w, { "1": series(true), "2": series(false) });
  const { worker } = await w.boot();
  await worker.evaluate(EVALUATION_CADENCE);
  await worker.evaluate(2 * EVALUATION_CADENCE);
  const history = await w.stores.evaluations.history("2", 50);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.retired, true);
  assert.equal(history[0]!.retirementRule, "capital_floor");
  assert.equal(history[0]!.capital, UNIT / 100n);
  assert.deepEqual((await w.stores.evaluations.history("1", 50)).map((r) => r.sequence), [1, 2]);
  assert.deepEqual((await w.stores.evaluations.latest()).map((r) => r.agentId), ["1"]);
});

test("with reallocation on, the records are written after settlement, with the capital read before it", async () => {
  const w = await world({ reallocationOwners: ["a"], agents: [{ agentId: "1", owner: "a" }, { agentId: "2", owner: "a" }] });
  await seedFitness(w, { "1": series(true), "2": series(false) });
  const { worker } = await w.boot();
  const evaluation = await worker.evaluate(EVALUATION_CADENCE);
  assert.equal(evaluation.settled.length, 1, "the evaluation moved capital");
  assert.equal(await w.token.balanceOf(w.accounts.get("2")!), 80n * UNIT);
  assert.deepEqual((await w.stores.evaluations.latest()).map((r) => r.capital), [100n * UNIT, 100n * UNIT]);
});

test("a rerun of an evaluation keeps what the first run recorded", async () => {
  const w = await world({ reallocation: REALLOCATION_DISABLED, agents: [{ agentId: "1", owner: "a" }, { agentId: "2", owner: "a" }] });
  await seedFitness(w, { "1": series(true), "2": series(false) });
  const { worker } = await w.boot();
  await worker.evaluate(EVALUATION_CADENCE);
  const first = await w.stores.evaluations.latest();
  w.token.mint(w.accounts.get("1")!, 7n * UNIT);
  await worker.evaluate(EVALUATION_CADENCE);
  assert.deepEqual(await w.stores.evaluations.latest(), first);
});

test("a failure to record fails the evaluation like any store failure, after the evaluation has decided everything", async () => {
  const w = await world({ reallocation: REALLOCATION_DISABLED, agents: [{ agentId: "1", owner: "a" }, { agentId: "2", owner: "a", capital: UNIT / 100n }] });
  await seedFitness(w, { "1": series(true), "2": series(false) });
  const failing: EvaluationStore = {
    record: async (_records: readonly EvaluationRecord[]) => {
      throw new Error("database unavailable");
    },
    history: async () => [],
    latest: async () => [],
  };
  w.stores.evaluations = failing;
  const { worker } = await w.boot();
  await assert.rejects(worker.evaluate(EVALUATION_CADENCE), /database unavailable/);
  assert.equal((await w.stores.agents.get("2"))!.status, "retired", "retirement was applied before recording");
});
