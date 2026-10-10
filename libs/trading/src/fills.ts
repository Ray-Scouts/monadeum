import type { CostedFill } from "@monadeum/fitness";
import { formatUnits, parseEventLogs } from "viem";
import { baseToQuote, ORDER_BOOK_ABI, priceOf, ROUTER_ABI, type KuruMarket } from "./market.js";
import type { Fill, OperationReceipt, OrderSnapshot, TradeCosts, TradeRecord } from "./types.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Reads one fill from an included operation's logs: the router's `KuruRouterSwap` for what the account paid and
 * received, and the market's `Trade` events for the gross fill before the taker fee. Returns null when the logs do
 * not contain exactly one swap by this account on this market's assets, which the caller treats as unattributable.
 */
export function decodeFill(market: KuruMarket, order: OrderSnapshot, receipt: OperationReceipt): Fill | null {
  const logs = receipt.logs as unknown as Parameters<typeof parseEventLogs>[0]["logs"];
  const swaps = parseEventLogs({ abi: ROUTER_ABI, eventName: "KuruRouterSwap", logs, strict: true }).filter(
    (l) => same(l.address, market.router) && same(l.args.msgSender, order.account),
  );
  if (swaps.length !== 1) return null;
  const swap = swaps[0]!.args;
  if (!same(swap.debitToken, market.quote) || !same(swap.creditToken, market.base) || swap.amountOut === 0n) return null;

  const trades = parseEventLogs({ abi: ORDER_BOOK_ABI, eventName: "Trade", logs, strict: true }).filter((l) => same(l.address, market.market));
  const filled = trades.reduce((sum, t) => sum + t.args.filledSize, 0n);
  const grossFromTrades = (filled * 10n ** BigInt(market.baseDecimals)) / market.sizePrecision;
  // A fill the Trade events do not cover (for example the AMM vault, not checked by issue #20) falls back to the rate.
  const fromTrades = trades.length > 0 && grossFromTrades >= swap.amountOut;
  const feeBase = fromTrades
    ? grossFromTrades - swap.amountOut
    : (swap.amountOut * BigInt(order.takerFeeBps)) / BigInt(10_000 - order.takerFeeBps);

  return {
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    quoteIn: swap.amountIn,
    baseOut: swap.amountOut,
    grossBaseFilled: swap.amountOut + feeBase,
    feeSource: fromTrades ? "trade-events" : "taker-fee-bps",
    feeBase,
    executedPrice: priceOf(swap.amountIn, swap.amountOut, market),
  };
}

/**
 * Costs against the reference price captured at plan time. Gas is in MON, the base asset, so it converts at the same
 * reference. Slippage is what was paid above the reference for the gross amount filled, so it includes the half-spread
 * and price impact and excludes the fee.
 */
export function costsOf(market: KuruMarket, order: OrderSnapshot, gasCostWei: bigint, fill: Fill | null): TradeCosts {
  const price = order.reference.price;
  const gas = baseToQuote(gasCostWei, price, market);
  if (!fill) return { gasWei: gasCostWei, gas, fees: 0n, slippage: 0n };
  return {
    gasWei: gasCostWei,
    gas,
    fees: baseToQuote(fill.feeBase, price, market),
    slippage: fill.quoteIn - baseToQuote(fill.grossBaseFilled, price, market),
  };
}

/**
 * The cost entry FitnessModule's `netEconomicPerformance` consumes, in whole settlement-asset units. A trade's
 * realized P&L belongs to the position when it closes, and x402 spend is recorded by X402Module, so both are 0 here;
 * gas, fees, and slippage are this trade's. A reverted trade still reports the gas it paid.
 */
export function toCostedFill(record: TradeRecord, quoteDecimals: number): CostedFill | null {
  if (!record.costs) return null;
  const units = (v: bigint) => Number(formatUnits(v, quoteDecimals));
  return { realizedPnl: 0, x402: 0, gas: units(record.costs.gas), fees: units(record.costs.fees), slippage: units(record.costs.slippage) };
}
