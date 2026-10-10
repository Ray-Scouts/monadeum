import type {
  AgentWalletRecord,
  AgentWalletStore,
  SponsorshipBudget,
  SponsorshipLedger,
  SponsorshipUsage,
  TickOperationRecord,
} from "@monadeum/wallets";
import type { Address } from "viem";
import { decode, encode } from "./codec.js";
import { isUniqueViolation, type Database } from "./database.js";

// No SessionKeyVault here, by design: session private keys belong in a secrets manager, never in Postgres
// (SECURITY.md section 11). The wallet records below hold the session key's address and the owner's enable
// signature, never the key itself.

/** `AgentWalletStore` on Postgres. Insert-if-absent and account uniqueness are primary-key and unique constraints. */
export class PgAgentWalletStore implements AgentWalletStore {
  constructor(private readonly db: Database) {}

  async get(agentId: string): Promise<AgentWalletRecord | undefined> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM wallet_accounts WHERE agent_id = $1", [agentId]);
    return rows[0] ? decode<AgentWalletRecord>(rows[0].body) : undefined;
  }

  async claim(record: AgentWalletRecord): Promise<boolean> {
    try {
      const { rows } = await this.db.query(
        `INSERT INTO wallet_accounts (agent_id, account_key, body) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT DO NOTHING RETURNING agent_id`,
        [record.agentId, record.account.toLowerCase(), encode(record)],
      );
      return rows.length === 1;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async update(record: AgentWalletRecord): Promise<void> {
    let rows;
    try {
      ({ rows } = await this.db.query(
        "UPDATE wallet_accounts SET account_key = $2, body = $3::jsonb WHERE agent_id = $1 RETURNING agent_id",
        [record.agentId, record.account.toLowerCase(), encode(record)],
      ));
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`account ${record.account} belongs to another agent`);
      throw error;
    }
    if (rows.length === 0) throw new Error(`no wallet record for ${record.agentId}`);
  }

  async findByAccount(account: Address): Promise<AgentWalletRecord | undefined> {
    const { rows } = await this.db.query<{ body: string }>(
      "SELECT body::text AS body FROM wallet_accounts WHERE account_key = $1",
      [account.toLowerCase()],
    );
    return rows[0] ? decode<AgentWalletRecord>(rows[0].body) : undefined;
  }

  async getOperation(agentId: string, tickKey: string): Promise<TickOperationRecord | undefined> {
    const { rows } = await this.db.query<{ body: string }>(
      "SELECT body::text AS body FROM wallet_tick_operations WHERE agent_id = $1 AND tick_key = $2",
      [agentId, tickKey],
    );
    return rows[0] ? decode<TickOperationRecord>(rows[0].body) : undefined;
  }

  async claimOperation(record: TickOperationRecord): Promise<boolean> {
    const { rows } = await this.db.query(
      `INSERT INTO wallet_tick_operations (agent_id, tick_key, body) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (agent_id, tick_key) DO NOTHING RETURNING agent_id`,
      [record.agentId, record.tickKey, encode(record)],
    );
    return rows.length === 1;
  }

  async updateOperation(record: TickOperationRecord): Promise<void> {
    const { rows } = await this.db.query(
      "UPDATE wallet_tick_operations SET body = $3::jsonb WHERE agent_id = $1 AND tick_key = $2 RETURNING agent_id",
      [record.agentId, record.tickKey, encode(record)],
    );
    if (rows.length === 0) throw new Error(`no operation record for ${JSON.stringify([record.agentId, record.tickKey])}`);
  }

  async listOperations(agentId: string): Promise<TickOperationRecord[]> {
    const { rows } = await this.db.query<{ body: string }>(
      "SELECT body::text AS body FROM wallet_tick_operations WHERE agent_id = $1 ORDER BY seq",
      [agentId],
    );
    return rows.map((r) => decode<TickOperationRecord>(r.body));
  }
}

/**
 * `SponsorshipLedger` on Postgres. `reserve` is one conditional upsert: the budget check and the increment happen in
 * the same statement, under the row lock, so two concurrent reservations cannot both take the last slot.
 */
export class PgSponsorshipLedger implements SponsorshipLedger {
  constructor(private readonly db: Database) {}

  async usage(agentId: string): Promise<SponsorshipUsage> {
    const { rows } = await this.db.query<{ operations: number; gas_wei: string }>(
      "SELECT operations, gas_wei::text AS gas_wei FROM wallet_sponsorship WHERE agent_id = $1",
      [agentId],
    );
    return rows[0] ? { operations: rows[0].operations, gasWei: BigInt(rows[0].gas_wei) } : { operations: 0, gasWei: 0n };
  }

  async reserve(agentId: string, maxCost: bigint, budget: SponsorshipBudget): Promise<boolean> {
    if (maxCost <= 0n) return false;
    const { rows } = await this.db.query(
      `INSERT INTO wallet_sponsorship AS s (agent_id, operations, gas_wei)
       SELECT $1, 1, $2::numeric WHERE 1 <= $3::integer AND $2::numeric <= $4::numeric
       ON CONFLICT (agent_id) DO UPDATE SET operations = s.operations + 1, gas_wei = s.gas_wei + $2::numeric
       WHERE s.operations + 1 <= $3::integer AND s.gas_wei + $2::numeric <= $4::numeric
       RETURNING s.agent_id`,
      [agentId, maxCost.toString(), budget.operations, budget.gasWei.toString()],
    );
    return rows.length === 1;
  }

  async settle(agentId: string, reserved: bigint, actual: bigint): Promise<void> {
    const { rows } = await this.db.query(
      "UPDATE wallet_sponsorship SET gas_wei = gas_wei - $2::numeric + $3::numeric WHERE agent_id = $1 RETURNING agent_id",
      [agentId, reserved.toString(), actual.toString()],
    );
    if (rows.length === 0) throw new Error(`no reservation for ${agentId}`);
  }

  async release(agentId: string, reserved: bigint): Promise<void> {
    const { rows } = await this.db.query(
      "UPDATE wallet_sponsorship SET operations = operations - 1, gas_wei = gas_wei - $2::numeric WHERE agent_id = $1 RETURNING agent_id",
      [agentId, reserved.toString()],
    );
    if (rows.length === 0) throw new Error(`no reservation for ${agentId}`);
  }
}
