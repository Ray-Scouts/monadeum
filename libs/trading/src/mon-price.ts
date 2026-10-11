import { ethers } from "ethers";
import type { Hex } from "viem";
import { liveSide, ORDER_BOOK_ABI, PRICE_SCALE, type Book, type KuruMarket } from "./market.js";

/** Quote per MON at the 1e18 scale, where it came from, and the chain time it was read at (Unix seconds). */
export interface MonPrice {
  price: bigint;
  source: string;
  observedAt: bigint;
}

/**
 * The MON price gas converts at, on a market whose base is not MON. `monPrice` returns null whenever it cannot vouch
 * for a price, and TradingService then builds no plan: a trade whose gas cannot be costed is not made.
 */
export interface MonPriceSource {
  /** The quote asset the price is denominated in; must be the trading market's quote. */
  readonly quote: Hex;
  monPrice(): Promise<MonPrice | null>;
}

/** What `KuruBookMonPrice` reads: a MON/quote book and the timestamp of the block it was read at. */
export interface BookReader {
  read(): Promise<{ book: Book; blockTimestamp: bigint }>;
}

export interface MonPriceLimits {
  /** Oldest acceptable block, seconds behind the local clock. A lagging RPC node fails closed. */
  maxAgeSeconds: number;
  /** Widest acceptable spread, bps of the mid. A thin or one-sided book fails closed. */
  maxSpreadBps: number;
}

/**
 * Starting values, not measurements: on 2026-10-10 the mainnet MON/USDC book read 0.02493 / 0.024975, about 18 bps
 * wide, and Monad's block time is around half a second, so both bounds leave wide room for a healthy book and RPC.
 */
export const DEFAULT_MON_PRICE_LIMITS: MonPriceLimits = { maxAgeSeconds: 60, maxSpreadBps: 200 };

/**
 * The mid of Kuru's MON/USDC book: the smallest source that needs no new vendor or oracle. It fails closed (null)
 * when the read throws, when either side of the book is empty, when the spread is wider than `maxSpreadBps`, or when
 * the block it was read at is more than `maxAgeSeconds` behind the local clock. It is a spot mid, so it can be moved
 * by whoever moves that book; it only converts gas, which is small next to the trade (ECONOMICS.md section 1).
 */
export class KuruBookMonPrice implements MonPriceSource {
  readonly source = "kuru-mon-usdc-mid";

  constructor(
    private readonly reader: BookReader,
    readonly quote: Hex,
    private readonly limits: MonPriceLimits = DEFAULT_MON_PRICE_LIMITS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async monPrice(): Promise<MonPrice | null> {
    let read;
    try {
      read = await this.reader.read();
    } catch {
      return null;
    }
    const { book, blockTimestamp } = read;
    if (!liveSide(book.bid) || !liveSide(book.ask) || book.ask < book.bid) return null;
    const mid = (book.bid + book.ask) / 2n;
    if (mid === 0n || ((book.ask - book.bid) * 10_000n) / mid > BigInt(this.limits.maxSpreadBps)) return null;
    const age = BigInt(Math.floor(this.now() / 1000)) - blockTimestamp;
    if (age > BigInt(this.limits.maxAgeSeconds) || age < -BigInt(this.limits.maxAgeSeconds)) return null;
    return { price: mid, source: this.source, observedAt: blockTimestamp };
  }
}

/** Reads `bestBidAsk` and the block's timestamp at one block, so the two cannot come from different blocks. */
export function kuruBookReader(market: KuruMarket, provider: ethers.providers.JsonRpcProvider): BookReader {
  if (market.base.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
    throw new Error("the MON price book must have native MON as its base");
  }
  const orderBook = new ethers.Contract(market.market, ORDER_BOOK_ABI as unknown as ethers.ContractInterface, provider);
  return {
    async read() {
      const block = await provider.getBlock("latest");
      const [bid, ask] = (await orderBook.bestBidAsk({ blockTag: block.number })) as [ethers.BigNumber, ethers.BigNumber];
      return { book: { bid: bid.toBigInt(), ask: ask.toBigInt() }, blockTimestamp: BigInt(block.timestamp) };
    },
  };
}

/** A fixed price, for tests and local development only. */
export function fixedMonPrice(quote: Hex, price: bigint = PRICE_SCALE): MonPriceSource {
  return { quote, monPrice: async () => ({ price, source: "fixed", observedAt: 0n }) };
}
