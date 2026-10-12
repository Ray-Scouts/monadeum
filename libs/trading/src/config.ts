import { ethers } from "ethers";
import { getAddress, isAddress, zeroAddress, type Hex } from "viem";
import { nativeBase, type KuruMarket } from "./market.js";
import { DEFAULT_MON_PRICE_LIMITS, KuruBookMonPrice, kuruBookReader, monBase, type MonPriceLimits, type MonPriceSource } from "./mon-price.js";
import { TradingService } from "./trading.js";
import type { PositionStore, TradeSigner, TradeStore } from "./types.js";
import { KuruSdkVenue } from "./venue.js";

export class TradingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradingConfigError";
  }
}

/**
 * A deployment's trading market and the book its MON price for gas is read from. Both are configuration, read from
 * the environment by `loadTradingConfig`, never a code constant: mainnet trades WETH/USDC with gas priced on the
 * MON/USDC book, testnet trades our own WMON/USDC market with gas priced on that same book (ARCHITECTURE.md
 * section 10, TradingModule).
 */
export interface TradingConfig {
  market: KuruMarket;
  /** Null when the market's base is native MON, whose own price converts gas. */
  monPrice: {
    /** The order book read for the MON price. Its quote is the trading market's quote. */
    market: Hex;
    /** The zero address for native MON, or `wrappedNative`. */
    base: Hex;
    wrappedNative?: Hex;
    source: string;
  } | null;
}

type Env = Record<string, string | undefined>;

function address(env: Env, name: string): Hex {
  const raw = env[name]?.trim();
  if (!raw) throw new TradingConfigError(`${name} is not set`);
  if (!isAddress(raw, { strict: false })) throw new TradingConfigError(`${name} is not an address`);
  return getAddress(raw);
}

function optionalAddress(env: Env, name: string): Hex | undefined {
  return env[name]?.trim() ? address(env, name) : undefined;
}

function integer(env: Env, name: string, fallback: number | null, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) {
    if (fallback === null) throw new TradingConfigError(`${name} is not set`);
    return fallback;
  }
  if (!/^\d+$/.test(raw) || Number(raw) > max) throw new TradingConfigError(`${name} must be an integer from 0 to ${max}`);
  return Number(raw);
}

/**
 * Reads the trading market from the environment, or returns null when `TRADING_KURU_MARKET` is unset (trading is not
 * configured in this process). Variables:
 *
 * - `TRADING_PAIR`, e.g. WETH/USDC or WMON/USDC: the pair TradeIntents must name.
 * - `TRADING_KURU_ROUTER`, `TRADING_KURU_MARKET`: Kuru's router and the order-book market.
 * - `TRADING_BASE`, `TRADING_QUOTE`: the market's base and quote; the quote is the settlement asset.
 * - `TRADING_BASE_DECIMALS` (default 18), `TRADING_QUOTE_DECIMALS` (default 6), `TRADING_SIZE_PRECISION`: as the
 *   market's `getMarketParams` reports them; `KuruSdkVenue.verifyMarket` re-checks them against the chain.
 * - `TRADING_MON_PRICE_MARKET`: the order book the MON price for gas is read from. Required unless the base is
 *   native MON. Its quote must be `TRADING_QUOTE`.
 * - `TRADING_MON_PRICE_BASE` (default the zero address, native MON): that book's base.
 * - `TRADING_WRAPPED_NATIVE`: Wrapped MON. Required when `TRADING_MON_PRICE_BASE` is not native MON, and must equal it.
 */
export function loadTradingConfig(env: Env): TradingConfig | null {
  if (!env.TRADING_KURU_MARKET?.trim()) return null;
  const pair = env.TRADING_PAIR?.trim();
  if (!pair) throw new TradingConfigError("TRADING_PAIR is not set");
  if (!/^[A-Za-z0-9.]{1,16}\/[A-Za-z0-9.]{1,16}$/.test(pair)) throw new TradingConfigError("TRADING_PAIR must be a pair such as WMON/USDC");
  const sizePrecisionRaw = env.TRADING_SIZE_PRECISION?.trim();
  if (!sizePrecisionRaw) throw new TradingConfigError("TRADING_SIZE_PRECISION is not set");
  if (!/^10*$/.test(sizePrecisionRaw)) throw new TradingConfigError("TRADING_SIZE_PRECISION must be a power of ten");
  const market: KuruMarket = {
    pair,
    router: address(env, "TRADING_KURU_ROUTER"),
    market: address(env, "TRADING_KURU_MARKET"),
    base: address(env, "TRADING_BASE"),
    quote: address(env, "TRADING_QUOTE"),
    baseDecimals: integer(env, "TRADING_BASE_DECIMALS", 18, 36),
    quoteDecimals: integer(env, "TRADING_QUOTE_DECIMALS", 6, 36),
    sizePrecision: BigInt(sizePrecisionRaw),
  };
  if (market.quote === zeroAddress) throw new TradingConfigError("TRADING_QUOTE must be the settlement asset, not native MON");
  if (market.base.toLowerCase() === market.quote.toLowerCase()) throw new TradingConfigError("TRADING_BASE and TRADING_QUOTE are the same token");

  const wrappedNative = optionalAddress(env, "TRADING_WRAPPED_NATIVE");
  const monMarket = optionalAddress(env, "TRADING_MON_PRICE_MARKET");
  if (!monMarket) {
    if (!nativeBase(market)) throw new TradingConfigError("TRADING_MON_PRICE_MARKET is not set: a market whose base is not MON needs a MON price book for gas");
    return { market, monPrice: null };
  }
  const monPriceBase = optionalAddress(env, "TRADING_MON_PRICE_BASE") ?? zeroAddress;
  if (!monBase(monPriceBase, wrappedNative)) {
    throw new TradingConfigError("TRADING_MON_PRICE_BASE must be native MON (the zero address) or equal TRADING_WRAPPED_NATIVE");
  }
  const wrapped = monPriceBase !== zeroAddress;
  return {
    market,
    monPrice: { market: monMarket, base: monPriceBase, wrappedNative, source: wrapped ? "kuru-wmon-usdc-mid" : "kuru-mon-usdc-mid" },
  };
}

/** The MON price for gas a configuration describes, over `provider`, or undefined on a native-MON market. */
export function monPriceSourceOf(
  config: TradingConfig,
  provider: ethers.providers.JsonRpcProvider,
  limits: MonPriceLimits = DEFAULT_MON_PRICE_LIMITS,
): MonPriceSource | undefined {
  const m = config.monPrice;
  if (!m) return undefined;
  const reader = kuruBookReader({ market: m.market, base: m.base }, provider, { wrappedNative: m.wrappedNative });
  return new KuruBookMonPrice(reader, config.market.quote, limits, undefined, m.source);
}

/**
 * The TradingModule part of a worker's tick runner, from configuration: the SDK venue on the configured market, the
 * configured MON price source, and TradingService over the given signer and stores. It verifies the market against
 * the chain first and refuses a mismatch, so a wrong address or decimals never reaches an order.
 */
export async function buildKuruTrading(
  config: TradingConfig,
  provider: ethers.providers.JsonRpcProvider,
  deps: { signer: TradeSigner; trades: TradeStore; positions: PositionStore; limits?: MonPriceLimits },
): Promise<{ venue: KuruSdkVenue; monPrice: MonPriceSource | undefined; trading: TradingService }> {
  const venue = new KuruSdkVenue(config.market, provider);
  const problems = await venue.verifyMarket();
  if (problems.length > 0) throw new TradingConfigError(`the configured market does not match the chain: ${problems.join(", ")}`);
  const monPrice = monPriceSourceOf(config, provider, deps.limits);
  const trading = new TradingService(config.market, venue, deps.signer, deps.trades, deps.positions, monPrice);
  return { venue, monPrice, trading };
}
