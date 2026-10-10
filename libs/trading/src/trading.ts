import { hashExecutionPlan } from "@monadeum/commitment";
import { type ActionProposal, type Decision, type ExecutionPlan } from "@monadeum/risk";
import { encodeFunctionData, zeroAddress, type Hex } from "viem";
import { costsOf, decodeFill } from "./fills.js";
import { ERC20_ABI, referencePrice, type KuruMarket } from "./market.js";
import { applyFill, emptyPosition, unrealizedPnl } from "./positions.js";
import {
  SignerRejected,
  type OperationReceipt,
  type OrderSnapshot,
  type Position,
  type PositionStore,
  type SellOrder,
  type TradeFailure,
  type TradeRecord,
  type TradeSigner,
  type TradeStore,
} from "./types.js";
import type { Venue } from "./venue.js";

export interface PreparedTrade {
  order: OrderSnapshot;
  plan: ExecutionPlan;
}

/**
 * Why no plan was built. For a close: `no-position` when nothing is open, `close-pending` while an earlier close may
 * still be in flight, and `native-sell` on a native-MON base market, which cannot be sold with a zero native value.
 */
export type PrepareResult =
  | { ok: true; trade: PreparedTrade }
  | {
      ok: false;
      reason:
        | "no-action" | "pair" | "notional" | "slippage" | "no-liquidity" | "no-quote" | "network"
        | "no-position" | "close-pending" | "native-sell";
    };

/** What reconciliation found for a tick. `resubmittable` means nothing for this tick exists anywhere it can look. */
export type Reconciled =
  | { state: "absent" }
  | { state: "resubmittable"; record: TradeRecord }
  | { state: "recorded"; record: TradeRecord };

const FINAL = new Set(["filled", "failed", "needs-review"]);

/**
 * Builds Kuru execution plans and submits approved ones, once per tick key (ARCHITECTURE.md section 11), and keeps
 * each agent's position on the market so a close realizes P&L.
 *
 * Order of a tick: `prepare` turns the proposal's TradeIntent into an ExecutionPlan (exact-amount approve, then the
 * router swap; a `long` intent buys, a `flat` intent sells the whole open position); the RiskModule evaluates that
 * plan; `submit` sends it only if the decision approved this exact plan hash. Every attempt, including a policy
 * rejection, is written to the TradeStore with the order and the failure. `settle` folds a final trade into the
 * position, once per tick key, and returns the realized P&L FitnessModule receives.
 */
export class TradingService {
  // In-process guard: one submission per tick key at a time in this process, set before the first await. Across
  // processes, the store's atomic claim and the signer's lookup contract are the guard.
  private readonly inflight = new Map<string, Promise<TradeRecord>>();

  constructor(
    private readonly market: KuruMarket,
    private readonly venue: Venue,
    private readonly signer: TradeSigner,
    private readonly store: TradeStore,
    private readonly positions: PositionStore,
  ) {
    if (market.base !== zeroAddress && !market.wrappedNativeBase) {
      throw new Error("the base must be native MON or wrap it one to one: gas converts at the market price");
    }
  }

  async prepare(proposal: ActionProposal): Promise<PrepareResult> {
    const intent = proposal.action;
    if (!intent || (intent.side !== "long" && intent.side !== "flat")) return { ok: false, reason: "no-action" };
    if (intent.pair !== this.market.pair) return { ok: false, reason: "pair" };
    const slip = intent.maxSlippageBps;
    if (!Number.isInteger(slip) || slip < 0 || slip >= 10_000) return { ok: false, reason: "slippage" };
    // A close sells what the position store holds, never an amount the proposal declares, so a flat notional is 0.
    if (intent.side === "flat") return intent.notional === 0n ? this.prepareClose(proposal, slip) : { ok: false, reason: "notional" };
    if (typeof intent.notional !== "bigint" || intent.notional <= 0n) return { ok: false, reason: "notional" };

    let book, takerFeeBps, expected, block;
    try {
      [book, takerFeeBps, block] = await Promise.all([this.venue.book(), this.venue.takerFeeBps(), this.venue.blockNumber()]);
      expected = await this.venue.quoteBuy(intent.notional);
    } catch {
      return { ok: false, reason: "network" };
    }
    const reference = referencePrice(book);
    if (!reference) return { ok: false, reason: "no-liquidity" };
    const minBaseOut = (expected * BigInt(10_000 - slip)) / 10_000n;
    if (minBaseOut <= 0n) return { ok: false, reason: "no-quote" };

    // Approve exactly the notional, never an unbounded amount (ARCHITECTURE.md section 16.3 counting rule).
    const approve = {
      target: this.market.quote,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [this.market.router, intent.notional] }),
    };
    let swap;
    try {
      swap = await this.venue.swapCall(proposal.account, intent.notional, minBaseOut);
    } catch {
      return { ok: false, reason: "network" };
    }
    const calls = [approve, swap];
    const order: OrderSnapshot = {
      tickKey: proposal.tickKey,
      agentId: proposal.agentId,
      account: proposal.account,
      pair: intent.pair,
      side: "buy",
      quoteIn: intent.notional,
      expectedBaseOut: expected,
      minBaseOut,
      maxSlippageBps: slip,
      reference,
      takerFeeBps,
      preparedAtBlock: block,
    };
    return { ok: true, trade: { order, plan: { tickKey: proposal.tickKey, calls, planHash: planHashOf(proposal.tickKey, calls) } } };
  }

  /**
   * A close: `approve(router, size)` on the base token, exactly the open size, then the router sell of that size with
   * `minAmountOut` set to the SDK quote less `maxSlippageBps`. Refused while an earlier close may be in flight.
   */
  private async prepareClose(proposal: ActionProposal, slip: number): Promise<PrepareResult> {
    if (this.market.base === zeroAddress) return { ok: false, reason: "native-sell" };
    const position = await this.openPosition(proposal.agentId);
    if (position === "close-pending") return { ok: false, reason: "close-pending" };
    if (position.size <= 0n) return { ok: false, reason: "no-position" };
    const size = position.size;

    let book, takerFeeBps, expected, block;
    try {
      [book, takerFeeBps, block] = await Promise.all([this.venue.book(), this.venue.takerFeeBps(), this.venue.blockNumber()]);
      expected = await this.venue.quoteSell(size);
    } catch {
      return { ok: false, reason: "network" };
    }
    const reference = referencePrice(book, "sell");
    if (!reference) return { ok: false, reason: "no-liquidity" };
    const minQuoteOut = (expected * BigInt(10_000 - slip)) / 10_000n;
    if (minQuoteOut <= 0n) return { ok: false, reason: "no-quote" };

    const approve = {
      target: this.market.base,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [this.market.router, size] }),
    };
    let sell;
    try {
      sell = await this.venue.sellCall(proposal.account, size, minQuoteOut);
    } catch {
      return { ok: false, reason: "network" };
    }
    const calls = [approve, sell];
    const order: SellOrder = {
      tickKey: proposal.tickKey,
      agentId: proposal.agentId,
      account: proposal.account,
      pair: this.market.pair,
      side: "sell",
      baseIn: size,
      expectedQuoteOut: expected,
      minQuoteOut,
      maxSlippageBps: slip,
      reference,
      takerFeeBps,
      preparedAtBlock: block,
    };
    return { ok: true, trade: { order, plan: { tickKey: proposal.tickKey, calls, planHash: planHashOf(proposal.tickKey, calls) } } };
  }

  /** The agent's position, after settling a close that has since become final; `close-pending` if one may be in flight. */
  private async openPosition(agentId: string): Promise<Position | "close-pending"> {
    const position = await this.position(agentId);
    if (!position.closing) return position;
    const record = await this.store.get(position.closing);
    // Absent, unresolved, or needing review: the close may have sold, so nothing else is sold until it is known.
    if (!record || (record.status !== "filled" && record.status !== "failed")) return "close-pending";
    await this.settle(record);
    return this.position(agentId);
  }

  /** The agent's position on this market; an empty one when it has never traded. */
  async position(agentId: string): Promise<Position> {
    return (await this.positions.get(agentId)) ?? emptyPosition(agentId, this.market.pair);
  }

  /** Unrealized P&L of the agent's open size at the current book, base units; reported only, never a fitness input. */
  async unrealized(agentId: string): Promise<bigint | null> {
    return unrealizedPnl(this.market, await this.position(agentId), await this.venue.book());
  }

  /**
   * Folds a final trade into its agent's position and returns the realized P&L it produced (0 for a buy or a failed
   * trade), settlement-asset base units. Idempotent by tick key: a trade already settled returns the same figure and
   * changes nothing. A filled or failed close releases the close marker; a close in `needs-review` keeps it, so no
   * further close is built until an operator resolves it. A trade that is not final settles nothing.
   */
  async settle(record: TradeRecord): Promise<bigint> {
    if (record.status !== "filled" && record.status !== "failed") return 0n;
    const current = await this.position(record.order.agentId);
    const release = current.closing === record.key ? { closing: null } : {};
    const done = current.applied[record.key];
    if (done !== undefined) {
      if (current.closing === record.key) await this.positions.write({ ...current, closing: null });
      return done;
    }
    const { position, realized } = applyFill(current, record);
    await this.positions.write({ ...position, ...release, applied: { ...current.applied, [record.key]: realized } });
    return realized;
  }

  /**
   * Marks a close as in flight before anything is sent, so no other tick builds a second sell of the same position.
   * False when a different close holds the mark. A tick whose own record is already final needs no mark.
   */
  private async markClosing(order: SellOrder): Promise<boolean> {
    const position = await this.position(order.agentId);
    if (position.closing === order.tickKey) return true;
    const existing = await this.store.get(order.tickKey);
    if (existing && FINAL.has(existing.status)) return true;
    if (position.closing !== null) return false;
    await this.positions.write({ ...position, closing: order.tickKey });
    return true;
  }

  /**
   * Submits an approved plan at most once per tick key. A second call for the same key never sends a second
   * operation blindly: it reconciles first, and resubmits the same plan only when neither the signer nor the chain
   * shows anything for that tick.
   */
  async submit(trade: PreparedTrade, decision: Decision): Promise<TradeRecord> {
    const { order, plan } = trade;
    const record: TradeRecord = {
      key: order.tickKey, order, planHash: plan.planHash, calls: plan.calls, status: "claimed",
      ref: null, fill: null, costs: null, failure: null,
    };

    const rejection = policyFailure(trade, decision);
    if (rejection) {
      const failed = { ...record, status: "failed" as const, failure: rejection };
      // Claimed like any other attempt, so a rejected tick cannot later be submitted under the same key.
      if (await this.store.claim(failed)) return failed;
      return (await this.store.get(order.tickKey))!;
    }

    if (order.side === "sell" && !(await this.markClosing(order))) {
      const blocked = { ...record, status: "failed" as const, failure: { kind: "execution" as const, reason: "another close of this position may be in flight" } };
      // Nothing was sent; the key is burned like a rejection so this tick cannot sell later.
      if (await this.store.claim(blocked)) return blocked;
      return (await this.store.get(order.tickKey))!;
    }

    // A concurrent submit for a key this process is already handling never reaches the signer.
    const running = this.inflight.get(order.tickKey);
    if (running) return (await this.store.get(order.tickKey)) ?? (await running);
    const work = this.claimAndSend(record);
    this.inflight.set(order.tickKey, work);
    try {
      return await work;
    } finally {
      this.inflight.delete(order.tickKey);
    }
  }

  private async claimAndSend(record: TradeRecord): Promise<TradeRecord> {
    if (await this.store.claim(record)) return this.send(record);
    const existing = (await this.store.get(record.key))!;
    if (existing.planHash !== record.planHash) return existing;
    const found = await this.reconcile(record.key);
    if (found.state !== "resubmittable") return found.state === "absent" ? existing : found.record;
    return this.send(found.record);
  }

  /**
   * Restart path. For a tick left `claimed` or `submitted`, asks the signer (bundler and chain) for the operation,
   * then checks Kuru's router logs for any swap by the account since the plan was built that no record accounts for.
   * Only when both come back empty is the tick resubmittable.
   */
  async reconcile(tickKey: string): Promise<Reconciled> {
    const record = await this.store.get(tickKey);
    if (!record) return { state: "absent" };
    if (FINAL.has(record.status)) return { state: "recorded", record };

    let status;
    try {
      status = await this.signer.lookup({ tickKey, account: record.order.account, ref: record.ref });
    } catch (error) {
      return { state: "recorded", record: await this.write(record, { failure: network(error) }) };
    }
    if (status.state === "included") return { state: "recorded", record: await this.finalize(record, status.ref, status.receipt) };
    if (status.state === "pending") return { state: "recorded", record: await this.write(record, { status: "submitted", ref: status.ref, failure: null }) };

    let swaps;
    try {
      swaps = await this.venue.swapsSince(record.order.account, record.order.preparedAtBlock);
    } catch (error) {
      return { state: "recorded", record: await this.write(record, { failure: network(error) }) };
    }
    const unattributed = [];
    for (const s of swaps) if (!(await this.store.findByTransaction(s.transactionHash))) unattributed.push(s);
    if (unattributed.length > 0) {
      const reason = `signer reports no operation, but the router shows unattributed swaps by this account: ${unattributed.map((s) => s.transactionHash).join(", ")}`;
      return { state: "recorded", record: await this.write(record, { status: "needs-review", failure: { kind: "execution", reason } }) };
    }
    return { state: "resubmittable", record: await this.write(record, { status: "claimed", ref: null }) };
  }

  private async send(record: TradeRecord): Promise<TradeRecord> {
    let ref: Hex;
    try {
      ({ ref } = await this.signer.submit({ tickKey: record.key, account: record.order.account, calls: record.calls }));
    } catch (error) {
      if (error instanceof SignerRejected) {
        return await this.write(record, { status: "failed", failure: { kind: "execution", reason: error.message } });
      }
      // Unknown outcome: stays claimed, and the next attempt reconciles before anything is resent.
      return await this.write(record, { failure: network(error) });
    }
    const submitted = await this.write(record, { status: "submitted", ref, failure: null });
    const found = await this.reconcile(record.key);
    return found.state === "absent" ? submitted : found.record;
  }

  private async finalize(record: TradeRecord, ref: Hex, receipt: OperationReceipt): Promise<TradeRecord> {
    if (!receipt.success) {
      return await this.write(record, {
        status: "failed", ref, costs: costsOf(this.market, record.order, receipt.gasCostWei, null),
        failure: { kind: "execution", reason: receipt.revertReason ?? "operation reverted without a reason" },
      });
    }
    const fill = decodeFill(this.market, record.order, receipt);
    if (!fill) {
      return await this.write(record, {
        status: "needs-review", ref, costs: costsOf(this.market, record.order, receipt.gasCostWei, null),
        failure: { kind: "execution", reason: `operation ${receipt.transactionHash} succeeded but no single swap by the account was decoded` },
      });
    }
    return await this.write(record, { status: "filled", ref, fill, costs: costsOf(this.market, record.order, receipt.gasCostWei, fill), failure: null });
  }

  private async write(record: TradeRecord, patch: Partial<TradeRecord>): Promise<TradeRecord> {
    const next = { ...record, ...patch };
    await this.store.write(next);
    // The trade record is durable first; a crash before the position is updated is repaired by the next `settle` of
    // this key (the worker's measurement, or the next close's `prepare`), which is idempotent.
    if (next.status === "filled" || next.status === "failed") await this.settle(next);
    return next;
  }
}

export function planHashOf(tickKey: string, calls: ExecutionPlan["calls"]): Hex {
  return hashExecutionPlan({ tickKey, calls });
}

function policyFailure(trade: PreparedTrade, decision: Decision): TradeFailure | null {
  if (!decision.approved) return { kind: "policy", reason: "rejected by the RiskModule", violations: [...decision.violations] };
  const recomputed = planHashOf(trade.plan.tickKey, trade.plan.calls);
  if (decision.planHash !== trade.plan.planHash || recomputed !== trade.plan.planHash || trade.plan.tickKey !== trade.order.tickKey) {
    return { kind: "policy", reason: "the plan presented is not the plan the RiskModule approved", violations: ["plan-hash-mismatch"] };
  }
  return null;
}

function network(error: unknown): TradeFailure {
  return { kind: "network", reason: error instanceof Error ? error.message : String(error) };
}
