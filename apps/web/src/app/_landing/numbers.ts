import { CAPITAL_FLOOR, REALLOCATION_CAP, SLOT_CEILING } from "@monadeum/reallocation/constants";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { planReallocation } from "@monadeum/reallocation/plan";

/**
 * Illustrative reallocation used across the landing page: one owner, three agents with the protocol principal.
 * The capitals after trading are a sample; the move goes through the real protocol bounds and `planReallocation`.
 */
const principal = PROTOCOL.principal;
const SAMPLE_CAPITAL = { high: principal * 1.32, middle: principal * 1.04, low: principal * 0.6 } as const;

const plan = planReallocation(
  [SAMPLE_CAPITAL.low],
  [{ capital: SAMPLE_CAPITAL.high, principal }],
  REALLOCATION_CAP,
  SLOT_CEILING,
  CAPITAL_FLOOR,
);

export const REALLOC = {
  principal,
  before: SAMPLE_CAPITAL,
  moved: plan.moved,
  after: { high: SAMPLE_CAPITAL.high + plan.moved, middle: SAMPLE_CAPITAL.middle, low: SAMPLE_CAPITAL.low - plan.moved },
  total: SAMPLE_CAPITAL.high + SAMPLE_CAPITAL.middle + SAMPLE_CAPITAL.low,
  ceiling: SLOT_CEILING * principal,
  /** The bars span $0 up to this value. */
  scale: principal * 2,
} as const;

/** Formats a dollar amount with two decimals, rounding away floating point noise. */
export const money = (v: number) => `$${(Math.round(v * 100) / 100).toFixed(2)}`;
export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
