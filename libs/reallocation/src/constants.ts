/**
 * Protocol constants of the adopted selection mechanism (EVOLUTION.md sections 3.1, 4, and 6). This file is the one
 * source for these values: the simulation's `PROTOCOL` (`simulation/src/protocol.ts`) imports them from here, and the
 * reallocation contract (issue #31) is expected to take the same values. They are proposed defaults, the values the
 * issue #92 confirmation run tested, not measured optima. Changing one is a documented decision in EVOLUTION.md first.
 */

/** Share of a source's capital it can lose in one evaluation (`reallocation_cap`, EVOLUTION.md section 3.1). */
export const REALLOCATION_CAP = 0.2;

/** A sink's capital ceiling through reallocation, as a multiple of its principal (`slot_ceiling`, section 4). */
export const SLOT_CEILING = 4;

/** Minimum viable capital (section 6). A source never goes below it, and an agent below it retires. */
export const CAPITAL_FLOOR = 0.06;

/** Ticks between evaluations (section 3.1 item 3). Ranking, reallocation, and the starvation check run only here. */
export const EVALUATION_CADENCE = 20;

/** Consecutive bottom-decile windows within its niche before an agent retires (`K`, section 6). */
export const RETIREMENT_WINDOWS = 3;

/** Niche percentile at or below which a window counts toward starvation: the bottom decile (section 6). */
export const STARVATION_PERCENTILE = 0.1;

/** Fewest agents an owner's reallocation policy must name for anything to move (section 3.1 item 8). */
export const MIN_POLICY_AGENTS = 2;
