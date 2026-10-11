import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { EvaluationRecord, EvaluationStore } from "@monadeum/agent-registry";
import { PgEvaluationStore } from "@monadeum/db";
import { boot, call, createAgent, newWallet, privySignIn, type Backend, type Booted } from "./harness.js";

// The worker's evaluation records as the API serves them: per agent to the owner only, and to everyone as a population
// aggregate. On PGlite the API reads them through `monadeum_reader`; the records are written here through the owning
// connection, standing in for the worker, because the API's roles cannot write them.

function record(agentId: string, sequence: number, overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    sequence, agentId, evaluatedAt: 1_790_000_000_000 + sequence, capital: 100_000_000n + BigInt(sequence), adjustedFitness: 0.5,
    fitnessPercentile: 0.75, rawSortino: 0.4, zeroDownsideFlag: false, tradeCount: 12, lowWindows: 0, retired: false, retirementRule: null,
    ...overrides,
  };
}

/** The worker's write path: the owning connection on Postgres, the shared store in memory. */
const writer = (b: Booted): EvaluationStore => (b.db ? new PgEvaluationStore(b.db) : b.stores.evaluations);

for (const backend of ["memory", "pglite"] as Backend[]) {
  describe(`${backend}: evaluation results`, () => {
    let b: Booted;
    const alice = newWallet();
    const mallory = newWallet();
    let aliceAuth: { bearer: string };
    let malloryAuth: { bearer: string };
    let first: string;
    let second: string;
    before(async () => {
      b = await boot(backend);
      aliceAuth = { bearer: (await privySignIn(b.app, "did:privy:alice", alice)).bearer };
      malloryAuth = { bearer: (await privySignIn(b.app, "did:privy:mallory", mallory)).bearer };
      first = (await createAgent(b.app, aliceAuth, alice, "first")).agentId;
      second = (await createAgent(b.app, aliceAuth, alice, "second")).agentId;
    });
    after(() => b.close());

    it("serves nulls before any evaluation", async () => {
      const { body } = await call(b.app, "GET", `/agents/${first}`, { auth: aliceAuth });
      for (const field of ["capital", "fitnessPercentile", "lowWindows", "zeroDownsideFlag", "retirement", "capitalHistory"]) {
        assert.equal(body.agent[field], null, field);
      }
      const population = await call(b.app, "GET", "/population", { auth: aliceAuth });
      assert.equal(population.body.lastEvaluation, null);
      assert.equal(population.body.capital, null);
    });

    it("serves the latest evaluation and the capital history to the owner", async () => {
      await writer(b).record([record(first, 1), record(second, 1, { capital: 7n })]);
      await writer(b).record([
        record(first, 2, { fitnessPercentile: 1 / 6, lowWindows: 1, zeroDownsideFlag: true }),
        record(second, 2, { capital: 3n, adjustedFitness: null, fitnessPercentile: null, lowWindows: 3, retired: true, retirementRule: "starvation" }),
      ]);
      const detail = await call(b.app, "GET", `/agents/${first}`, { auth: aliceAuth });
      assert.equal(detail.status, 200);
      const agent = detail.body.agent;
      assert.equal(agent.capital, "100000002");
      assert.equal(agent.fitnessPercentile, 1 / 6);
      assert.equal(agent.lowWindows, 1);
      assert.equal(agent.zeroDownsideFlag, true);
      assert.equal(agent.retirement, null);
      assert.deepEqual(agent.capitalHistory, [{ evaluation: 1, capital: "100000001" }, { evaluation: 2, capital: "100000002" }]);
      assert.equal(agent.tradeCount, null, "not served by this change");

      const list = await call(b.app, "GET", "/agents", { auth: aliceAuth });
      const retired = list.body.agents.find((a: { id: string }) => a.id === second);
      assert.equal(retired.capital, "3");
      assert.equal(retired.fitnessPercentile, null);
      assert.equal(retired.lowWindows, 3);
      assert.deepEqual(retired.retirement, { rule: "starvation", evaluation: 2 });
      assert.deepEqual(retired.capitalHistory.map((h: { capital: string }) => h.capital), ["7", "3"]);
    });

    it("bounds the capital history to the most recent evaluations", async () => {
      const { agentId } = await createAgent(b.app, aliceAuth, alice, "long");
      for (let sequence = 1; sequence <= 60; sequence++) await writer(b).record([record(agentId, sequence)]);
      const { body } = await call(b.app, "GET", `/agents/${agentId}`, { auth: aliceAuth });
      assert.equal(body.agent.capitalHistory.length, 50);
      assert.equal(body.agent.capitalHistory[0].evaluation, 11);
      assert.equal(body.agent.capitalHistory[49].evaluation, 60);
    });

    it("does not expose another owner's agent, and the population carries only aggregates", async () => {
      const other = await call(b.app, "GET", `/agents/${first}`, { auth: malloryAuth });
      assert.equal(other.status, 404);
      assert.ok(!JSON.stringify(other.body).includes("100000002"));
      assert.deepEqual((await call(b.app, "GET", "/agents", { auth: malloryAuth })).body.agents, []);

      await writer(b).record([record(first, 61, { capital: 40n }), record("someone-else", 61, { capital: 2n }), record("retired-now", 61, { capital: 1_000n, retired: true, retirementRule: "capital_floor" })]);
      const population = await call(b.app, "GET", "/population", { auth: malloryAuth });
      assert.equal(population.status, 200);
      assert.deepEqual(population.body.lastEvaluation, { sequence: 61, at: 1_790_000_000_061 });
      assert.equal(population.body.capital, "42", "live agents only: the agent retired in that evaluation is not counted");
      const text = JSON.stringify(population.body);
      for (const id of [first, second, "someone-else", "retired-now"]) assert.ok(!text.includes(id), id);
      assert.equal((await call(b.app, "GET", "/population")).status, 401);
    });
  });
}
