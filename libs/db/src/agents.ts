import {
  initialState,
  type AgentRecord,
  type AgentRegistry,
  type AgentState,
  type DebitRecord,
  type DebitStore,
  type EvaluationRecord,
  type RecordedReallocation,
  type EvaluationStore,
} from "@monadeum/agent-registry";
import type { Hex } from "viem";
import { decode, encode } from "./codec.js";
import { isUniqueViolation, type Database } from "./database.js";

/** SQLSTATE 23503, foreign_key_violation. */
const isForeignKeyViolation = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23503";

/**
 * The worker's agent registry and running state on Postgres (migration 0006). `add` is agent creation's write and is
 * not granted to the worker role; the worker reads, retires (`update`), and saves state.
 */
export class PgAgentStore implements AgentRegistry {
  constructor(private readonly db: Database) {}

  async add(record: AgentRecord): Promise<void> {
    const owned = { ...record, owner: record.owner.toLowerCase() as Hex };
    try {
      await this.db.query("INSERT INTO worker_agents (agent_id, owner, status, body) VALUES ($1, $2, $3, $4::jsonb)", [
        owned.agentId, owned.owner, owned.status, encode(owned),
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`agent ${record.agentId} exists`);
      throw error;
    }
  }

  async list(): Promise<AgentRecord[]> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM worker_agents ORDER BY agent_id");
    return rows.map((r) => decode<AgentRecord>(r.body));
  }

  async get(agentId: string): Promise<AgentRecord | undefined> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM worker_agents WHERE agent_id = $1", [agentId]);
    return rows[0] ? decode<AgentRecord>(rows[0].body) : undefined;
  }

  async update(record: AgentRecord): Promise<void> {
    const owned = { ...record, owner: record.owner.toLowerCase() as Hex };
    const { rows } = await this.db.query(
      "UPDATE worker_agents SET owner = $2, status = $3, body = $4::jsonb WHERE agent_id = $1 RETURNING agent_id",
      [owned.agentId, owned.owner, owned.status, encode(owned)],
    );
    if (rows.length === 0) throw new Error(`no agent ${record.agentId}`);
  }

  async state(agentId: string): Promise<AgentState> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM worker_agent_states WHERE agent_id = $1", [agentId]);
    if (rows[0]) return decode<AgentState>(rows[0].body);
    return initialState(await this.get(agentId));
  }

  async saveState(agentId: string, state: AgentState): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO worker_agent_states (agent_id, body) VALUES ($1, $2::jsonb)
         ON CONFLICT (agent_id) DO UPDATE SET body = EXCLUDED.body`,
        [agentId, encode(state)],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) throw new Error(`no agent ${agentId}`);
      throw error;
    }
  }
}

/** `DebitStore` on Postgres. `claim` is INSERT ... ON CONFLICT DO NOTHING on the debit key, the primary key. */
export class PgDebitStore implements DebitStore {
  constructor(private readonly db: Database) {}

  async get(key: string): Promise<DebitRecord | undefined> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM reallocation_debits WHERE key = $1", [key]);
    return rows[0] ? decode<DebitRecord>(rows[0].body) : undefined;
  }

  async claim(record: DebitRecord): Promise<boolean> {
    const { rows } = await this.db.query(
      "INSERT INTO reallocation_debits (key, status, body) VALUES ($1, $2, $3::jsonb) ON CONFLICT (key) DO NOTHING RETURNING key",
      [record.key, record.status, encode(record)],
    );
    return rows.length === 1;
  }

  async write(record: DebitRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO reallocation_debits (key, status, body) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body`,
      [record.key, record.status, encode(record)],
    );
  }
}

interface EvaluationRow {
  agent_id: string;
  sequence: number;
  evaluated_at: string;
  capital: string;
  adjusted_fitness: number | null;
  fitness_percentile: number | null;
  raw_sortino: number | null;
  zero_downside: boolean;
  trade_count: number;
  low_windows: number;
  retired: boolean;
  retirement_rule: string | null;
  reallocation_kind: RecordedReallocation["kind"] | null;
  reallocation_reason: string | null;
  reallocation_amount: string | null;
  rank_position: number | null;
  rank_of: number | null;
  rank_quota: number | null;
}

const EVALUATION_COLUMNS = `agent_id, sequence, evaluated_at::text AS evaluated_at, capital::text AS capital, adjusted_fitness,
  fitness_percentile, raw_sortino, zero_downside, trade_count, low_windows, retired, retirement_rule, reallocation_kind, reallocation_reason,
  reallocation_amount::text AS reallocation_amount, rank_position, rank_of, rank_quota`;

const num = (v: number | string | null) => (v === null ? null : Number(v));

function evaluationFrom(row: EvaluationRow): EvaluationRecord {
  const record: EvaluationRecord = {
    sequence: Number(row.sequence),
    agentId: row.agent_id,
    evaluatedAt: Number(row.evaluated_at),
    capital: BigInt(row.capital),
    adjustedFitness: num(row.adjusted_fitness),
    fitnessPercentile: num(row.fitness_percentile),
    rawSortino: num(row.raw_sortino),
    zeroDownsideFlag: row.zero_downside,
    tradeCount: Number(row.trade_count),
    lowWindows: Number(row.low_windows),
    retired: row.retired,
    retirementRule: row.retirement_rule,
  };
  // Set only when recorded, so a record without an outcome reads exactly as the in-memory store returns it.
  if (row.reallocation_kind !== null) {
    record.reallocation = {
      kind: row.reallocation_kind,
      reason: row.reallocation_reason,
      amount: row.reallocation_amount === null ? null : BigInt(row.reallocation_amount),
      rank: row.rank_position === null ? null : { position: Number(row.rank_position), of: Number(row.rank_of), quota: Number(row.rank_quota) },
    };
  }
  return record;
}

/**
 * `EvaluationStore` on Postgres (migration 0013). One evaluation's records are inserted in one transaction, each
 * `ON CONFLICT DO NOTHING` on (agent, sequence), so a rerun keeps what the first run recorded and needs no UPDATE grant.
 */
export class PgEvaluationStore implements EvaluationStore {
  constructor(private readonly db: Database) {}

  async record(records: readonly EvaluationRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const r of records) {
        await tx.query(
          `INSERT INTO evaluation_records (agent_id, sequence, evaluated_at, capital, adjusted_fitness, fitness_percentile, raw_sortino,
             zero_downside, trade_count, low_windows, retired, retirement_rule, reallocation_kind, reallocation_reason, reallocation_amount,
             rank_position, rank_of, rank_quota)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) ON CONFLICT (agent_id, sequence) DO NOTHING`,
          [r.agentId, r.sequence, r.evaluatedAt, r.capital.toString(), r.adjustedFitness, r.fitnessPercentile, r.rawSortino,
            r.zeroDownsideFlag, r.tradeCount, r.lowWindows, r.retired, r.retirementRule, r.reallocation?.kind ?? null,
            r.reallocation?.reason ?? null, r.reallocation?.amount?.toString() ?? null, r.reallocation?.rank?.position ?? null,
            r.reallocation?.rank?.of ?? null, r.reallocation?.rank?.quota ?? null],
        );
      }
    });
  }

  async history(agentId: string, limit: number): Promise<EvaluationRecord[]> {
    if (limit <= 0) return [];
    const { rows } = await this.db.query<EvaluationRow>(
      `SELECT ${EVALUATION_COLUMNS} FROM evaluation_records WHERE agent_id = $1 ORDER BY sequence DESC LIMIT $2`,
      [agentId, limit],
    );
    return rows.map(evaluationFrom).reverse();
  }

  async latest(): Promise<EvaluationRecord[]> {
    const { rows } = await this.db.query<EvaluationRow>(
      `SELECT ${EVALUATION_COLUMNS} FROM evaluation_records
       WHERE sequence = (SELECT max(sequence) FROM evaluation_records) ORDER BY agent_id COLLATE "C"`,
    );
    return rows.map(evaluationFrom);
  }
}
