import type { TickRecord, TickStore } from "@monadeum/tick";
import type { Position, PositionStore, TradeCounts, TradeRecord, TradeStore } from "@monadeum/trading";
import type { PaymentLog, PaymentLogEntry, PaymentSpend, PaymentTotals, SlotClaim, X402SlotStore } from "@monadeum/x402";
import type { Address, Hex } from "viem";
import { decode, encode } from "./codec.js";
import type { Database } from "./database.js";

/** `TradeStore` on Postgres. `claim` is INSERT ... ON CONFLICT DO NOTHING on the tick key, the primary key. */
export class PgTradeStore implements TradeStore, TradeCounts {
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

  // The agent is the order's `agentId` in the record body; there is no agent column, so these scan the filled rows.
  async filledByAgent(agentIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map(agentIds.map((id) => [id, 0]));
    if (agentIds.length === 0) return counts;
    const { rows } = await this.db.query<{ agent_id: string; n: string }>(
      `SELECT body->'order'->>'agentId' AS agent_id, count(*)::text AS n FROM trade_records
       WHERE status = 'filled' AND body->'order'->>'agentId' = ANY($1::text[]) GROUP BY 1`,
      [[...agentIds]],
    );
    for (const r of rows) counts.set(r.agent_id, Number(r.n));
    return counts;
  }

  async filledRecords(limit: number): Promise<TradeRecord[]> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM trade_records WHERE status = 'filled' ORDER BY seq DESC LIMIT $1", [limit]);
    return rows.map((r) => decode<TradeRecord>(r.body));
  }

  async filledTotal(): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>("SELECT count(*)::text AS n FROM trade_records WHERE status = 'filled'");
    return Number(rows[0]!.n);
  }
}

const txKey = (record: TradeRecord): string | null => record.fill?.transactionHash.toLowerCase() ?? null;

/**
 * `X402SlotStore` on Postgres (`x402_nonce_slots`, migration 0012). `claim` is one INSERT ... ON CONFLICT DO NOTHING:
 * the slot, the payment key, and the (account, nonce) pair are each unique, so a conflict on any of them claims
 * nothing. There is no update or delete.
 */
export class PgX402SlotStore implements X402SlotStore {
  constructor(private readonly db: Database) {}

  async claim(claim: SlotClaim): Promise<boolean> {
    const { rows } = await this.db.query(
      `INSERT INTO x402_nonce_slots (account_key, epoch, slot, nonce_key, payment_key, body) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT DO NOTHING RETURNING payment_key`,
      [claim.account.toLowerCase(), claim.epoch.toString(), claim.slot, claim.nonce.toLowerCase(), claim.paymentKey, encode(claim)],
    );
    return rows.length === 1;
  }

  async findByPayment(paymentKey: string): Promise<SlotClaim | undefined> {
    const { rows } = await this.db.query<{ body: string }>("SELECT body::text AS body FROM x402_nonce_slots WHERE payment_key = $1", [paymentKey]);
    return rows[0] ? decode<SlotClaim>(rows[0].body) : undefined;
  }

  async findByNonce(account: Address, nonce: Hex): Promise<SlotClaim | undefined> {
    const { rows } = await this.db.query<{ body: string }>(
      "SELECT body::text AS body FROM x402_nonce_slots WHERE account_key = $1 AND nonce_key = $2",
      [account.toLowerCase(), nonce.toLowerCase()],
    );
    return rows[0] ? decode<SlotClaim>(rows[0].body) : undefined;
  }
}

/** `PaymentLog` on Postgres. `claim` is INSERT ... ON CONFLICT DO NOTHING on the purchase key, the primary key. */
export class PgPaymentLog implements PaymentLog, PaymentTotals {
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

  // `PaymentSpend`'s rule in SQL: entries with a nonzero price, the agent being the key up to its first colon
  // (`paymentAgentId`). The price is a bigint, which the codec stores as {"$bigint": "<decimal>"}.
  async spendByAgent(agentIds: readonly string[]): Promise<Map<string, PaymentSpend>> {
    if (agentIds.length === 0) return new Map();
    const groups = new Map<string, SpendRow[]>(agentIds.map((id) => [id, []]));
    const { rows } = await this.db.query<SpendRow & { agent_id: string }>(
      `SELECT split_part(key, ':', 1) AS agent_id, body->>'provider' AS provider, count(*)::text AS n, sum(${PRICE})::text AS spent
       FROM x402_payments WHERE ${PRICE} > 0 AND split_part(key, ':', 1) = ANY($1::text[]) GROUP BY 1, 2`,
      [[...agentIds]],
    );
    for (const r of rows) groups.get(r.agent_id)?.push(r);
    return new Map([...groups].map(([id, g]) => [id, spendOf(g)]));
  }

  async settled(limit: number): Promise<{ count: number; entries: PaymentLogEntry[] }> {
    const [count, latest] = await Promise.all([
      this.db.query<{ n: string }>("SELECT count(*)::text AS n FROM x402_payments WHERE settlement_ref IS NOT NULL"),
      this.db.query<{ body: string }>("SELECT body::text AS body FROM x402_payments WHERE settlement_ref IS NOT NULL ORDER BY seq DESC LIMIT $1", [limit]),
    ]);
    return { count: Number(count.rows[0]!.n), entries: latest.rows.map((r) => decode<PaymentLogEntry>(r.body)) };
  }

  async spendTotal(): Promise<PaymentSpend> {
    const { rows } = await this.db.query<SpendRow>(
      `SELECT body->>'provider' AS provider, count(*)::text AS n, sum(${PRICE})::text AS spent FROM x402_payments WHERE ${PRICE} > 0 GROUP BY 1`,
    );
    return spendOf(rows);
  }
}

const PRICE = "(body->'price'->>'$bigint')::numeric";

interface SpendRow {
  provider: string;
  n: string;
  spent: string;
}

/** One tally from per-provider rows, providers sorted as `tallyPayments` sorts them. */
function spendOf(rows: readonly SpendRow[]): PaymentSpend {
  const byProvider = rows.map((r) => ({ provider: r.provider, spent: BigInt(r.spent) })).sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
  return {
    purchases: rows.reduce((n, r) => n + Number(r.n), 0),
    spent: byProvider.reduce((s, p) => s + p.spent, 0n),
    byProvider,
  };
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
