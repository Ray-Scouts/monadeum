import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateCapital, assertGenomeHasNoProtocolFields } from "../src/allocate.js";
import { ReproductionService } from "../src/reproduction.service.js";
import type { ReproductionSettlement } from "../src/settlement.js";

test("allocation spends only profit and never drops the parent below principal", () => {
  const out = allocateCapital({ capital: 20, principal: 10, fraction: 0.5, maxChildCapital: 10 });
  assert.equal(out.childCapital, 5);
  assert.equal(out.parentCapitalAfter, 15);
  assert.ok(out.parentCapitalAfter >= 10);
  assert.equal(out.childCapital + out.parentCapitalAfter, 20);
  const broke = allocateCapital({ capital: 10, principal: 10, fraction: 0.5, maxChildCapital: 10 });
  assert.equal(broke.childCapital, 0);
  assert.equal(broke.parentCapitalAfter, 10);
});

test("a protocol field on a genome is rejected", () => {
  assert.doesNotThrow(() => assertGenomeHasNoProtocolFields({ riskTolerance: 0.1 }));
  assert.throws(() => assertGenomeHasNoProtocolFields({ riskTolerance: 0.1, k: 20 }));
  assert.throws(() => assertGenomeHasNoProtocolFields({ pMut: 0.15 }));
});

test("settlement runs only on the evaluation cadence and only after eligibility", () => {
  const calls: number[] = [];
  const settlement: ReproductionSettlement = {
    transfer(request) {
      calls.push(request.amount);
      return { amount: request.amount };
    },
  };
  const service = new ReproductionService(settlement);
  assert.throws(() =>
    service.settle({
      tick: 7,
      evalEvery: 20,
      eligibility: { eligible: true, failed: [] },
      allocation: { childCapital: 4, parentCapitalAfter: 16 },
      parentId: "p",
      childId: "c",
    }),
  );
  const skipped = service.settle({
    tick: 20,
    evalEvery: 20,
    eligibility: { eligible: false, failed: ["profit"] },
    allocation: { childCapital: 4, parentCapitalAfter: 16 },
    parentId: "p",
    childId: "c",
  });
  assert.equal(skipped.moved, false);
  assert.deepEqual(calls, []);
  const moved = service.settle({
    tick: 20,
    evalEvery: 20,
    eligibility: { eligible: true, failed: [] },
    allocation: { childCapital: 4, parentCapitalAfter: 16 },
    parentId: "p",
    childId: "c",
  });
  assert.equal(moved.moved, true);
  assert.deepEqual(calls, [4]);
});

test("an unconfigured settlement moves no capital", () => {
  const service = new ReproductionService();
  assert.throws(() =>
    service.settle({
      tick: 20,
      evalEvery: 20,
      eligibility: { eligible: true, failed: [] },
      allocation: { childCapital: 4, parentCapitalAfter: 16 },
      parentId: "p",
      childId: "c",
    }),
  );
});
