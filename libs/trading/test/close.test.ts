import assert from "node:assert/strict";
import { test } from "node:test";
import { netEconomicPerformance } from "@monadeum/fitness";
import type { ActionProposal, Decision } from "@monadeum/risk";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Hex } from "viem";
import {
  KURU_MAINNET_WETH_USDC,
  KURU_TESTNET_MON_USDC,
  MemoryPositionStore,
  MemoryTradeStore,
  TradingService,
  DEFAULT_MON_PRICE_LIMITS,
  KuruBookMonPrice,
  applyFill,
  buildSellCall,
  emptyPosition,
  fixedMonPrice,
  toCostedFill,
  unrealizedPnl,
  type Call,
  type KuruMarket,
  type LogEntry,
  type MonPriceSource,
  type OperationReceipt,
  type SellFill,
  type SellOrder,
  type TradeRecord,
  type TradeSigner,
  type Venue,
} from "../src/index.js";
import { ERC20_ABI, ORDER_BOOK_ABI, ROUTER_ABI } from "../src/market.js";

// Closing a position: the sell plan, its fill, the position it settles into, and the guard against selling twice.
// The configured testnet market's base is native MON, which cannot be sold with a zero native value, so these tests
// use the default WETH/USDC market, with abstract prices (1.00 and 1.10 USDC per base unit) so the arithmetic is easy
// to follow, and a MON price for gas that tracks the book's mid.

const W: KuruMarket = KURU_MAINNET_WETH_USDC;
const WMON: Hex = W.base;
const ACCOUNT: Hex = "0x00000000000000000000000000000000000000aa";
const E16 = 10n ** 16n;
const BUY_CALL: Call = { target: W.router, data: "0xffa5210a01" };
const SELL_CALL: Call = { target: W.router, data: "0xffa5210a02" };
const GAS_WEI = 43n * 10n ** 15n; // 0.043 MON, 43_000 quote base units at a 1.00 reference, 47_300 at 1.10

function proposal(tick: number, side: "long" | "flat", notional = side === "long" ? 1_000_000n : 0n): ActionProposal {
  return {
    schemaVersion: 1, tickKey: `agent-1:${tick}`, agentId: "agent-1", account: ACCOUNT, genomeHash: "0x01", strategyType: "trading",
    state: { capital: 10_000_000n, principal: 10_000_000n, ticksSinceTrade: 3, observedAt: "2026-10-10T00:00:00Z" },
    information: [],
    action: { kind: "trade", pair: "WETH/USDC", side, notional, maxSlippageBps: 100 },
  };
}

const approved = (planHash: Hex): Decision => ({ approved: true, policyVersion: 1, policyHash: "0x00", planHash });

function swapLog(debit: Hex, credit: Hex, amountIn: bigint, amountOut: bigint): LogEntry {
  return {
    address: W.router,
    topics: encodeEventTopics({ abi: ROUTER_ABI, eventName: "KuruRouterSwap" }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("address, address, address, uint256, uint256"), [ACCOUNT, debit, credit, amountIn, amountOut]),
  };
}
function tradeLog(filledSize: bigint): LogEntry {
  return {
    address: W.market,
    topics: encodeEventTopics({ abi: ORDER_BOOK_ABI, eventName: "Trade" }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("uint40, address, bool, uint256, uint96, address, address, uint96"), [
      1, "0x00000000000000000000000000000000000000bb", false, 0n, 0n, W.router, ACCOUNT, filledSize,
    ]),
  };
}
const receipt = (logs: LogEntry[], hash: Hex): OperationReceipt => ({
  success: true, transactionHash: hash, blockNumber: 101n, gasCostWei: GAS_WEI, logs, revertReason: null,
});

// Buy 1 USDC at the ask: 0.995 WMON filled, 0.005 kept as the fee. Sell 0.99 WMON for 1.07 USDC.
const BUY_RECEIPT = receipt([swapLog(W.quote, WMON, 1_000_000n, 99n * E16), tradeLog((995n * 10n ** 15n * W.sizePrecision) / 10n ** 18n)], "0xb1");
const SELL_RECEIPT = receipt([swapLog(WMON, W.quote, 99n * E16, 1_070_000n)], "0x51");

function world() {
  const state = { book: { bid: 99n * E16, ask: 101n * E16 }, takerFeeBps: 0, monDown: false };
  const venue: Venue = {
    blockNumber: async () => 100n,
    book: async () => state.book,
    takerFeeBps: async () => state.takerFeeBps,
    quoteBuy: async () => 99n * E16,
    swapCall: async () => BUY_CALL,
    quoteSell: async () => 1_075_000n,
    sellCall: async () => SELL_CALL,
    swapsSince: async () => [],
  };
  const sent: { tickKey: string; calls: Call[] }[] = [];
  const outcomes = new Map<string, "included" | "unknown" | "absent">();
  const receipts = new Map<string, OperationReceipt>();
  const signer: TradeSigner = {
    submit: async (r) => {
      sent.push(r);
      if (outcomes.get(r.tickKey) === "unknown") throw new Error("socket hang up");
      return { ref: "0xabc" };
    },
    lookup: async ({ tickKey }) => {
      const outcome = outcomes.get(tickKey) ?? "included";
      if (outcome === "unknown") throw new Error("bundler unreachable");
      const r = receipts.get(tickKey);
      return outcome === "included" && r ? { state: "included", ref: "0xabc", receipt: r } : { state: "absent" };
    },
  };
  const trades = new MemoryTradeStore();
  const positions = new MemoryPositionStore();
  const mon: MonPriceSource = { quote: W.quote, monPrice: async () => (state.monDown ? null : { price: (state.book.bid + state.book.ask) / 2n, source: "test-mid", observedAt: 0n }) };
  const service = () => new TradingService(W, venue, signer, trades, positions, mon);
  return { state, sent, outcomes, receipts, trades, positions, service, venue, signer };
}

async function run(service: TradingService, p: ActionProposal): Promise<TradeRecord> {
  const prepared = await service.prepare(p);
  assert.ok(prepared.ok, prepared.ok ? "" : prepared.reason);
  return service.submit(prepared.trade, approved(prepared.trade.plan.planHash));
}

test("the SDK builds a sell of an ERC-20 base with zero native value, and refuses a native-MON base", async () => {
  const call = await buildSellCall(W, ACCOUNT, 99n * E16, 1_000_000n);
  assert.equal(call.target, W.router);
  const { functionName, args } = decodeFunctionData({ abi: ROUTER_ABI, data: call.data });
  assert.equal(functionName, "anyToAnySwap");
  const [markets, isBuy, nativeSend, debit, credit, amount, minOut] = args;
  assert.deepEqual(markets.map((a) => a.toLowerCase()), [W.market.toLowerCase()]);
  assert.deepEqual(isBuy, [false]);
  assert.deepEqual(nativeSend, [false]);
  assert.equal(debit.toLowerCase(), WMON.toLowerCase());
  assert.equal(credit.toLowerCase(), W.quote.toLowerCase());
  assert.equal(amount, 99n * E16);
  assert.equal(minOut, 1_000_000n);
  await assert.rejects(buildSellCall(KURU_TESTNET_MON_USDC, ACCOUNT, 1n, 1n), /native value/);
});

test("a round trip realizes P&L at reference prices, and realized P&L net of costs is the cash result", async () => {
  const w = world();
  w.receipts.set("agent-1:1", BUY_RECEIPT);
  w.receipts.set("agent-1:2", SELL_RECEIPT);
  const service = w.service();

  const buy = await run(service, proposal(1, "long"));
  assert.equal(buy.status, "filled");
  // Reference mid 1.00: fee 0.005 WMON = 5_000, slippage 1 - 0.995 = 5_000, so the basis is 0.99 USDC.
  assert.deepEqual(buy.costs, { gasWei: GAS_WEI, gas: 43_000n, fees: 5_000n, slippage: 5_000n });
  const open = await service.position("agent-1");
  assert.deepEqual([open.size, open.basis, open.closing], [99n * E16, 990_000n, null]);
  w.state.book = { bid: 109n * E16, ask: 111n * E16 };
  assert.equal(await service.unrealized("agent-1"), 1_089_000n - 990_000n);

  const prepared = await service.prepare(proposal(2, "flat"));
  assert.ok(prepared.ok);
  const order = prepared.trade.order as SellOrder;
  assert.equal(order.side, "sell");
  assert.equal(order.baseIn, 99n * E16, "the whole open size, read from the position store");
  assert.equal(order.minQuoteOut, (1_075_000n * 9_900n) / 10_000n);
  assert.deepEqual(order.reference, { kind: "mid", price: 110n * E16 });
  const [approve, sell] = prepared.trade.plan.calls;
  assert.equal(approve!.target, WMON, "the approve is on the base token, not the settlement asset");
  assert.deepEqual(decodeFunctionData({ abi: ERC20_ABI, data: approve!.data }).args, [W.router, 99n * E16]);
  assert.deepEqual(sell, SELL_CALL);

  const close = await service.submit(prepared.trade, approved(prepared.trade.plan.planHash));
  assert.equal(close.status, "filled");
  const fill = close.fill as SellFill;
  assert.deepEqual([fill.side, fill.baseIn, fill.quoteOut, fill.feeQuote], ["sell", 99n * E16, 1_070_000n, 0n]);
  // Reference mid 1.10: 0.99 WMON is worth 1.089 USDC, received 1.07, so slippage is 0.019.
  assert.deepEqual(close.costs, { gasWei: GAS_WEI, gas: 47_300n, fees: 0n, slippage: 19_000n });
  const realized = await service.settle(close);
  assert.equal(realized, 1_089_000n - 990_000n);
  assert.equal(await service.settle(close), realized, "settling again changes nothing");
  assert.equal(await service.settle(buy), 0n);
  const flat = await service.position("agent-1");
  assert.deepEqual([flat.size, flat.basis, flat.realized, flat.closing], [0n, 0n, 99_000n, null]);

  const entries = [toCostedFill(buy, 6, await service.settle(buy))!, toCostedFill(close, 6, realized)!];
  const cash = (1_070_000 - 1_000_000 - 43_000 - 47_300) / 1e6;
  assert.ok(Math.abs(netEconomicPerformance(entries) - cash) < 1e-12, "realized minus fees, slippage, and gas is quote out minus quote in minus gas");
  assert.deepEqual(await service.prepare(proposal(3, "flat")), { ok: false, reason: "no-position" });
  assert.equal(w.sent.length, 2);
});

test("a crash mid-close never sells twice: the close mark blocks other ticks until the first close is reconciled", async () => {
  const w = world();
  w.receipts.set("agent-1:1", BUY_RECEIPT);
  await run(w.service(), proposal(1, "long"));

  // Two ticks build a close before either is sent; the first is sent and its outcome is lost.
  const first = await w.service().prepare(proposal(2, "flat"));
  const second = await w.service().prepare(proposal(3, "flat"));
  assert.ok(first.ok && second.ok);
  w.outcomes.set("agent-1:2", "unknown");
  const pending = await w.service().submit(first.trade, approved(first.trade.plan.planHash));
  assert.equal(pending.status, "claimed", "outcome unknown: stays open for reconciliation");
  assert.equal((await w.positions.get("agent-1"))!.closing, "agent-1:2");

  const blocked = await w.service().submit(second.trade, approved(second.trade.plan.planHash));
  assert.equal(blocked.status, "failed");
  assert.match(blocked.failure!.reason, /another close/);
  assert.deepEqual(await w.service().prepare(proposal(4, "flat")), { ok: false, reason: "close-pending" });
  assert.equal(w.sent.filter((s) => s.tickKey !== "agent-1:1").length, 1, "only the first close reached the signer");

  // Restart: the same tick resumes, the signer finds the included operation, and the position settles once.
  w.outcomes.set("agent-1:2", "included");
  w.receipts.set("agent-1:2", SELL_RECEIPT);
  const restarted = w.service();
  const filled = await restarted.submit(first.trade, approved(first.trade.plan.planHash));
  assert.equal(filled.status, "filled");
  assert.equal(w.sent.filter((s) => s.tickKey === "agent-1:2").length, 1, "reconciled, not resent");
  const position = await restarted.position("agent-1");
  assert.deepEqual([position.size, position.closing], [0n, null]);
  // The reference did not move (mid 1.00), so the close realizes nothing; selling above it is negative slippage.
  assert.equal(position.realized, 0n);
  assert.equal(filled.costs!.slippage, 990_000n - 1_070_000n);
  assert.deepEqual(await restarted.prepare(proposal(5, "flat")), { ok: false, reason: "no-position" });
});

test("a close whose operation reverted releases the mark and leaves the position open", async () => {
  const w = world();
  w.receipts.set("agent-1:1", BUY_RECEIPT);
  w.receipts.set("agent-1:2", { ...SELL_RECEIPT, success: false, logs: [], revertReason: "slippage" });
  const service = w.service();
  await run(service, proposal(1, "long"));
  const failed = await run(service, proposal(2, "flat"));
  assert.equal(failed.status, "failed");
  const position = await service.position("agent-1");
  assert.deepEqual([position.size, position.closing], [99n * E16, null]);
  assert.ok((await service.prepare(proposal(3, "flat"))).ok, "the next tick may close again");
});

test("average cost: a partial sell realizes against its share of the basis, and the mark needs a bid", () => {
  const record = (fill: SellFill): TradeRecord => ({
    key: "k", order: {} as SellOrder, planHash: "0x00", calls: [], status: "filled", ref: null, fill,
    costs: { gasWei: 0n, gas: 0n, fees: 3_000n, slippage: 7_000n }, failure: null,
  });
  const open = { ...emptyPosition("a", "MON/USDC"), size: 4n * 10n ** 18n, basis: 4_000_000n };
  const { position, realized } = applyFill(open, record({
    side: "sell", transactionHash: "0x01", blockNumber: 1n, baseIn: 10n ** 18n, quoteOut: 1_190_000n, grossQuoteOut: 1_193_000n,
    feeSource: "taker-fee-bps", feeQuote: 3_000n, executedPrice: 0n,
  }));
  assert.equal(realized, 1_190_000n + 3_000n + 7_000n - 1_000_000n);
  assert.deepEqual([position.size, position.basis, position.realized], [3n * 10n ** 18n, 3_000_000n, 200_000n]);
  assert.equal(unrealizedPnl(W, position, { bid: 0n, ask: 101n * E16 }), null);
  assert.equal(unrealizedPnl(W, position, { bid: 120n * E16, ask: 0n }), 3_600_000n - 3_000_000n);
});

test("off a native-MON market, gas converts at the MON price, and no plan is built without one", async () => {
  const stores = () => [new MemoryTradeStore(), new MemoryPositionStore()] as const;
  assert.throws(() => new TradingService(W, {} as Venue, {} as TradeSigner, ...stores()), /MON price source/);
  assert.throws(() => new TradingService(W, {} as Venue, {} as TradeSigner, ...stores(), fixedMonPrice(KURU_TESTNET_MON_USDC.quote)), /quote asset/);

  const w = world();
  w.receipts.set("agent-1:1", BUY_RECEIPT);
  w.state.monDown = true;
  assert.deepEqual(await w.service().prepare(proposal(1, "long")), { ok: false, reason: "gas-price" });
  assert.equal(w.sent.length, 0);

  const service = new TradingService(W, w.venue, w.signer, ...stores(), fixedMonPrice(W.quote, 25n * 10n ** 15n));
  const prepared = await service.prepare(proposal(1, "long"));
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.trade.order.monPrice, { price: 25n * 10n ** 15n, source: "fixed" });
  const record = await service.submit(prepared.trade, approved(prepared.trade.plan.planHash));
  assert.equal(record.costs!.gas, 1_075n, "0.043 MON at 0.025 USDC per MON, not at the base's 1.00 reference");
});

test("the Kuru book MON price fails closed on an empty, wide, or stale book, and on a read error", async () => {
  const now = 1_790_000_000_000;
  const head = BigInt(now / 1000);
  const at = (book: { bid: bigint; ask: bigint }, blockTimestamp = head, fail = false) =>
    new KuruBookMonPrice(
      {
        read: async () => {
          if (fail) throw new Error("rpc");
          return { book, blockTimestamp };
        },
      },
      W.quote,
      DEFAULT_MON_PRICE_LIMITS,
      () => now,
    );
  const healthy = { bid: 24_930n * 10n ** 12n, ask: 24_975n * 10n ** 12n };
  assert.deepEqual(await at(healthy).monPrice(), { price: (healthy.bid + healthy.ask) / 2n, source: "kuru-mon-usdc-mid", observedAt: head });
  assert.equal(await at({ bid: 0n, ask: healthy.ask }).monPrice(), null, "no bid");
  assert.equal(await at({ bid: healthy.bid, ask: 2n ** 256n - 1n }).monPrice(), null, "no ask");
  assert.equal(await at({ bid: 24_000n * 10n ** 12n, ask: 25_000n * 10n ** 12n }).monPrice(), null, "about 408 bps wide");
  assert.equal(await at(healthy, head - 61n).monPrice(), null, "a block more than 60 seconds old");
  assert.equal(await at(healthy, head, true).monPrice(), null, "read error");
});
