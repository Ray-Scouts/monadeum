import type { Database } from "@monadeum/db";
import { getAddress, type Address, type Hex } from "viem";

// The record of relayed funding authorizations (ARCHITECTURE.md sections 6.1 and 7), in memory for tests and local
// development and on Postgres in migration 0014. The store enforces the two rules the relayer depends on: a nonce is
// prepared once, and a submission is claimed once, atomically with the user's daily relay budget.

export type FundingStatus = "prepared" | "submitted" | "confirmed" | "failed";

/** One EIP-3009 `TransferWithAuthorization`, exactly as the owner signs it. */
export interface FundingAuthorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export interface FundingRecord {
  agentId: string;
  userId: string;
  /** The settlement asset whose domain the authorization is signed in. */
  asset: Address;
  authorization: FundingAuthorization;
  createdAt: number;
  status: FundingStatus;
  /** Set once claimed: the owner's signature and the relayer transaction's hash, written before it is sent. */
  signature: Hex | null;
  txHash: Hex | null;
  submittedAt: number | null;
  blockNumber: bigint | null;
  error: string | null;
}

export type ClaimOutcome = "claimed" | "not-prepared" | "budget-exceeded";

export interface FundingStore {
  /** Insert-if-absent by nonce. False when the nonce exists. */
  prepare(record: FundingRecord): Promise<boolean>;
  get(nonce: Hex): Promise<FundingRecord | undefined>;
  /** Prepared authorizations of the user that have not expired at `nowSeconds`. */
  openCount(userId: string, nowSeconds: bigint): Promise<number>;
  /** Submissions of the user claimed at or after `since` (milliseconds), whatever their outcome. */
  submittedSince(userId: string, since: number): Promise<number>;
  /**
   * Moves a prepared authorization to `submitted` with its signature and transaction hash, only while the user has
   * fewer than `limit` submissions since `since`. The budget check and the claim are one atomic step, so two concurrent
   * submissions cannot both take the last relay of the day, and a nonce is claimed at most once.
   */
  claim(nonce: Hex, input: { signature: Hex; txHash: Hex; at: number; since: number; limit: number }): Promise<ClaimOutcome>;
  /** Settles a submitted authorization. Only `submitted` moves; any other status is left as it is. */
  settle(nonce: Hex, outcome: { status: "confirmed" | "failed"; blockNumber: bigint | null; error: string | null }): Promise<void>;
  listByAgent(agentId: string, limit: number): Promise<FundingRecord[]>;
}

const copy = (r: FundingRecord): FundingRecord => ({ ...r, authorization: { ...r.authorization } });

export class MemoryFundingStore implements FundingStore {
  private readonly rows = new Map<string, FundingRecord>();

  async prepare(record: FundingRecord) {
    const key = record.authorization.nonce.toLowerCase();
    if (this.rows.has(key)) return false;
    this.rows.set(key, copy(record));
    return true;
  }

  async get(nonce: Hex) {
    const r = this.rows.get(nonce.toLowerCase());
    return r ? copy(r) : undefined;
  }

  async openCount(userId: string, nowSeconds: bigint) {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.status === "prepared" && r.authorization.validBefore > nowSeconds).length;
  }

  async submittedSince(userId: string, since: number) {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.submittedAt !== null && r.submittedAt >= since).length;
  }

  // Synchronous between reading and writing, so it is atomic within the process.
  async claim(nonce: Hex, input: { signature: Hex; txHash: Hex; at: number; since: number; limit: number }): Promise<ClaimOutcome> {
    const r = this.rows.get(nonce.toLowerCase());
    if (!r || r.status !== "prepared") return "not-prepared";
    const used = [...this.rows.values()].filter((x) => x.userId === r.userId && x.submittedAt !== null && x.submittedAt >= input.since).length;
    if (used >= input.limit) return "budget-exceeded";
    Object.assign(r, { status: "submitted", signature: input.signature.toLowerCase(), txHash: input.txHash.toLowerCase(), submittedAt: input.at });
    return "claimed";
  }

  async settle(nonce: Hex, outcome: { status: "confirmed" | "failed"; blockNumber: bigint | null; error: string | null }) {
    const r = this.rows.get(nonce.toLowerCase());
    if (r?.status === "submitted") Object.assign(r, outcome);
  }

  async listByAgent(agentId: string, limit: number) {
    return [...this.rows.values()].filter((r) => r.agentId === agentId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(copy);
  }
}

interface Row {
  nonce: string;
  agent_id: string;
  user_id: string;
  owner_key: string;
  account_key: string;
  asset_key: string;
  value: string;
  valid_after: string;
  valid_before: string;
  created_at: string;
  status: FundingStatus;
  signature: string | null;
  tx_hash: string | null;
  submitted_at: string | null;
  block_number: string | null;
  error: string | null;
}

const COLUMNS = `nonce, agent_id, user_id, owner_key, account_key, asset_key, value::text AS value, valid_after::text AS valid_after,
  valid_before::text AS valid_before, created_at::text AS created_at, status, signature, tx_hash, submitted_at::text AS submitted_at,
  block_number::text AS block_number, error`;

function fromRow(r: Row): FundingRecord {
  return {
    agentId: r.agent_id,
    userId: r.user_id,
    asset: getAddress(r.asset_key),
    authorization: {
      from: getAddress(r.owner_key),
      to: getAddress(r.account_key),
      value: BigInt(r.value),
      validAfter: BigInt(r.valid_after),
      validBefore: BigInt(r.valid_before),
      nonce: r.nonce as Hex,
    },
    createdAt: Number(r.created_at),
    status: r.status,
    signature: r.signature as Hex | null,
    txHash: r.tx_hash as Hex | null,
    submittedAt: r.submitted_at === null ? null : Number(r.submitted_at),
    blockNumber: r.block_number === null ? null : BigInt(r.block_number),
    error: r.error,
  };
}

/** Advisory lock namespace for the per-user budget claim; the second key is the user ID's hash. */
const BUDGET_LOCK = 0x66756e64;

/** On migration 0014, under `monadeum_api` when `db` is role-scoped. */
export class PgFundingStore implements FundingStore {
  constructor(private readonly db: Database) {}

  async prepare(record: FundingRecord) {
    const a = record.authorization;
    const { rows } = await this.db.query(
      `INSERT INTO api_funding_authorizations (nonce, agent_id, user_id, owner_key, account_key, asset_key, value, valid_after, valid_before, created_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'prepared') ON CONFLICT DO NOTHING RETURNING nonce`,
      [a.nonce.toLowerCase(), record.agentId, record.userId, a.from.toLowerCase(), a.to.toLowerCase(), record.asset.toLowerCase(), a.value.toString(), a.validAfter.toString(), a.validBefore.toString(), record.createdAt],
    );
    return rows.length === 1;
  }

  async get(nonce: Hex) {
    const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM api_funding_authorizations WHERE nonce = $1`, [nonce.toLowerCase()]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async openCount(userId: string, nowSeconds: bigint) {
    const { rows } = await this.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM api_funding_authorizations WHERE user_id = $1 AND status = 'prepared' AND valid_before > $2",
      [userId, nowSeconds.toString()],
    );
    return Number(rows[0]!.n);
  }

  async submittedSince(userId: string, since: number) {
    const { rows } = await this.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM api_funding_authorizations WHERE user_id = $1 AND submitted_at >= $2",
      [userId, since],
    );
    return Number(rows[0]!.n);
  }

  claim(nonce: Hex, input: { signature: Hex; txHash: Hex; at: number; since: number; limit: number }): Promise<ClaimOutcome> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ user_id: string }>("SELECT user_id FROM api_funding_authorizations WHERE nonce = $1 AND status = 'prepared'", [nonce.toLowerCase()]);
      const userId = rows[0]?.user_id;
      if (userId === undefined) return "not-prepared";
      // Serializes claims of one user across API instances for the rest of this transaction.
      await tx.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [BUDGET_LOCK, userId]);
      const used = await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM api_funding_authorizations WHERE user_id = $1 AND submitted_at >= $2", [userId, input.since]);
      if (Number(used.rows[0]!.n) >= input.limit) return "budget-exceeded";
      const claimed = await tx.query(
        `UPDATE api_funding_authorizations SET status = 'submitted', signature = $2, tx_hash = $3, submitted_at = $4
         WHERE nonce = $1 AND status = 'prepared' RETURNING nonce`,
        [nonce.toLowerCase(), input.signature.toLowerCase(), input.txHash.toLowerCase(), input.at],
      );
      return claimed.rows.length === 1 ? "claimed" : "not-prepared";
    });
  }

  async settle(nonce: Hex, outcome: { status: "confirmed" | "failed"; blockNumber: bigint | null; error: string | null }) {
    await this.db.query(
      "UPDATE api_funding_authorizations SET status = $2, block_number = $3, error = $4 WHERE nonce = $1 AND status = 'submitted'",
      [nonce.toLowerCase(), outcome.status, outcome.blockNumber === null ? null : outcome.blockNumber.toString(), outcome.error],
    );
  }

  async listByAgent(agentId: string, limit: number) {
    const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM api_funding_authorizations WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`, [agentId, limit]);
    return rows.map(fromRow);
  }
}
