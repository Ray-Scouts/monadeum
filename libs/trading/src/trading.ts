import { hashOf, type ActionProposal, type Decision, type ExecutionPlan } from "@monadeum/risk";
import { encodeFunctionData, zeroAddress, type Hex } from "viem";
import { costsOf, decodeFill } from "./fills.js";
import { ERC20_ABI, referencePrice, type KuruMarket } from "./market.js";
import {
  SignerRejected,
  type OperationReceipt,
  type OrderSnapshot,
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

export type PrepareResult =
  | { ok: true; trade: PreparedTrade }
  | { ok: false; reason: "no-action" | "pair" | "notional" | "slippage" | "no-liquidity" | "no-quote" | "network" };

/** What reconciliation found for a tick. `resubmittable` means nothing for this tick exists anywhere it can look. */
export type Reconciled =
  | { state: "absent" }
  | { state: "resubmittable"; record: TradeRecord }
  | { state: "recorded"; record: TradeRecord };

const FINAL = new Set(["filled", "failed", "needs-review"]);

/**
 * Builds Kuru execution plans and submits approved ones, once per tick key (ARCHITECTURE.md section 11).
 *
 * Order of a tick: `prepare` turns the proposal's TradeIntent into an ExecutionPlan (exact-amount approve, then the
 * router swap); the RiskModule evaluates that plan; `submit` sends it only if the decision approved this exact plan
 * hash. Every attempt, including a policy rejection, is written to the TradeStore with the order and the failure.
 */
export class TradingService {
  // In-process guard for the reconcile-then-resend path. Across processes, the signer's lookup contract is the guard.
  private readonly inflight = new Set<string>();

  constructor(
    private readonly market: KuruMarket,
    private readonly venue: Venue,
    private readonly signer: TradeSigner,
    private readonly store: TradeStore,
  ) {
    if (market.base !== zeroAddress) throw new Error("only a native-MON base market is supported: gas converts at the market price");
  }

  async prepare(proposal: ActionProposal): Promise<PrepareResult> {
    const intent = proposal.action;
    // "flat" means no position, which the worker treats as no action (libs/tick); there is nothing to sell into.
    if (!intent || intent.side !== "long") return { ok: false, reason: "no-action" };
    if (intent.pair !== this.market.pair) return { ok: false, reason: "pair" };
    if (typeof intent.notional !== "bigint" || intent.notional <= 0n) return { ok: false, reason: "notional" };
    const slip = intent.maxSlippageBps;
    if (!Number.isInteger(slip) || slip < 0 || slip >= 10_000) return { ok: false, reason: "slippage" };

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
      if (this.store.claim(failed)) return failed;
      return this.store.get(order.tickKey)!;
    }

    // Claimed before any await, so two concurrent submits for one key cannot both reach the signer.
    if (!this.store.claim(record)) {
      const existing = this.store.get(order.tickKey)!;
      if (existing.planHash !== plan.planHash || this.inflight.has(order.tickKey)) return existing;
      this.inflight.add(order.tickKey);
      try {
        const found = await this.reconcile(order.tickKey);
        if (found.state !== "resubmittable") return found.state === "absent" ? existing : found.record;
        return await this.send(found.record);
      } finally {
        this.inflight.delete(order.tickKey);
      }
    }
    this.inflight.add(order.tickKey);
    try {
      return await this.send(record);
    } finally {
      this.inflight.delete(order.tickKey);
    }
  }

  /**
   * Restart path. For a tick left `claimed` or `submitted`, asks the signer (bundler and chain) for the operation,
   * then checks Kuru's router logs for any swap by the account since the plan was built that no record accounts for.
   * Only when both come back empty is the tick resubmittable.
   */
  async reconcile(tickKey: string): Promise<Reconciled> {
    const record = this.store.get(tickKey);
    if (!record) return { state: "absent" };
    if (FINAL.has(record.status)) return { state: "recorded", record };

    let status;
    try {
      status = await this.signer.lookup({ tickKey, account: record.order.account, ref: record.ref });
    } catch (error) {
      return { state: "recorded", record: this.write(record, { failure: network(error) }) };
    }
    if (status.state === "included") return { state: "recorded", record: this.finalize(record, status.ref, status.receipt) };
    if (status.state === "pending") return { state: "recorded", record: this.write(record, { status: "submitted", ref: status.ref, failure: null }) };

    let swaps;
    try {
      swaps = await this.venue.swapsSince(record.order.account, record.order.preparedAtBlock);
    } catch (error) {
      return { state: "recorded", record: this.write(record, { failure: network(error) }) };
    }
    const unattributed = swaps.filter((s) => !this.store.findByTransaction(s.transactionHash));
    if (unattributed.length > 0) {
      const reason = `signer reports no operation, but the router shows unattributed swaps by this account: ${unattributed.map((s) => s.transactionHash).join(", ")}`;
      return { state: "recorded", record: this.write(record, { status: "needs-review", failure: { kind: "execution", reason } }) };
    }
    return { state: "resubmittable", record: this.write(record, { status: "claimed", ref: null }) };
  }

  private async send(record: TradeRecord): Promise<TradeRecord> {
    let ref: Hex;
    try {
      ({ ref } = await this.signer.submit({ tickKey: record.key, account: record.order.account, calls: record.calls }));
    } catch (error) {
      if (error instanceof SignerRejected) {
        return this.write(record, { status: "failed", failure: { kind: "execution", reason: error.message } });
      }
      // Unknown outcome: stays claimed, and the next attempt reconciles before anything is resent.
      return this.write(record, { failure: network(error) });
    }
    const submitted = this.write(record, { status: "submitted", ref, failure: null });
    const found = await this.reconcile(record.key);
    return found.state === "absent" ? submitted : found.record;
  }

  private finalize(record: TradeRecord, ref: Hex, receipt: OperationReceipt): TradeRecord {
    if (!receipt.success) {
      return this.write(record, {
        status: "failed", ref, costs: costsOf(this.market, record.order, receipt.gasCostWei, null),
        failure: { kind: "execution", reason: receipt.revertReason ?? "operation reverted without a reason" },
      });
    }
    const fill = decodeFill(this.market, record.order, receipt);
    if (!fill) {
      return this.write(record, {
        status: "needs-review", ref, costs: costsOf(this.market, record.order, receipt.gasCostWei, null),
        failure: { kind: "execution", reason: `operation ${receipt.transactionHash} succeeded but no single swap by the account was decoded` },
      });
    }
    return this.write(record, { status: "filled", ref, fill, costs: costsOf(this.market, record.order, receipt.gasCostWei, fill), failure: null });
  }

  private write(record: TradeRecord, patch: Partial<TradeRecord>): TradeRecord {
    const next = { ...record, ...patch };
    this.store.write(next);
    return next;
  }
}

export function planHashOf(tickKey: string, calls: ExecutionPlan["calls"]): Hex {
  return hashOf("monadeum:plan:v1", { tickKey, calls });
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
