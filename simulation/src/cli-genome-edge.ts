import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COSTS,
  MAGNITUDE_GRID,
  REFERENCE_MAGNITUDE,
  REGIMES,
  TO_SYNTHETIC,
  backtest,
  calibrate,
  cutBlocks,
  labelBlocks,
  mean,
  quintileSpread,
  range,
  rankPersistence,
  rSquared,
  sampleGenomes,
  sampleSd,
  syntheticCell,
  ticksOf,
  type Block,
  type CostCase,
  type RealRegime,
  type SyntheticCell,
} from "./genome-edge.js";
import { HELD_OUT_END, HELD_OUT_START, IN_SAMPLE_START, coinbaseHourly, csvLines, hourlyReturns, kuruHourly, type HourlySeries } from "./genome-edge-data.js";
import { median } from "@monadeum/fitness/math";

// Issue #102. PHASE=synthetic computes the synthetic reference (no market data). PHASE=bars builds the committed hourly
// series from the raw fetch. PHASE=insample runs the data quality gate and every statistic on the in-sample period
// only (first two thirds against the last third). PHASE=final runs the pre-registered analysis once on the held-out
// period. Paths are relative to `simulation/`.

const DATA = resolve("data/genome-edge");
const RAW = resolve(DATA, "raw");
const OUT = resolve("results/genome-edge");
mkdirSync(OUT, { recursive: true });
const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const genomes = sampleGenomes();

function writeSeries(name: string, series: HourlySeries): void {
  const lines = series.hours.map((h, i) => `${new Date(h * 1000).toISOString()},${h},${series.close[i]},${series.count[i]}`);
  writeFileSync(resolve(DATA, name), `hour_utc,unix,close,observations\n${lines.join("\n")}\n`);
}

function readSeries(name: string): HourlySeries {
  const rows = readFileSync(resolve(DATA, name), "utf8").trim().split("\n").slice(1).map((line) => line.split(","));
  return { hours: rows.map((r) => Number(r[1])), close: rows.map((r) => Number(r[2])), count: rows.map((r) => Number(r[3])) };
}

if (process.env.PHASE === "bars") {
  mkdirSync(DATA, { recursive: true });
  const kuru = kuruHourly(resolve(RAW, "kuru-trades.csv"), IN_SAMPLE_START, HELD_OUT_END);
  const coinbase = coinbaseHourly(resolve(RAW, "coinbase-mon-usd-1h.csv"), IN_SAMPLE_START, HELD_OUT_END);
  writeSeries("kuru-mon-usdc-1h.csv", kuru);
  writeSeries("coinbase-mon-usd-1h.csv", coinbase);
  const chunks = readFileSync(resolve(RAW, "kuru-chunks.csv"), "utf8").trim().split("\n").slice(1);
  const blocks = chunks.map((line) => line.split(",").map(Number));
  const manifest = {
    kuruTradesSha256: sha(resolve(RAW, "kuru-trades.csv")),
    kuruTrades: [...csvLines(resolve(RAW, "kuru-trades.csv"))].length,
    kuruChunks: blocks.length,
    kuruFirstBlock: Math.min(...blocks.map((b) => b[0] as number)),
    kuruLastBlock: Math.max(...blocks.map((b) => b[1] as number)),
    coinbaseRawSha256: sha(resolve(RAW, "coinbase-mon-usd-1h.csv")),
    kuruHourlySha256: sha(resolve(DATA, "kuru-mon-usdc-1h.csv")),
    coinbaseHourlySha256: sha(resolve(DATA, "coinbase-mon-usd-1h.csv")),
  };
  writeFileSync(resolve(DATA, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

if (process.env.PHASE === "synthetic") {
  const cases = (process.env.COST_CASES ?? "base,high,zero").split(",") as CostCase[];
  const regimes = (process.env.REGIMES ?? REGIMES.join(",")).split(",") as typeof REGIMES[number][];
  const cells: SyntheticCell[] = [];
  for (const cost of cases) {
    for (const regime of regimes) {
      for (const magnitude of MAGNITUDE_GRID) {
        cells.push(syntheticCell(genomes, regime, magnitude, cost));
        console.error(`${cost} ${regime} ${magnitude}`);
      }
    }
  }
  if (cases.includes("base")) for (const regime of regimes) cells.push(syntheticCell(genomes, regime, REFERENCE_MAGNITUDE, "base", false));
  writeFileSync(resolve(OUT, `synthetic-${cases.join("-")}-${regimes.join("-")}.json`), `${JSON.stringify(cells)}\n`);
}

interface Prepared {
  hours: number[];
  returns: Float64Array;
  inFrom: number;
  inTo: number;
  outFrom: number;
  outTo: number;
}

/** Index 0 is the first in-sample hour. Hours before the first observed price are skipped (stated as a deviation). */
function prepare(series: HourlySeries, fromHour?: number): Prepared & { firstPriced: number } {
  const r = hourlyReturns(series);
  const firstPriced = fromHour === undefined ? r.returns.findIndex((value) => Number.isFinite(value)) : r.hours.indexOf(fromHour);
  const hours = r.hours.slice(firstPriced);
  const returns = Float64Array.from(r.returns.slice(firstPriced));
  const heldOut = hours.indexOf(HELD_OUT_START);
  const outFrom = heldOut < 0 ? hours.length : heldOut;
  return { hours, returns, inFrom: 1, inTo: outFrom, outFrom, outTo: hours.length, firstPriced };
}

function coverage(series: HourlySeries, from: number, to: number): number {
  let hit = 0;
  let total = 0;
  series.hours.forEach((h, i) => {
    if (h >= from && h < to) {
      total += 1;
      if ((series.count[i] as number) > 0) hit += 1;
    }
  });
  return total === 0 ? 0 : hit / total;
}

function analyze(p: Prepared, cost: CostCase, synthetic: SyntheticCell[], label: string) {
  const bt = backtest(p.returns, genomes, COSTS[cost]);
  const inBlocksRaw = cutBlocks(p.returns, p.inFrom, p.inTo);
  const stressSd = 1.5 * median(inBlocksRaw.map((b) => b.sd));
  const inBlocks = labelBlocks(inBlocksRaw, stressSd);
  const outBlocks = labelBlocks(cutBlocks(p.returns, p.outFrom, p.outTo), stressSd);
  const ref = (regime: string, magnitude: number, withPair = true): SyntheticCell | undefined =>
    synthetic.find((c) => c.cost === cost && c.regime === regime && c.magnitude === magnitude && c.withPair === withPair);
  const regimes: RealRegime[] = ["trending", "mean_reverting", "choppy", "stress"];
  const h1 = regimes.map((regime) => {
    const inCount = inBlocks.filter((b) => b.label === regime).length;
    const outCount = outBlocks.filter((b) => b.label === regime).length;
    const qualifies = inCount >= 2 && outCount >= 2;
    const reference = ref(TO_SYNTHETIC[regime], REFERENCE_MAGNITUDE)?.medianSpread ?? Number.NaN;
    const referenceNoPair = ref(TO_SYNTHETIC[regime], REFERENCE_MAGNITUDE, false)?.medianSpread ?? Number.NaN;
    const inTicks = ticksOf(inBlocks, regime);
    const outTicks = ticksOf(outBlocks, regime);
    const result = inTicks.length > 0 && outTicks.length > 0 ? quintileSpread(bt, p.returns, inTicks, outTicks, 1) : null;
    const holds = qualifies && result !== null && result.normalized >= reference && result.p < 0.05;
    const below = qualifies && result !== null && result.upper95 < reference;
    return { regime, inBlocks: inCount, outBlocks: outCount, qualifies, reference, referenceNoPair, result, holds, below };
  });
  const pooledRefCurve = MAGNITUDE_GRID.map((m) => median(REGIMES.map((r) => ref(r, m)?.medianSpread ?? Number.NaN)));
  const pooledReference = median(REGIMES.map((r) => ref(r, REFERENCE_MAGNITUDE)?.medianSpread ?? Number.NaN));
  const pooled = quintileSpread(bt, p.returns, range(p.inFrom, p.inTo), range(p.outFrom, p.outTo), 1);
  const qualifying = h1.filter((row) => row.qualifies);
  let h1Call: "passes" | "negative" | "inconclusive" = "inconclusive";
  if (h1.filter((row) => row.holds).length >= 2) h1Call = "passes";
  else if (qualifying.length >= 2 && qualifying.every((row) => row.below)) h1Call = "negative";
  else if (qualifying.length < 2 && pooled.upper95 < pooledReference) h1Call = "negative";

  const outTicks = range(p.outFrom, p.outTo);
  const h2 = rankPersistence(bt, outTicks, 2);
  const h2Reference = median(REGIMES.map((r) => ref(r, REFERENCE_MAGNITUDE)?.medianRho ?? Number.NaN));
  let h2Call: "passes" | "negative" | "inconclusive" = "inconclusive";
  if (h2.rho >= h2Reference && h2.lower95 > 0) h2Call = "passes";
  else if (h2.upper95 < h2Reference) h2Call = "negative";
  const h2ByRegime = regimes.map((regime) => {
    const blocks = outBlocks.filter((b) => b.label === regime);
    const rhos = h2.perEvaluation.filter((e) => blocks.some((b) => e.tick >= b.start && e.tick < b.end)).map((e) => e.rho);
    return { regime, evaluations: rhos.length, rho: rhos.length ? mean(rhos) : Number.NaN };
  });
  const magnitudeStar = calibrate(pooled.normalized, pooledRefCurve);

  const outMean = bt.net.map((row) => mean(Array.from(row.slice(p.outFrom, p.outTo))));
  const r2 = rSquared(outMean, [
    genomes.map((g) => Math.log(Math.max(1, Math.floor(g.timeHorizon)))),
    genomes.map((g) => g.entryThreshold),
    genomes.map((g) => Math.log(g.executionFrequency)),
  ]);
  const swapsPerGenome = mean(bt.swaps.map((row) => row.slice(p.outFrom, p.outTo).reduce((a, b) => a + b, 0)));
  return {
    label,
    cost,
    costPerSwap: COSTS[cost],
    ticks: { inSample: p.inTo - p.inFrom, heldOut: p.outTo - p.outFrom },
    marketSd: { inSample: sampleSd(p.returns.slice(p.inFrom, p.inTo)), heldOut: sampleSd(p.returns.slice(p.outFrom, p.outTo)) },
    stressSd,
    blocks: { inSample: inBlocks.map(blockRow(p)), heldOut: outBlocks.map(blockRow(p)) },
    h1,
    h1Call,
    pooled,
    pooledReference,
    pooledRefCurve,
    magnitudeStar,
    h2: { ...h2, perEvaluation: undefined },
    h2Reference,
    h2Call,
    h2ByRegime,
    heldOutR2: r2,
    meanInMarket: mean(bt.inMarket),
    swapsPerGenomeHeldOut: swapsPerGenome,
    meanHeldOutNetPerTick: mean(outMean),
  };
}

const blockRow = (p: Prepared) => (b: Block) => ({
  from: new Date((p.hours[b.start] as number) * 1000).toISOString().slice(0, 10),
  hours: b.end - b.start,
  sd: b.sd,
  efficiency: b.efficiency,
  autocorrelation: b.autocorrelation,
  label: b.label,
});

if (process.env.PHASE === "insample" || process.env.PHASE === "final") {
  // The in-sample dry run builds its series from the raw files with an end at the held-out start, so it never reads a
  // held-out hour. The final run reads the committed hourly series.
  const insample = process.env.PHASE === "insample";
  const kuruSeries = insample ? kuruHourly(resolve(RAW, "kuru-trades.csv"), IN_SAMPLE_START, HELD_OUT_START) : readSeries("kuru-mon-usdc-1h.csv");
  const coinbaseSeries = insample
    ? coinbaseHourly(resolve(RAW, "coinbase-mon-usd-1h.csv"), IN_SAMPLE_START, HELD_OUT_START)
    : readSeries("coinbase-mon-usd-1h.csv");
  const synthetic = readdirSync(OUT)
    .filter((name) => name.startsWith("synthetic-") && name.endsWith(".json"))
    .flatMap((name) => JSON.parse(readFileSync(resolve(OUT, name), "utf8")) as SyntheticCell[]);
  const kuruR = hourlyReturns(kuruSeries);
  const cbR = hourlyReturns(coinbaseSeries);
  const paired: [number, number][] = [];
  kuruR.hours.forEach((h, i) => {
    const a = kuruR.returns[i] as number;
    const b = cbR.returns[i] as number;
    if (h < HELD_OUT_START && Number.isFinite(a) && Number.isFinite(b)) paired.push([a, b]);
  });
  const pearson = (xy: [number, number][]): number => {
    const mx = mean(xy.map((v) => v[0]));
    const my = mean(xy.map((v) => v[1]));
    let n = 0;
    let dx = 0;
    let dy = 0;
    for (const [x, y] of xy) {
      n += (x - mx) * (y - my);
      dx += (x - mx) ** 2;
      dy += (y - my) ** 2;
    }
    return n / Math.sqrt(dx * dy);
  };
  const gate = {
    coverageInSample: coverage(kuruSeries, IN_SAMPLE_START, HELD_OUT_START),
    coverageHeldOut: process.env.PHASE === "final" ? coverage(kuruSeries, HELD_OUT_START, HELD_OUT_END) : null,
    correlationInSample: pearson(paired),
    pairedHours: paired.length,
    coinbaseCoverageInSample: coverage(coinbaseSeries, IN_SAMPLE_START, HELD_OUT_START),
    firstKuruHour: new Date((kuruSeries.hours[kuruSeries.close.findIndex((c) => Number.isFinite(c))] as number) * 1000).toISOString(),
  };
  console.log(JSON.stringify({ gate }, null, 2));

  const kuru = prepare(kuruSeries);
  // The proxy runs on the same hours as the Kuru series.
  const coinbase = prepare(coinbaseSeries, kuru.hours[0]);
  if (process.env.PHASE === "insample") {
    // Dry run on in-sample data only: first two thirds as "in-sample", last third as "held-out".
    const dry = (p: Prepared): Prepared => {
      const split = p.inFrom + Math.floor(((p.inTo - p.inFrom) * 2) / 3);
      return { ...p, inTo: split, outFrom: split, outTo: p.inTo };
    };
    const out = { gate, kuru: analyze(dry(kuru), "base", synthetic, "kuru dry run"), coinbase: analyze(dry(coinbase), "base", synthetic, "coinbase dry run") };
    writeFileSync(resolve(OUT, "insample-dry-run.json"), `${JSON.stringify(out, null, 2)}\n`);
    console.log(JSON.stringify({ kuru: summary(out.kuru), coinbase: summary(out.coinbase) }, null, 2));
  } else {
    const runs = [];
    for (const cost of ["base", "high", "zero"] as CostCase[]) {
      runs.push(analyze(kuru, cost, synthetic, "kuru"));
      runs.push(analyze(coinbase, cost, synthetic, "coinbase"));
    }
    writeFileSync(resolve(OUT, "final.json"), `${JSON.stringify({ gate, firstPricedHour: new Date((kuru.hours[0] as number) * 1000).toISOString(), runs }, null, 2)}\n`);
    for (const run of runs) console.log(JSON.stringify(summary(run)));
  }
}

function summary(run: ReturnType<typeof analyze>) {
  return {
    label: run.label,
    cost: run.cost,
    h1Call: run.h1Call,
    h1: run.h1.map((r) => ({ regime: r.regime, q: r.qualifies, n: [r.inBlocks, r.outBlocks], ref: r.reference, s: r.result?.normalized, p: r.result?.p, up: r.result?.upper95 })),
    pooled: { s: run.pooled.normalized, lo: run.pooled.lower95, up: run.pooled.upper95, ref: run.pooledReference, carry: run.pooled.rankCarry },
    h2: { rho: run.h2.rho, lo: run.h2.lower95, up: run.h2.upper95, ref: run.h2Reference, call: run.h2Call, evals: run.h2.evaluations },
    mStar: run.magnitudeStar,
    r2: run.heldOutR2,
  };
}

if (process.env.PHASE === "report") {
  // Markdown tables for results/genome-edge.md, from final.json and the synthetic reference.
  const final = JSON.parse(readFileSync(resolve(OUT, "final.json"), "utf8")) as { runs: ReturnType<typeof analyze>[] };
  const synthetic = readdirSync(OUT)
    .filter((name) => name.startsWith("synthetic-") && name.endsWith(".json"))
    .flatMap((name) => JSON.parse(readFileSync(resolve(OUT, name), "utf8")) as SyntheticCell[]);
  const f = (v: number | null | undefined, d = 3): string => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(d));
  const pf = (p: number | undefined): string => (p === undefined ? "n/a" : p < 0.0005 ? "<0.001" : p.toFixed(3));
  const lines: string[] = [];
  lines.push(
    "### H1 by regime",
    "",
    "| source | cost | regime | blocks in / out | qualifies | ticks out | spread bp/tick | market sd | normalized | one-sided p | 95% upper | reference 0.006 | carry |",
    "|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const run of final.runs) {
    for (const row of run.h1) {
      const r = row.result;
      lines.push(
        `| ${run.label} | ${run.cost} | ${row.regime} | ${row.inBlocks} / ${row.outBlocks} | ${row.qualifies ? "yes" : "no"} | ${r?.ticksOut ?? 0} | ${f(r ? r.spread * 1e4 : null, 2)} | ${f(r?.marketSd, 4)} | ${f(r?.normalized)} | ${pf(r?.p)} | ${f(r?.upper95)} | ${f(row.reference)} | ${f(r?.rankCarry)} |`,
      );
    }
  }
  lines.push(
    "",
    "### Pooled and H2",
    "",
    "| source | cost | H1 call | pooled normalized spread | 95% bounds | pooled reference | m* | H2 rho | 95% bounds | H2 reference | H2 call | evaluations | genomes ranked | in-market share | swaps per genome, held out | mean net bp/tick | held-out R2 on fields | in-sample to held-out carry |",
    "|---|---|---|---:|---|---:|---:|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const run of final.runs) {
    lines.push(
      `| ${run.label} | ${run.cost} | ${run.h1Call} | ${f(run.pooled.normalized)} | ${f(run.pooled.lower95)} to ${f(run.pooled.upper95)} | ${f(run.pooledReference)} | ${f(run.magnitudeStar, 4)} | ${f(run.h2.rho)} | ${f(run.h2.lower95)} to ${f(run.h2.upper95)} | ${f(run.h2Reference)} | ${run.h2Call} | ${run.h2.evaluations} | ${f(run.h2.meanRanked, 0)} | ${f(run.meanInMarket)} | ${f(run.swapsPerGenomeHeldOut, 1)} | ${f(run.meanHeldOutNetPerTick * 1e4, 3)} | ${f(run.heldOutR2)} | ${f(run.pooled.rankCarry)} |`,
    );
  }
  lines.push("", "### H2 by held-out regime (descriptive)", "", "| source | cost | regime | evaluations | mean rho |", "|---|---|---|---:|---:|");
  for (const run of final.runs) for (const row of run.h2ByRegime) lines.push(`| ${run.label} | ${run.cost} | ${row.regime} | ${row.evaluations} | ${f(row.rho)} |`);
  lines.push("", "### Regime blocks (Kuru)", "", "| period | from | hours | sd | efficiency | lag-1 autocorrelation | label |", "|---|---|---:|---:|---:|---:|---|");
  const kuru = final.runs[0] as ReturnType<typeof analyze>;
  for (const [period, blocks] of [
    ["in-sample", kuru.blocks.inSample],
    ["held-out", kuru.blocks.heldOut],
  ] as const) {
    for (const b of blocks) lines.push(`| ${period} | ${b.from} | ${b.hours} | ${f(b.sd, 4)} | ${f(b.efficiency)} | ${f(b.autocorrelation)} | ${b.label} |`);
  }
  lines.push("", "### Synthetic reference (median over 20 seeds)", "", "| cost | regime | magnitude | pair in score | normalized spread | rho |", "|---|---|---:|---|---:|---:|");
  const order = (c: SyntheticCell): string => `${c.cost}|${REGIMES.indexOf(c.regime)}|${c.magnitude.toFixed(4)}|${c.withPair ? 0 : 1}`;
  for (const c of [...synthetic].sort((a, b) => order(a).localeCompare(order(b)))) {
    lines.push(`| ${c.cost} | ${c.regime} | ${c.magnitude} | ${c.withPair ? "yes" : "no"} | ${f(c.medianSpread)} | ${f(c.medianRho)} |`);
  }
  console.log(lines.join("\n"));
}

