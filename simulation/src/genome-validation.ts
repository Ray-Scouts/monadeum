import { mean, sampleStdev, welch } from "./aggregate.js";
import { OFFSET } from "./genome-model.js";
import { run } from "./runner.js";
import type { Regime, RunResult } from "./types.js";

/**
 * Static-population validation of the issue #84 genome performance model. Each agent's ROI over the run is pooled
 * across seeds and split into quintiles by closeness to the regime optimum under the model, or by hidden skill without
 * it. Magnitude 0 keeps random genomes but gives them no edge, which isolates what the market path alone does.
 */

/** The section 8 baseline policy and costs of the re-run arm A: risk 0.25, trade every tick, x402 $0.01. */
const POLICY = { riskTolerance: 0.25, executionFrequency: 1 };
export const VALIDATION_TICKS = 300;

/** `null` magnitude is the current harness: identical founders and the hidden skill. */
export interface ValidationSpec {
  regime: Regime;
  magnitude: number | null;
  population: number;
  seeds: number;
}

export interface QuintileRow {
  n: number;
  /** Mean base edge, per tick. */
  edge: number;
  /** Mean genome distance from the regime optimum. Null for the hidden skill baseline. */
  distance: number | null;
  roiMean: number;
  roiStdev: number;
}

export interface ValidationRow {
  regime: Regime;
  magnitude: number | null;
  population: number;
  seeds: number;
  agents: number;
  /** Mean and sample standard deviation across seeds of the population ROI, percent. */
  populationRoiMean: number;
  populationRoiStdev: number;
  /** Per-agent ROI, percent, pooled over seeds. */
  agentRoiMean: number;
  agentRoiStdev: number;
  agentRoiP10: number;
  agentRoiP50: number;
  agentRoiP90: number;
  retiredShare: number;
  /** Quintiles from farthest from the optimum to closest, or from lowest to highest hidden skill. */
  quintiles: QuintileRow[];
  /** Closest (or highest-skill) quintile mean ROI minus farthest (or lowest-skill), percentage points. */
  topBottomGap: number;
  topBottomP: number;
  /** Pearson correlation of base edge and agent ROI. 0 at magnitude 0, where every edge is 0. */
  correlation: number;
  /** OLS slope of agent ROI (percent) on base edge (basis points per tick). */
  slopePctPerBp: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? 0;
  return a + (b - a) * (position - lo);
}

interface AgentPoint {
  edge: number;
  distance: number | null;
  roi: number;
  retired: boolean;
}

function points(result: RunResult, magnitude: number | null): AgentPoint[] {
  return result.agents.map((agent) => {
    const distance = agent.genomeDistance ?? null;
    const edge = magnitude === null || distance === null ? agent.skill : magnitude * (1 - distance - OFFSET);
    return {
      edge,
      distance,
      roi: agent.principal > 0 ? ((agent.capital - agent.principal) / agent.principal) * 100 : 0,
      retired: agent.status === "retired",
    };
  });
}

export function validateCell(spec: ValidationSpec): ValidationRow {
  const all: AgentPoint[] = [];
  const populationRois: number[] = [];
  for (let seed = 1; seed <= spec.seeds; seed++) {
    const result = run({
      seed,
      population: spec.population,
      ticks: VALIDATION_TICKS,
      regime: spec.regime,
      mode: "static",
      genome: POLICY,
      diversity: true,
      costs: { x402Usd: 0.01 },
      ...(spec.magnitude === null ? {} : { genomeModel: { magnitude: spec.magnitude }, randomGenomes: true }),
    });
    populationRois.push(result.roiPct);
    all.push(...points(result, spec.magnitude));
  }
  const rois = all.map((item) => item.roi).sort((a, b) => a - b);
  const key = (item: AgentPoint): number => (item.distance === null ? item.edge : -item.distance);
  const byEdge = [...all].sort((a, b) => key(a) - key(b));
  const quintiles: QuintileRow[] = [];
  const groups: AgentPoint[][] = [];
  for (let i = 0; i < 5; i++) {
    const group = byEdge.slice(Math.floor((i * byEdge.length) / 5), Math.floor(((i + 1) * byEdge.length) / 5));
    groups.push(group);
    const distances = group.flatMap((item) => (item.distance === null ? [] : [item.distance]));
    quintiles.push({
      n: group.length,
      edge: mean(group.map((item) => item.edge)),
      distance: distances.length === 0 ? null : mean(distances),
      roiMean: mean(group.map((item) => item.roi)),
      roiStdev: sampleStdev(group.map((item) => item.roi)),
    });
  }
  const top = (groups[4] ?? []).map((item) => item.roi);
  const bottom = (groups[0] ?? []).map((item) => item.roi);
  const test = welch(top, bottom);
  const edgeMean = mean(all.map((item) => item.edge));
  const roiMean = mean(all.map((item) => item.roi));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const item of all) {
    sxy += (item.edge - edgeMean) * (item.roi - roiMean);
    sxx += (item.edge - edgeMean) ** 2;
    syy += (item.roi - roiMean) ** 2;
  }
  return {
    regime: spec.regime,
    magnitude: spec.magnitude,
    population: spec.population,
    seeds: spec.seeds,
    agents: all.length,
    populationRoiMean: mean(populationRois),
    populationRoiStdev: sampleStdev(populationRois),
    agentRoiMean: roiMean,
    agentRoiStdev: sampleStdev(rois),
    agentRoiP10: quantile(rois, 0.1),
    agentRoiP50: quantile(rois, 0.5),
    agentRoiP90: quantile(rois, 0.9),
    retiredShare: all.filter((item) => item.retired).length / Math.max(1, all.length),
    quintiles,
    topBottomGap: test.meanA - test.meanB,
    topBottomP: test.p,
    correlation: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0,
    slopePctPerBp: sxx > 0 ? sxy / sxx / 10_000 : 0,
  };
}

const label = (magnitude: number | null): string => (magnitude === null ? "hidden skill" : `genome ${magnitude}`);
const pFmt = (p: number): string => (p < 0.0001 ? "<0.0001" : p.toFixed(4));

export function formatValidationSummary(rows: readonly ValidationRow[]): string {
  const lines = [
    "| regime | model | agents | population roi | agent roi sd | agent p10 | agent p50 | agent p90 | retired % | top-bottom quintile gap pp | Welch p | correlation | slope pct per bp |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.regime} | ${label(row.magnitude)} | ${row.agents} | ${row.populationRoiMean.toFixed(2)} | ${row.agentRoiStdev.toFixed(2)} | ${row.agentRoiP10.toFixed(2)} | ${row.agentRoiP50.toFixed(2)} | ${row.agentRoiP90.toFixed(2)} | ${(row.retiredShare * 100).toFixed(1)} | ${row.topBottomGap.toFixed(2)} | ${pFmt(row.topBottomP)} | ${row.correlation.toFixed(3)} | ${row.slopePctPerBp.toFixed(3)} |`,
    );
  }
  return lines.join("\n");
}

export function formatQuintiles(rows: readonly ValidationRow[]): string {
  const lines = [
    "| regime | model | quintile | mean edge bp/tick | mean distance | mean agent roi | agent roi sd |",
    "|---|---|---:|---:|---:|---:|---:|",
  ];
  for (const row of rows) {
    row.quintiles.forEach((q, index) => {
      lines.push(
        `| ${row.regime} | ${label(row.magnitude)} | ${index + 1} | ${(q.edge * 10_000).toFixed(2)} | ${q.distance === null ? "n/a" : q.distance.toFixed(3)} | ${q.roiMean.toFixed(2)} | ${q.roiStdev.toFixed(2)} |`,
      );
    });
  }
  return lines.join("\n");
}
