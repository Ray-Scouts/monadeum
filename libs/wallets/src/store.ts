import type { Address, Hex } from "viem";
import type { OperationReceipt } from "./chain.js";

export interface SessionRecord {
  keyAddress: Address;
  /** Kernel permission ID of the session key's permission validator. */
  permissionId: Hex;
  /** The owner's enable signature. Together with the key it is a bearer credential until revoked (SECURITY.md section 11). */
  enableSignature: Hex;
  /** Kernel `currentNonce` the enable signature is bound to. Revocation is verified by the nonce moving past it. */
  enableNonce: number;
  status: "active" | "revoking" | "revoked";
  issuedAt: number;
  revokedAt: number | null;
  revokeUserOpHash: Hex | null;
}

/**
 * The agent's x402 key (ARCHITECTURE.md section 16.3, x402 signature path): a second key, separate from the session
 * key, trusted only by X402PaymentValidator. `installing` is written before the owner operation that installs the
 * validator is submitted, so a crash can always find the key's address again.
 */
export interface X402KeyRecord {
  keyAddress: Address;
  /** The X402PaymentValidator the key was installed on, kept so revocation still finds it if configuration changes. */
  validator: Address;
  status: "installing" | "active" | "revoking" | "revoked";
  installedAt: number | null;
  revokedAt: number | null;
}

export interface AgentWalletRecord {
  agentId: string;
  owner: Address;
  /** Kernel account index. One owner has one index per agent account. */
  index: bigint;
  account: Address;
  deployment: { status: "pending" | "deployed"; userOpHash: Hex | null };
  session: SessionRecord | null;
  /** Absent on records written before the x402 key existed, which reads as null. */
  x402?: X402KeyRecord | null;
}

/** One signed operation for a tick. Recorded before it is submitted, so a crash can never lose its hash. */
export interface TickAttempt {
  userOpHash: Hex;
  nonce: bigint;
  sponsored: boolean;
  /** Sponsorship reserved for it in the ledger, settled when its receipt is seen. 0 when the account paid. */
  reserved: bigint;
  /** The bundler answered and refused it, so it was never accepted. */
  rejected: boolean;
}

/** Session-key operation keyed by (agent ID, tick key), for at-most-once submission across restarts. */
export interface TickOperationRecord {
  agentId: string;
  tickKey: string;
  account: Address;
  /** keccak256 of the encoded calls. A tick key is bound to one set of calls. */
  callsHash: Hex;
  /** Every attempt, oldest first. Re-attempts reuse the nonce of the attempt they replace. */
  attempts: TickAttempt[];
  included: { userOpHash: Hex; receipt: OperationReceipt } | null;
}

/**
 * Durable store. `claim` and `claimOperation` are insert-if-absent. `claim` is keyed by agent ID and, separately,
 * unique by account address (compared case-insensitively); `claimOperation` by (agent ID, tick key). `update` and
 * `updateOperation` throw when the record does not exist, and `update` throws when the new account address belongs
 * to another agent. `listOperations` returns an agent's operations in claim order. A write must be durable before it
 * returns: the service submits an operation only after its attempt has been written. `@monadeum/db` provides the
 * Postgres implementation.
 */
export interface AgentWalletStore {
  get(agentId: string): Promise<AgentWalletRecord | undefined>;
  claim(record: AgentWalletRecord): Promise<boolean>;
  update(record: AgentWalletRecord): Promise<void>;
  findByAccount(account: Address): Promise<AgentWalletRecord | undefined>;
  getOperation(agentId: string, tickKey: string): Promise<TickOperationRecord | undefined>;
  claimOperation(record: TickOperationRecord): Promise<boolean>;
  updateOperation(record: TickOperationRecord): Promise<void>;
  listOperations(agentId: string): Promise<TickOperationRecord[]>;
}

/**
 * Holds session private keys. Production backs this with a secrets manager (SECURITY.md section 11); keys never
 * go to the database, a log, or source control, so `@monadeum/db` deliberately provides no implementation of this
 * interface. `destroy` must make the key unrecoverable from this store. The x402 key is held in a second, separate
 * vault instance (WalletsService refuses the same instance for both), so a lookup for one key can never return the
 * other.
 */
export interface SessionKeyVault {
  put(agentId: string, privateKey: Hex): Promise<void>;
  get(agentId: string): Promise<Hex | null>;
  destroy(agentId: string): Promise<void>;
}

const copy = (r: AgentWalletRecord): AgentWalletRecord =>
  ({
    ...r,
    deployment: { ...r.deployment },
    session: r.session ? { ...r.session } : null,
    ...(r.x402 === undefined ? {} : { x402: r.x402 ? { ...r.x402 } : null }),
  });

const copyOp = (r: TickOperationRecord): TickOperationRecord =>
  ({ ...r, attempts: r.attempts.map((a) => ({ ...a })), included: r.included ? { ...r.included } : null });

export class MemoryAgentWalletStore implements AgentWalletStore {
  private readonly byAgent = new Map<string, AgentWalletRecord>();
  private readonly operations = new Map<string, TickOperationRecord>();
  private readonly opKey = (agentId: string, tickKey: string) => JSON.stringify([agentId, tickKey]);

  async findByAccount(account: Address) {
    for (const r of this.byAgent.values()) if (r.account.toLowerCase() === account.toLowerCase()) return copy(r);
    return undefined;
  }

  async getOperation(agentId: string, tickKey: string) {
    const r = this.operations.get(this.opKey(agentId, tickKey));
    return r ? copyOp(r) : undefined;
  }

  async claimOperation(record: TickOperationRecord) {
    const key = this.opKey(record.agentId, record.tickKey);
    if (this.operations.has(key)) return false;
    this.operations.set(key, copyOp(record));
    return true;
  }

  async updateOperation(record: TickOperationRecord) {
    const key = this.opKey(record.agentId, record.tickKey);
    if (!this.operations.has(key)) throw new Error(`no operation record for ${key}`);
    this.operations.set(key, copyOp(record));
  }

  async listOperations(agentId: string) {
    return [...this.operations.values()].filter((r) => r.agentId === agentId).map(copyOp);
  }

  async get(agentId: string) {
    const r = this.byAgent.get(agentId);
    return r ? copy(r) : undefined;
  }

  async claim(record: AgentWalletRecord) {
    if (this.byAgent.has(record.agentId)) return false;
    for (const r of this.byAgent.values()) if (r.account.toLowerCase() === record.account.toLowerCase()) return false;
    this.byAgent.set(record.agentId, copy(record));
    return true;
  }

  async update(record: AgentWalletRecord) {
    if (!this.byAgent.has(record.agentId)) throw new Error(`no wallet record for ${record.agentId}`);
    for (const r of this.byAgent.values()) {
      if (r.agentId !== record.agentId && r.account.toLowerCase() === record.account.toLowerCase()) {
        throw new Error(`account ${record.account} belongs to another agent`);
      }
    }
    this.byAgent.set(record.agentId, copy(record));
  }
}

/** In-process vault for tests and local development only. */
export class MemorySessionKeyVault implements SessionKeyVault {
  private readonly keys = new Map<string, Hex>();
  async put(agentId: string, privateKey: Hex) {
    if (this.keys.has(agentId)) throw new Error(`a session key is already held for ${agentId}`);
    this.keys.set(agentId, privateKey);
  }
  async get(agentId: string) {
    return this.keys.get(agentId) ?? null;
  }
  async destroy(agentId: string) {
    this.keys.delete(agentId);
  }
}
