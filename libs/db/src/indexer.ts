import type { BlockHash, ChainEvent, EventFilter, ReadModelStore, SyncBatch } from "@monadeum/indexer";
import type { Address, Hex } from "viem";
import type { Database } from "./database.js";

interface EventRow {
  kind: string;
  account: string | null;
  address: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  data: string;
}

/**
 * The indexer's `ReadModelStore` on Postgres (migration 0002). `apply` writes every row, block hash, tracked account,
 * and the new cursor in one transaction, and `rollback` deletes everything above the ancestor and moves the cursor in
 * one transaction, so a reader never sees rows without their cursor or a half-undone reorg. The indexer should connect
 * through a role that is a member of `monadeum_indexer`, the only role granted writes on these tables (migration 0004).
 */
export class PgReadModelStore implements ReadModelStore {
  constructor(private readonly db: Database) {}

  async cursor(): Promise<BlockHash | null> {
    const { rows } = await this.db.query<{ n: string; hash: string }>("SELECT block_number::text AS n, block_hash AS hash FROM indexer_cursor WHERE id = 1");
    return rows[0] ? { number: BigInt(rows[0].n), hash: rows[0].hash as Hex } : null;
  }

  async blockHashes(): Promise<BlockHash[]> {
    const { rows } = await this.db.query<{ n: string; hash: string }>(
      "SELECT block_number::text AS n, block_hash AS hash FROM indexer_blocks ORDER BY block_number DESC",
    );
    return rows.map((r) => ({ number: BigInt(r.n), hash: r.hash as Hex }));
  }

  async trackedAccounts(): Promise<Address[]> {
    const { rows } = await this.db.query<{ account: string }>("SELECT account FROM indexer_tracked_accounts ORDER BY first_block, account");
    return rows.map((r) => r.account as Address);
  }

  async apply(batch: SyncBatch): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Locks the cursor row, so two writers cannot both advance from the same cursor.
      const { rows } = await tx.query<{ n: string }>("SELECT block_number::text AS n FROM indexer_cursor WHERE id = 1 FOR UPDATE");
      if (rows[0] && batch.cursor.number <= BigInt(rows[0].n)) throw new Error("batch does not advance the cursor");
      for (const e of batch.events) {
        await tx.query(
          `INSERT INTO chain_events (block_number, block_hash, log_index, kind, account, address, tx_hash, data)
           VALUES ($1::numeric, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [e.blockNumber.toString(), e.blockHash, e.logIndex, e.kind, e.account, e.address, e.transactionHash, JSON.stringify(e.data)],
        );
      }
      for (const b of batch.blocks) {
        await tx.query(
          `INSERT INTO indexer_blocks (block_number, block_hash) VALUES ($1::numeric, $2)
           ON CONFLICT (block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash`,
          [b.number.toString(), b.hash],
        );
      }
      await tx.query("DELETE FROM indexer_blocks WHERE block_number < $1::numeric AND block_number <> $2::numeric", [
        batch.pruneBelow.toString(),
        batch.cursor.number.toString(),
      ]);
      for (const t of batch.discovered) {
        await tx.query(
          "INSERT INTO indexer_tracked_accounts (account, first_block) VALUES ($1, $2::numeric) ON CONFLICT (account) DO NOTHING",
          [t.account, t.firstBlock.toString()],
        );
      }
      await setCursor(tx, batch.cursor);
    });
  }

  async rollback(ancestor: BlockHash): Promise<void> {
    const n = ancestor.number.toString();
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT 1 FROM indexer_cursor WHERE id = 1 FOR UPDATE");
      await tx.query("DELETE FROM chain_events WHERE block_number > $1::numeric", [n]);
      await tx.query("DELETE FROM indexer_blocks WHERE block_number > $1::numeric", [n]);
      await tx.query("DELETE FROM indexer_tracked_accounts WHERE first_block > $1::numeric", [n]);
      await tx.query(
        `INSERT INTO indexer_blocks (block_number, block_hash) VALUES ($1::numeric, $2)
         ON CONFLICT (block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash`,
        [n, ancestor.hash],
      );
      await setCursor(tx, ancestor);
    });
  }

  async events(filter: EventFilter = {}): Promise<ChainEvent[]> {
    const { rows } = await this.db.query<EventRow>(
      `SELECT kind, account, address, block_number::text AS block_number, block_hash, tx_hash, log_index, data::text AS data
       FROM chain_events
       WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR account = $2)
       ORDER BY chain_events.block_number, chain_events.log_index, chain_events.kind COLLATE "C"`,
      [filter.kind ?? null, filter.account?.toLowerCase() ?? null],
    );
    return rows.map((r) => ({
      kind: r.kind,
      account: r.account as Address | null,
      address: r.address as Address,
      blockNumber: BigInt(r.block_number),
      blockHash: r.block_hash as Hex,
      transactionHash: r.tx_hash as Hex,
      logIndex: r.log_index,
      data: JSON.parse(r.data) as ChainEvent["data"],
    }));
  }
}

async function setCursor(tx: { query(text: string, params?: readonly unknown[]): Promise<unknown> }, cursor: BlockHash): Promise<void> {
  await tx.query(
    `INSERT INTO indexer_cursor (id, block_number, block_hash) VALUES (1, $1::numeric, $2)
     ON CONFLICT (id) DO UPDATE SET block_number = EXCLUDED.block_number, block_hash = EXCLUDED.block_hash`,
    [cursor.number.toString(), cursor.hash],
  );
}
