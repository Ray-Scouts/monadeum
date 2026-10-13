import type { BreakerEvent, BreakerSignal, BreakerStore } from "@monadeum/agent-registry";

export type BreakerTrip = Extract<BreakerEvent, { kind: "trip" }>;

/**
 * The thresholds of the population-level circuit breaker (SECURITY.md section 9, layer 3), settlement-asset base units.
 * A signal trips the breaker when its value is strictly above its threshold. A null threshold leaves that signal
 * unchecked; the tick runner requires the capital-at-risk threshold (`loadTickRunnerConfig`).
 */
export interface BreakerThresholds {
  /** Sum over Active, funded agents of the settlement-asset balance plus the cost basis of the open position. */
  capitalAtRisk: bigint | null;
  /** The capital one evaluation's reallocation plan would move, checked before anything is settled. */
  reallocationVolume: bigint | null;
}

/**
 * A latch over the append-only breaker log. While the latest entry is a trip, the worker runs no tick and settles no
 * reallocation; evaluations still compute fitness and apply retirement, which move no capital. Only a `clear`, which
 * the policy operator's CLI appends after a human review (`clearBreaker`), releases it. Each signal is checked at
 * every evaluation, so a breach is caught within one evaluation cadence.
 */
export class PopulationBreaker {
  constructor(
    private readonly store: BreakerStore,
    readonly thresholds: BreakerThresholds,
    private readonly clock: () => Date,
  ) {}

  /** The trip in force, or null. A store that cannot be read throws, and the caller fails closed. */
  async tripped(): Promise<BreakerTrip | null> {
    const latest = await this.store.latest();
    return latest?.kind === "trip" ? latest : null;
  }

  /** Trips the breaker when `observed` is above the signal's threshold. Returns the trip in force after the check. */
  async check(signal: BreakerSignal, observed: bigint): Promise<BreakerTrip | null> {
    const current = await this.tripped();
    if (current) return current;
    const threshold = signal === "capital-at-risk" ? this.thresholds.capitalAtRisk : this.thresholds.reallocationVolume;
    if (threshold === null || observed <= threshold) return null;
    const trip: BreakerTrip = {
      kind: "trip", signal, observed, threshold, actor: "worker",
      reason: `${signal} ${observed} is above the threshold ${threshold}`, recordedAt: this.clock().getTime(),
    };
    await this.store.append(trip);
    return trip;
  }
}

/** A human's release of a tripped breaker, with who reviewed it and why. Refuses when the breaker is not tripped. */
export async function clearBreaker(store: BreakerStore, input: { actor: string; reason: string; now: Date }): Promise<void> {
  const actor = input.actor.trim();
  const reason = input.reason.trim();
  if (!actor || !reason) throw new Error("a clear names who reviewed the trip and why it is safe to resume");
  const latest = await store.latest();
  if (latest?.kind !== "trip") throw new Error("the population breaker is not tripped");
  await store.append({ kind: "clear", actor, reason, recordedAt: input.now.getTime() });
}
