import type { Address } from "viem";
import type { ChainEvent, ReadModelStore } from "@monadeum/read-model";
import { decodeRow, logQueries } from "../decode.js";
import type { HandlerRegistry } from "../registry.js";
import type { LogQuery, RawLog } from "../types.js";

/**
 * An independent source of logs for the cross-check. `HyperSyncLogSource` implements it over Envio HyperSync; tests
 * implement it in memory. It is read-only, and anything it throws makes the report `unverified`, never `match`.
 */
export interface LogSource {
  /** Name shown in the report. */
  readonly name: string;
  /** The highest block the source has indexed. A source that has not reached the range cannot confirm it. */
  height(): Promise<bigint>;
  /** Logs of `query.address` matching `query.topics` in `[fromBlock, toBlock]`, both inclusive, all pages. */
  logs(query: LogQuery): Promise<RawLog[]>;
}

/** The part of the read-model the cross-check reads. It has no write method by construction. */
export type CrosscheckStore = Pick<ReadModelStore, "cursor" | "events" | "trackedAccounts">;

export interface CrosscheckOptions {
  source: LogSource;
  store: CrosscheckStore;
  registry: HandlerRegistry;
  from: bigint;
  to: bigint;
  /** Widest range one run accepts. Default 100000. */
  maxBlocks?: bigint;
  /** Most logs one run accepts from the source, and most stored rows it compares. Default 200000. */
  maxLogs?: number;
  /** Followed accounts per query, as in the indexer. Default 500. */
  addressChunk?: number;
  /**
   * Restricts the comparison to rows whose kind this accepts, on both sides. Absent means every kind. A handler whose
   * kinds are all rejected is not queried, so a narrow comparison also asks the source for fewer logs.
   */
  kinds?: (kind: string) => boolean;
}

export interface RowRef {
  kind: string;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
}

export interface FieldMismatch extends RowRef {
  /** `account`, `address`, `blockHash`, `transactionHash`, or `data.<name>`. */
  field: string;
  indexer: string | null;
  source: string | null;
}

/**
 * - `match`: both sides were read and are identical over the range.
 * - `mismatch`: both sides were read and differ. An alert for an operator; nothing is corrected.
 * - `unverified`: the comparison could not be made (`reason` says why). It says nothing about the read-model.
 */
export type CrosscheckStatus = "match" | "mismatch" | "unverified";

export interface CrosscheckReport {
  status: CrosscheckStatus;
  range: { from: number; to: number };
  source: string;
  /** The highest block the source reported, when it was read. Present on any report that got that far. */
  sourceHeight?: number;
  /** Present only when `status` is `unverified`. */
  reason?: string;
  counts: { indexer: number; source: number };
  matched: number;
  /** Rows the indexer stored that the source does not have. */
  missingInSource: RowRef[];
  /** Rows the source has that the indexer did not store. */
  missingInIndexer: RowRef[];
  fieldMismatches: FieldMismatch[];
}

const DEFAULT_MAX_BLOCKS = 100_000n;
const DEFAULT_MAX_LOGS = 200_000;

class CrosscheckError extends Error {}

/**
 * Compares the rows the indexer stored for `[from, to]` with the rows the same handlers make of the logs an independent
 * source returns for the same range, by (block number, log index, kind). It reads the store and the source and writes
 * nothing. The report is deterministic: it carries no time, rows are in chain order, and a given pair of inputs always
 * yields the same JSON. Any failure to read either side yields `unverified`.
 *
 * Scope, deliberately narrow: the followed set is taken from the store, so which accounts are followed (admission) is
 * not checked; the handlers' decoding is shared with the indexer, so decoding is not checked either. What is checked is
 * that the source delivers the same logs, with the same positions and hashes, as the indexer stored.
 */
export async function crosscheck(options: CrosscheckOptions): Promise<CrosscheckReport> {
  const { source, store, registry, from, to } = options;
  const wanted = options.kinds ?? (() => true);
  let sourceHeight: number | undefined;
  const empty = (reason: string): CrosscheckReport => ({
    status: "unverified",
    range: { from: Number(from), to: Number(to) },
    source: source.name,
    ...(sourceHeight === undefined ? {} : { sourceHeight }),
    reason,
    counts: { indexer: 0, source: 0 },
    matched: 0,
    missingInSource: [],
    missingInIndexer: [],
    fieldMismatches: [],
  });
  try {
    const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
    const maxLogs = options.maxLogs ?? DEFAULT_MAX_LOGS;
    const addressChunk = options.addressChunk ?? 500;
    if (from < 0n || to < from) throw new CrosscheckError("the range is empty or negative");
    if (to - from + 1n > maxBlocks) throw new CrosscheckError(`the range is wider than ${maxBlocks} blocks`);
    if (to > BigInt(Number.MAX_SAFE_INTEGER)) throw new CrosscheckError("the range is beyond the safe integer range");

    const cursor = await store.cursor();
    if (!cursor) throw new CrosscheckError("the read-model has no cursor yet");
    if (to > cursor.number) throw new CrosscheckError(`block ${to} is above the stored cursor ${cursor.number}`);
    const height = await source.height();
    if (height <= BigInt(Number.MAX_SAFE_INTEGER)) sourceHeight = Number(height);
    if (height < to) throw new CrosscheckError(`${source.name} has indexed up to block ${height}, below ${to}`);

    const tracked = new Set<Address>(await store.trackedAccounts());
    const accounts = [...tracked];

    const theirs = new Map<string, ChainEvent>();
    let received = 0;
    for (const handler of registry.list()) {
      if (!handler.kinds.some(wanted)) continue;
      for (const query of logQueries(handler, from, to, accounts, addressChunk)) {
        for (const log of await source.logs(query)) {
          if (++received > maxLogs) throw new CrosscheckError(`${source.name} returned more than ${maxLogs} logs`);
          const row = decodeRow(handler, log);
          // The same rule the indexer applies: a discovery handler sees every account, only followed ones are stored.
          if (!row || !wanted(row.kind) || (row.account !== null && !tracked.has(row.account))) continue;
          const event: ChainEvent = { ...row, address: log.address, blockNumber: log.blockNumber, blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: log.logIndex };
          theirs.set(key(event), event);
        }
      }
    }

    const mine = new Map<string, ChainEvent>();
    for (const row of await store.events()) {
      if (row.blockNumber < from || row.blockNumber > to || !wanted(row.kind)) continue;
      if (mine.size >= maxLogs) throw new CrosscheckError(`the read-model holds more than ${maxLogs} rows in the range`);
      mine.set(key(row), row);
    }

    return compare(mine, theirs, { from, to, source: source.name, sourceHeight });
  } catch (error) {
    return empty(error instanceof Error ? error.message : String(error));
  }
}

function key(row: ChainEvent): string {
  return `${row.blockNumber.toString().padStart(20, "0")}:${row.logIndex.toString().padStart(10, "0")}:${row.kind}`;
}

function ref(row: ChainEvent): RowRef {
  return { kind: row.kind, blockNumber: Number(row.blockNumber), logIndex: row.logIndex, transactionHash: row.transactionHash };
}

function compare(mine: Map<string, ChainEvent>, theirs: Map<string, ChainEvent>, info: { from: bigint; to: bigint; source: string; sourceHeight?: number }): CrosscheckReport {
  const keys = [...new Set([...mine.keys(), ...theirs.keys()])].sort();
  const missingInSource: RowRef[] = [];
  const missingInIndexer: RowRef[] = [];
  const fieldMismatches: FieldMismatch[] = [];
  let matched = 0;
  for (const k of keys) {
    const a = mine.get(k);
    const b = theirs.get(k);
    if (a && !b) missingInSource.push(ref(a));
    else if (b && !a) missingInIndexer.push(ref(b));
    else if (a && b) {
      const diffs = differences(a, b);
      if (diffs.length === 0) matched++;
      for (const d of diffs) fieldMismatches.push({ ...ref(a), ...d });
    }
  }
  const clean = missingInSource.length === 0 && missingInIndexer.length === 0 && fieldMismatches.length === 0;
  return {
    status: clean ? "match" : "mismatch",
    range: { from: Number(info.from), to: Number(info.to) },
    source: info.source,
    ...(info.sourceHeight === undefined ? {} : { sourceHeight: info.sourceHeight }),
    counts: { indexer: mine.size, source: theirs.size },
    matched,
    missingInSource,
    missingInIndexer,
    fieldMismatches,
  };
}

function differences(a: ChainEvent, b: ChainEvent): { field: string; indexer: string | null; source: string | null }[] {
  const out: { field: string; indexer: string | null; source: string | null }[] = [];
  const check = (field: string, x: string | null | undefined, y: string | null | undefined) => {
    if (x !== y) out.push({ field, indexer: x ?? null, source: y ?? null });
  };
  check("account", a.account, b.account);
  check("address", a.address, b.address);
  check("blockHash", a.blockHash, b.blockHash);
  check("transactionHash", a.transactionHash, b.transactionHash);
  for (const name of [...new Set([...Object.keys(a.data), ...Object.keys(b.data)])].sort()) {
    const x = a.data[name];
    const y = b.data[name];
    check(`data.${name}`, x === undefined ? undefined : String(x), y === undefined ? undefined : String(y));
  }
  return out;
}
