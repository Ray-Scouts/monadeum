import type { Hex } from "viem";
import { CanonicalizationError, canonicalSet, taggedHash, type CommitmentTag } from "./canonical.js";
import { hashReallocationPolicy, parseReallocationPolicy } from "./reallocation.js";

/** Integer amount in settlement-asset base units: bigint in memory, canonical decimal string in JSON. */
export type BaseUnits = bigint | string;
export type Address = `0x${string}`;

/** Genome schema version 1, the field set of ARCHITECTURE.md section 16.4 and EVOLUTION.md section 1. */
export interface GenomeV1 {
  schemaVersion: 1;
  strategyType: "trading";
  assetUniverse: readonly string[];
  riskTolerance: number;
  executionFrequency: number;
  timeHorizon: number;
  entryThreshold: number;
  exitThreshold: number;
  informationSources: readonly string[];
  informationBudget: BaseUnits;
  modelConfiguration: string;
}

/** The strategy plugin build a genome runs under. Field set is provisional (section 16.4). */
export interface StrategyVersionV1 {
  schemaVersion: 1;
  strategyType: "trading";
  /** Plugin release identifier, for example a semantic version. */
  version: string;
  /** 32-byte digest of the plugin build that runs the genome. */
  codeDigest: Hex;
}

/**
 * Every committed kind. All but `reallocationPolicy` use the section 16.4 scheme; an owner's reallocation policy is
 * committed as its EIP-712 struct hash instead (reallocation.ts, ARCHITECTURE.md section 16.5).
 */
export type CommitmentKind = "genome" | "strategyVersion" | "reallocationPolicy" | "riskPolicy" | "executionPlan";

/** The kinds hashed with the section 16.4 JCS scheme. */
export type JcsKind = Exclude<CommitmentKind, "reallocationPolicy">;

export const TAGS: Record<JcsKind, CommitmentTag> = {
  genome: "monadeum:genome:v1",
  strategyVersion: "monadeum:strategy:v1",
  riskPolicy: "monadeum:policy:v1",
  executionPlan: "monadeum:plan:v1",
};

type Doc = Record<string, unknown>;

function asObject(value: unknown, path: string): Doc {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new CanonicalizationError(path, "expected an object");
  return value as Doc;
}

function onlyKeys(doc: Doc, required: readonly string[], optional: readonly string[], path: string): void {
  // Key names are part of the hashed bytes, so an unknown field is a schemaVersion change, never silently hashed
  for (const key of Object.keys(doc)) {
    if (!required.includes(key) && !optional.includes(key)) throw new CanonicalizationError(`${path}.${key}`, "field is not part of this schema version");
  }
  for (const key of required) {
    if (doc[key] === undefined) throw new CanonicalizationError(`${path}.${key}`, "required field is missing");
  }
}

function literal<T>(value: unknown, expected: T, path: string): T {
  if (value !== expected) throw new CanonicalizationError(path, `expected ${JSON.stringify(expected)}`);
  return expected;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string") throw new CanonicalizationError(path, "expected a string");
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new CanonicalizationError(path, "expected a finite number");
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) throw new CanonicalizationError(path, "expected an integer within the IEEE 754 safe range");
  return value as number;
}

function stringSet(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new CanonicalizationError(path, "expected an array");
  return canonicalSet(value.map((v, i) => str(v, `${path}[${i}]`)));
}

const DECIMAL = /^(0|[1-9][0-9]*)$/;

function baseUnits(value: unknown, path: string): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw new CanonicalizationError(path, "base-unit amount must be non-negative");
    return value.toString();
  }
  // Money is never a float; a decimal string must already be canonical, so "0500" and "500" cannot both exist
  if (typeof value !== "string" || !DECIMAL.test(value)) throw new CanonicalizationError(path, "expected a bigint or a canonical non-negative decimal string");
  return value;
}

function hex(value: unknown, bytes: number, path: string): string {
  const s = str(value, path);
  if (!new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(s)) throw new CanonicalizationError(path, `expected ${bytes} bytes of 0x-prefixed hex`);
  return s.toLowerCase();
}

/** Applies section 16.4 normalization to a genome and returns the exact object that is canonicalized. */
export function normalizeGenome(input: unknown): Doc {
  const g = asObject(input, "$");
  onlyKeys(
    g,
    ["schemaVersion", "strategyType", "assetUniverse", "riskTolerance", "executionFrequency", "timeHorizon", "entryThreshold", "exitThreshold", "informationSources", "informationBudget", "modelConfiguration"],
    [],
    "$",
  );
  return {
    schemaVersion: literal(g.schemaVersion, 1, "$.schemaVersion"),
    strategyType: literal(g.strategyType, "trading", "$.strategyType"),
    assetUniverse: stringSet(g.assetUniverse, "$.assetUniverse"),
    riskTolerance: finite(g.riskTolerance, "$.riskTolerance"),
    executionFrequency: integer(g.executionFrequency, "$.executionFrequency"),
    timeHorizon: integer(g.timeHorizon, "$.timeHorizon"),
    entryThreshold: finite(g.entryThreshold, "$.entryThreshold"),
    exitThreshold: finite(g.exitThreshold, "$.exitThreshold"),
    informationSources: stringSet(g.informationSources, "$.informationSources"),
    informationBudget: baseUnits(g.informationBudget, "$.informationBudget"),
    modelConfiguration: str(g.modelConfiguration, "$.modelConfiguration"),
  };
}

export function normalizeStrategyVersion(input: unknown): Doc {
  const s = asObject(input, "$");
  onlyKeys(s, ["schemaVersion", "strategyType", "version", "codeDigest"], [], "$");
  return {
    schemaVersion: literal(s.schemaVersion, 1, "$.schemaVersion"),
    strategyType: literal(s.strategyType, "trading", "$.strategyType"),
    version: str(s.version, "$.version"),
    codeDigest: hex(s.codeDigest, 32, "$.codeDigest"),
  };
}

function hexData(value: unknown, path: string): string {
  const s = str(value, path);
  if (!/^0x([0-9a-fA-F]{2})*$/.test(s)) throw new CanonicalizationError(path, "expected 0x-prefixed hex bytes");
  return s.toLowerCase();
}

/**
 * The Policy/Risk Engine rule set of ARCHITECTURE.md section 16.1. Field types and their semantic checks belong to
 * libs/risk; this fixes only what is hashed. `previousHash` is null in memory for version 1 and, per section 16.4
 * rule 3, an absent value is omitted from the hashed object rather than written as null.
 */
export function normalizeRiskPolicy(input: unknown): Doc {
  const d = asObject(input, "$");
  onlyKeys(
    d,
    ["schemaVersion", "version", "effectiveFrom", "settlementAsset", "allowedCalls", "allowedPairs", "perActionCap", "sessionDailyCap", "perTickInformationCap", "dailyInformationCap", "maxPositionFraction"],
    ["previousHash"],
    "$",
  );
  if (!Array.isArray(d.allowedCalls)) throw new CanonicalizationError("$.allowedCalls", "expected an array");
  if (!Array.isArray(d.allowedPairs)) throw new CanonicalizationError("$.allowedPairs", "expected an array");
  const out: Doc = {
    schemaVersion: literal(d.schemaVersion, 1, "$.schemaVersion"),
    version: integer(d.version, "$.version"),
    effectiveFrom: str(d.effectiveFrom, "$.effectiveFrom"),
    settlementAsset: hex(d.settlementAsset, 20, "$.settlementAsset"),
    // Order is kept: section 16.4 rule 1 names only the genome's set fields, and the signed document is hashed as signed
    allowedCalls: d.allowedCalls.map((c, i) => {
      const path = `$.allowedCalls[${i}]`;
      const call = asObject(c, path);
      onlyKeys(call, ["target", "selector", "label"], [], path);
      return { target: hex(call.target, 20, `${path}.target`), selector: hex(call.selector, 4, `${path}.selector`), label: str(call.label, `${path}.label`) };
    }),
    allowedPairs: d.allowedPairs.map((p, i) => str(p, `$.allowedPairs[${i}]`)),
    perActionCap: baseUnits(d.perActionCap, "$.perActionCap"),
    sessionDailyCap: baseUnits(d.sessionDailyCap, "$.sessionDailyCap"),
    perTickInformationCap: baseUnits(d.perTickInformationCap, "$.perTickInformationCap"),
    dailyInformationCap: baseUnits(d.dailyInformationCap, "$.dailyInformationCap"),
    maxPositionFraction: finite(d.maxPositionFraction, "$.maxPositionFraction"),
  };
  if (d.previousHash !== null && d.previousHash !== undefined) out.previousHash = hex(d.previousHash, 32, "$.previousHash");
  return out;
}

/** The `{ tickKey, calls }` object an execution plan's hash commits to (ARCHITECTURE.md section 16.2). Call order is execution order and is kept. */
export function normalizeExecutionPlan(input: unknown): Doc {
  const p = asObject(input, "$");
  onlyKeys(p, ["tickKey", "calls"], [], "$");
  if (!Array.isArray(p.calls)) throw new CanonicalizationError("$.calls", "expected an array");
  return {
    tickKey: str(p.tickKey, "$.tickKey"),
    calls: p.calls.map((c, i) => {
      const path = `$.calls[${i}]`;
      const call = asObject(c, path);
      onlyKeys(call, ["target", "data"], [], path);
      return { target: hex(call.target, 20, `${path}.target`), data: hexData(call.data, `${path}.data`) };
    }),
  };
}

const NORMALIZERS: Record<JcsKind, (input: unknown) => Doc> = {
  genome: normalizeGenome,
  strategyVersion: normalizeStrategyVersion,
  riskPolicy: normalizeRiskPolicy,
  executionPlan: normalizeExecutionPlan,
};

export function normalize(kind: JcsKind, input: unknown): Doc {
  return NORMALIZERS[kind](input);
}

/** The on-chain commitment of a record of any kind: the section 16.4 hash, or a reallocation policy's EIP-712 struct hash. */
export function hashCommitment(kind: CommitmentKind, input: unknown): Hex {
  if (kind === "reallocationPolicy") return hashReallocationPolicy(parseReallocationPolicy(input));
  return taggedHash(TAGS[kind], normalize(kind, input));
}

export const hashGenome = (genome: GenomeV1): Hex => hashCommitment("genome", genome);
export const hashStrategyVersion = (version: StrategyVersionV1): Hex => hashCommitment("strategyVersion", version);
export const hashRiskPolicy = (document: unknown): Hex => hashCommitment("riskPolicy", document);
export const hashExecutionPlan = (plan: { tickKey: string; calls: readonly { target: string; data: string }[] }): Hex =>
  hashCommitment("executionPlan", plan);
