import { hashRiskPolicy } from "@monadeum/commitment";
import { loadPolicy, type AllowedCall, type PolicyDocument, type SignedPolicy, type VerifiedPolicy } from "@monadeum/risk";
import { RISK_CEILING } from "@monadeum/strategy";
import type { TradingConfig } from "@monadeum/trading";
import { APPROVE_SELECTOR, type WalletsConfig } from "@monadeum/wallets";
import { ethers } from "ethers";
import { getAddress, isAddress, isHex, recoverMessageAddress, zeroAddress, type Address, type Hex } from "viem";

// Signed RiskModule policy documents for a deployment (ARCHITECTURE.md section 16.1): what the operator's CLI builds,
// signs, verifies, and appends (policy-main.ts), and what the worker's tick runner checks a loaded version against.

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

/** The stored versions, in version order, as `loadPolicy` verifies them. `PgPolicyVersions` implements it. */
export interface PolicyVersions {
  list(): Promise<SignedPolicy[]>;
}

/** The operator's side: append one signed version. `PgPolicyVersions` implements it under the operator role. */
export interface PolicyAppender extends PolicyVersions {
  append(input: { document: PolicyDocument; signer: Address; signature: Hex }): Promise<void>;
}

/** In-memory versions, for tests and local development only. Like the table, append-only and unique by version. */
export class MemoryPolicyVersions implements PolicyAppender {
  private readonly rows: SignedPolicy[] = [];
  async list(): Promise<SignedPolicy[]> {
    return this.rows.map((r) => structuredClone(r));
  }
  async append(input: { document: PolicyDocument; signer: Address; signature: Hex }): Promise<void> {
    if (this.rows.some((r) => r.document.version === input.document.version)) throw new PolicyError(`policy version ${input.document.version} is already stored`);
    this.rows.push(structuredClone({ document: input.document, signature: input.signature }));
  }
}

/** What a deployment's policy must cover: the market agents trade and the settlement asset they spend. */
export interface PolicyTarget {
  settlementAsset: Hex;
  pair: string;
  router: Hex;
  /** The ERC-20 base a close sells (WMON on testnet, WETH on mainnet), or null on a native-MON base market. */
  tradedBase: Hex | null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The deployment's target, from the same configuration the worker trades under: WalletsModule's call scope
 * (`WALLETS_*`) and the market (`TRADING_*`). Refuses a configuration where the two disagree, since a policy built from
 * one would reject every plan built from the other: a different settlement asset or router, or a base a close sells
 * that is not a traded asset in the session key scope.
 */
export function policyTarget(wallets: WalletsConfig, trading: TradingConfig): { scope: readonly AllowedCall[]; target: PolicyTarget } {
  const scope = wallets.chain.scope;
  const settlement = scope.find((c) => c.label === "settlement-asset")?.target;
  const { market } = trading;
  if (!settlement || !same(settlement, market.quote)) throw new PolicyError("WALLETS_SETTLEMENT_ASSET is not TRADING_QUOTE: the market must be quoted in the settlement asset");
  if (!scope.some((c) => c.label === "kuru-router" && same(c.target, market.router))) throw new PolicyError("WALLETS_KURU_ROUTER is not TRADING_KURU_ROUTER");
  const native = same(market.base, zeroAddress);
  if (!native && !scope.some((c) => c.label === "traded-asset" && same(c.target, market.base))) {
    throw new PolicyError("TRADING_BASE is not in WALLETS_TRADED_ASSETS: no close of a position could be signed");
  }
  return { scope, target: { settlementAsset: getAddress(market.quote), pair: market.pair, router: getAddress(market.router), tradedBase: native ? null : getAddress(market.base) } };
}

/**
 * Why `document` cannot govern trading on `target`, or an empty list. Checked by the CLI before a version is built and
 * by the worker on every load, so a valid signature over a document for another market never lets a tick run.
 */
export function coverageProblems(document: PolicyDocument, target: PolicyTarget): string[] {
  const problems: string[] = [];
  const calls = document.allowedCalls;
  if (!same(document.settlementAsset, target.settlementAsset)) problems.push("its settlement asset is not the market's quote");
  if (!document.allowedPairs.includes(target.pair)) problems.push(`it does not allow the pair ${target.pair}`);
  if (!calls.some((c) => c.label === "settlement-asset" && same(c.target, target.settlementAsset) && same(c.selector, APPROVE_SELECTOR))) {
    problems.push("it does not allow approve on the settlement asset");
  }
  if (!calls.some((c) => c.label === "kuru-router" && same(c.target, target.router))) problems.push("it does not allow the Kuru router");
  if (target.tradedBase && !calls.some((c) => c.label === "traded-asset" && same(c.target, target.tradedBase!) && same(c.selector, APPROVE_SELECTOR))) {
    problems.push("it does not allow approve on the traded base, so no close could be approved");
  }
  if (document.perActionCap <= 0n || document.sessionDailyCap <= 0n) problems.push("its spend caps are 0");
  return problems;
}

/** A date past every `effectiveFrom`, so `loadPolicy` verifies the whole chain and returns its last version. */
const END_OF_TIME = new Date(8.64e15);

/** The stored chain's last version, verified against `signer`, or null when nothing is stored. Throws if it does not verify. */
export async function latestVersion(rows: readonly SignedPolicy[], signer: Address): Promise<VerifiedPolicy | null> {
  if (rows.length === 0) return null;
  const verified = await loadPolicy(rows, signer, END_OF_TIME);
  if (!verified || verified.document.version !== rows.length) {
    throw new PolicyError(`the ${rows.length} stored policy versions do not verify as one chain signed by ${signer}`);
  }
  return verified;
}

export interface PolicyInputs {
  scope: readonly AllowedCall[];
  target: PolicyTarget;
  /** Settlement-asset base units. Must not exceed the agents' on-chain per-transaction cap (SECURITY.md section 9). */
  perActionCap: bigint;
  /** Settlement-asset base units. Must not exceed the agents' on-chain daily cap (ARCHITECTURE.md section 16.1). */
  sessionDailyCap: bigint;
  /** Default `RISK_CEILING`, the protocol ceiling on riskTolerance. */
  maxPositionFraction?: number;
  effectiveFrom: string;
  /** The stored chain's last version, from `latestVersion`; null for version 1. */
  previous: VerifiedPolicy | null;
}

/**
 * The 16.1 document for a deployment. The allowed calls are WalletsModule's session key scope as configured, so the
 * off-chain and on-chain allowlists are the same list: the settlement asset's `transfer` and `approve`, the Kuru
 * router's swap selectors, the reallocation contract's `reallocate`, and `approve` on each traded asset. The only pair
 * is the market's. The information caps are 0: the x402 payer is off and the runner buys nothing.
 */
export function buildPolicyDocument(input: PolicyInputs): PolicyDocument {
  const fraction = input.maxPositionFraction ?? RISK_CEILING;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) throw new PolicyError("the maximum position fraction must be above 0 and at most 1");
  if (input.perActionCap <= 0n) throw new PolicyError("the per-action cap must be above 0");
  if (input.sessionDailyCap < input.perActionCap) throw new PolicyError("the session daily cap must be at least the per-action cap");
  const from = Date.parse(input.effectiveFrom);
  if (Number.isNaN(from)) throw new PolicyError("effectiveFrom is not a date");
  if (input.previous && from < Date.parse(input.previous.document.effectiveFrom)) {
    throw new PolicyError(`effectiveFrom is earlier than version ${input.previous.document.version}'s, ${input.previous.document.effectiveFrom}`);
  }
  const document: PolicyDocument = {
    schemaVersion: 1,
    version: input.previous ? input.previous.document.version + 1 : 1,
    previousHash: input.previous ? input.previous.hash : null,
    effectiveFrom: new Date(from).toISOString(),
    settlementAsset: input.target.settlementAsset,
    allowedCalls: input.scope.map((c) => ({ target: getAddress(c.target), selector: c.selector.toLowerCase() as Hex, label: c.label })),
    allowedPairs: [input.target.pair],
    perActionCap: input.perActionCap,
    sessionDailyCap: input.sessionDailyCap,
    perTickInformationCap: 0n,
    dailyInformationCap: 0n,
    maxPositionFraction: fraction,
  };
  const problems = coverageProblems(document, input.target);
  if (problems.length > 0) throw new PolicyError(`the document would not cover the market: ${problems.join("; ")}`);
  return document;
}

const AMOUNTS = ["perActionCap", "sessionDailyCap", "perTickInformationCap", "dailyInformationCap"] as const;
const KEYS = [
  "schemaVersion", "version", "previousHash", "effectiveFrom", "settlementAsset", "allowedCalls", "allowedPairs",
  ...AMOUNTS, "maxPositionFraction",
];
const LABELS = new Set(["kuru-router", "reallocation", "settlement-asset", "traded-asset"]);

/** The document as JSON, amounts as decimal strings so nothing is lost to a float. Read back with `policyFromJson`. */
export function policyToJson(document: PolicyDocument): string {
  const plain: Record<string, unknown> = { ...document };
  for (const k of AMOUNTS) plain[k] = document[k].toString();
  return JSON.stringify(plain, null, 2);
}

/** Parses a document written by `policyToJson`, strictly: unknown or missing fields, and any malformed value, are refused. */
export function policyFromJson(value: unknown): PolicyDocument {
  const d = (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
  if (d === null || typeof d !== "object" || Array.isArray(d)) throw new PolicyError("a policy document is a JSON object");
  const keys = Object.keys(d).sort();
  if (keys.join() !== [...KEYS].sort().join()) throw new PolicyError(`a policy document has exactly the fields ${KEYS.join(", ")}`);
  for (const k of AMOUNTS) if (typeof d[k] !== "string" || !/^\d+$/.test(d[k] as string)) throw new PolicyError(`${k} must be a decimal string of base units`);
  const calls = d.allowedCalls;
  if (!Array.isArray(calls) || !calls.every((c) => c && isAddress(c.target) && isHex(c.selector) && c.selector.length === 10 && LABELS.has(c.label) && Object.keys(c).length === 3)) {
    throw new PolicyError("allowedCalls must be a list of { target, selector, label }");
  }
  if (!Array.isArray(d.allowedPairs) || !d.allowedPairs.every((p) => typeof p === "string")) throw new PolicyError("allowedPairs must be a list of pairs");
  if (d.schemaVersion !== 1 || !Number.isInteger(d.version) || (d.previousHash !== null && !isHex(d.previousHash))) throw new PolicyError("schemaVersion, version, or previousHash is malformed");
  if (typeof d.effectiveFrom !== "string" || typeof d.maxPositionFraction !== "number" || typeof d.settlementAsset !== "string" || !isAddress(d.settlementAsset)) {
    throw new PolicyError("effectiveFrom, settlementAsset, or maxPositionFraction is malformed");
  }
  return {
    schemaVersion: 1,
    version: d.version as number,
    previousHash: d.previousHash as Hex | null,
    effectiveFrom: d.effectiveFrom,
    settlementAsset: d.settlementAsset as Hex,
    allowedCalls: calls.map((c) => ({ target: c.target as Hex, selector: c.selector as Hex, label: c.label })),
    allowedPairs: [...(d.allowedPairs as string[])],
    perActionCap: BigInt(d.perActionCap as string),
    sessionDailyCap: BigInt(d.sessionDailyCap as string),
    perTickInformationCap: BigInt(d.perTickInformationCap as string),
    dailyInformationCap: BigInt(d.dailyInformationCap as string),
    maxPositionFraction: d.maxPositionFraction,
  };
}

/** The address that signed `document`: EIP-191 over the 32 bytes of its 16.4 hash, as `loadPolicy` verifies it. */
export async function signerOf(document: PolicyDocument, signature: Hex): Promise<Address> {
  return getAddress(await recoverMessageAddress({ message: { raw: hashRiskPolicy(document) }, signature }));
}

/**
 * Signs with an encrypted JSON keystore (Web3 Secret Storage, as `cast wallet new` writes it). The key exists only in
 * this call's memory; it is never logged, written, or returned.
 */
export async function signWithKeystore(document: PolicyDocument, keystore: string, password: string): Promise<{ signer: Address; signature: Hex }> {
  let wallet: ethers.Wallet;
  try {
    wallet = await ethers.Wallet.fromEncryptedJson(keystore, password);
  } catch {
    throw new PolicyError("the keystore could not be decrypted with that password");
  }
  const signature = (await wallet.signMessage(ethers.utils.arrayify(hashRiskPolicy(document)))) as Hex;
  return { signer: getAddress(wallet.address), signature };
}

/**
 * Checks that `document`, signed by `signature`, is the next version of the stored chain and is signed by the pinned
 * signer, then appends it. The database checks none of this (migration 0003); `loadPolicy` in the worker checks it on
 * every load, so a version that would not verify is refused here instead of silently disabling every tick.
 */
export async function appendVersion(store: PolicyAppender, document: PolicyDocument, signature: Hex, pinned: Address): Promise<VerifiedPolicy> {
  const signer = await signerOf(document, signature).catch(() => {
    throw new PolicyError("the signature is malformed");
  });
  if (!same(signer, pinned)) throw new PolicyError(`the document is signed by ${signer}, not by the pinned operator ${pinned}`);
  const rows = await store.list();
  const previous = await latestVersion(rows, pinned);
  const expected = previous ? previous.document.version + 1 : 1;
  if (document.version !== expected) throw new PolicyError(`the next version is ${expected}, not ${document.version}`);
  if (document.previousHash !== (previous?.hash ?? null)) throw new PolicyError(`previousHash must be ${previous?.hash ?? "null"}`);
  const verified = await latestVersion([...rows, { document, signature }], pinned);
  await store.append({ document, signer, signature });
  return verified!;
}
