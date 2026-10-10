import { hashRiskPolicy } from "@monadeum/commitment";
import type { PolicyDocument, SignedPolicy } from "@monadeum/risk";
import type { Address, Hex } from "viem";
import { decode, encode } from "./codec.js";
import { isUniqueViolation, type Database } from "./database.js";

/**
 * The append-only policy-document table (ARCHITECTURE.md section 16.1, migration 0003). `append` is for the operator
 * role, `list` for the worker. Neither verifies a signature: `loadPolicy` in `@monadeum/risk` does, on every load,
 * against the signer pinned in the worker's configuration. The stored hash is computed here from the document, never
 * taken from the caller.
 */
export class PgPolicyVersions {
  constructor(private readonly db: Database) {}

  /** Appends one signed version. Throws if the version, or a document with the same hash, is already stored. */
  async append(input: { document: PolicyDocument; signer: Address; signature: Hex }): Promise<void> {
    try {
      await this.db.query(
        "INSERT INTO risk_policy_versions (version, document, policy_hash, signer, signature) VALUES ($1, $2::jsonb, $3, $4, $5)",
        [input.document.version, encode(input.document), hashRiskPolicy(input.document), input.signer, input.signature],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`policy version ${input.document.version} or an identical document is already stored`);
      throw error;
    }
  }

  /** Every stored version in version order, the rows `loadPolicy` verifies. */
  async list(): Promise<SignedPolicy[]> {
    const { rows } = await this.db.query<{ document: string; signature: string }>(
      "SELECT document::text AS document, signature FROM risk_policy_versions ORDER BY version",
    );
    return rows.map((r) => ({ document: decode<PolicyDocument>(r.document), signature: r.signature as Hex }));
  }
}
