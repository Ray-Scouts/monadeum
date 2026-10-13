import type { Address, Hex } from "viem";
import type { LogQuery, RawLog } from "../types.js";
import type { LogSource } from "./compare.js";

/** Envio HyperSync for Monad testnet (chain 10143), from Envio's supported-networks documentation, checked 2026-10-12. */
export const MONAD_TESTNET_HYPERSYNC_URL = "https://10143.hypersync.xyz";

export class HyperSyncError extends Error {}

/** The slice of `HypersyncClient` (`@envio-dev/hypersync-client` 1.4.1) this module uses, so a test can stand in for it. */
export interface HyperSyncClientLike {
  getHeight(): Promise<number>;
  get(query: HyperSyncQuery): Promise<HyperSyncResponse>;
}

export interface HyperSyncQuery {
  fromBlock: number;
  /** Exclusive. */
  toBlock?: number;
  logs: { address?: string[]; topics?: string[][] }[];
  fieldSelection: { log: string[] };
}

export interface HyperSyncResponse {
  archiveHeight?: number;
  nextBlock: number;
  data: {
    logs: {
      removed?: boolean;
      logIndex?: number;
      transactionHash?: string;
      blockHash?: string;
      blockNumber?: number;
      address?: string;
      data?: string;
      topics: (string | undefined | null)[];
    }[];
  };
}

export interface HyperSyncLimits {
  /** Pages one `logs` call may take. A source that keeps paging is treated as failing. Default 200. */
  maxPages?: number;
  /** Logs one `logs` call may collect. Default 200000. */
  maxLogs?: number;
}

const LOG_FIELDS = ["Removed", "LogIndex", "TransactionHash", "BlockHash", "BlockNumber", "Address", "Data", "Topic0", "Topic1", "Topic2", "Topic3"];

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

/**
 * A `LogSource` over Envio HyperSync. HyperSync is treated like any external data source: every response is validated
 * and anything unexpected throws, which the cross-check reports as `unverified`. It is read-only.
 *
 * HyperSync's `toBlock` is exclusive and its responses are paginated by `nextBlock`; this class takes inclusive bounds
 * as `LogSource` defines them and follows `nextBlock` until the range is covered, refusing a page that does not advance.
 */
export class HyperSyncLogSource implements LogSource {
  readonly name = "envio-hypersync";
  private readonly maxPages: number;
  private readonly maxLogs: number;

  constructor(
    private readonly client: HyperSyncClientLike,
    limits: HyperSyncLimits = {},
  ) {
    this.maxPages = limits.maxPages ?? 200;
    this.maxLogs = limits.maxLogs ?? 200_000;
  }

  async height(): Promise<bigint> {
    const height = await this.client.getHeight();
    if (!Number.isSafeInteger(height) || height < 0) throw new HyperSyncError("HyperSync reported an invalid height");
    return BigInt(height);
  }

  async logs(query: LogQuery): Promise<RawLog[]> {
    const wanted = new Set(query.address.map((a) => a.toLowerCase()));
    const topics = query.topics.map((t) => (t ? t.map((x) => x.toLowerCase()) : []));
    const last = Number(query.toBlock);
    if (!Number.isSafeInteger(last) || !Number.isSafeInteger(Number(query.fromBlock)) || query.fromBlock > query.toBlock) {
      throw new HyperSyncError("invalid block range");
    }
    const out: RawLog[] = [];
    let next = Number(query.fromBlock);
    for (let page = 0; next <= last; page++) {
      if (page >= this.maxPages) throw new HyperSyncError(`HyperSync did not finish within ${this.maxPages} pages`);
      const response = await this.client.get({
        fromBlock: next,
        toBlock: last + 1,
        logs: [{ address: [...wanted], topics }],
        fieldSelection: { log: LOG_FIELDS },
      });
      if (!response || !response.data || !Array.isArray(response.data.logs)) throw new HyperSyncError("HyperSync returned a malformed response");
      if (!Number.isSafeInteger(response.nextBlock) || response.nextBlock <= next) throw new HyperSyncError("HyperSync did not advance past the requested block");
      for (const log of response.data.logs) {
        out.push(validate(log, wanted, Number(query.fromBlock), last));
        if (out.length > this.maxLogs) throw new HyperSyncError(`HyperSync returned more than ${this.maxLogs} logs`);
      }
      next = response.nextBlock;
    }
    return out;
  }
}

function validate(log: HyperSyncResponse["data"]["logs"][number], wanted: Set<string>, from: number, to: number): RawLog {
  if (log.removed === true) throw new HyperSyncError("HyperSync returned a removed log");
  const { blockNumber, logIndex } = log;
  if (typeof blockNumber !== "number" || !Number.isSafeInteger(blockNumber) || blockNumber < from || blockNumber > to) throw new HyperSyncError("HyperSync returned a log outside the range");
  if (typeof logIndex !== "number" || !Number.isSafeInteger(logIndex) || logIndex < 0) throw new HyperSyncError("HyperSync returned a log without a valid index");
  if (typeof log.address !== "string" || !ADDRESS.test(log.address) || !wanted.has(log.address.toLowerCase())) throw new HyperSyncError("HyperSync returned a log from an address that was not asked for");
  if (typeof log.blockHash !== "string" || !HASH.test(log.blockHash)) throw new HyperSyncError("HyperSync returned a log without a valid block hash");
  if (typeof log.transactionHash !== "string" || !HASH.test(log.transactionHash)) throw new HyperSyncError("HyperSync returned a log without a valid transaction hash");
  if (typeof log.data !== "string" || !HEX.test(log.data)) throw new HyperSyncError("HyperSync returned a log with invalid data");
  const topics: Hex[] = [];
  for (const topic of log.topics) {
    if (topic === null || topic === undefined) continue;
    if (typeof topic !== "string" || !HASH.test(topic)) throw new HyperSyncError("HyperSync returned an invalid topic");
    topics.push(topic.toLowerCase() as Hex);
  }
  return {
    address: log.address.toLowerCase() as Address,
    topics,
    data: log.data.toLowerCase() as Hex,
    blockNumber: BigInt(blockNumber),
    blockHash: log.blockHash.toLowerCase() as Hex,
    transactionHash: log.transactionHash.toLowerCase() as Hex,
    logIndex,
  };
}

/**
 * Builds a client for `url` with `apiToken`. The client package is loaded here, not at import, because it is a native
 * module that offline tests never need. The token is passed to the client and nowhere else.
 */
export async function createHyperSyncClient(url: string, apiToken: string): Promise<HyperSyncClientLike> {
  const { HypersyncClient } = await import("@envio-dev/hypersync-client");
  return new HypersyncClient({ url, apiToken, httpReqTimeoutMillis: 30_000, maxNumRetries: 3 }) as unknown as HyperSyncClientLike;
}
