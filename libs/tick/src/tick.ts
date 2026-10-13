import { acceptTokenField } from "@monadeum/external";
import type { ActionProposal, Decision, InformationRequest, Ledger, PurchasedInformation } from "@monadeum/risk";
import type { Action, AgentView, Quote } from "@monadeum/strategy";
import type { PreparedTrade, PrepareResult, Reconciled, TradeRecord } from "@monadeum/trading";
import type { BuyResult, Provider, Purchase } from "@monadeum/x402";
import type { Hex } from "viem";

/**
 * One agent tick, ARCHITECTURE.md sections 4, 11, 14, and 16.2: observe, decide whether to buy information, buy it
 * through x402 within the RiskModule's information caps, propose, build the execution plan, check the plan with the
 * RiskModule, submit only the approved plan hash, measure. Every external dependency is a port, so the worker wires
 * the real modules and tests wire fakes at the edges.
 *
 * Every store and service call is awaited, so a durable store that answers asynchronously drops in unchanged.
 *
 * Idempotency is keyed on (agent ID, tick sequence number). The approval is written to the tick store before the plan
 * is submitted, so a restarted tick resumes the approved plan through TradingService, which reconciles with the
 * bundler and the chain before anything is resent, and never decides again. An x402 purchase is claimed in the
 * payment log before it is paid, so a restarted tick cannot pay twice; it fails instead, with no action.
 */

export type TickStep = "observe" | "decide" | "information" | "plan" | "policy" | "execute";

export type TickOutcome =
  | { kind: "no-action" }
  | { kind: "executed"; trade: TradeRecord }
  | { kind: "failed"; step: TickStep; reason: string; violations?: string[]; trade?: TradeRecord };

/**
 * executed: the plan is filled. none: nothing was executed, final for this key. pending: the approved plan's outcome
 * is not known yet; run the same tick key again to reconcile it, which never sends a second operation blindly.
 */
export interface TickResult {
  key: string;
  action: "none" | "executed" | "pending";
  retry: "none" | "next-tick" | "reconcile";
  outcome?: TickOutcome;
}

export interface TickRecord {
  key: string;
  agentId: string;
  tick: number;
  /** started: claimed. approved: the RiskModule approved this plan, written before submission. recorded: final. */
  status: "started" | "approved" | "recorded";
  /** Written before paying, so its cost is measured even when the tick fails or crashes after the payment. */
  purchase: Purchase | null;
  approved: { proposal: ActionProposal; trade: PreparedTrade; decision: Decision } | null;
  outcome: TickOutcome | null;
}

/** Durable per-tick record. `claim` is insert-if-absent; a durable store implements it atomically. */
export interface TickStore {
  get(key: string): Promise<TickRecord | undefined>;
  claim(record: TickRecord): Promise<boolean>;
  write(record: TickRecord): Promise<void>;
}

/** What the worker read for this tick. `view` feeds the strategy; `ledger` is what the RiskModule enforces against. */
export interface Observation {
  /** Untrusted: a token field from an external market source, validated before anything uses it. */
  symbol: unknown;
  observedAt: string;
  view: AgentView;
  ledger: Ledger;
  account: Hex;
  genomeHash: Hex;
  principal: bigint;
  /** The settlement asset's decimals, read from the token. */
  decimals: number;
  maxSlippageBps: number;
  /** The agent's open position size on the market, base units, from TradingModule's position store. */
  position: bigint;
  /**
   * The most settlement asset one buy may spend, base units: the lower of the signed policy's `perActionCap` and the
   * account's on-chain `perTxCap`. A buy's notional is clipped to it (ARCHITECTURE.md section 11, "Tick runner"). Null
   * when no policy is in effect: nothing is clipped, and the RiskModule rejects the plan as before.
   */
  maxNotional: bigint | null;
  /** The information the agent may buy this tick, at most `maxPrice` base units, or null for none. */
  offer: { provider: Provider; resource: string; maxPrice: bigint } | null;
}

/** Called at least once per tick key, so an implementation must be idempotent by `key`. */
export interface TickMeasurement {
  key: string;
  agentId: string;
  tick: number;
  outcome: TickOutcome;
  /** x402 spend this tick may have incurred, in base units, counted even when the tick failed after paying. */
  information: bigint;
  trade: TradeRecord | null;
}

export interface TickPorts {
  /** null when the chain or market source could not be read (RPC degradation): the tick fails with no action. */
  observe(): Promise<Observation | null>;
  strategy: { propose(state: AgentView, quote: Quote | null): Action | null };
  risk: {
    information(request: InformationRequest, ledger: Ledger): Decision;
    trade(proposal: ActionProposal, plan: PreparedTrade["plan"], ledger: Ledger): Decision;
  };
  x402: {
    buy(purchase: Purchase): Promise<BuyResult>;
    recordInfluence(paymentRef: string, influenced: boolean): Promise<void> | void;
    spent(purchase: Purchase): Promise<bigint> | bigint;
  };
  trading: {
    prepare(proposal: ActionProposal): Promise<PrepareResult>;
    submit(trade: PreparedTrade, decision: Decision): Promise<TradeRecord>;
    reconcile(tickKey: string): Promise<Reconciled>;
  };
  measure(measurement: TickMeasurement): Promise<void> | void;
}

export function tickKey(agentId: string, tick: number): string {
  return `${agentId}:${tick}`;
}

/** The scheduler's claim: one job per (agent, tick), however often it is enqueued. */
export function enqueueTick(store: TickStore, agentId: string, tick: number): Promise<boolean> {
  return store.claim(fresh(agentId, tick));
}

function fresh(agentId: string, tick: number): TickRecord {
  return { key: tickKey(agentId, tick), agentId, tick, status: "started", purchase: null, approved: null, outcome: null };
}

/** Planner floats to settlement-asset base units, rounding down, once, when the proposal is built (section 16). */
export function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const scale = 10 ** decimals;
  let units = Math.floor(amount * scale);
  if (units > 0 && units / scale > amount) units -= 1;
  return BigInt(units);
}

const toUnits = (amount: bigint, decimals: number) => Number(amount) / 10 ** decimals;

export async function runTick(store: TickStore, agentId: string, tick: number, ports: TickPorts): Promise<TickResult> {
  const key = tickKey(agentId, tick);
  let record = await store.get(key);
  if (record?.status === "recorded") return result(key, record.outcome ?? { kind: "no-action" });
  if (record?.status === "approved" && record.approved) {
    // Restart after approval: resume the approved plan. TradingService reconciles before it resends anything.
    const { trade, decision } = record.approved;
    return finish(store, ports, record, await ports.trading.submit(trade, decision));
  }
  if (!record) {
    record = fresh(agentId, tick);
    if (!(await store.claim(record))) return { key, action: "none", retry: "none" };
  } else {
    // Started but not approved: a crash before the approval was written. Anything the trade store holds for this
    // key (a logged rejection) is final; an x402 purchase already claimed fails below instead of paying again.
    const found = await ports.trading.reconcile(key);
    if (found.state !== "absent") return finish(store, ports, record, found.record);
  }
  const started = record;
  const fail = (step: TickStep, reason: string, violations?: string[], trade?: TradeRecord) =>
    finish(store, ports, started, trade ?? null, { kind: "failed", step, reason, ...(violations ? { violations } : {}), ...(trade ? { trade } : {}) });

  const observed = await ports.observe();
  if (!observed) return fail("observe", "rpc");
  if (!acceptTokenField(observed.symbol).ok) return fail("observe", "token field");
  const { view, ledger, decimals } = observed;

  let quote: Quote | null = null;
  const information: PurchasedInformation[] = [];
  let action: Action | null;
  try {
    const offer = observed.offer;
    if (offer && ports.strategy.propose(view, { provider: offer.provider, price: toUnits(offer.maxPrice, decimals) })?.buyInformation) {
      const request: InformationRequest = { tickKey: key, agentId, provider: offer.provider, maxPrice: offer.maxPrice };
      const allowed = ports.risk.information(request, ledger);
      if (!allowed.approved) return fail("information", "policy", allowed.violations);
      const purchase: Purchase = { tickKey: key, provider: offer.provider, resource: offer.resource, maxPrice: offer.maxPrice };
      record = { ...started, purchase };
      await store.write(record);
      const bought = await ports.x402.buy(purchase);
      // Unreachable, malformed, or anomalous: no information, and no trade as if the call had succeeded (section 14).
      if (!bought.ok) return finish(store, ports, record, null, { kind: "failed", step: "information", reason: bought.reason });
      information.push({ provider: bought.quote.provider, price: bought.price, observedAt: bought.quote.observedAt, paymentRef: bought.paymentRef });
      quote = { provider: bought.quote.provider, price: toUnits(bought.price, decimals) };
    }
    action = ports.strategy.propose(view, quote);
    if (information.length > 0) {
      const without = ports.strategy.propose(view, null);
      await ports.x402.recordInfluence(information[0]!.paymentRef, without?.side !== action?.side || without?.notional !== action?.notional);
    }
  } catch (error) {
    return finish(store, ports, record, null, { kind: "failed", step: "decide", reason: error instanceof Error ? error.message : String(error) });
  }

  // "long" buys `notional`. "flat" is the exit decision: with a position open it closes all of it, the size coming
  // from TradingModule's position store, never from the proposal; with nothing open it is no action.
  const proposed = action && action.side === "long" ? toBaseUnits(action.notional, decimals) : 0n;
  const notional = observed.maxNotional !== null && proposed > observed.maxNotional ? observed.maxNotional : proposed;
  const close = action?.side === "flat" && observed.position > 0n;
  if (!action || (notional === 0n && !close)) return finish(store, ports, record, null, { kind: "no-action" });

  const proposal: ActionProposal = {
    schemaVersion: 1,
    tickKey: key,
    agentId,
    account: observed.account,
    genomeHash: observed.genomeHash,
    strategyType: "trading",
    state: { capital: ledger.capital, principal: observed.principal, ticksSinceTrade: view.ticksSinceTrade, observedAt: observed.observedAt },
    information,
    action: { kind: "trade", pair: action.pair, side: close ? "flat" : "long", notional, maxSlippageBps: observed.maxSlippageBps },
  };
  const purchased = record;
  const failHere = (step: TickStep, reason: string, violations?: string[], trade?: TradeRecord) =>
    finish(store, ports, purchased, trade ?? null, { kind: "failed", step, reason, ...(violations ? { violations } : {}), ...(trade ? { trade } : {}) });

  const prepared = await ports.trading.prepare(proposal);
  if (!prepared.ok) return failHere("plan", prepared.reason);
  const decision = ports.risk.trade(proposal, prepared.trade.plan, ledger);
  if (!decision.approved) {
    // Logged by TradingService as a policy failure, which also burns the key: nothing is sent for this tick.
    const rejected = await ports.trading.submit(prepared.trade, decision);
    return failHere("policy", "rejected by the RiskModule", [...decision.violations], rejected);
  }
  record = { ...purchased, status: "approved", approved: { proposal, trade: prepared.trade, decision } };
  await store.write(record);
  return finish(store, ports, record, await ports.trading.submit(prepared.trade, decision));
}

function outcomeOf(trade: TradeRecord): TickOutcome {
  if (trade.status === "filled") return { kind: "executed", trade };
  const step: TickStep = trade.failure?.kind === "policy" ? "policy" : "execute";
  const reason = trade.status === "needs-review" ? `needs-review: ${trade.failure?.reason ?? ""}` : (trade.failure?.reason ?? trade.status);
  return { kind: "failed", step, reason, ...(trade.failure?.violations ? { violations: trade.failure.violations } : {}), trade };
}

async function finish(store: TickStore, ports: TickPorts, record: TickRecord, trade: TradeRecord | null, outcome?: TickOutcome): Promise<TickResult> {
  if (!outcome && trade && (trade.status === "claimed" || trade.status === "submitted")) {
    // Outcome unknown: stays approved, so the next run of this key reconciles. Nothing is measured twice.
    return { key: record.key, action: "pending", retry: "reconcile" };
  }
  const final = outcome ?? outcomeOf(trade!);
  const information = record.purchase ? await ports.x402.spent(record.purchase) : 0n;
  await ports.measure({ key: record.key, agentId: record.agentId, tick: record.tick, outcome: final, information, trade });
  await store.write({ ...record, status: "recorded", outcome: final });
  return result(record.key, final);
}

function result(key: string, outcome: TickOutcome): TickResult {
  if (outcome.kind === "executed") return { key, action: "executed", retry: "none", outcome };
  return { key, action: "none", retry: outcome.kind === "failed" ? "next-tick" : "none", outcome };
}

export class MemoryTickStore implements TickStore {
  private readonly rows = new Map<string, TickRecord>();
  async get(key: string): Promise<TickRecord | undefined> {
    const row = this.rows.get(key);
    return row ? structuredClone(row) : undefined;
  }
  async claim(record: TickRecord): Promise<boolean> {
    if (this.rows.has(record.key)) return false;
    this.rows.set(record.key, structuredClone(record));
    return true;
  }
  async write(record: TickRecord): Promise<void> {
    this.rows.set(record.key, structuredClone(record));
  }
}
