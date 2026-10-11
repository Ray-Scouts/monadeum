import type { TickRecord, TickStore } from "@monadeum/tick";
import type { Position, PositionStore, TradeRecord, TradeStore } from "@monadeum/trading";
import type { PaymentLog, PaymentLogEntry } from "@monadeum/x402";
import type { Hex } from "viem";
import { decode, encode } from "./codec.js";
import type { Database } from "./database.js";

/** `TradeStore` on Postgres. `claim` is INSERT ... ON CONFLICT DO NOTHING on the tick key, the primary key. */
export class PgTradeStore implements TradeStore {
  constructor(private readonly db: Database) {}

  async claim(record: TradeRecord): Promise<boolean> {
    const { rows } = await this.db.query(
      `INSERT INTO trade_records (key, status, tx_hash_key, body) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (key) DO NOTHING RETURNING key`,
      [record.key, record.status, txKey(record), encode(record)],
    );
    return rows.length === 1;
  }

  async write(record: TradeRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO trade_records (key, status, tx_hash_key, body) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, tx_hash_key = EXCLUDED.tx_hash_key, body = EXCLUDED.body`,
      [record.key, record.status, txKey(record), encode(record)],
    );
  }

  async get(key: string): Promise<TradeRecord | undefined> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM trade_records WHERE key = $1", [key]);
    return rows[0] ? decode<TradeRecord>(rows[0].body) : undefined;
  }

  async findByTransaction(hash: Hex): Promise<TradeRecord | undefined> {
    const { rows } = await this.db.query<{ body: string }>(
      "SELECT body::text AS body FROM trade_records WHERE tx_hash_key = $1 ORDER BY seq LIMIT 1",
      [hash.toLowerCase()],
    );
    return rows[0] ? decode<TradeRecord>(rows[0].body) : undefined;
  }
}

const txKey = (record: TradeRecord): string | null => record.fill?.transactionHash.toLowerCase() ?? null;

/** `PaymentLog` on Postgres. `claim` is INSERT ... ON CONFLICT DO NOTHING on the purchase key, the primary key. */
export class PgPaymentLog implements PaymentLog {
  constructor(private readonly db: Database) {}

  async claim(entry: PaymentLogEntry): Promise<boolean> {
    const { rows } = await this.db.query(
      `INSERT INTO x402_payments (key, settlement_ref, body) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (key) DO NOTHING RETURNING key`,
      [entry.key, entry.settlementRef, encode(entry)],
    );
    return rows.length === 1;
  }

  async write(entry: PaymentLogEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO x402_payments (key, settlement_ref, body) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (key) DO UPDATE SET settlement_ref = EXCLUDED.settlement_ref, body = EXCLUDED.body`,
      [entry.key, entry.settlementRef, encode(entry)],
    );
  }

  async get(key: string): Promise<PaymentLogEntry | undefined> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM x402_payments WHERE key = $1", [key]);
    return rows[0] ? decode<PaymentLogEntry>(rows[0].body) : undefined;
  }

  async findBySettlement(ref: string): Promise<PaymentLogEntry | undefined> {
    const { rows } = await this.db.query<{ body: string }>(
      "SELECT body::text AS body FROM x402_payments WHERE settlement_ref = $1 ORDER BY seq LIMIT 1",
      [ref],
    );
    return rows[0] ? decode<PaymentLogEntry>(rows[0].body) : undefined;
  }
}

/**
 * `TickStore` on Postgres. `claim` is INSERT ... ON CONFLICT DO NOTHING on the tick key, the primary key; `write`
 * replaces the record, including the approval the tick writes before it submits the approved plan.
 */
export class PgTickStore implements TickStore {
  constructor(private readonly db: Database) {}

  async get(key: string): Promise<TickRecord | undefined> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM tick_records WHERE key = $1", [key]);
    return rows[0] ? decode<TickRecord>(rows[0].body) : undefined;
  }

  async claim(record: TickRecord): Promise<boolean> {
    const { rows } = await this.db.query(
      `INSERT INTO tick_records (key, agent_id, tick, status, body) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (key) DO NOTHING RETURNING key`,
      [record.key, record.agentId, record.tick, record.status, encode(record)],
    );
    return rows.length === 1;
  }

  async write(record: TickRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO tick_records (key, agent_id, tick, status, body) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (key) DO UPDATE SET agent_id = EXCLUDED.agent_id, tick = EXCLUDED.tick, status = EXCLUDED.status, body = EXCLUDED.body`,
      [record.key, record.agentId, record.tick, record.status, encode(record)],
    );
  }
}

/**
 * TradingModule's `PositionStore` on Postgres (migration 0011). One row per agent, replaced whole by `write`, which is
 * durable when it resolves. Writes for one agent are serialized by the worker, as the interface states.
 */
export class PgPositionStore implements PositionStore {
  constructor(private readonly db: Database) {}

  async get(agentId: string): Promise<Position | undefined> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM trade_positions WHERE agent_id = $1", [agentId]);
    return rows[0] ? decode<Position>(rows[0].body) : undefined;
  }

  async write(position: Position): Promise<void> {
    await this.db.query(
      `INSERT INTO trade_positions (agent_id, body) VALUES ($1, $2::jsonb)
       ON CONFLICT (agent_id) DO UPDATE SET body = EXCLUDED.body`,
      [position.agentId, encode(position)],
    );
  }
}
