import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REALLOCATION_DISABLED,
  REALLOCATION_ENABLED,
  REALLOCATION_OFF_REASON,
  REALLOCATION_PRODUCTION_ACK,
  ReallocationSwitchError,
  loadReallocationSwitch,
} from "../src/switch.js";

test("reallocation is off when the flag is unset, empty, or false, with the study result as the reason", () => {
  for (const env of [{}, { MONADEUM_REALLOCATION_ENABLED: "" }, { MONADEUM_REALLOCATION_ENABLED: " false " }, { MONADEUM_ENV: "production" }]) {
    const s = loadReallocationSwitch(env);
    assert.equal(s.enabled, false);
    assert.equal(s.reason, REALLOCATION_OFF_REASON);
  }
  assert.match(REALLOCATION_OFF_REASON, /off by default/);
  assert.match(REALLOCATION_OFF_REASON, /pre-registered study/);
  assert.match(REALLOCATION_OFF_REASON, /adds nothing measurable/);
});

test("any value other than true or false refuses to start", () => {
  for (const value of ["1", "yes", "TRUE", "on"]) {
    assert.throws(() => loadReallocationSwitch({ MONADEUM_REALLOCATION_ENABLED: value }), ReallocationSwitchError);
  }
});

test("outside production the flag alone turns reallocation on", () => {
  assert.deepEqual(loadReallocationSwitch({ MONADEUM_REALLOCATION_ENABLED: "true" }), REALLOCATION_ENABLED);
  assert.deepEqual(loadReallocationSwitch({ MONADEUM_REALLOCATION_ENABLED: "true", MONADEUM_ENV: "development" }), { enabled: true, reason: null });
});

test("production refuses the flag without the exact acknowledgement of a new pre-registered study", () => {
  const on = { MONADEUM_ENV: "production", MONADEUM_REALLOCATION_ENABLED: "true" };
  assert.throws(() => loadReallocationSwitch(on), /refusing to start without MONADEUM_REALLOCATION_PRODUCTION_ACK/);
  assert.throws(() => loadReallocationSwitch({ ...on, MONADEUM_REALLOCATION_PRODUCTION_ACK: "true" }), ReallocationSwitchError);
  assert.deepEqual(loadReallocationSwitch({ ...on, MONADEUM_REALLOCATION_PRODUCTION_ACK: REALLOCATION_PRODUCTION_ACK }), REALLOCATION_ENABLED);
  // The acknowledgement never turns reallocation on by itself.
  assert.deepEqual(loadReallocationSwitch({ MONADEUM_ENV: "production", MONADEUM_REALLOCATION_PRODUCTION_ACK: REALLOCATION_PRODUCTION_ACK }), REALLOCATION_DISABLED);
});

test("an unknown MONADEUM_ENV with the flag on refuses to start rather than guessing", () => {
  assert.throws(() => loadReallocationSwitch({ MONADEUM_ENV: "prod", MONADEUM_REALLOCATION_ENABLED: "true" }), ReallocationSwitchError);
});
