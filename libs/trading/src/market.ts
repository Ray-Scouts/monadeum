import { parseAbi, zeroAddress, type Hex } from "viem";

/**
 * One Kuru order-book market reached through Kuru's router. The MVP scope is a single-hop market whose base is native
 * MON and whose quote is the settlement asset (MON/USDC), so gas, paid in MON, converts to the settlement asset at the
 * market's own price. Every field is deployment configuration and is re-checked against the chain by `verifyMarket`.
 */
export interface KuruMarket {
  pair: string;
  router: Hex;
  market: Hex;
  /** The zero address for native MON, or an ERC-20 that wraps MON one to one when `wrappedNativeBase` is set. */
  base: Hex;
  /**
   * Set only for an ERC-20 base that wraps MON one to one, so gas, paid in MON, still converts at the market's price.
   * Such a base can be sold with a zero native value; native MON cannot (ARCHITECTURE.md section 10, TradingModule).
   */
  wrappedNativeBase?: boolean;
  /** The settlement asset. */
  quote: Hex;
  baseDecimals: number;
  quoteDecimals: number;
  /** Scale of `filledSize` in the market's `Trade` event, read from `getMarketParams`. */
  sizePrecision: bigint;
}

/**
 * Kuru's MON/USDC testnet market as read by the issue #20 spike on 2026-10-08 from
 * `https://docs.kuru.io/contracts/Contract-addresses` and confirmed against the router's `verifiedMarket` registry.
 * Time-sensitive: re-check before relying on it.
 */
export const KURU_TESTNET_MON_USDC: KuruMarket = {
  pair: "MON/USDC",
  router: "0x7EFbE105Ca7415dE98F96622173458ac1c054630",
  market: "0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9",
  base: zeroAddress,
  quote: "0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570",
  baseDecimals: 18,
  quoteDecimals: 6,
  sizePrecision: 10_000_000_000n,
};

// Same signatures as the spike and as the ABIs shipped in @kuru-labs/kuru-sdk 0.0.95 (abi/Router.json, abi/OrderBook.json).
export const ROUTER_ABI = parseAbi([
  "function anyToAnySwap(address[] markets, bool[] isBuy, bool[] nativeSend, address debitToken, address creditToken, uint256 amount, uint256 minAmountOut) payable returns (uint256)",
  "event KuruRouterSwap(address msgSender, address debitToken, address creditToken, uint256 amountIn, uint256 amountOut)",
]);
export const ORDER_BOOK_ABI = parseAbi([
  "function bestBidAsk() view returns (uint256 bid, uint256 ask)",
  "event Trade(uint40 orderId, address makerAddress, bool isBuy, uint256 price, uint96 updatedSize, address takerAddress, address txOrigin, uint96 filledSize)",
]);
export const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

/** `bestBidAsk` scale: whole quote units per whole base unit, times 1e18. */
export const PRICE_SCALE = 10n ** 18n;
const MAX_UINT = 2n ** 256n - 1n;

/** An empty side of the book reads as 0 or 2^256 - 1. */
export function liveSide(price: bigint): boolean {
  return price !== 0n && price !== MAX_UINT;
}

export interface Book {
  bid: bigint;
  ask: bigint;
}

/** Converts a base-asset amount (base units) to quote-asset base units at `price` (1e18 scale), rounding down. */
export function baseToQuote(amount: bigint, price: bigint, market: KuruMarket): bigint {
  return (amount * price * 10n ** BigInt(market.quoteDecimals)) / (10n ** BigInt(market.baseDecimals) * PRICE_SCALE);
}

/** Price paid, quote per base at the 1e18 scale, from amounts in base units. */
export function priceOf(quoteIn: bigint, baseOut: bigint, market: KuruMarket): bigint {
  if (baseOut === 0n) return 0n;
  return (quoteIn * PRICE_SCALE * 10n ** BigInt(market.baseDecimals)) / (baseOut * 10n ** BigInt(market.quoteDecimals));
}

/**
 * The reference a fill's slippage and a position's value are measured against: the mid when both sides are live,
 * else the side the order takes (the best ask for a buy, the best bid for a sell). Null when that side is empty.
 */
export function referencePrice(book: Book, side: "buy" | "sell" = "buy"): { kind: "mid" | "ask" | "bid"; price: bigint } | null {
  const [taken, other] = side === "buy" ? [book.ask, book.bid] : [book.bid, book.ask];
  if (!liveSide(taken)) return null;
  if (!liveSide(other)) return { kind: side === "buy" ? "ask" : "bid", price: taken };
  return { kind: "mid", price: (book.bid + book.ask) / 2n };
}
