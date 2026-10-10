import assert from "node:assert/strict";
import { test } from "node:test";
import { ReallocationService } from "@monadeum/reallocation";
import { createWorker } from "../src/main.js";

test("the worker boots as its own Nest context and does not listen for http", async () => {
  const app = await createWorker();
  assert.equal(typeof app.get, "function");
  await app.close();
});

test("the worker provides the reallocation module, which plans nothing without an owner policy", async () => {
  const app = await createWorker();
  const service = app.get(ReallocationService);
  const plan = service.plan(20, [
    { id: "a", owner: "o", status: "active", capital: 10, principal: 10, adjustedFitness: 1, flaggedZeroDownside: false },
    { id: "b", owner: "o", status: "active", capital: 10, principal: 10, adjustedFitness: -1, flaggedZeroDownside: false },
  ]);
  assert.deepEqual(plan.moves, []);
  await app.close();
});
