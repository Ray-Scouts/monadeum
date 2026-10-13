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
  /**
   * True when every block up to `cursor` was read under the indexer's `finalized` rule. Absent means false. The store
   * keeps the conjunction over every batch since it was empty, so one batch read under the confirmations rule makes
   * `finalizedThrough` null until the read-model is rebuilt.
   */
  finalized?: boolean;
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
  /**
   * The cursor's block number when every stored row was read from finalized blocks, otherwise null. Readers that must
   * act only on finalized data, such as the worker's principal recomputation, read this bound and nothing above it.
   */
  finalizedThrough(): Promise<bigint | null>;
  /** The settlement-asset contract the indexer recorded at start, lowercase, or null before it first started. */
  settlementAsset(): Promise<Address | null>;
  /**
   * Records the settlement-asset contract this read-model's funding rows come from. Idempotent for the same address;
   * throws when a different one is already recorded, because the stored rows would then mix two tokens.
   */
  recordSettlementAsset(asset: Address): Promise<void>;
  /** Optional contracts this read-model indexes, by name (for example `reallocation`), lowercase. */
  indexedContracts(): Promise<Record<string, Address>>;
  /**
   * Records that this read-model indexes `address` under `name`. Idempotent for the same address. Throws
   * `IndexedContractError` when a different address is recorded under the name, or when the name is new and the
   * read-model already has a cursor: the blocks below the cursor were read without that contract, so its earlier events
   * are missing, and the read-model must be rebuilt from the start block instead.
   */
  recordIndexedContract(name: string, address: Address): Promise<void>;
}

/**
 * The read side a consumer of the read-model needs. Granted to the worker role for its principal job (libs/db 0009
 * and 0010).
 */
export type ReadModelReader = Pick<ReadModelStore, "events" | "finalizedThrough" | "settlementAsset">;

/** Thrown by `recordSettlementAsset` when the read-model already records a different settlement asset. */
export class SettlementAssetMismatchError extends Error {
  constructor(recorded: Address, requested: Address) {
    super(`the read-model records settlement asset ${recorded}, not ${requested}; rebuild it before changing the asset`);
    this.name = "SettlementAssetMismatchError";
  }
}

/**
 * Row kinds of the reallocation contract's `Reallocated` event, one per followed side (`apps/indexer`). Both carry
 * `owner`, `source`, `sink`, `amount` (base units), and `evaluation`, the contract's evaluation number.
 */
export const REALLOCATION_SENT = "reallocation.sent";
export const REALLOCATION_RECEIVED = "reallocation.received";

/** Thrown by `recordIndexedContract` when recording the contract would make the read-model claim rows it does not have. */
export class IndexedContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexedContractError";
  }
}

/** The rule `recordIndexedContract` applies, shared by every implementation. Returns true when a new record is needed. */
export function checkIndexedContract(recorded: Address | undefined, name: string, address: Address, hasCursor: boolean): boolean {
  if (recorded === address) return false;
  if (recorded !== undefined) throw new IndexedContractError(`the read-model records ${name} contract ${recorded}, not ${address}; rebuild it before changing the contract`);
  if (hasCursor) throw new IndexedContractError(`the read-model was synced without the ${name} contract, so its earlier events are missing; rebuild it from the start block to index ${address}`);
  return true;
}

/** For tests and local development. Not durable: a restart starts from the configured start block. */
export class InMemoryReadModelStore implements ReadModelStore {
  private rows: ChainEvent[] = [];
  private hashes = new Map<bigint, BlockHash>();
  private tracked = new Map<Address, TrackedAccount>();
  private head: BlockHash | null = null;
  private finalized = false;
  private asset: Address | null = null;
  private contracts: Record<string, Address> = {};

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
    this.finalized = (this.head === null || this.finalized) && batch.finalized === true;
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

  async finalizedThrough(): Promise<bigint | null> {
    return this.head && this.finalized ? this.head.number : null;
  }

  async settlementAsset(): Promise<Address | null> {
    return this.asset;
  }

  async recordSettlementAsset(asset: Address): Promise<void> {
    const lower = asset.toLowerCase() as Address;
    if (this.asset !== null && this.asset !== lower) throw new SettlementAssetMismatchError(this.asset, lower);
    this.asset = lower;
  }

  async indexedContracts(): Promise<Record<string, Address>> {
    return { ...this.contracts };
  }

  async recordIndexedContract(name: string, address: Address): Promise<void> {
    const lower = address.toLowerCase() as Address;
    if (checkIndexedContract(this.contracts[name], name, lower, this.head !== null)) this.contracts[name] = lower;
  }
}

export function chainOrder(a: ChainEvent, b: ChainEvent): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}

export * from "./funding.js";
