import { baseToQuote, referencePrice, type Book, type KuruMarket } from "./market.js";
import type { Position, TradeRecord } from "./types.js";

export function emptyPosition(agentId: string, pair: string): Position {
  return { agentId, pair, size: 0n, basis: 0n, realized: 0n, closing: null, applied: {} };
}

/**
 * Applies one filled trade to a position by average cost, and returns the realized P&L it produced, settlement-asset
 * base units. Pure; the caller persists the result.
 *
 * A buy adds the base received to `size` and its reference value to `basis`: the quote paid less the fee and
 * slippage the trade's costs already carry. A sell takes the base sold out of `size` and the matching share of
 * `basis` (all of it when the whole position is sold), and realizes the reference value of the base sold, which is
 * the quote received plus the fee and slippage its own costs carry, less that share of `basis`.
 *
 * So, over a round trip, realized P&L minus both trades' fees and slippage is quote received minus quote paid, and
 * nothing is counted twice. A sell larger than the open size realizes against the whole basis and leaves the position
 * at 0; TradingService never builds one, and the chain refuses one the account cannot cover.
 */
export function applyFill(position: Position, record: TradeRecord): { position: Position; realized: bigint } {
  const { fill, costs } = record;
  if (record.status !== "filled" || !fill || !costs) return { position, realized: 0n };
  if (fill.side !== "sell") {
    return { position: { ...position, size: position.size + fill.baseOut, basis: position.basis + fill.quoteIn - costs.fees - costs.slippage }, realized: 0n };
  }
  const sold = fill.baseIn < position.size ? fill.baseIn : position.size;
  const basisOut = sold === position.size ? position.basis : (position.basis * sold) / position.size;
  const proceeds = fill.quoteOut + costs.fees + costs.slippage;
  const realized = proceeds - basisOut;
  return {
    position: { ...position, size: position.size - sold, basis: position.basis - basisOut, realized: position.realized + realized },
    realized,
  };
}

/**
 * Unrealized P&L of the open size: its value at the sell-side reference of `book` (the mid, else the best bid) less
 * its basis, settlement-asset base units. It is a mark, not a cash flow: it is reported, never fed to FitnessModule,
 * whose fitness inputs are realized (EVOLUTION.md section 2.1). Null when the book has no bid to mark against.
 */
export function unrealizedPnl(market: KuruMarket, position: Position, book: Book): bigint | null {
  if (position.size === 0n) return 0n;
  const reference = referencePrice(book, "sell");
  if (!reference) return null;
  return baseToQuote(position.size, reference.price, market) - position.basis;
}
