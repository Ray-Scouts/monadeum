import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { run, type RunResult } from "../src/index.js";
import { reallocationQuota } from "../src/reallocation.js";
import { MIXED_OWNER_CYCLE, ownerSizes, runSlotCell, SLOT_ARMS, slotRunConfig, type SlotCell } from "../src/slots.js";
import type { Regime } from "../src/types.js";

/** Issue #89. Every change in total capital must come from trading and cost flows. */
function assertConserved(result: RunResult): void {
  const { grossPnl, fees, slippage, gas, x402 } = result.ledger;
  const flows = grossPnl - fees - slippage - gas - x402;
  assert.ok(Math.abs(result.totalCapital - result.startingCapital - flows) < 1e-6);
}

/**
 * No capital crosses an owner boundary. Per slot, the end capital is the principal plus the slot's own trading flows
 * plus what reallocation moved in or out. Per owner, reallocation nets to zero. Together these say each owner ends
 * with its principal plus its own slots' trading flows, and nothing else.
 */
function assertOwnerBound(result: RunResult): void {
  const net = new Map<number, number>();
  for (const agent of result.agents) {
    assert.ok(agent.owner !== undefined && agent.reallocatedIn !== undefined && agent.tradingNet !== undefined);
    assert.ok(Math.abs(agent.capital - agent.principal - agent.tradingNet - agent.reallocatedIn) < 1e-9, agent.id);
    net.set(agent.owner, (net.get(agent.owner) ?? 0) + agent.reallocatedIn);
  }
  for (const [owner, value] of net) assert.ok(Math.abs(value) < 1e-9, `owner ${owner} nets ${value}`);
}

const scoped = Object.values(SLOT_ARMS).filter((arm) => arm.owners !== undefined);

test("the small-pool rule takes the bottom one and the top one below 20 slots, deciles from 20, nothing below 2", () => {
  const expected: [number, number, number][] = [
    // ranked, population-wide quota (issue #85), owner-pool quota (issue #89)
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 1],
    [3, 0, 1],
    [5, 0, 1],
    [9, 0, 1],
    [10, 1, 1],
    [19, 1, 1],
    [20, 2, 2],
    [25, 2, 2],
    [100, 10, 10],
  ];
  for (const [ranked, wide, pool] of expected) {
    assert.equal(reallocationQuota(ranked, false), wide, `wide ${ranked}`);
    assert.equal(reallocationQuota(ranked, true), pool, `pool ${ranked}`);
    assert.ok(2 * reallocationQuota(ranked, true) <= ranked, "sources and sinks never overlap");
  }
});

test("owner sizes partition the population in slot order", () => {
  assert.deepEqual(ownerSizes(10, 3), [3, 3, 3, 1]);
  assert.deepEqual(ownerSizes(10, 10), [10]);
  assert.deepEqual(ownerSizes(10, "mixed"), [1, 1, 1, 2, 2, 3]);
  assert.deepEqual(ownerSizes(100, "mixed"), [...MIXED_OWNER_CYCLE, ...MIXED_OWNER_CYCLE]);
  for (const population of [10, 100, 1000]) {
    for (const spec of [3, 5, 10, "mixed"] as const) {
      const sizes = ownerSizes(population, spec);
      assert.equal(
        sizes.reduce((sum, size) => sum + size, 0),
        population,
      );
      assert.ok(sizes.every((size) => Number.isInteger(size) && size >= 1));
    }
  }
});

test("in the runner, a pool of 2 reallocates, a pool of 1 never does, and population-wide needs 10", () => {
  const base = slotRunConfig(SLOT_ARMS["RO-c0.2-x4"]!, 0.009, 3, "trending", 1);
  const wide = run(base);
  assert.equal(wide.slots?.capitalMoved, 0, "3 ranked slots give a population-wide quota of 0");
  const owned = run({ ...base, slots: { ...base.slots!, owners: [1, 2] } });
  assert.ok((owned.slots?.capitalMoved ?? 0) > 0, "an owner of 2 moves capital from its bottom one to its top one");
  const single = owned.agents.find((agent) => agent.owner === 0);
  assert.equal(single?.reallocatedIn, 0);
  assertConserved(owned);
  assertOwnerBound(owned);
});

test("no capital crosses an owner boundary in any owner-scoped arm, and the check is not vacuous", () => {
  const regimes: Regime[] = ["trending", "stress_flash_crash"];
  for (const regime of regimes) {
    for (const arm of scoped) {
      const result = run(slotRunConfig(arm, 0.009, 100, regime, 2));
      assertConserved(result);
      assertOwnerBound(result);
      assert.equal(result.endPopulation, 100);
      assert.ok((result.slots?.capitalMoved ?? 0) > 0, `${arm.name} ${regime} moved nothing`);
      assert.ok(result.agents.some((agent) => (agent.reallocatedIn ?? 0) !== 0));
    }
  }
});

test("owner-scoped reallocation conserves capital with every cost and edge at zero", () => {
  const zero = { gasUsd: 0, x402Usd: 0, feeBps: 0, slippageBps: 0, infoEdge: 0 };
  for (const name of ["O3-N-c0.2-x4", "Omix-Mo-c0.2-x2", "O5-Mp-c0.2-x4"]) {
    const result = run({ ...slotRunConfig(SLOT_ARMS[name]!, 0, 100, "choppy", 3), costs: zero });
    assertConserved(result);
    assertOwnerBound(result);
  }
});

test("owner donor scope copies genomes only within an owner, population scope crosses owners", () => {
  const ownerOf = (result: RunResult): Map<string, number> =>
    new Map(result.agents.map((agent) => [agent.id, agent.owner ?? -1]));
  const within = run(slotRunConfig(SLOT_ARMS["O10-Mo-c0.2-x4"]!, 0.009, 100, "trending", 1));
  const owners = ownerOf(within);
  const copied = within.agents.filter((agent) => agent.parent !== null);
  assert.ok(copied.length > 0);
  assert.ok(copied.every((agent) => owners.get(agent.parent as string) === agent.owner));
  const wide = run(slotRunConfig(SLOT_ARMS["O10-Mp-c0.2-x4"]!, 0.009, 100, "trending", 1));
  const wideOwners = ownerOf(wide);
  assert.ok(wide.agents.some((agent) => agent.parent !== null && wideOwners.get(agent.parent) !== agent.owner));
});

test("no replacement keeps every genome: no replacement, no donor, no lineage", () => {
  for (const name of ["N", "RO-c0.2-x4", "O3-N-c0.2-x2"]) {
    const result = run(slotRunConfig(SLOT_ARMS[name]!, 0.009, 100, "choppy", 1));
    assert.equal(result.slots?.replacements, 0);
    assert.equal(result.slots?.noDonor, 0);
    assert.ok(result.agents.every((agent) => agent.parent === null && agent.status === "active"));
  }
  assert.equal(run(slotRunConfig(SLOT_ARMS.N!, 0.009, 100, "choppy", 1)).slots?.capitalMoved, 0);
});

test("one owner holding every slot matches population-wide reallocation once the pool is 10 or more", () => {
  const base = slotRunConfig(SLOT_ARMS["B-c0.2-x4"]!, 0.009, 100, "trending", 4);
  const wide = run(base);
  const one = run({ ...base, slots: { ...base.slots!, owners: [100] } });
  assert.equal(one.roiPct, wide.roiPct);
  assert.deepEqual(one.slots, wide.slots);
});

test("with the issue #89 options unset, an issue #85 cell reproduces field for field", () => {
  const published = JSON.parse(
    readFileSync(new URL("../../results/fixed-slot/B-c0.2-x4-m0.009-10-choppy.json", import.meta.url), "utf8"),
  ) as { cells: SlotCell[] };
  const cell = runSlotCell(SLOT_ARMS["B-c0.2-x4"]!, 0.009, 10, "choppy", 50);
  assert.deepEqual(JSON.parse(JSON.stringify(cell)), published.cells[0]);
});

test("slots mode rejects a bad ownership configuration", () => {
  const base = slotRunConfig(SLOT_ARMS["RO-c0.2-x4"]!, 0.009, 10, "choppy", 1);
  assert.throws(() => run({ ...base, slots: { ...base.slots!, owners: [3, 3, 3] } }), RangeError);
  assert.throws(() => run({ ...base, slots: { ...base.slots!, owners: [5, 0, 5] } }), RangeError);
  assert.throws(() => run({ ...base, slots: { ...base.slots!, donorScope: "owner" } }), RangeError);
});
