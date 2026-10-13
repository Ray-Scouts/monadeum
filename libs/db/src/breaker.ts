import type { BreakerEvent, BreakerSignal, BreakerStore } from "@monadeum/agent-registry";
import type { Database } from "./database.js";

interface Row {
  kind: "trip" | "clear";
  signal: BreakerSignal | null;
  observed: string | null;
  threshold: string | null;
  actor: string;
  reason: string;
  recorded_at: string;
}

/**
 * `BreakerStore` on Postgres (migration 0018): append-only, the latest entry by insertion order is the state. Row-level
 * security lets `monadeum_worker` append trips only and `monadeum_policy_operator` clears only.
 */
export class PgBreakerStore implements BreakerStore {
  constructor(private readonly db: Database) {}

  async append(event: BreakerEvent): Promise<void> {
    const trip = event.kind === "trip" ? event : null;
    await this.db.query(
      `INSERT INTO population_breaker_events (kind, signal, observed, threshold, actor, reason, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event.kind, trip?.signal ?? null, trip?.observed.toString() ?? null, trip?.threshold.toString() ?? null, event.actor, event.reason, event.recordedAt],
    );
  }

  async latest(): Promise<BreakerEvent | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT kind, signal, observed::text AS observed, threshold::text AS threshold, actor, reason, recorded_at::text AS recorded_at
       FROM population_breaker_events ORDER BY id DESC LIMIT 1`,
    );
    const r = rows[0];
    if (!r) return null;
    const recordedAt = Number(r.recorded_at);
    return r.kind === "trip"
      ? { kind: "trip", signal: r.signal!, observed: BigInt(r.observed!), threshold: BigInt(r.threshold!), actor: r.actor, reason: r.reason, recordedAt }
      : { kind: "clear", actor: r.actor, reason: r.reason, recordedAt };
  }
}
