// The store behavior is held to the conformance suite in libs/db, which runs against these in-memory stores and the
// Postgres ones. This file checks only the initial state this package defines.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryAgentStore, initialState, type AgentRecord } from "../src/index.js";

const agent: AgentRecord = {
  agentId: "a", owner: "0x00000000000000000000000000000000000000AA", account: "0x00000000000000000000000000000000000000bb",
  genomeHash: `0x${"11".repeat(32)}`,
  genome: { riskTolerance: 0.1, executionFrequency: 3, informationBudget: 5n, informationSources: ["nansen"], pair: "MON/USDC", assetUniverse: ["MON/USDC"] },
  principal: 100n, status: "active",
};

test("a new agent may trade on its first tick: the initial state counts its execution frequency as elapsed", async () => {
  const store = new MemoryAgentStore();
  await store.add(agent);
  assert.deepEqual(await store.state("a"), initialState(agent));
  assert.equal((await store.state("a")).ticksSinceTrade, 3);
  assert.equal((await store.state("unknown")).ticksSinceTrade, 1);
  assert.equal((await store.get("a"))?.owner, "0x00000000000000000000000000000000000000aa");
});
