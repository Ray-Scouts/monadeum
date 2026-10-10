import type { AbiEvent, Address, Hex } from "viem";

/** A log as returned by `eth_getLogs`, before decoding. Addresses are lowercase. */
export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
}

export interface BlockRef {
  number: bigint;
  hash: Hex;
  parentHash: Hex;
}

/** One `eth_getLogs` call. `topics[0]` lists the accepted event selectors; a null position matches anything. */
export interface LogQuery {
  fromBlock: bigint;
  toBlock: bigint;
  address: Address[];
  topics: (Hex[] | null)[];
}

/** Everything the indexer reads from the chain. `ViemIndexerChain` implements it; tests implement it in memory. */
export interface IndexerChain {
  chainId(): Promise<number>;
  headBlockNumber(): Promise<bigint>;
  /** The canonical block at `number`, or null if the node does not have it. */
  block(number: bigint): Promise<BlockRef | null>;
  logs(query: LogQuery): Promise<RawLog[]>;
}

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

/** What a handler makes of one decoded log. */
export interface HandledEvent {
  kind: string;
  account: Address | null;
  data: Record<string, FieldValue>;
}

/**
 * Where a handler's logs come from.
 *
 * - `contract`: a fixed contract. With `discoversAccounts`, every account its events name joins the tracked set.
 * - `contract-by-account`: a fixed contract, restricted to logs whose topic at `accountTopic` is a tracked account.
 * - `account`: logs emitted by tracked accounts themselves.
 */
export type HandlerSource =
  | { kind: "contract"; address: Address; discoversAccounts?: boolean }
  | { kind: "contract-by-account"; address: Address; accountTopic: 1 | 2 | 3 }
  | { kind: "account" };

export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
}

/**
 * A pluggable source of read-model rows. Adding a contract (for example the reallocation contract, issue #31) means
 * registering one more handler; the sync loop, reorg handling, and store do not change.
 */
export interface EventHandler {
  name: string;
  source: HandlerSource;
  /** Event ABI items this handler decodes. Their selectors are the `topics[0]` filter. */
  events: readonly AbiEvent[];
  /** Every `kind` this handler can return. Two handlers may not declare the same kind. */
  kinds: readonly string[];
  /** Maps one decoded log to a row, or null to ignore it. Must be pure: a re-index after a reorg calls it again. */
  handle(decoded: DecodedLog, log: RawLog): HandledEvent | null;
}
