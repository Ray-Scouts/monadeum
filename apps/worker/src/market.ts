import { liveSide, type MidSample, type MidSampleStore } from "@monadeum/trading";
import { parseAbi, type Address, type Hex } from "viem";
import type { AgentRecord } from "./agents.js";
import type { RpcReads } from "./chain.js";
import type { MarketDataLimits } from "./config.js";
import { tickAt } from "./consumer/jobs.js";
import type { MarketReading, MarketSource } from "./ports.js";

/** One read of an order book's best bid and ask (1e18 scale, quote per base), and the block it was read at. */
export interface BookReading {
  bid: bigint;
  ask: bigint;
  blockNumber: bigint;
  /** Unix seconds. */
  blockTimestamp: bigint;
}

export interface BookReader {
  read(): Promise<BookReading>;
}

const ORDER_BOOK_READ_ABI = parseAbi(["function bestBidAsk() view returns (uint256 bid, uint256 ask)"]);

/** Reads Kuru's `bestBidAsk` at the latest block, and that block's timestamp, so the two come from one block. */
export function rpcBookReader(rpc: RpcReads, market: Address): BookReader {
  return {
    async read() {
      const block = await rpc.getBlock();
      if (block.number === null) throw new Error("the latest block has no number");
      const [bid, ask] = (await rpc.readContract({ address: market, abi: ORDER_BOOK_READ_ABI, functionName: "bestBidAsk", blockNumber: block.number })) as readonly [bigint, bigint];
      return { bid, ask, blockNumber: block.number, blockTimestamp: block.timestamp };
    },
  };
}

/**
 * The strategy's `signal` from on-chain data (ARCHITECTURE.md section 11, "Tick runner"; EVOLUTION.md section 1.1):
 * the trailing mean of the market's per-tick mid returns over the agent's `timeHorizon` ticks, minus its
 * `entryThreshold`. The strategy goes long when that is positive and proposes `flat`, the exit, otherwise. This is the
 * signal the issue #102 study scored (the harness trailing-mean signal), applied to the configured Kuru book.
 *
 * The series: one mid per tick per market, the first valid reading taken during that tick, kept in Postgres
 * (`MidSampleStore`, migration 0015) so every agent of a tick reads the same mid and a restart loses nothing. Every
 * tick job samples the book first, funded or not, so the series builds before agents trade.
 *
 * Fail closed, never a guessed value: `read` returns null, and the tick then takes no action, when the book cannot be
 * read now, when either side is empty or crossed, when the spread is wider than `maxSpreadBps`, when the block read is
 * more than `maxAgeSeconds` from the local clock, when the agent's genome document is absent, or when any of the
 * `timeHorizon + 1` consecutive tick samples is missing (a new market, or a gap while the worker was down: the signal
 * comes back once the window is whole again). The mid is a spot price that whoever moves the book can move; on
 * testnet the book is our own seeded liquidity, so the signal carries no economic meaning there.
 */
export class KuruMidSignal implements MarketSource {
  constructor(
    private readonly deps: {
      market: Hex;
      /** The token field the tick validates, the base of the pair, e.g. WMON. */
      symbol: string;
      reader: BookReader;
      samples: MidSampleStore;
      tickIntervalMs: number;
      limits: MarketDataLimits;
      clock: () => Date;
    },
  ) {}

  /** Reads the book now and records this tick's mid if none is recorded yet. Null when the reading is not valid. */
  async sample(): Promise<MidSample | null> {
    const { reader, limits, clock, tickIntervalMs, samples, market } = this.deps;
    let r: BookReading;
    try {
      r = await reader.read();
    } catch {
      return null;
    }
    if (!liveSide(r.bid) || !liveSide(r.ask) || r.ask < r.bid) return null;
    const mid = (r.bid + r.ask) / 2n;
    if (mid === 0n || ((r.ask - r.bid) * 10_000n) / mid > BigInt(limits.maxSpreadBps)) return null;
    const now = clock();
    const age = now.getTime() / 1000 - Number(r.blockTimestamp);
    if (!(Math.abs(age) <= limits.maxAgeSeconds)) return null;
    const tick = tickAt(now, tickIntervalMs);
    if (tick <= 0) return null;
    try {
      return await samples.record({ market: market.toLowerCase() as Hex, tick, mid, blockNumber: r.blockNumber, blockTimestamp: r.blockTimestamp });
    } catch {
      return null;
    }
  }

  async read(agent: AgentRecord): Promise<MarketReading | null> {
    const genome = agent.genomeDocument;
    if (!genome) return null;
    const horizon = Math.floor(genome.timeHorizon);
    if (!Number.isSafeInteger(horizon) || horizon < 1 || !Number.isFinite(genome.entryThreshold)) return null;
    const current = await this.sample();
    if (!current) return null;
    let series: MidSample[];
    try {
      series = await this.deps.samples.range(this.deps.market, current.tick - horizon, current.tick);
    } catch {
      return null;
    }
    if (series.length !== horizon + 1 || series.some((s, i) => s.tick !== current.tick - horizon + i || s.mid <= 0n)) return null;
    let sum = 0;
    for (let i = 1; i < series.length; i++) {
      const [before, after] = [series[i - 1]!.mid, series[i]!.mid];
      // The return at 1e18 precision in integers first, so a small move on a large mid is not lost to a float.
      sum += Number(((after - before) * 10n ** 18n) / before) / 1e18;
    }
    return { symbol: this.deps.symbol, signal: sum / horizon - genome.entryThreshold, observedAt: new Date(Number(current.blockTimestamp) * 1000).toISOString() };
  }
}
