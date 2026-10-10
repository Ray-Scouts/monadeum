import type { Hex } from "viem";
import { CanonicalizationError } from "./canonical.js";
import { hashCommitment, type CommitmentKind } from "./documents.js";

const BYTES32 = /^0x[0-9a-f]{64}$/;
const ZERO = `0x${"0".repeat(64)}`;

/** SECURITY.md section 12: a commitment whose off-chain record does not match its on-chain hash is alerted on immediately. */
export interface CommitmentAlert {
  severity: "critical";
  rule: "security-12-commitment-mismatch";
  kind: CommitmentKind;
  /** What the record belongs to, for example an agent ID or an owner address. */
  subject: string;
  reason: MismatchReason;
  onChainHash: string;
  /** Present when the off-chain record could be hashed. */
  recomputedHash?: Hex;
  detail: string;
}

export type MismatchReason =
  /** The record hashes to a different value than the chain holds. */
  | "hash-mismatch"
  /** The chain holds no commitment (zero hash) for a record that exists off-chain. */
  | "no-on-chain-commitment"
  /** The value read from the chain is not a 32-byte hash. */
  | "malformed-on-chain-hash"
  /** The off-chain record cannot be canonicalized, so it cannot be the record that was committed. */
  | "invalid-record";

export type VerificationResult =
  | { ok: true; kind: CommitmentKind; subject: string; hash: Hex }
  | { ok: false; alert: CommitmentAlert };

/**
 * Recomputes the section 16.4 hash of an off-chain record and compares it with the hash read from the chain.
 * Every failure is a section 12 alert: a record that cannot be verified is treated as a record that does not match.
 */
export function verifyCommitment(kind: CommitmentKind, subject: string, record: unknown, onChainHash: string): VerificationResult {
  const fail = (reason: MismatchReason, detail: string, recomputedHash?: Hex): VerificationResult => ({
    ok: false,
    alert: { severity: "critical", rule: "security-12-commitment-mismatch", kind, subject, reason, onChainHash, recomputedHash, detail },
  });
  const claimed = onChainHash.toLowerCase();
  if (!BYTES32.test(claimed)) return fail("malformed-on-chain-hash", "on-chain value is not 32 bytes of 0x-prefixed hex");
  if (claimed === ZERO) return fail("no-on-chain-commitment", "on-chain commitment is the zero hash");
  let recomputed: Hex;
  try {
    recomputed = hashCommitment(kind, record);
  } catch (error) {
    if (error instanceof CanonicalizationError) return fail("invalid-record", error.message);
    throw error;
  }
  if (recomputed !== claimed) return fail("hash-mismatch", `off-chain record hashes to ${recomputed}`, recomputed);
  return { ok: true, kind, subject, hash: recomputed };
}
