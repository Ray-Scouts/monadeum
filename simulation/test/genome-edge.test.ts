import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodeTrade, TRADE_TOPIC } from "../src/cli-genome-edge-fetch.js";
import { hourlyReturns, kuruHourly } from "../src/genome-edge-data.js";
import {
  COSTS,
  backtest,
  blockBootstrapMeans,
  calibrate,
  cutBlocks,
  labelBlocks,
  quintileSpread,
  range,
  rankPersistence,
  sampleGenomes,
  spearman,
  syntheticEdge,
} from "../src/genome-edge.js";

test("genome sample is deterministic and inside the pre-registered ranges", () => {
  const a = sampleGenomes();
  const b = sampleGenomes();
  assert.deepEqual(a, b);
  assert.equal(a.length, 1000);
  for (const g of a) {
    assert.ok(g.timeHorizon >= 1 && g.timeHorizon <= 200);
    assert.ok(g.entryThreshold >= -0.01 && g.entryThreshold <= 0.01);
    assert.ok(Number.isInteger(g.executionFrequency) && g.executionFrequency >= 1 && g.executionFrequency <= 50);
  }
});

test("base cost per swap is 11.6 bps", () => {
  assert.ok(Math.abs(COSTS.base - 0.001156) < 1e-6);
  assert.ok(Math.abs(COSTS.high - 0.001916) < 1e-6);
});

test("backtest decides at the close of bar t for bar t + 1 and charges each swap", () => {
  const returns = Float64Array.from([0, 0.01, 0.02, -0.01, 0.03]);
  const genome = { timeHorizon: 1, entryThreshold: 0, executionFrequency: 1, pair: "PAIR_A" };
  const bt = backtest(returns, [genome], 0.001);
  const net = Array.from(bt.net[0] as Float64Array);
  // t=0: mean 0, not above 0, flat. t=1: 0.01 > 0, long for bar 2 (swap). t=2: long for bar 3. t=3: -0.01, flat for bar 4 (swap).
  assert.deepEqual(net.map((v) => Number(v.toFixed(6))), [0, 0, 0.019, -0.01, -0.001]);
  assert.deepEqual(Array.from(bt.swaps[0] as Uint8Array), [0, 0, 1, 0, 1]);
});

test("execution frequency holds the position between decisions", () => {
  const returns = Float64Array.from([0.01, -0.02, -0.02, -0.02, 0.01]);
  const genome = { timeHorizon: 1, entryThreshold: 0, executionFrequency: 3, pair: "PAIR_A" };
  const bt = backtest(returns, [genome], 0);
  assert.deepEqual(Array.from(bt.net[0] as Float64Array).map((v) => Number(v.toFixed(6))), [0, -0.02, -0.02, -0.02, 0]);
});

test("a planted edge produces a positive out-of-sample spread and positive rank persistence", () => {
  const genomes = sampleGenomes(200, 7);
  const returns = Float64Array.from(range(0, 1200).map((i) => 0.01 * Math.sin(i * 1.7)));
  const edges = genomes.map((g) => (g.entryThreshold < 0 ? 0.002 : -0.001));
  const bt = backtest(returns, genomes, COSTS.base, edges);
  const result = quintileSpread(bt, returns, range(1, 800), range(800, 1200), 1, 200);
  assert.ok(result.spread > 0);
  const h2 = rankPersistence(bt, range(800, 1200), 2, 200);
  assert.ok(h2.rho > 0);
});

test("synthetic edge matches the issue #84 range and drops the pair cleanly", () => {
  const g = { timeHorizon: 100, entryThreshold: -0.002, executionFrequency: 1, pair: "PAIR_A" };
  assert.ok(Math.abs(syntheticEdge(g, "trending", 0.006) - 0.004) < 1e-12);
  assert.ok(Math.abs(syntheticEdge({ ...g, pair: "PAIR_B" }, "trending", 0.006, false) - 0.004) < 1e-12);
});

test("calibration interpolates, floors at 0, and caps", () => {
  const grid = [0, 0.003, 0.006];
  const curve = [0.02, 0.15, 0.3];
  assert.equal(calibrate(0.01, curve, grid), 0);
  assert.ok(Math.abs(calibrate(0.225, curve, grid) - 0.0045) < 1e-12);
  assert.equal(calibrate(0.5, curve, grid), 0.006);
});

test("spearman and bootstrap basics", () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  const boots = blockBootstrapMeans([1, 1, 1, 1], 2, 10, 1);
  assert.deepEqual(boots, new Array(10).fill(1));
});

test("regime labels follow the pre-registered order", () => {
  const n = 336;
  const trend = Float64Array.from(range(0, n).map((i) => 0.002 + (i % 2 ? 0.001 : -0.001)));
  const alternating = Float64Array.from(range(0, n).map((i) => (i % 2 ? 0.01 : -0.01)));
  const [t] = labelBlocks(cutBlocks(trend, 0, n), 1);
  const [m] = labelBlocks(cutBlocks(alternating, 0, n), 1);
  const [s] = labelBlocks(cutBlocks(alternating, 0, n), 0.001);
  assert.equal(t?.label, "trending");
  assert.equal(m?.label, "mean_reverting");
  assert.equal(s?.label, "stress");
});

test("trade decoding and hourly bars: last trade, outlier filter, carry forward", () => {
  const word = (v: bigint): string => v.toString(16).padStart(64, "0");
  const data = `0x${[1n, 2n, 1n, 25n * 10n ** 15n, 0n, 3n, 4n, 5n].map(word).join("")}`;
  const decoded = decodeTrade(data);
  assert.equal(decoded.isBuy, true);
  assert.equal(decoded.price, 25n * 10n ** 15n);
  assert.equal(decoded.filledSize, 5n);
  assert.match(TRADE_TOPIC, /^0x[0-9a-f]{64}$/);

  const dir = mkdtempSync(join(tmpdir(), "genome-edge-"));
  const file = join(dir, "trades.csv");
  const start = 7200;
  const rows = [
    "block,log_index,timestamp,is_buy,price_raw,filled_size_raw",
    `10,0,${start - 3000},1,${20n * 10n ** 15n},1`,
    `11,0,${start + 10},1,${21n * 10n ** 15n},1`,
    `11,1,${start + 20},1,${22n * 10n ** 15n},1`,
    `12,0,${start + 30},1,${40n * 10n ** 15n},1`,
  ];
  writeFileSync(file, `${rows.join("\n")}\n`);
  const series = kuruHourly(file, start, start + 2 * 3600);
  // Hour start-3600: 0.020. Hour start: median 0.022, 0.040 dropped, last kept 0.022. Next hour: carried.
  assert.deepEqual(series.close, [0.02, 0.022, 0.022]);
  assert.deepEqual(series.count, [1, 3, 0]);
  const r = hourlyReturns(series);
  assert.ok(Math.abs((r.returns[0] as number) - 0.1) < 1e-12);
  assert.equal(r.returns[1], 0);
});
