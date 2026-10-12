import type { Hex } from "viem";

/**
 * One mid of an order book, taken during one tick (ARCHITECTURE.md section 11, "Tick runner"). `mid` is
 * (best bid + best ask) / 2 at Kuru's `bestBidAsk` scale, quote per base times 1e18. `market` is lowercase.
 */
export interface MidSample {
  market: Hex;
  tick: number;
  mid: bigint;
  blockNumber: bigint;
  /** Unix seconds of the block the book was read at. */
  blockTimestamp: bigint;
}

/**
 * The rolling mid series a market signal is computed from. `record` is insert-if-absent by (market, tick) and returns
 * the sample stored under that key, which is the earlier one when the tick was already sampled, so every reader of a
 * tick sees the same mid. `range` returns the stored samples of `market` with `fromTick <= tick <= toTick`, ascending.
 * `@monadeum/db` provides the Postgres implementation (migration 0015).
 */
export interface MidSampleStore {
  record(sample: MidSample): Promise<MidSample>;
  range(market: Hex, fromTick: number, toTick: number): Promise<MidSample[]>;
}

/** In-memory store for tests and local development only. */
export class MemoryMidSampleStore implements MidSampleStore {
  private readonly rows = new Map<string, MidSample>();

  async record(sample: MidSample): Promise<MidSample> {
    const stored = { ...sample, market: sample.market.toLowerCase() as Hex };
    const key = `${stored.market}:${stored.tick}`;
    const existing = this.rows.get(key);
    if (existing) return { ...existing };
    this.rows.set(key, stored);
    return { ...stored };
  }

  async range(market: Hex, fromTick: number, toTick: number): Promise<MidSample[]> {
    const m = market.toLowerCase();
    return [...this.rows.values()]
      .filter((s) => s.market === m && s.tick >= fromTick && s.tick <= toTick)
      .sort((a, b) => a.tick - b.tick)
      .map((s) => ({ ...s }));
  }
}
