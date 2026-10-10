import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateCapital, assertGenomeHasNoProtocolFields } from "../src/allocate.js";

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
