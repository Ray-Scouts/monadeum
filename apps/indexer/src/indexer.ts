import { decodeEventLog, pad, type Address, type Hex } from "viem";
import { selectors, type HandlerRegistry } from "./registry.js";
import { chainOrder, type ReadModelStore, type TrackedAccount } from "./store.js";
import type { BlockHash, ChainEvent, EventHandler, IndexerChain, RawLog } from "./types.js";

export interface SyncOptions {
  /** First block to index when the store has no cursor. */
  startBlock: bigint;
  /** Maximum number of blocks per batch, and so per `eth_getLogs` range. */
  batchSize: bigint;
  /** A block is indexed only once it is this many blocks below the head. */
  confirmations: bigint;
  /** How many blocks below the cursor stored hashes are kept. A reorg deeper than this stops the indexer. */
  reorgWindow: bigint;
  /** Maximum addresses per `eth_getLogs` call when following tracked accounts. */
  addressChunk?: number;
}

export type SyncResult =
  | { status: "idle"; cursor: bigint | null }
  | { status: "indexed"; from: bigint; to: bigint; events: number; caughtUp: boolean }
  | { status: "reorg"; rolledBackTo: bigint; discarded: bigint }
  | { status: "retry"; reason: string };

/** The chain diverged from the stored hashes further back than `reorgWindow`. Needs an operator; never skipped. */
export class DeepReorgError extends Error {}
export class ChainMismatchError extends Error {}

/**
 * Chain sync: polls confirmed blocks in batches, decodes logs through the handler registry, and writes each batch
 * atomically with its cursor. Before every batch it checks the stored cursor hash against the chain; on a mismatch it
 * walks the stored hashes back to the newest block that is still canonical, deletes every row above it, and resumes
 * from there, so the removed blocks are re-indexed from the canonical chain.
 */
export class Indexer {
  private readonly addressChunk: number;

  constructor(
    private readonly chain: IndexerChain,
    private readonly store: ReadModelStore,
    private readonly registry: HandlerRegistry,
    private readonly options: SyncOptions,
  ) {
    if (options.batchSize < 1n) throw new Error("batchSize must be at least 1");
    if (options.confirmations < 0n) throw new Error("confirmations must not be negative");
    if (options.reorgWindow <= options.confirmations) throw new Error("reorgWindow must be larger than confirmations");
    this.addressChunk = options.addressChunk ?? 500;
  }

  async verifyChain(expectedChainId: number): Promise<void> {
    const id = await this.chain.chainId();
    if (id !== expectedChainId) throw new ChainMismatchError(`RPC reports chain ${id}, expected ${expectedChainId}`);
  }

  async syncOnce(): Promise<SyncResult> {
    const head = await this.chain.headBlockNumber();
    const target = head - this.options.confirmations;
    const cursor = await this.store.cursor();

    if (cursor) {
      const canonical = await this.chain.block(cursor.number);
      if (!canonical || canonical.hash !== cursor.hash) return this.rollback(cursor);
    }

    const from = cursor ? cursor.number + 1n : this.options.startBlock;
    if (from > target) return { status: "idle", cursor: cursor?.number ?? null };
    const to = min(target, from + this.options.batchSize - 1n);

    const tracked = new Set(await this.store.trackedAccounts());
    const discovered: TrackedAccount[] = [];
    const logs: { handler: EventHandler; log: RawLog }[] = [];

    for (const handler of this.registry.discovery()) {
      const found = await this.fetch(handler, from, to, []);
      logs.push(...found);
      for (const { handler: h, log } of found) {
        const row = this.decode(h, log);
        if (row?.account && !tracked.has(row.account)) {
          tracked.add(row.account);
          discovered.push({ account: row.account, firstBlock: log.blockNumber });
        }
      }
    }
    const accounts = [...tracked];
    for (const handler of this.registry.followers()) logs.push(...(await this.fetch(handler, from, to, accounts)));

    // Every block that produced a row, and the batch's first and last block, must still be canonical and agree with
    // the hash its logs carry; a reorg that landed between the cursor check and here is retried, never stored.
    const fromBlock = await this.chain.block(from);
    if (!fromBlock) return { status: "retry", reason: `block ${from} is not available` };
    if (cursor && fromBlock.parentHash !== cursor.hash) return { status: "retry", reason: `block ${from} does not extend the cursor` };
    const blocks = new Map<bigint, BlockHash>([[from, { number: from, hash: fromBlock.hash }]]);
    for (const number of new Set([to, ...logs.map((l) => l.log.blockNumber)])) {
      if (blocks.has(number)) continue;
      const block = await this.chain.block(number);
      if (!block) return { status: "retry", reason: `block ${number} is not available` };
      blocks.set(number, { number, hash: block.hash });
    }
    for (const { log } of logs) {
      if (blocks.get(log.blockNumber)?.hash !== log.blockHash) return { status: "retry", reason: `log in block ${log.blockNumber} is not on the canonical chain` };
    }

    const events: ChainEvent[] = [];
    for (const { handler, log } of logs) {
      const row = this.decode(handler, log);
      if (!row) continue;
      events.push({ ...row, address: log.address, blockNumber: log.blockNumber, blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: log.logIndex });
    }
    events.sort(chainOrder);

    const cursorBlock = blocks.get(to)!;
    await this.store.apply({ events, blocks: [...blocks.values()], discovered, cursor: cursorBlock, pruneBelow: to - this.options.reorgWindow });
    return { status: "indexed", from, to, events: events.length, caughtUp: to === target };
  }

  private async rollback(cursor: BlockHash): Promise<SyncResult> {
    const floor = cursor.number - this.options.reorgWindow;
    for (const stored of await this.store.blockHashes()) {
      if (stored.number < floor) break;
      const canonical = await this.chain.block(stored.number);
      if (canonical && canonical.hash === stored.hash) {
        await this.store.rollback(stored);
        return { status: "reorg", rolledBackTo: stored.number, discarded: cursor.number - stored.number };
      }
    }
    throw new DeepReorgError(`no stored block within ${this.options.reorgWindow} blocks of ${cursor.number} is canonical`);
  }

  private async fetch(handler: EventHandler, from: bigint, to: bigint, accounts: Address[]): Promise<{ handler: EventHandler; log: RawLog }[]> {
    const topic0 = selectors(handler);
    const source = handler.source;
    const queries: { address: Address[]; topics: (Hex[] | null)[] }[] = [];
    if (source.kind === "contract") {
      queries.push({ address: [source.address], topics: [topic0] });
    } else {
      for (let i = 0; i < accounts.length; i += this.addressChunk) {
        const chunk = accounts.slice(i, i + this.addressChunk);
        if (source.kind === "account") {
          queries.push({ address: chunk, topics: [topic0] });
        } else {
          const topics: (Hex[] | null)[] = [topic0, null, null, null].slice(0, source.accountTopic + 1);
          topics[source.accountTopic] = chunk.map((a) => pad(a, { size: 32 }));
          queries.push({ address: [source.address], topics });
        }
      }
    }
    const out: { handler: EventHandler; log: RawLog }[] = [];
    for (const q of queries) {
      for (const log of await this.chain.logs({ fromBlock: from, toBlock: to, ...q })) out.push({ handler, log });
    }
    return out;
  }

  private decode(handler: EventHandler, log: RawLog) {
    let decoded;
    try {
      decoded = decodeEventLog({ abi: handler.events, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
    } catch {
      // A log with a matching selector that does not decode (for example a different contract's event with the same
      // name and argument types but other indexing) is not one of ours.
      return null;
    }
    return handler.handle({ eventName: decoded.eventName as string, args: (decoded.args ?? {}) as Record<string, unknown> }, log);
  }

  /** Runs until `signal` aborts. Polls immediately while behind, then every `pollIntervalMs`. */
  async run(signal: AbortSignal, pollIntervalMs: number, log: (message: string) => void = () => {}): Promise<void> {
    while (!signal.aborted) {
      let wait = pollIntervalMs;
      try {
        const result = await this.syncOnce();
        if (result.status === "indexed") {
          log(`indexed ${result.from}..${result.to}, ${result.events} rows`);
          if (!result.caughtUp) wait = 0;
        } else if (result.status === "reorg") {
          log(`reorg: rolled back ${result.discarded} blocks to ${result.rolledBackTo}`);
          wait = 0;
        } else if (result.status === "retry") {
          log(`retry: ${result.reason}`);
        }
      } catch (error) {
        if (error instanceof DeepReorgError) throw error;
        log(`sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (wait > 0) await sleep(wait, signal);
    }
  }
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
