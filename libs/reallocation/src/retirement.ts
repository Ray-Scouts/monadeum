import { percentile } from "@monadeum/fitness/math";
import { CAPITAL_FLOOR, RETIREMENT_WINDOWS, STARVATION_PERCENTILE } from "./constants.js";

export type RetirementReason = "owner" | "capital_floor" | "starvation";

export interface RetirementInput {
  capital: number;
  /** Adjusted fitness this window, or null when the agent has none. A null window leaves the starvation count as is. */
  adjustedFitness: number | null;
  /** Adjusted fitness of every Active agent in the agent's niche this window, including the agent's own. */
  nicheFitness: readonly number[];
  /** Consecutive bottom-decile windows counted before this one. */
  lowFitnessWindows: number;
  /** The owner explicitly retires the agent. */
  ownerRequested?: boolean;
}

export interface RetirementDecision {
  retire: boolean;
  reason: RetirementReason | null;
  /** The starvation count to carry into the next window. */
  lowFitnessWindows: number;
}

/** Below the section 6 floor. The simulation checks this after every tick, not only at evaluations. */
export function belowCapitalFloor(capital: number, floor: number = CAPITAL_FLOOR): boolean {
  return capital < floor;
}

/**
 * The section 6 retirement trigger, as the simulation applies it: the owner retires the agent, its capital is below the
 * floor, or its adjusted fitness percentile within its niche has been at or below the bottom decile for `windows`
 * consecutive evaluations. Retirement moves no capital (THREAT-MODEL.md invariant 15): the decision only changes
 * status, and the balance stays in the agent's own account.
 */
export function evaluateRetirement(
  input: RetirementInput,
  floor: number = CAPITAL_FLOOR,
  windows: number = RETIREMENT_WINDOWS,
): RetirementDecision {
  let low = input.lowFitnessWindows;
  if (input.adjustedFitness !== null) {
    low = percentile(input.adjustedFitness, input.nicheFitness) <= STARVATION_PERCENTILE ? low + 1 : 0;
  }
  if (input.ownerRequested) return { retire: true, reason: "owner", lowFitnessWindows: low };
  if (belowCapitalFloor(input.capital, floor)) return { retire: true, reason: "capital_floor", lowFitnessWindows: low };
  if (low >= windows) return { retire: true, reason: "starvation", lowFitnessWindows: low };
  return { retire: false, reason: null, lowFitnessWindows: low };
}
