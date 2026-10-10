import type { Address, Hex } from "viem";

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

export interface AgentWalletRecord {
  agentId: string;
  owner: Address;
  /** Kernel account index. One owner has one index per agent account. */
  index: bigint;
  account: Address;
  deployment: { status: "pending" | "deployed"; userOpHash: Hex | null };
  session: SessionRecord | null;
}

/** Durable store. `claim` is insert-if-absent, keyed by agent ID and, separately, unique by account address. */
export interface AgentWalletStore {
  get(agentId: string): Promise<AgentWalletRecord | undefined>;
  claim(record: AgentWalletRecord): Promise<boolean>;
  update(record: AgentWalletRecord): Promise<void>;
}

/**
 * Holds session private keys. Production backs this with a secrets manager (SECURITY.md section 11); keys never
 * go to the database, a log, or source control. `destroy` must make the key unrecoverable from this store.
 */
export interface SessionKeyVault {
  put(agentId: string, privateKey: Hex): Promise<void>;
  get(agentId: string): Promise<Hex | null>;
  destroy(agentId: string): Promise<void>;
}

const copy = (r: AgentWalletRecord): AgentWalletRecord =>
  ({ ...r, deployment: { ...r.deployment }, session: r.session ? { ...r.session } : null });

export class MemoryAgentWalletStore implements AgentWalletStore {
  private readonly byAgent = new Map<string, AgentWalletRecord>();

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
