import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryTickStore, enqueueTick, runTick, type TickPorts } from "../src/tick.js";
import type { AgentView } from "@monadeum/strategy";

const state: AgentView = {
  capital: 100,
  riskTolerance: 0.1,
  executionFrequency: 1,
  informationBudget: 1,
  pair: "PAIR_A",
  ticksSinceTrade: 5,
  signal: 0.01,
};

function ports(over: Partial<TickPorts> = {}): TickPorts & { executions: number } {
  const bag = { executions: 0 };
  return {
    executions: 0,
    observe: () => ({ ok: true, symbol: "MON" }),
    quote: () => null,
    policy: () => ({ ok: true }),
    execute: () => {
      bag.executions += 1;
      return { ok: true, userOpHash: "0xabc" };
    },
    measure: () => undefined,
    probe: () => "absent",
    ...over,
    get executionsCount() {
      return bag.executions;
    },
  } as TickPorts & { executions: number };
}

test("the scheduler does not enqueue the same agent tick twice", () => {
  const store = new MemoryTickStore();
  assert.equal(enqueueTick(store, "a", 1), true);
  assert.equal(enqueueTick(store, "a", 1), false);
  assert.equal(enqueueTick(store, "a", 2), true);
});

test("a crash after submit does not send a second transaction when the probe already sees it", () => {
  const store = new MemoryTickStore();
  store.put({ key: "a:1", status: "submitted", userOpHash: "0xabc" });
  let executions = 0;
  const result = runTick(store, "a", 1, state, ports({
    execute: () => {
      executions += 1;
      return { ok: true, userOpHash: "0xdef" };
    },
    probe: () => "included",
  }));
  assert.equal(executions, 0);
  assert.equal(result.action, "none");
  assert.equal(store.get("a:1")?.status, "recorded");
});

test("rpc, malformed quote, and paymaster failures fail closed", () => {
  for (const failure of [
    ports({ observe: () => ({ ok: false, reason: "rpc" }) }),
    ports({ quote: () => ({ malformed: true }) }),
    ports({ execute: () => ({ ok: false, reason: "paymaster" }) }),
  ]) {
    const store = new MemoryTickStore();
    const result = runTick(store, "a", 3, state, failure);
    assert.equal(result.action, "none");
    assert.equal(result.retry, "next-tick");
  }
});
