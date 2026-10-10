import type { EvaluationPlan } from "./plan.js";
import type { SourceDebit } from "./ports.js";

/**
 * Converts a planner amount (settlement-asset units, a float) to base units, rounding down, once, at the boundary
 * (ARCHITECTURE.md section 16). Rounding down is what keeps every bound: a debit never exceeds its cap or crosses the
 * floor, and a credit never exceeds its room, because each base-unit amount is at most the planned amount.
 */
export function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`invalid amount ${amount}`);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) throw new RangeError(`invalid decimals ${decimals}`);
  const scale = 10 ** decimals;
  let units = Math.floor(amount * scale);
  // The product can round up past an integer in floating point; step back so the result is never above the amount.
  if (units > 0 && units / scale > amount) units -= 1;
  return BigInt(units);
}

/**
 * Groups an evaluation's moves into one debit per source, in plan order, with each credit converted to base units
 * rounding down. A credit that rounds to 0 is dropped, and a source left with no credit has no debit. Capital is
 * conserved exactly: every base unit debited is credited to a sink of the same owner.
 */
export function groupDebits(sequence: number, plan: EvaluationPlan, decimals: number): SourceDebit[] {
  const debits = new Map<string, SourceDebit>();
  for (const move of plan.moves) {
    const amount = toBaseUnits(move.amount, decimals);
    if (amount === 0n) continue;
    const key = `${move.owner}:${sequence}:${move.source}`;
    let debit = debits.get(key);
    if (!debit) {
      debit = { key, owner: move.owner, sequence, source: move.source, credits: [], total: 0n };
      debits.set(key, debit);
    }
    if (debit.credits.some((c) => c.sink === move.sink)) throw new RangeError(`duplicate move ${key} -> ${move.sink}`);
    debit.credits.push({ sink: move.sink, amount });
    debit.total += amount;
  }
  return [...debits.values()];
}
