import { allocateCapital } from "@monadeum/reproduction/allocate";
import { PROTOCOL } from "monadeum-simulation/protocol";

/**
 * Illustrative reproduction used across the landing page. The profit figure is a sample;
 * every derived number goes through the real protocol constants and `allocateCapital`.
 */
const SAMPLE_PROFIT_FRACTION = 0.64;

const principal = PROTOCOL.principal;
const profit = principal * SAMPLE_PROFIT_FRACTION;
const capitalBefore = principal + profit;
const { childCapital, parentCapitalAfter } = allocateCapital({
  capital: capitalBefore,
  principal,
  fraction: PROTOCOL.reproductionFraction,
  maxChildCapital: PROTOCOL.principal,
});

export const REPRO = {
  principal,
  profit,
  capitalBefore,
  threshold: principal * (1 + PROTOCOL.profitThresholdFraction),
  childCapital,
  parentCapitalAfter,
  profitAfter: parentCapitalAfter - principal,
  /** The bars span $0 up to this value. */
  scale: principal * 2,
} as const;

/** Formats a dollar amount with two decimals, rounding away floating point noise. */
export const money = (v: number) => `$${(Math.round(v * 100) / 100).toFixed(2)}`;
export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
