import { concat, keccak256, stringToBytes, type Hex } from "viem";

// ARCHITECTURE.md section 16.4. Genome-specific normalization (sorting set fields) belongs to the genome hash work.
export type HashTag = "monadeum:genome:v1" | "monadeum:strategy:v1" | "monadeum:policy:v1" | "monadeum:plan:v1";

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite number");
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, normalize(v)]));
  }
  return value;
}

// Sorted-key JSON.stringify is RFC 8785 in JavaScript; check against the RFC vectors if a non-JS implementation appears
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function hashOf(tag: HashTag, value: unknown): Hex {
  return keccak256(concat([stringToBytes(tag), new Uint8Array([0]), stringToBytes(canonicalJson(value))]));
}
