import { parseAbi, zeroAddress, type Hex } from "viem";

/**
 * One Kuru order-book market reached through Kuru's router: a single hop whose quote is the settlement asset. Its base
 * is either native MON, which can be bought but not sold under the zero-native-value rule, or an ERC-20, which can be
 * bought and sold (ARCHITECTURE.md section 10, TradingModule). Gas is paid in MON, so on a market whose base is not
 * MON it converts to the settlement asset through a separate MON price (`MonPriceSource`). Every field is deployment
 * configuration and is re-checked against the chain by `verifyMarket`.
 */
export interface KuruMarket {
  pair: string;
  router: Hex;
  market: Hex;
  /** The zero address for native MON, or an ERC-20 such as WETH. */
  base: Hex;
  /** The settlement asset. */
  quote: Hex;
  baseDecimals: number;
  quoteDecimals: number;
  /** Scale of `filledSize` in the market's `Trade` event, read from `getMarketParams`. */
  sizePrecision: bigint;
}

export function nativeBase(market: KuruMarket): boolean {
  return market.base.toLowerCase() === zeroAddress;
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

/**
 * Kuru's WETH/USDC market on Monad mainnet, the default trading market (the owner's decision, after a close was found
 * impossible on a native-MON base). Read on 2026-10-10 from Kuru's market API and on-chain through
 * `https://rpc.monad.xyz`: registered at the router (`verifiedMarket`), `getMarketParams` base WETH (18 decimals),
 * quote USDC (6 decimals), sizePrecision 1e10, pricePrecision 1e4, tickSize 100, minSize 2e7, maxSize 1e18, taker and
 * maker fee 0 bps; the installed SDK 0.0.95 builds a sell on it with value 0. Time-sensitive: re-check before use.
 */
export const KURU_MAINNET_WETH_USDC: KuruMarket = {
  pair: "WETH/USDC",
  router: "0xd651346d7c789536ebf06dc72aE3C8502cd695CC",
  market: "0xa6afd386135b7d41a6c40c525abc4a1019b0d132",
  base: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
  quote: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  baseDecimals: 18,
  quoteDecimals: 6,
  sizePrecision: 10_000_000_000n,
};

/**
 * Kuru's MON/USDC market on Monad mainnet, read on 2026-10-10 (docs, API, and on-chain): native MON base, USDC quote,
 * sizePrecision 1e10, taker fee 0. Not traded by default; it is the book the default MON price for gas is read from.
 */
export const KURU_MAINNET_MON_USDC: KuruMarket = {
  pair: "MON/USDC",
  router: "0xd651346d7c789536ebf06dc72aE3C8502cd695CC",
  market: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
  base: zeroAddress,
  quote: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  baseDecimals: 18,
  quoteDecimals: 6,
  sizePrecision: 10_000_000_000n,
};

/** The market agents trade unless a deployment configures another. */
export const DEFAULT_MARKET = KURU_MAINNET_WETH_USDC;

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

/** Converts native MON in wei to quote-asset base units at `monPrice` (quote per MON, 1e18 scale), rounding down. */
export function monToQuote(wei: bigint, monPrice: bigint, market: KuruMarket): bigint {
  return (wei * monPrice * 10n ** BigInt(market.quoteDecimals)) / (10n ** 18n * PRICE_SCALE);
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
