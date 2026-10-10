import type { Address, Hex } from "viem";

// The chain-sourced read-model's row types and store interface, shared by its one writer (`apps/indexer`) and its
// Postgres implementation (`PgReadModelStore` in `@monadeum/db`). It lives in its own package so the indexer can
// depend on `@monadeum/db` without a dependency cycle (ARCHITECTURE.md section 10).

/** A JSON-safe field. Integers are decimal strings, so a uint256 never loses precision. */
export type FieldValue = string | number | boolean;

/** One decoded chain fact, as stored in the read-model. */
export interface ChainEvent {
  /** Stable name, for example `spend.limits-set`. Declared by exactly one handler. */
  kind: string;
  /** The agent account the fact is about, lowercase, or null if it is about no single account. */
  account: Address | null;
  /** The contract that emitted the log, lowercase. */
  address: Address;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  data: Record<string, FieldValue>;
}

export interface BlockHash {
  number: bigint;
  hash: Hex;
}

export interface TrackedAccount {
  account: Address;
  /** Block of the first event that put the account in the tracked set. A rollback below it removes the account. */
  firstBlock: bigint;
}

/** One batch, written atomically: either every row and the new cursor are stored, or nothing is. */
export interface SyncBatch {
  events: ChainEvent[];
  /** Hashes of the batch's last block and of every block that produced a row, kept for reorg detection. */
  blocks: BlockHash[];
  discovered: TrackedAccount[];
  cursor: BlockHash;
  /** Block hashes below this number may be discarded. */
  pruneBelow: bigint;
}

export interface EventFilter {
  kind?: string;
  account?: Address;
}

/**
 * The read-model as the indexer writes it. The indexer is the only writer of these rows: they are chain-sourced
 * facts, and nothing else in the platform may insert, change, or delete them (ARCHITECTURE.md section 10).
 */
export interface ReadModelStore {
  cursor(): Promise<BlockHash | null>;
  /** Stored block hashes, highest first. */
  blockHashes(): Promise<BlockHash[]>;
  trackedAccounts(): Promise<Address[]>;
  apply(batch: SyncBatch): Promise<void>;
  /** Deletes every row above `ancestor.number` and moves the cursor to `ancestor`. Atomic. */
  rollback(ancestor: BlockHash): Promise<void>;
  /** Rows in chain order, (block, log index). */
  events(filter?: EventFilter): Promise<ChainEvent[]>;
}

/** For tests and local development. Not durable: a restart starts from the configured start block. */
export class InMemoryReadModelStore implements ReadModelStore {
  private rows: ChainEvent[] = [];
  private hashes = new Map<bigint, BlockHash>();
  private tracked = new Map<Address, TrackedAccount>();
  private head: BlockHash | null = null;

  async cursor(): Promise<BlockHash | null> {
    return this.head;
  }

  async blockHashes(): Promise<BlockHash[]> {
    return [...this.hashes.values()].sort((a, b) => (a.number < b.number ? 1 : a.number > b.number ? -1 : 0));
  }

  async trackedAccounts(): Promise<Address[]> {
    return [...this.tracked.keys()];
  }

  async apply(batch: SyncBatch): Promise<void> {
    if (this.head && batch.cursor.number <= this.head.number) throw new Error("batch does not advance the cursor");
    this.rows.push(...batch.events);
    this.rows.sort(chainOrder);
    for (const block of batch.blocks) this.hashes.set(block.number, block);
    for (const number of [...this.hashes.keys()]) if (number < batch.pruneBelow && number !== batch.cursor.number) this.hashes.delete(number);
    for (const t of batch.discovered) if (!this.tracked.has(t.account)) this.tracked.set(t.account, t);
    this.head = batch.cursor;
  }

  async rollback(ancestor: BlockHash): Promise<void> {
    this.rows = this.rows.filter((r) => r.blockNumber <= ancestor.number);
    for (const number of [...this.hashes.keys()]) if (number > ancestor.number) this.hashes.delete(number);
    for (const [account, t] of [...this.tracked]) if (t.firstBlock > ancestor.number) this.tracked.delete(account);
    this.hashes.set(ancestor.number, ancestor);
    this.head = ancestor;
  }

  async events(filter: EventFilter = {}): Promise<ChainEvent[]> {
    return this.rows.filter((r) => (filter.kind === undefined || r.kind === filter.kind) && (filter.account === undefined || r.account === filter.account.toLowerCase()));
  }
}

export function chainOrder(a: ChainEvent, b: ChainEvent): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}
