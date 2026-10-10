export interface ReallocationSink {
  capital: number;
  principal: number;
}

export interface ReallocationPlan {
  /** Amount taken from each source, in the order given. */
  debits: number[];
  /** Amount given to each sink, in the order given. */
  credits: number[];
  /** Total moved. Equal to the sum of the debits and to the sum of the credits, up to rounding. */
  moved: number;
}

/**
 * Bounded reallocation for issue #85, a pure function of balances. Each source offers `cap` of its capital, never going
 * below `floor`. Each sink can take up to `ceiling * principal - capital`. The amount moved is the smaller of the total
 * offer and the total room. Sources give in proportion to their offers and sinks receive in proportion to their room,
 * so no source goes below the floor and no sink goes above its ceiling. Nothing is created or destroyed.
 */
export function planReallocation(
  sources: readonly number[],
  sinks: readonly ReallocationSink[],
  cap: number,
  ceiling: number,
  floor: number,
): ReallocationPlan {
  const offers = sources.map((capital) => Math.max(0, Math.min(cap * capital, capital - floor)));
  const rooms = sinks.map((sink) => Math.max(0, ceiling * sink.principal - sink.capital));
  const pool = offers.reduce((sum, value) => sum + value, 0);
  const room = rooms.reduce((sum, value) => sum + value, 0);
  const moved = Math.min(pool, room);
  if (!(moved > 0)) return { debits: sources.map(() => 0), credits: sinks.map(() => 0), moved: 0 };
  return {
    debits: offers.map((offer) => offer * (moved / pool)),
    credits: rooms.map((space) => space * (moved / room)),
    moved,
  };
}

/**
 * How many slots are sources, and how many are sinks, in a pool of `ranked` slots that have a fitness.
 *
 * - Population-wide (issue #85): the bottom and top decile, `floor(ranked / 10)`, and none below 10 ranked slots.
 * - Owner pool (issue #89, `smallPool`): a decile does not exist in a pool of 3 or 5, so the rule is the bottom one and
 *   the top one in a pool of 2 to 19 ranked slots, the bottom and top decile from 20 up, and none in a pool of 0 or 1.
 *   The two rules agree from 10 ranked slots up.
 */
export function reallocationQuota(ranked: number, smallPool: boolean): number {
  const decile = Math.floor(ranked / 10);
  if (!smallPool) return decile;
  return ranked >= 2 ? Math.max(1, decile) : 0;
}

/**
 * Issue #92 exploratory matched-aggressiveness rule: in a population-wide pool of `ranked` slots, the bottom and top
 * `max(1, floor(ranked * share))` slots, from 2 ranked slots up. A share of 1/3 gives a population-wide pool the same
 * source and sink share as the small-pool rule gives an owner of 3. The share must be in (0, 0.5], so sources and sinks
 * never overlap.
 */
export function sharedQuota(ranked: number, share: number): number {
  if (!(share > 0 && share <= 0.5)) throw new RangeError(`quota share must be in (0, 0.5], got ${share}`);
  return ranked >= 2 ? Math.max(1, Math.floor(ranked * share)) : 0;
}

/**
 * Issue #92 exploratory recycling: how much of a retired slot's `capital` its owner's best active slot can take, up to
 * `ceiling * principal`. A sink already at or above its ceiling takes nothing.
 */
export function recycleAmount(capital: number, sink: ReallocationSink, ceiling: number): number {
  return Math.max(0, Math.min(capital, ceiling * sink.principal - sink.capital));
}
