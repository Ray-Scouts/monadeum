import assert from "node:assert/strict";
import { test } from "node:test";
import { RISK_CEILING, RISK_FLOOR } from "../src/propose.js";
import {
  ALLOWED_INFORMATION_SOURCES,
  ALLOWED_MODEL_CONFIGURATIONS,
  DEFAULT_GENOME_PRESET,
  FREQUENCY_MAX,
  FREQUENCY_MIN,
  GENOME_PRESETS,
  TIME_HORIZON_MAX,
  TIME_HORIZON_MIN,
  genomePreset,
} from "../src/presets.js";

// EVOLUTION.md section 1.1: every preset sits inside the section 1 ranges, and the conservative preset carries the
// documented values. A change here without the document changing with it fails this test on purpose.

test("every preset is inside the section 1 ranges and allowlists", () => {
  for (const [key, p] of Object.entries(GENOME_PRESETS)) {
    assert.equal(p.name, key);
    assert.ok(p.riskTolerance >= RISK_FLOOR && p.riskTolerance <= RISK_CEILING, `${key} riskTolerance`);
    assert.ok(Number.isInteger(p.executionFrequency) && p.executionFrequency >= FREQUENCY_MIN && p.executionFrequency <= FREQUENCY_MAX, `${key} executionFrequency`);
    assert.ok(Number.isInteger(p.timeHorizon) && p.timeHorizon >= TIME_HORIZON_MIN && p.timeHorizon <= TIME_HORIZON_MAX, `${key} timeHorizon`);
    assert.ok(Number.isFinite(p.entryThreshold) && Number.isFinite(p.exitThreshold), `${key} thresholds`);
    assert.ok((ALLOWED_MODEL_CONFIGURATIONS as readonly string[]).includes(p.modelConfiguration), `${key} modelConfiguration`);
    assert.ok(p.informationSources.every((s) => (ALLOWED_INFORMATION_SOURCES as readonly string[]).includes(s)), `${key} informationSources`);
    assert.ok(p.informationBudget >= 0n, `${key} informationBudget`);
  }
  assert.ok(genomePreset(DEFAULT_GENOME_PRESET));
});

test("the conservative preset carries the values documented in EVOLUTION.md section 1.1", () => {
  const p = GENOME_PRESETS.conservative!;
  assert.deepEqual({ ...p, informationSources: [...p.informationSources] }, {
    name: "conservative",
    riskTolerance: 0.1,
    executionFrequency: 24,
    timeHorizon: 24,
    entryThreshold: 0.0002,
    exitThreshold: 0,
    informationSources: [],
    informationBudget: 0n,
    modelConfiguration: "low",
  });
  assert.equal(DEFAULT_GENOME_PRESET, "conservative");
});

test("only a named preset resolves, and presets cannot be changed at run time", () => {
  for (const name of ["toString", "__proto__", "constructor", "Conservative", "", null, 1, {}]) assert.equal(genomePreset(name), undefined, String(name));
  assert.ok(Object.isFrozen(GENOME_PRESETS));
  assert.ok(Object.isFrozen(GENOME_PRESETS.conservative));
});
