import { baseToQuote, liveSide, referencePrice, type Book, type KuruMarket } from "./market.js";

/**
 * Figures measured by the issue #20 spike (`spikes/kuru-testnet-trade`), dry run on Monad testnet, 2026-10-08,
 * MON/USDC market through Kuru's router. The live run was not executed (no Kuru testnet USDC could be obtained), so
 * these are a simulated gas estimate and on-chain reads, not a receipt. They replace the back-of-envelope $0.001 gas
 * and the assumed 10 bps fee in ECONOMICS.md section 1 for this module's cost estimation only.
 */
export const ISSUE_20 = {
  /** `eth_estimateGas` for one router `anyToAnySwap` from an EOA, one fill against one resting order. */
  routerSwapGas: 389_331n,
  /** Gas buffer the spike applied on top of the estimate, in bps. */
  gasBufferBps: 1_000n,
  /** `eth_gasPrice` on testnet at the time of the read (base fee 100 gwei). */
  gasPriceWei: 102_000_000_000n,
  /** `takerFeeBps` from `getMarketParams`, testnet market and, read-only, the mainnet MON-USDC market. */
  takerFeeBps: 0,
} as const;

/**
 * Monad charges the gas limit, not gas used, per `https://docs.monad.xyz/developer-essentials/gas-pricing`
 * (read 2026-10-08). The spike's live run was meant to verify this and has not; until it does, this is an assumption,
 * and it is the conservative one.
 */
export function chargedGasWei(gasEstimate: bigint, gasPriceWei: bigint, bufferBps: bigint = ISSUE_20.gasBufferBps): bigint {
  return (gasEstimate + (gasEstimate * bufferBps) / 10_000n) * gasPriceWei;
}

export interface CostEstimate {
  gasWei: bigint;
  /** All amounts below are settlement-asset base units. */
  gas: bigint;
  fees: bigint;
  /** Half the quoted spread on `notional`; null when one side of the book is empty and no mid exists. */
  halfSpread: bigint | null;
  total: bigint;
}

export interface EstimateInput {
  notional: bigint;
  book: Book;
  takerFeeBps?: number;
  gasPriceWei?: bigint;
}

/**
 * Expected cost of one market buy of `notional` settlement-asset base units. Gas is the router swap only, from the
 * issue #20 measurement: an ERC-4337 operation adds verification and pre-verification gas, and the exact-amount
 * approve adds its own call, neither of which has been measured, so this is a lower bound on gas. Price impact
 * beyond the top of book is not included; the quote taken at plan time covers it.
 */
export function estimateTradeCost(market: KuruMarket, input: EstimateInput): CostEstimate | null {
  const reference = referencePrice(input.book);
  if (!reference || input.notional < 0n) return null;
  const takerFeeBps = BigInt(input.takerFeeBps ?? ISSUE_20.takerFeeBps);
  const gasWei = chargedGasWei(ISSUE_20.routerSwapGas, input.gasPriceWei ?? ISSUE_20.gasPriceWei);
  // Native MON is the base asset, so wei are base units and convert at the market's own price.
  const gas = baseToQuote(gasWei, reference.price, market);
  const fees = (input.notional * takerFeeBps) / 10_000n;
  const halfSpread = liveSide(input.book.bid)
    ? (input.notional * (input.book.ask - input.book.bid)) / (input.book.ask + input.book.bid)
    : null;
  return { gasWei, gas, fees, halfSpread, total: gas + fees + (halfSpread ?? 0n) };
}
