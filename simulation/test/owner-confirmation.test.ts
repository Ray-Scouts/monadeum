import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { run, type RunResult } from "../src/index.js";
import { recycleAmount, sharedQuota } from "../src/reallocation.js";
import { runSlotCell, SLOT_ARMS, slotRunConfig, type SlotCell } from "../src/slots.js";
import type { Regime } from "../src/types.js";

/** Issue #92. Every change in total capital must come from trading and cost flows. */
function assertConserved(result: RunResult): void {
  const { grossPnl, fees, slippage, gas, x402 } = result.ledger;
  const flows = grossPnl - fees - slippage - gas - x402;
  assert.ok(Math.abs(result.totalCapital - result.startingCapital - flows) < 1e-6);
}

/** Per slot, end capital is principal plus own trading flows plus net moves in; per owner, moves net to zero. */
function assertOwnerBound(result: RunResult): void {
  const net = new Map<number, number>();
  for (const agent of result.agents) {
    assert.ok(agent.owner !== undefined && agent.reallocatedIn !== undefined && agent.tradingNet !== undefined);
    assert.ok(Math.abs(agent.capital - agent.principal - agent.tradingNet - agent.reallocatedIn) < 1e-9, agent.id);
    net.set(agent.owner, (net.get(agent.owner) ?? 0) + agent.reallocatedIn);
  }
  for (const [owner, value] of net) assert.ok(Math.abs(value) < 1e-9, `owner ${owner} nets ${value}`);
}

test("a seed range starts at firstSeed, and the default is seeds 1 to n", () => {
  const arm = SLOT_ARMS.C1!;
  const late = runSlotCell(arm, 0.009, 10, "trending", 3, 51);
  assert.deepEqual(
    late.seeds.map((item) => item.seed),
    [51, 52, 53],
  );
  const early = runSlotCell(arm, 0.009, 10, "trending", 53);
  assert.deepEqual(
    early.seeds.map((item) => item.seed),
    Array.from({ length: 53 }, (_, index) => index + 1),
  );
  assert.deepEqual(late.seeds, early.seeds.slice(50));
  assert.deepEqual(runSlotCell(arm, 0.009, 10, "trending", 2, 1), runSlotCell(arm, 0.009, 10, "trending", 2));
  assert.throws(() => runSlotCell(arm, 0.009, 10, "trending", 2, 0), RangeError);
});

test("with the issue #92 options unset, an issue #89 cell reproduces field for field", () => {
  const published = JSON.parse(
    readFileSync(
      new URL("../../results/reallocation-scope/Omix-RT-c0.2-x4-m0.009-10-choppy.json", import.meta.url),
      "utf8",
    ),
  ) as { cells: SlotCell[] };
  const cell = runSlotCell(SLOT_ARMS["Omix-RT-c0.2-x4"]!, 0.009, 10, "choppy", 50);
  assert.deepEqual(JSON.parse(JSON.stringify(cell)), published.cells[0]);
});

test("the matched share takes the bottom and top share of a population-wide pool", () => {
  assert.equal(sharedQuota(0, 1 / 3), 0);
  assert.equal(sharedQuota(1, 1 / 3), 0);
  assert.equal(sharedQuota(2, 1 / 3), 1);
  assert.equal(sharedQuota(3, 1 / 3), 1);
  assert.equal(sharedQuota(10, 1 / 3), 3);
  assert.equal(sharedQuota(1000, 1 / 3), 333);
  assert.equal(sharedQuota(1000, 1 / 5), 200);
  for (const ranked of [2, 3, 7, 100, 999]) {
    for (const share of [1 / 3, 1 / 5, 0.5]) assert.ok(2 * sharedQuota(ranked, share) <= ranked);
  }
  assert.throws(() => sharedQuota(10, 0), RangeError);
  assert.throws(() => sharedQuota(10, 0.6), RangeError);
});

test("the matched-share arms conserve capital and move more than the decile rule", () => {
  const decile = run(slotRunConfig(SLOT_ARMS["RT-c0.2-x4"]!, 0.009, 100, "trending", 1));
  for (const name of ["RTs3-c0.2-x4", "RTs5-c0.2-x4"]) {
    const result = run(slotRunConfig(SLOT_ARMS[name]!, 0.009, 100, "trending", 1));
    assertConserved(result);
    assert.equal(result.slots?.replacements, 0);
    assert.ok((result.slots?.capitalMoved ?? 0) > (decile.slots?.capitalMoved ?? 0), name);
  }
  const base = slotRunConfig(SLOT_ARMS["RTs3-c0.2-x4"]!, 0.009, 10, "choppy", 1);
  assert.throws(() => run({ ...base, slots: { ...base.slots!, owners: [5, 5] } }), RangeError);
  assert.throws(() => run({ ...base, slots: { ...base.slots!, quotaShare: 0.75 } }), RangeError);
});

test("recycling never fills a sink past its ceiling", () => {
  assert.equal(recycleAmount(5, { capital: 10, principal: 10 }, 4), 5);
  assert.equal(recycleAmount(50, { capital: 10, principal: 10 }, 4), 30);
  assert.equal(recycleAmount(5, { capital: 40, principal: 10 }, 4), 0);
  assert.equal(recycleAmount(5, { capital: 45, principal: 10 }, 4), 0);
  for (const capital of [0, 3, 12.5, 39.9]) {
    const amount = recycleAmount(20, { capital, principal: 10 }, 4);
    assert.ok(amount >= 0 && capital + amount <= 40 + 1e-12);
  }
});

test("recycling conserves capital, keeps every move inside one owner, and empties retired slots when it can", () => {
  const regimes: Regime[] = ["trending", "stress_flash_crash"];
  for (const regime of regimes) {
    for (const seed of [1, 2]) {
      const idle = run(slotRunConfig(SLOT_ARMS["Omix-RT-c0.2-x4"]!, 0.009, 100, regime, seed));
      const result = run(slotRunConfig(SLOT_ARMS["Omix-RTr-c0.2-x4"]!, 0.009, 100, regime, seed));
      assertConserved(result);
      assertOwnerBound(result);
      assert.equal(result.slots?.replacements, 0);
      assert.ok((result.slots?.capitalRecycled ?? 0) > 0, `${regime} ${seed} recycled nothing`);
      assert.equal(idle.slots?.capitalRecycled, undefined);
      const idleRetired = idle.agents.filter((a) => a.status === "retired").reduce((sum, a) => sum + a.capital, 0);
      const leftRetired = result.agents.filter((a) => a.status === "retired").reduce((sum, a) => sum + a.capital, 0);
      assert.ok(leftRetired < idleRetired, `${regime} ${seed}`);
    }
  }
});

test("a single-slot owner has nowhere to recycle to", () => {
  const base = slotRunConfig(SLOT_ARMS["Omix-RTr-c0.2-x4"]!, 0.009, 100, "choppy", 1);
  const result = run(base);
  const sizes = base.slots!.owners!;
  for (const agent of result.agents) {
    if (sizes[agent.owner!] === 1) assert.equal(agent.reallocatedIn, 0, agent.id);
  }
  assertOwnerBound(result);
});
