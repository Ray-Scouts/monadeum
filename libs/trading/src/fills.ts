import type { CostedFill } from "@monadeum/fitness";
import { formatUnits, parseEventLogs } from "viem";
import { baseToQuote, monToQuote, ORDER_BOOK_ABI, priceOf, ROUTER_ABI, type KuruMarket } from "./market.js";
import type { Fill, OperationReceipt, OrderSnapshot, TradeCosts, TradeRecord } from "./types.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Reads one fill from an included operation's logs: the router's `KuruRouterSwap` for what the account paid and
 * received, and, for a buy, the market's `Trade` events for the gross fill before the taker fee. Returns null when the
 * logs do not contain exactly one swap by this account on this market's assets in the order's direction, which the
 * caller treats as unattributable.
 */
export function decodeFill(market: KuruMarket, order: OrderSnapshot, receipt: OperationReceipt): Fill | null {
  const logs = receipt.logs as unknown as Parameters<typeof parseEventLogs>[0]["logs"];
  const swaps = parseEventLogs({ abi: ROUTER_ABI, eventName: "KuruRouterSwap", logs, strict: true }).filter(
    (l) => same(l.address, market.router) && same(l.args.msgSender, order.account),
  );
  if (swaps.length !== 1) return null;
  const swap = swaps[0]!.args;
  const [debit, credit] = order.side === "buy" ? [market.quote, market.base] : [market.base, market.quote];
  if (!same(swap.debitToken, debit) || !same(swap.creditToken, credit) || swap.amountOut === 0n) return null;

  if (order.side === "sell") {
    // A sell's `Trade` events report base filled, which is the amount sold, so they do not show the fee; the rate does.
    const feeQuote = (swap.amountOut * BigInt(order.takerFeeBps)) / BigInt(10_000 - order.takerFeeBps);
    return {
      side: "sell",
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      baseIn: swap.amountIn,
      quoteOut: swap.amountOut,
      grossQuoteOut: swap.amountOut + feeQuote,
      feeSource: "taker-fee-bps",
      feeQuote,
      executedPrice: priceOf(swap.amountOut, swap.amountIn, market),
    };
  }

  const trades = parseEventLogs({ abi: ORDER_BOOK_ABI, eventName: "Trade", logs, strict: true }).filter((l) => same(l.address, market.market));
  const filled = trades.reduce((sum, t) => sum + t.args.filledSize, 0n);
  const grossFromTrades = (filled * 10n ** BigInt(market.baseDecimals)) / market.sizePrecision;
  // A fill the Trade events do not cover (for example the AMM vault, not checked by issue #20) falls back to the rate.
  const fromTrades = trades.length > 0 && grossFromTrades >= swap.amountOut;
  const feeBase = fromTrades
    ? grossFromTrades - swap.amountOut
    : (swap.amountOut * BigInt(order.takerFeeBps)) / BigInt(10_000 - order.takerFeeBps);

  return {
    side: "buy",
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
 * Costs against the prices captured at plan time. Gas is in MON and converts at the order's MON price (the reference
 * itself on a native-MON market). Slippage excludes the fee and includes the half-spread and price impact: for a
 * buy, what was paid above the reference for the gross amount filled; for a sell, what was received below the
 * reference for the amount sold, before the fee.
 */
export function costsOf(market: KuruMarket, order: OrderSnapshot, gasCostWei: bigint, fill: Fill | null): TradeCosts {
  const price = order.reference.price;
  // Gas is paid in MON: on a native-MON market the reference is its price, otherwise the price captured at plan time.
  const gas = monToQuote(gasCostWei, order.monPrice?.price ?? price, market);
  if (!fill) return { gasWei: gasCostWei, gas, fees: 0n, slippage: 0n };
  if (fill.side === "sell") {
    return { gasWei: gasCostWei, gas, fees: fill.feeQuote, slippage: baseToQuote(fill.baseIn, price, market) - fill.grossQuoteOut };
  }
  return {
    gasWei: gasCostWei,
    gas,
    fees: baseToQuote(fill.feeBase, price, market),
    slippage: fill.quoteIn - baseToQuote(fill.grossBaseFilled, price, market),
  };
}

/**
 * The cost entry FitnessModule's `netEconomicPerformance` consumes, in whole settlement-asset units: this trade's gas,
 * fees, and slippage, and the realized P&L it produced when it closed a position (`TradingService.settle`, 0 for a
 * buy). x402 spend is recorded by X402Module, so it is 0 here. A reverted trade still reports the gas it paid.
 */
export function toCostedFill(record: TradeRecord, quoteDecimals: number, realizedPnl = 0n): CostedFill | null {
  if (!record.costs) return null;
  const units = (v: bigint) => Number(formatUnits(v, quoteDecimals));
  return {
    realizedPnl: units(realizedPnl),
    x402: 0,
    gas: units(record.costs.gas),
    fees: units(record.costs.fees),
    slippage: units(record.costs.slippage),
  };
}
