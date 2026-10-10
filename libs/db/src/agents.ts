import { initialState, type AgentRecord, type AgentRegistry, type AgentState, type DebitRecord, type DebitStore } from "@monadeum/agent-registry";
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
