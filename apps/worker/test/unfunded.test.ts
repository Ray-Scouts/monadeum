import assert from "node:assert/strict";
import { test } from "node:test";
import { EVALUATION_CADENCE } from "@monadeum/reallocation";
import { world } from "./harness.js";

// EVOLUTION.md section 1.1: agent creation writes principal 0, and funding raises it. Until then the worker neither
// ticks the agent nor evaluates it, so an agent nobody has funded yet is not retired for being below the capital floor.

test("an agent with principal 0 does not tick, is not ranked, and is not retired; once funded it trades", async () => {
  const w = await world({ agents: [{ agentId: "1", owner: "a" }, { agentId: "2", owner: "a", capital: 0n }], reallocationOwners: ["a"] });
  const record = (await w.stores.agents.get("2"))!;
  await w.stores.agents.update({ ...record, principal: 0n });
  const { worker } = await w.boot();

  for (let tick = 1; tick <= EVALUATION_CADENCE; tick++) {
    assert.equal(await worker.tick("2", tick), null, `tick ${tick}`);
    await worker.tick("1", tick);
  }
  const evaluation = await worker.evaluate(EVALUATION_CADENCE);
  assert.deepEqual(evaluation.fitness.map((f) => f.agentId), ["1"]);
  assert.deepEqual(evaluation.retired, []);
  assert.equal((await w.stores.agents.get("2"))!.status, "active");
  assert.equal(evaluation.settled.length, 0, "a pool with one funded agent moves nothing");

  // Funding: the deposit lands and principal is recomputed from it.
  w.token.mint(w.accounts.get("2")!, 50n * 10n ** 6n);
  await w.stores.agents.update({ ...record, principal: 50n * 10n ** 6n });
  const next = await worker.tick("2", EVALUATION_CADENCE + 1);
  assert.ok(next, "a funded agent ticks");
});
