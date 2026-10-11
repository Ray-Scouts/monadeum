import { decodeFunctionData, parseAbi, recoverMessageAddress, type Hex } from "viem";
import { hashExecutionPlan, hashRiskPolicy } from "@monadeum/commitment";
import { CAPITAL_FLOOR, REALLOCATION_CAP, SLOT_CEILING } from "@monadeum/reallocation/constants";

// Types are ARCHITECTURE.md sections 16.1 and 16.2. Change them there first.
export type BaseUnits = bigint;

export interface AllowedCall {
  target: Hex;
  selector: Hex;
  label: "kuru-router" | "reallocation" | "settlement-asset";
}

export interface PolicyDocument {
  schemaVersion: 1;
  version: number;
  previousHash: Hex | null;
  effectiveFrom: string;
  settlementAsset: Hex;
  allowedCalls: AllowedCall[];
  allowedPairs: string[];
  perActionCap: BaseUnits;
  sessionDailyCap: BaseUnits;
  perTickInformationCap: BaseUnits;
  dailyInformationCap: BaseUnits;
  maxPositionFraction: number;
}

export interface SignedPolicy {
  document: PolicyDocument;
  signature: Hex;
}

export interface VerifiedPolicy {
  document: PolicyDocument;
  hash: Hex;
}

export interface Ledger {
  capital: BaseUnits;
  spentInWindow: BaseUnits;
  informationBudget: BaseUnits;
  informationToday: BaseUnits;
  informationThisTick: BaseUnits;
  assetUniverse: string[];
}

export type Violation =
  | "call-not-allowed" | "recipient-not-allowed" | "pair-not-allowed" | "provider-not-allowed"
  | "per-action-cap" | "session-daily-cap" | "information-cap"
  | "position-fraction" | "plan-hash-mismatch" | "policy-unverified"
  // With ReallocationProposal (ARCHITECTURE.md section 16.2), accepted by the owner (section 16.5).
  | "reallocation-party" | "reallocation-policy" | "reallocation-bound";

export type Decision =
  | { approved: true; policyVersion: number; policyHash: Hex; planHash: Hex | null }
  | { approved: false; policyVersion: number; policyHash: Hex; violations: Violation[] };

export interface InformationRequest {
  tickKey: string;
  agentId: string;
  provider: "nansen" | "defillama";
  maxPrice: BaseUnits;
}

export interface PurchasedInformation {
  provider: "nansen" | "defillama";
  price: BaseUnits;
  observedAt: string;
  paymentRef: string;
}

export interface TradeIntent {
  kind: "trade";
  pair: string;
  side: "long" | "flat";
  notional: BaseUnits;
  maxSlippageBps: number;
}

export interface ActionProposal {
  schemaVersion: 1;
  tickKey: string;
  agentId: string;
  account: Hex;
  genomeHash: Hex;
  strategyType: "trading";
  state: { capital: BaseUnits; principal: BaseUnits; ticksSinceTrade: number; observedAt: string };
  information: PurchasedInformation[];
  action: TradeIntent | null;
}

export interface ExecutionPlan {
  tickKey: string;
  calls: { target: Hex; data: Hex }[];
  planHash: Hex;
}

/**
 * ARCHITECTURE.md section 16.2, accepted by the owner (section 16.5): one source's debit at one evaluation,
 * all of its credits in one `reallocate` call, as contracts/src/AgentReallocation.sol accepts (one call per source
 * per evaluation). Amounts are settlement-asset base units, converted from the planner's floats rounding down.
 */
export interface ReallocationCredit {
  sinkAgentId: string;
  sink: Hex;
  amount: BaseUnits;
}

export interface ReallocationProposal {
  schemaVersion: 1;
  /** `${owner}:${evaluation}:${sourceAgentId}`, the idempotency key of the source's debit. */
  moveKey: string;
  owner: Hex;
  /** Evaluation sequence number. */
  evaluation: number;
  /** EIP-712 struct hash of the owner's reallocation policy the plan was computed against (section 16.5). */
  policyHash: Hex;
  sourceAgentId: string;
  source: Hex;
  credits: ReallocationCredit[];
  total: BaseUnits;
}

/** One agent as the worker reads it from the registry and the chain, never from the proposal. */
export interface ReallocationParty {
  agentId: string;
  account: Hex;
  owner: Hex;
  status: "active" | "retired";
  capital: BaseUnits;
  principal: BaseUnits;
}

/** The owner's policy as committed on-chain: its hash, the agents it names, and any tightened bounds. */
export interface CommittedReallocationPolicy {
  hash: Hex;
  agents: string[];
  reallocationCap?: number;
  slotCeiling?: number;
  capitalFloor?: BaseUnits;
}

/** Authoritative inputs for a reallocation, the counterpart of Ledger. */
export interface ReallocationLedger {
  /** The source's windowTotal (section 16.3). */
  spentInWindow: BaseUnits;
  /** The settlement asset's decimals, read from the token. */
  decimals: number;
  source: ReallocationParty;
  /** Every agent the proposal names as a sink. A missing one is a party violation. */
  sinks: ReallocationParty[];
  ownerPolicy: CommittedReallocationPolicy | null;
}

/** The reallocation contract's entry point (contracts/src/AgentReallocation.sol), selector 0x4c329bba. */
export const REALLOCATE_ABI = parseAbi([
  "function reallocate(uint256 evaluation, bytes32 policyHash, (address sink, uint256 amount)[] credits)",
]);

const PROVIDERS = new Set(["nansen", "defillama"]);
const SETTLEMENT_ABI = parseAbi([
  "function transfer(address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
]);
const NO_POLICY: Hex = `0x${"0".repeat(64)}`;

const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const isHex = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v);
const isAmount = (v: unknown) => typeof v === "bigint" && v >= 0n;

function wellFormed(d: PolicyDocument): boolean {
  return (
    d.schemaVersion === 1 &&
    [d.perActionCap, d.sessionDailyCap, d.perTickInformationCap, d.dailyInformationCap].every(isAmount) &&
    Number.isFinite(d.maxPositionFraction) && d.maxPositionFraction >= 0 && d.maxPositionFraction <= 1 &&
    !Number.isNaN(Date.parse(d.effectiveFrom)) &&
    isHex(d.settlementAsset) &&
    Array.isArray(d.allowedCalls) && d.allowedCalls.every((c) => isHex(c?.target) && isHex(c?.selector)) &&
    Array.isArray(d.allowedPairs) && d.allowedPairs.every((p) => typeof p === "string")
  );
}

/**
 * Verifies every version's signature and the previousHash chain back to version 1, then returns the
 * latest version already in effect. Any failure returns null, and a null policy rejects everything.
 */
export async function loadPolicy(rows: readonly SignedPolicy[], signer: Hex, now: Date): Promise<VerifiedPolicy | null> {
  let previous: Hex | null = null;
  let active: VerifiedPolicy | null = null;
  let previousFrom = -Infinity;
  try {
    for (const [i, { document, signature }] of rows.entries()) {
      if (!wellFormed(document) || document.version !== i + 1 || document.previousHash !== previous) return null;
      const from = Date.parse(document.effectiveFrom);
      if (from < previousFrom) return null;
      previousFrom = from;
      const hash = hashRiskPolicy(document);
      const recovered = await recoverMessageAddress({ message: { raw: hash }, signature });
      if (!same(recovered, signer)) return null;
      if (from <= now.getTime()) active = { document, hash };
      previous = hash;
    }
  } catch {
    return null;
  }
  return active;
}

function decide(policy: VerifiedPolicy, violations: Violation[], planHash: Hex | null): Decision {
  const meta = { policyVersion: policy.document.version, policyHash: policy.hash };
  if (violations.length === 0) return { approved: true, ...meta, planHash };
  return { approved: false, ...meta, violations: [...new Set(violations)] };
}

function unverified(): Decision {
  return { approved: false, policyVersion: 0, policyHash: NO_POLICY, violations: ["policy-unverified"] };
}

export function evaluateInformation(policy: VerifiedPolicy | null, request: InformationRequest, ledger: Ledger): Decision {
  if (!policy) return unverified();
  const d = policy.document;
  const v: Violation[] = [];
  if (!PROVIDERS.has(request.provider)) v.push("provider-not-allowed");
  const tickCap = ledger.informationBudget < d.perTickInformationCap ? ledger.informationBudget : d.perTickInformationCap;
  if (
    !isAmount(request.maxPrice) ||
    ledger.informationThisTick + request.maxPrice > tickCap ||
    ledger.informationToday + request.maxPrice > d.dailyInformationCap
  ) v.push("information-cap");
  return decide(policy, v, null);
}

export function evaluateTrade(
  policy: VerifiedPolicy | null,
  proposal: ActionProposal,
  plan: ExecutionPlan,
  ledger: Ledger,
): Decision {
  if (!policy) return unverified();
  try {
    return evaluateTradeUnsafe(policy, proposal, plan, ledger);
  } catch {
    // Malformed input fails closed as a rejection, never as an exception.
    return decide(policy, ["call-not-allowed"], null);
  }
}

/**
 * The allowlist, recipient, and counting rules every plan is held to (section 16.1). Returns what the plan spends,
 * counted from calldata: `transfer` and `approve` on the settlement asset count their amount, every other allowed call
 * counts 0. Pushes a violation for each call that breaks a rule.
 */
function checkCalls(d: PolicyDocument, plan: ExecutionPlan, v: Violation[]): bigint {
  const recipients = d.allowedCalls.filter((c) => c.label !== "settlement-asset").map((c) => c.target);
  let spend = 0n;
  for (const call of plan.calls) {
    const selector = typeof call.data === "string" ? call.data.slice(0, 10) : "";
    if (selector.length < 10 || !d.allowedCalls.some((c) => same(c.target, call.target) && same(c.selector, selector))) {
      v.push("call-not-allowed");
      continue;
    }
    if (!same(call.target, d.settlementAsset)) continue;
    try {
      const { args } = decodeFunctionData({ abi: SETTLEMENT_ABI, data: call.data });
      const [to, amount] = args;
      if (!recipients.some((r) => same(r, to))) v.push("recipient-not-allowed");
      spend += amount;
    } catch {
      v.push("call-not-allowed");
    }
  }
  return spend;
}

function planHashOf(plan: ExecutionPlan): Hex | null {
  try {
    return hashExecutionPlan({ tickKey: plan.tickKey, calls: plan.calls });
  } catch {
    return null;
  }
}

function evaluateTradeUnsafe(policy: VerifiedPolicy, proposal: ActionProposal, plan: ExecutionPlan, ledger: Ledger): Decision {
  const d = policy.document;
  const v: Violation[] = [];

  const planHash = planHashOf(plan);
  if (planHash !== plan.planHash || plan.tickKey !== proposal.tickKey) v.push("plan-hash-mismatch");

  const action = proposal.action;
  if (!action) {
    if (plan.calls.length > 0) v.push("call-not-allowed");
  } else {
    if (!d.allowedPairs.includes(action.pair) || !ledger.assetUniverse.includes(action.pair)) v.push("pair-not-allowed");
    // The fraction is floored to parts per million, so the cap only ever rounds down.
    const positionCap = (ledger.capital * BigInt(Math.floor(d.maxPositionFraction * 1_000_000))) / 1_000_000n;
    if (!isAmount(action.notional) || action.notional > positionCap) v.push("position-fraction");
  }

  const spend = checkCalls(d, plan, v);
  if (spend > d.perActionCap) v.push("per-action-cap");
  if (ledger.spentInWindow + spend > d.sessionDailyCap) v.push("session-daily-cap");

  return decide(policy, v, planHash);
}

const PPM = 1_000_000n;
const ppm = (fraction: number) => BigInt(Math.floor(fraction * 1_000_000));

/**
 * Evaluates one source's reallocation debit (ARCHITECTURE.md section 16.2). The plan must be exactly
 * `approve(reallocation, total)` on the settlement asset, then `reallocate(evaluation, policyHash, credits)` on the
 * same allowlisted contract, encoding this proposal and nothing else. On top of the allowlist, recipient, and spend
 * caps every plan is held to, it re-checks from the ledger what the contract checks on-chain: same owner, Active
 * parties, the owner's committed policy naming them, and the cap, floor, and ceiling, each clamped to the protocol
 * value so a policy can only tighten it. The ranking that chose the source and sinks cannot be checked here.
 */
export function evaluateReallocation(
  policy: VerifiedPolicy | null,
  proposal: ReallocationProposal,
  plan: ExecutionPlan,
  ledger: ReallocationLedger,
): Decision {
  if (!policy) return unverified();
  try {
    return evaluateReallocationUnsafe(policy, proposal, plan, ledger);
  } catch {
    return decide(policy, ["call-not-allowed"], null);
  }
}

function evaluateReallocationUnsafe(
  policy: VerifiedPolicy,
  proposal: ReallocationProposal,
  plan: ExecutionPlan,
  ledger: ReallocationLedger,
): Decision {
  const d = policy.document;
  const v: Violation[] = [];

  const planHash = planHashOf(plan);
  if (planHash !== plan.planHash || plan.tickKey !== proposal.moveKey || !encodesProposal(d, proposal, plan)) v.push("plan-hash-mismatch");

  const credits = proposal.credits;
  const amountsOk = credits.length > 0 && credits.every((c) => isAmount(c.amount) && c.amount > 0n) &&
    isAmount(proposal.total) && credits.reduce((acc, c) => acc + c.amount, 0n) === proposal.total;
  if (!amountsOk) v.push("reallocation-bound");

  const src = ledger.source;
  const sinkOf = new Map(ledger.sinks.map((s) => [s.agentId, s]));
  const sinkIds = new Set(credits.map((c) => c.sinkAgentId));
  const partiesOk =
    src.agentId === proposal.sourceAgentId && same(src.account, proposal.source) && same(src.owner, proposal.owner) &&
    src.status === "active" && sinkIds.size === credits.length && !sinkIds.has(src.agentId) &&
    credits.every((c) => {
      const sink = sinkOf.get(c.sinkAgentId);
      return sink !== undefined && same(sink.account, c.sink) && same(sink.owner, src.owner) && sink.status === "active" && !same(sink.account, src.account);
    });
  if (!partiesOk) v.push("reallocation-party");

  const owner = ledger.ownerPolicy;
  const capFraction = owner?.reallocationCap ?? REALLOCATION_CAP;
  const ceilingMultiple = owner?.slotCeiling ?? SLOT_CEILING;
  const boundsValid = [capFraction, ceilingMultiple].every((x) => Number.isFinite(x) && x >= 0) &&
    (owner?.capitalFloor === undefined || isAmount(owner.capitalFloor));
  if (
    !owner || !boundsValid || !same(owner.hash, proposal.policyHash) ||
    !owner.agents.includes(proposal.sourceAgentId) || !credits.every((c) => owner.agents.includes(c.sinkAgentId))
  ) {
    v.push("reallocation-policy");
  } else if (partiesOk && amountsOk) {
    // Each bound is clamped to the protocol value, so an owner's policy can only tighten it.
    const capPpm = ppm(Math.min(capFraction, REALLOCATION_CAP));
    const ceilingPpm = ppm(Math.min(ceilingMultiple, SLOT_CEILING));
    const unit = 10n ** BigInt(ledger.decimals);
    const protocolFloor = (unit * ppm(CAPITAL_FLOOR) + PPM - 1n) / PPM;
    const floor = owner.capitalFloor !== undefined && owner.capitalFloor > protocolFloor ? owner.capitalFloor : protocolFloor;
    const total = proposal.total;
    const sinksOk = credits.every((c) => {
      const sink = sinkOf.get(c.sinkAgentId)!;
      return (sink.capital + c.amount) * PPM <= sink.principal * ceilingPpm;
    });
    if (total * PPM > src.capital * capPpm || src.capital - total < floor || !sinksOk) v.push("reallocation-bound");
  }

  const spend = checkCalls(d, plan, v);
  if (spend > d.perActionCap) v.push("per-action-cap");
  if (ledger.spentInWindow + spend > d.sessionDailyCap) v.push("session-daily-cap");

  return decide(policy, v, planHash);
}

/** The plan is exactly the approve and the reallocate call this proposal describes, to an allowlisted contract. */
function encodesProposal(d: PolicyDocument, proposal: ReallocationProposal, plan: ExecutionPlan): boolean {
  if (plan.calls.length !== 2) return false;
  const [approveCall, reallocateCall] = plan.calls as [ExecutionPlan["calls"][number], ExecutionPlan["calls"][number]];
  if (!same(approveCall.target, d.settlementAsset)) return false;
  const approved = decodeFunctionData({ abi: SETTLEMENT_ABI, data: approveCall.data });
  if (approved.functionName !== "approve") return false;
  const [spender, amount] = approved.args;
  if (!same(spender, reallocateCall.target) || amount !== proposal.total) return false;
  if (!d.allowedCalls.some((c) => c.label === "reallocation" && same(c.target, reallocateCall.target))) return false;
  const [evaluation, policyHash, credits] = decodeFunctionData({ abi: REALLOCATE_ABI, data: reallocateCall.data }).args;
  return (
    evaluation === BigInt(proposal.evaluation) &&
    same(policyHash, proposal.policyHash) &&
    credits.length === proposal.credits.length &&
    credits.every((c, i) => same(c.sink, proposal.credits[i]!.sink) && c.amount === proposal.credits[i]!.amount)
  );
}
