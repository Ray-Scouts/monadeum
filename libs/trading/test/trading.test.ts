import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionProposal, Decision } from "@monadeum/risk";
import { netEconomicPerformance } from "@monadeum/fitness";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Hex } from "viem";
import {
  ISSUE_20,
  KURU_TESTNET_MON_USDC as M,
  MemoryTradeStore,
  SignerRejected,
  TradingService,
  buildSwapCall,
  chargedGasWei,
  estimateTradeCost,
  planHashOf,
  toCostedFill,
  type Call,
  type LogEntry,
  type OperationReceipt,
  type OperationStatus,
  type PreparedTrade,
  type TradeSigner,
  type Venue,
} from "../src/index.js";
import { ERC20_ABI, ORDER_BOOK_ABI, ROUTER_ABI } from "../src/market.js";

const ACCOUNT: Hex = "0x00000000000000000000000000000000000000aa";
const E18 = 10n ** 18n;
// Book in the 1e18 scale `bestBidAsk` returns: bid 0.99, ask 1.01 USDC per MON, mid 1.00.
const BOOK = { bid: 99n * 10n ** 16n, ask: 101n * 10n ** 16n };
const SWAP_CALL: Call = { target: M.router, data: "0xffa5210a" };

function proposal(overrides: Partial<NonNullable<ActionProposal["action"]>> = {}, tick = 7): ActionProposal {
  return {
    schemaVersion: 1, tickKey: `agent-1:${tick}`, agentId: "agent-1", account: ACCOUNT, genomeHash: "0x01", strategyType: "trading",
    state: { capital: 10_000_000n, principal: 10_000_000n, ticksSinceTrade: 3, observedAt: "2026-10-09T00:00:00Z" },
    information: [],
    action: { kind: "trade", pair: "MON/USDC", side: "long", notional: 1_000_000n, maxSlippageBps: 50, ...overrides },
  };
}

function venue(overrides: Partial<Venue> = {}) {
  const calls = { swapsSince: 0 };
  const v: Venue = {
    blockNumber: async () => 100n,
    book: async () => BOOK,
    takerFeeBps: async () => 0,
    quoteBuy: async () => 99n * 10n ** 16n, // 0.99 MON for 1 USDC
    swapCall: async () => SWAP_CALL,
    swapsSince: async () => {
      calls.swapsSince++;
      return [];
    },
    ...overrides,
  };
  return { v, calls };
}

function signer(script: { submit?: () => Promise<{ ref: Hex }>; lookup?: () => Promise<OperationStatus> } = {}) {
  const sent: { tickKey: string; calls: Call[] }[] = [];
  const s: TradeSigner = {
    submit: async (r) => {
      sent.push(r);
      return script.submit ? script.submit() : { ref: "0xabc" };
    },
    lookup: async () => (script.lookup ? script.lookup() : { state: "absent" }),
  };
  return { s, sent };
}

const approved = (planHash: Hex): Decision => ({ approved: true, policyVersion: 1, policyHash: "0x00", planHash });

function swapLog(amountIn: bigint, amountOut: bigint, sender: Hex = ACCOUNT): LogEntry {
  return {
    address: M.router,
    topics: encodeEventTopics({ abi: ROUTER_ABI, eventName: "KuruRouterSwap" }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("address, address, address, uint256, uint256"), [sender, M.quote, M.base, amountIn, amountOut]),
  };
}
function tradeLog(filledSize: bigint): LogEntry {
  return {
    address: M.market,
    topics: encodeEventTopics({ abi: ORDER_BOOK_ABI, eventName: "Trade" }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("uint40, address, bool, uint256, uint96, address, address, uint96"), [
      1, "0x00000000000000000000000000000000000000bb", false, 0n, 0n, M.router, ACCOUNT, filledSize,
    ]),
  };
}
function receipt(logs: LogEntry[], overrides: Partial<OperationReceipt> = {}): OperationReceipt {
  return { success: true, transactionHash: "0xfeed", blockNumber: 101n, gasCostWei: 43_000_000_000_000_000n, logs, revertReason: null, ...overrides };
}

async function prepared(service: TradingService, p = proposal()): Promise<PreparedTrade> {
  const r = await service.prepare(p);
  assert.ok(r.ok);
  return r.trade;
}

test("prepare builds an exact-amount approve then the router swap, with minOut from the quote and the slippage bound", async () => {
  const { v } = venue();
  const service = new TradingService(M, v, signer().s, new MemoryTradeStore());
  const trade = await prepared(service);
  const [approve, swap] = trade.plan.calls;
  assert.equal(approve!.target, M.quote);
  const decoded = decodeFunctionData({ abi: ERC20_ABI, data: approve!.data });
  assert.deepEqual(decoded.args, [M.router, 1_000_000n]);
  assert.deepEqual(swap, SWAP_CALL);
  assert.equal(trade.order.minBaseOut, (99n * 10n ** 16n * 9_950n) / 10_000n);
  assert.deepEqual(trade.order.reference, { kind: "mid", price: E18 });
  assert.equal(trade.plan.planHash, planHashOf("agent-1:7", trade.plan.calls));
});

test("prepare declines flat, a foreign pair, a bad slippage bound, and an empty book without building anything", async () => {
  const service = new TradingService(M, venue().v, signer().s, new MemoryTradeStore());
  assert.deepEqual(await service.prepare(proposal({ side: "flat" })), { ok: false, reason: "no-action" });
  assert.deepEqual(await service.prepare(proposal({ pair: "ETH/USDC" })), { ok: false, reason: "pair" });
  assert.deepEqual(await service.prepare(proposal({ maxSlippageBps: 10_000 })), { ok: false, reason: "slippage" });
  const empty = new TradingService(M, venue({ book: async () => ({ bid: 0n, ask: 0n }) }).v, signer().s, new MemoryTradeStore());
  assert.deepEqual(await empty.prepare(proposal()), { ok: false, reason: "no-liquidity" });
  const down = new TradingService(M, venue({ quoteBuy: async () => { throw new Error("rpc"); } }).v, signer().s, new MemoryTradeStore());
  assert.deepEqual(await down.prepare(proposal()), { ok: false, reason: "network" });
});

test("a filled trade records executed price, size, fee, slippage, and gas, and feeds fitness cost accounting", async () => {
  // Paid 1 USDC, received 0.99 MON; Trade events show 0.995 MON gross, so 0.005 MON went to the fee.
  const gross = (995n * 10n ** 15n * M.sizePrecision) / E18;
  const { s, sent } = signer({ lookup: async () => ({ state: "included", ref: "0xabc", receipt: receipt([swapLog(1_000_000n, 99n * 10n ** 16n), tradeLog(gross)]) }) });
  const store = new MemoryTradeStore();
  const service = new TradingService(M, venue().v, s, store);
  const trade = await prepared(service);
  const record = await service.submit(trade, approved(trade.plan.planHash));

  assert.equal(sent.length, 1);
  assert.equal(record.status, "filled");
  assert.equal(record.fill!.quoteIn, 1_000_000n);
  assert.equal(record.fill!.baseOut, 99n * 10n ** 16n);
  assert.equal(record.fill!.feeSource, "trade-events");
  assert.equal(record.fill!.feeBase, 5n * 10n ** 15n);
  assert.equal(record.fill!.executedPrice, (E18 * 100n) / 99n);
  // At mid 1.00: fee 0.005 USDC, slippage 1 - 0.995 = 0.005 USDC, gas 0.043 MON = 0.043 USDC.
  assert.deepEqual(record.costs, { gasWei: 43n * 10n ** 15n, gas: 43_000n, fees: 5_000n, slippage: 5_000n });
  const costed = toCostedFill(record, M.quoteDecimals)!;
  assert.deepEqual(costed, { realizedPnl: 0, x402: 0, gas: 0.043, fees: 0.005, slippage: 0.005 });
  assert.ok(Math.abs(netEconomicPerformance([costed]) + 0.053) < 1e-12);
  assert.deepEqual(await store.get("agent-1:7"), record);
});

test("without Trade events the fee falls back to the market's taker fee rate", async () => {
  const { s } = signer({ lookup: async () => ({ state: "included", ref: "0xabc", receipt: receipt([swapLog(1_000_000n, 99n * 10n ** 16n)]) }) });
  const service = new TradingService(M, venue({ takerFeeBps: async () => 0 }).v, s, new MemoryTradeStore());
  const trade = await prepared(service);
  const record = await service.submit(trade, approved(trade.plan.planHash));
  assert.equal(record.fill!.feeSource, "taker-fee-bps");
  assert.equal(record.fill!.feeBase, 0n);
  assert.equal(record.costs!.slippage, 10_000n);
});

test("a policy rejection is logged with its violations, never sent, and blocks the tick key", async () => {
  const { s, sent } = signer();
  const store = new MemoryTradeStore();
  const service = new TradingService(M, venue().v, s, store);
  const trade = await prepared(service);
  const rejected: Decision = { approved: false, policyVersion: 1, policyHash: "0x00", violations: ["per-action-cap"] };
  const record = await service.submit(trade, rejected);
  assert.equal(record.status, "failed");
  assert.deepEqual(record.failure, { kind: "policy", reason: "rejected by the RiskModule", violations: ["per-action-cap"] });
  assert.equal(record.order.quoteIn, 1_000_000n);
  assert.equal((await service.submit(trade, approved(trade.plan.planHash))).status, "failed");
  assert.equal(sent.length, 0);
});

test("a plan that differs from the approved hash is refused as a policy failure", async () => {
  const { s, sent } = signer();
  const service = new TradingService(M, venue().v, s, new MemoryTradeStore());
  const trade = await prepared(service);
  const tampered = { ...trade, plan: { ...trade.plan, calls: [trade.plan.calls[0]!, { target: M.router, data: "0xdeadbeef" as Hex }] } };
  const record = await service.submit(tampered, approved(trade.plan.planHash));
  assert.equal(record.failure?.kind, "policy");
  assert.deepEqual(record.failure?.violations, ["plan-hash-mismatch"]);
  assert.equal(sent.length, 0);
});

test("an on-chain revert is an execution failure with its reason, and the gas it paid is still costed", async () => {
  const { s } = signer({ lookup: async () => ({ state: "included", ref: "0xabc", receipt: receipt([], { success: false, revertReason: "TooMuchSlippage" }) }) });
  const service = new TradingService(M, venue().v, s, new MemoryTradeStore());
  const trade = await prepared(service);
  const record = await service.submit(trade, approved(trade.plan.planHash));
  assert.equal(record.status, "failed");
  assert.deepEqual(record.failure, { kind: "execution", reason: "TooMuchSlippage" });
  assert.equal(record.costs!.gas, 43_000n);
  assert.deepEqual(toCostedFill(record, M.quoteDecimals), { realizedPnl: 0, x402: 0, gas: 0.043, fees: 0, slippage: 0 });
});

test("a bundler rejection is an execution failure; an unreachable signer is a network failure that stays claimed", async () => {
  const rejected = signer({ submit: async () => { throw new SignerRejected("AA23 reverted"); } });
  const a = new TradingService(M, venue().v, rejected.s, new MemoryTradeStore());
  const ta = await prepared(a);
  const ra = await a.submit(ta, approved(ta.plan.planHash));
  assert.equal(ra.status, "failed");
  assert.deepEqual(ra.failure, { kind: "execution", reason: "AA23 reverted" });

  const down = signer({ submit: async () => { throw new Error("ECONNRESET"); } });
  const b = new TradingService(M, venue().v, down.s, new MemoryTradeStore());
  const tb = await prepared(b);
  const rb = await b.submit(tb, approved(tb.plan.planHash));
  assert.equal(rb.status, "claimed");
  assert.deepEqual(rb.failure, { kind: "network", reason: "ECONNRESET" });
});

test("a retried tick does not resubmit when the signer finds the operation pending or included", async () => {
  let status: OperationStatus = { state: "pending", ref: "0xabc" };
  const { s, sent } = signer({ lookup: async () => status });
  const store = new MemoryTradeStore();
  const service = new TradingService(M, venue().v, s, store);
  const trade = await prepared(service);
  assert.equal((await service.submit(trade, approved(trade.plan.planHash))).status, "submitted");

  // A restarted worker rebuilds the service over the same durable store and retries the same tick.
  const restarted = new TradingService(M, venue().v, s, store);
  assert.equal((await restarted.submit(trade, approved(trade.plan.planHash))).status, "submitted");
  status = { state: "included", ref: "0xabc", receipt: receipt([swapLog(1_000_000n, 99n * 10n ** 16n)]) };
  assert.equal((await restarted.submit(trade, approved(trade.plan.planHash))).status, "filled");
  assert.equal((await restarted.submit(trade, approved(trade.plan.planHash))).status, "filled");
  assert.equal(sent.length, 1);
});

test("a crash between send and record is reconciled from the signer by tick key, without resending", async () => {
  const store = new MemoryTradeStore();
  const first = signer({ submit: async () => { throw new Error("process killed"); } });
  const service = new TradingService(M, venue().v, first.s, store);
  const trade = await prepared(service);
  await service.submit(trade, approved(trade.plan.planHash));
  assert.equal((await store.get("agent-1:7"))!.ref, null);

  const after = signer({ lookup: async () => ({ state: "included", ref: "0xabc", receipt: receipt([swapLog(1_000_000n, 99n * 10n ** 16n)]) }) });
  const restarted = new TradingService(M, venue().v, after.s, store);
  const found = await restarted.reconcile("agent-1:7");
  assert.equal(found.state, "recorded");
  assert.equal((await store.get("agent-1:7"))!.status, "filled");
  assert.equal(after.sent.length, 0);
});

test("when the signer finds nothing but the router shows an unattributed swap, the tick goes to review, not resubmission", async () => {
  const store = new MemoryTradeStore();
  const down = signer({ submit: async () => { throw new Error("timeout"); } });
  const trade = await prepared(new TradingService(M, venue().v, down.s, store));
  await new TradingService(M, venue().v, down.s, store).submit(trade, approved(trade.plan.planHash));

  const { v } = venue({ swapsSince: async () => [{ transactionHash: "0xbeef", blockNumber: 101n }] });
  const later = signer();
  const record = await new TradingService(M, v, later.s, store).submit(trade, approved(trade.plan.planHash));
  assert.equal(record.status, "needs-review");
  assert.match(record.failure!.reason, /0xbeef/);
  assert.equal(later.sent.length, 0);
});

test("when neither the signer nor the router shows anything, the same plan is resubmitted once", async () => {
  const store = new MemoryTradeStore();
  const down = signer({ submit: async () => { throw new Error("timeout"); } });
  const service = new TradingService(M, venue().v, down.s, store);
  const trade = await prepared(service);
  await service.submit(trade, approved(trade.plan.planHash));

  const { v, calls } = venue();
  // First lookup is the pre-send reconciliation (nothing found); the second follows the resend.
  const answers: OperationStatus[] = [{ state: "absent" }, { state: "pending", ref: "0xdef" }];
  const later = signer({ lookup: async () => answers.shift()! });
  const retried = new TradingService(M, v, later.s, store);
  const record = await retried.submit(trade, approved(trade.plan.planHash));
  assert.equal(calls.swapsSince, 1);
  assert.equal(later.sent.length, 1);
  assert.deepEqual(later.sent[0]!.calls, trade.plan.calls);
  assert.equal(record.status, "submitted");
  assert.equal(record.ref, "0xdef");
});

test("a different plan for an already claimed tick is never sent", async () => {
  const { s, sent } = signer({ lookup: async () => ({ state: "pending", ref: "0xabc" }) });
  const service = new TradingService(M, venue().v, s, new MemoryTradeStore());
  const trade = await prepared(service);
  await service.submit(trade, approved(trade.plan.planHash));
  const other = await prepared(new TradingService(M, venue({ quoteBuy: async () => 5n * 10n ** 17n }).v, s, new MemoryTradeStore()));
  await service.submit(other, approved(other.plan.planHash));
  assert.equal(sent.length, 1);
});

test("concurrent submits for one tick reach the signer once", async () => {
  const { s, sent } = signer({ lookup: async () => ({ state: "pending", ref: "0xabc" }) });
  const service = new TradingService(M, venue().v, s, new MemoryTradeStore());
  const trade = await prepared(service);
  await Promise.all([1, 2, 3].map(() => service.submit(trade, approved(trade.plan.planHash))));
  assert.equal(sent.length, 1);
});

test("the Kuru SDK builds router calldata offline that decodes as the anyToAnySwap issue #20 measured", async () => {
  const call = await buildSwapCall(M, ACCOUNT, 1_000_000n, 123n);
  assert.equal(call.target, M.router);
  const { functionName, args } = decodeFunctionData({ abi: ROUTER_ABI, data: call.data });
  assert.equal(functionName, "anyToAnySwap");
  const [markets, isBuy, nativeSend, debit, credit, amount, minOut] = args;
  assert.deepEqual(markets.map((a) => a.toLowerCase()), [M.market.toLowerCase()]);
  assert.deepEqual(isBuy, [true]);
  assert.deepEqual(nativeSend, [false]);
  assert.equal(debit.toLowerCase(), M.quote.toLowerCase());
  assert.equal(credit.toLowerCase(), M.base.toLowerCase());
  assert.equal(amount, 1_000_000n);
  assert.equal(minOut, 123n);
});

test("cost estimation uses the issue #20 measured gas and fee, not the $0.001 and 10 bps assumptions", () => {
  assert.equal(ISSUE_20.routerSwapGas, 389_331n);
  assert.equal(ISSUE_20.takerFeeBps, 0);
  // (389,331 + 10%) x 102 gwei, charged on the limit.
  assert.equal(chargedGasWei(ISSUE_20.routerSwapGas, ISSUE_20.gasPriceWei), 428_264n * 102_000_000_000n);
  const estimate = estimateTradeCost(M, { notional: 1_000_000n, book: BOOK })!;
  assert.equal(estimate.fees, 0n);
  assert.equal(estimate.halfSpread, 10_000n);
  assert.equal(estimate.gas, (428_264n * 102_000_000_000n) / 10n ** 12n);
  assert.equal(estimate.total, estimate.gas + estimate.halfSpread!);
  assert.equal(estimateTradeCost(M, { notional: 1n, book: { bid: 0n, ask: BOOK.ask } })!.halfSpread, null);
});
