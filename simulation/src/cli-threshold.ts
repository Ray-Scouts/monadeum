import { formatThreshold, runThresholdGrid } from "./threshold.js";
import type { Regime } from "./types.js";

const list = (value: string | undefined, fallback: string): number[] =>
  (value ?? fallback).split(",").map((item) => Number(item.trim()));

const regimes = (process.env.REGIMES ?? "trending,mean_reverting,choppy,stress_flash_crash")
  .split(",")
  .map((item) => item.trim()) as Regime[];

const cells = runThresholdGrid({
  populations: list(process.env.POPS, "10,100"),
  regimes,
  profitThresholdFractions: list(process.env.FRACTIONS, "0,0.1,0.25,0.5"),
  x402Prices: list(process.env.X402, "0.01,0.02,0.03,0.05,0.1,7.5"),
  seeds: Number(process.env.SEEDS ?? 50),
  ticks: 300,
});

process.stdout.write(formatThreshold(cells));
