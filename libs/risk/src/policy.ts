import { decodeFunctionData, parseAbi, recoverMessageAddress, type Hex } from "viem";
import { hashOf } from "./canonical.js";

// Types are ARCHITECTURE.md sections 16.1 and 16.2. Change them there first.
export type BaseUnits = bigint;

export interface AllowedCall {
  target: Hex;
  selector: Hex;
  label: "kuru-router" | "reproduction" | "settlement-asset";
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
  spentToday: BaseUnits;
  informationToday: BaseUnits;
  informationThisTick: BaseUnits;
  assetUniverse: string[];
}

export type Violation =
  | "call-not-allowed" | "recipient-not-allowed" | "pair-not-allowed" | "provider-not-allowed"
  | "per-action-cap" | "session-daily-cap" | "information-cap"
  | "position-fraction" | "plan-hash-mismatch" | "policy-unverified";

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

const PROVIDERS = new Set(["nansen", "defillama"]);
const SETTLEMENT_ABI = parseAbi([
  "function transfer(address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
]);
const NO_POLICY: Hex = `0x${"0".repeat(64)}`;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isAmount = (v: unknown) => typeof v === "bigint" && v >= 0n;

function wellFormed(d: PolicyDocument): boolean {
  return (
    d.schemaVersion === 1 &&
    [d.perActionCap, d.sessionDailyCap, d.perTickInformationCap, d.dailyInformationCap].every(isAmount) &&
    Number.isFinite(d.maxPositionFraction) && d.maxPositionFraction >= 0 && d.maxPositionFraction <= 1 &&
    !Number.isNaN(Date.parse(d.effectiveFrom))
  );
}

/**
 * Verifies every version's signature and the previousHash chain back to version 1, then returns the
 * latest version already in effect. Any failure returns null, and a null policy rejects everything.
 */
export async function loadPolicy(rows: readonly SignedPolicy[], signer: Hex, now: Date): Promise<VerifiedPolicy | null> {
  let previous: Hex | null = null;
  let active: VerifiedPolicy | null = null;
  try {
    for (const [i, { document, signature }] of rows.entries()) {
      if (!wellFormed(document) || document.version !== i + 1 || document.previousHash !== previous) return null;
      const hash = hashOf("monadeum:policy:v1", document);
      const recovered = await recoverMessageAddress({ message: { raw: hash }, signature });
      if (!same(recovered, signer)) return null;
      if (Date.parse(document.effectiveFrom) <= now.getTime()) active = { document, hash };
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
  if (
    !isAmount(request.maxPrice) ||
    ledger.informationThisTick + request.maxPrice > d.perTickInformationCap ||
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
  const d = policy.document;
  const v: Violation[] = [];

  let planHash: Hex | null = null;
  try {
    planHash = hashOf("monadeum:plan:v1", { tickKey: plan.tickKey, calls: plan.calls });
  } catch {}
  if (planHash !== plan.planHash || plan.tickKey !== proposal.tickKey) v.push("plan-hash-mismatch");

  const action = proposal.action;
  if (!action) {
    if (plan.calls.length > 0) v.push("call-not-allowed");
  } else {
    if (!d.allowedPairs.includes(action.pair) || !ledger.assetUniverse.includes(action.pair)) v.push("pair-not-allowed");
    // ponytail: fraction floored to parts per million, so the cap only ever rounds down
    const positionCap = (ledger.capital * BigInt(Math.floor(d.maxPositionFraction * 1_000_000))) / 1_000_000n;
    if (!isAmount(action.notional) || action.notional > positionCap) v.push("position-fraction");
  }

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
  if (spend > d.perActionCap) v.push("per-action-cap");
  if (ledger.spentToday + spend > d.sessionDailyCap) v.push("session-daily-cap");

  return decide(policy, v, planHash);
}
