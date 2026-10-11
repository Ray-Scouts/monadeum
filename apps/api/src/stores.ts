import type { AgentRecord as WorkerAgentRecord, AgentRegistry as WorkerAgentRegistry } from "@monadeum/agent-registry";
import { decode, encode, isUniqueViolation, PgAgentStore, type Database, type Transaction } from "@monadeum/db";
import type { PriorRecovery, RecoveryHold } from "@monadeum/recovery";
import { getAddress, type Address, type Hex } from "viem";

// Stores the API owns: the agent registry (AgentsModule's record of which owner wallet an agent belongs to), agent
// creation (that record and the worker's agent record, written together), the recovery log behind the bulk recovery
// hold (SECURITY.md section 9), and the owner-signed reallocation policies. Each has an in-memory implementation for
// tests and local development and a Postgres one on migrations 0007 and 0008.

export interface AgentRecord {
  agentId: string;
  /** The owner wallet of the user who created the agent; the owner of its account. Never taken from a request. */
  owner: Address;
  /** Kernel account index. One owner has one index per agent account. */
  index: bigint;
  name: string;
  /** The genome preset the agent was created from (EVOLUTION.md section 1.1); null on a record written before presets. */
  preset: string | null;
  /** The on-chain limits the agent's account is deployed with, settlement-asset base units. */
  limits: { perTxCap: bigint; dailyCap: bigint };
  /** Identity registry token ID (ARCHITECTURE.md section 9), a canonical decimal string; null until the registry exists. */
  registryId: string | null;
  createdAt: number;
}

/**
 * Which owner wallet each agent belongs to. `create` is insert-if-absent: it returns false, and stores nothing, when
 * the agent ID, the (owner, index) pair, or the registry ID is taken.
 */
export interface AgentRegistry {
  create(record: AgentRecord): Promise<boolean>;
  get(agentId: string): Promise<AgentRecord | undefined>;
  /** The owner's agents, oldest first. Owners are compared case-insensitively. */
  listByOwner(owner: Address): Promise<AgentRecord[]>;
  /** One more than the owner's highest index, or 0. */
  nextIndex(owner: Address): Promise<bigint>;
  count(): Promise<number>;
}

export type CreationOutcome = "created" | "conflict" | "population-cap";

/**
 * Agent creation's write: the API's creation record and the worker's agent record (`@monadeum/agent-registry`), both
 * or neither. `create` answers `population-cap`, and writes nothing, when `populationCap` Active agents already exist
 * (EVOLUTION.md section 4), and `conflict` when the agent ID or the (owner, index) pair is taken. Creations are
 * serialized, so two concurrent ones cannot both take the last place under the cap.
 */
export interface AgentCreation {
  create(record: AgentRecord, worker: WorkerAgentRecord, populationCap: number): Promise<CreationOutcome>;
}

export interface StoredHold {
  id: string;
  userId: string;
  hold: RecoveryHold;
  released: boolean;
}

/**
 * The revocations a root wallet started, and the held requests. Root wallets are lowercased addresses. `putHold`
 * throws when the ID exists; `updateHold` throws when it does not.
 */
export interface RecoveryLog {
  record(prior: PriorRecovery): Promise<void>;
  /** Every recorded revocation of `rootWalletId` at or after `from`. */
  since(rootWalletId: string, from: number): Promise<PriorRecovery[]>;
  putHold(hold: StoredHold): Promise<void>;
  updateHold(hold: StoredHold): Promise<void>;
  getHold(id: string): Promise<StoredHold | undefined>;
  listHolds(rootWalletId: string): Promise<StoredHold[]>;
}

export interface SignedPolicy {
  owner: Address;
  sequence: number;
  /** The normalized ReallocationPolicyV1 document, with base-unit fields as decimal strings. */
  document: Record<string, unknown>;
  policyHash: Hex;
  signature: Hex;
  createdAt: number;
}

/** Append-only record of owner-signed reallocation policies. `append` returns false when (owner, sequence) is taken. */
export interface PolicyLedger {
  append(policy: SignedPolicy): Promise<boolean>;
  latest(owner: Address): Promise<SignedPolicy | undefined>;
}

const lower = (a: string) => a.toLowerCase();
const copyAgent = (r: AgentRecord): AgentRecord => ({ ...r, limits: { ...r.limits } });
const activeCount = (agents: readonly WorkerAgentRecord[]) => agents.filter((a) => a.status === "active").length;
const copyHold = (h: StoredHold): StoredHold => ({ ...h, hold: { ...h.hold, agentIds: [...h.hold.agentIds] } });

export class MemoryAgentRegistry implements AgentRegistry {
  private readonly rows = new Map<string, AgentRecord>();

  async create(record: AgentRecord) {
    for (const r of this.rows.values()) {
      if (r.agentId === record.agentId) return false;
      if (lower(r.owner) === lower(record.owner) && r.index === record.index) return false;
      if (record.registryId !== null && r.registryId === record.registryId) return false;
    }
    this.rows.set(record.agentId, copyAgent(record));
    return true;
  }

  async get(agentId: string) {
    const r = this.rows.get(agentId);
    return r ? copyAgent(r) : undefined;
  }

  async listByOwner(owner: Address) {
    return [...this.rows.values()].filter((r) => lower(r.owner) === lower(owner)).sort((a, b) => a.createdAt - b.createdAt || (a.index < b.index ? -1 : 1)).map(copyAgent);
  }

  async nextIndex(owner: Address) {
    let next = 0n;
    for (const r of this.rows.values()) if (lower(r.owner) === lower(owner) && r.index >= next) next = r.index + 1n;
    return next;
  }

  async count() {
    return this.rows.size;
  }
}

/** Agent creation over the in-memory registries, serialized in process. */
export class MemoryAgentCreation implements AgentCreation {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly agents: AgentRegistry,
    private readonly workers: WorkerAgentRegistry,
  ) {}

  create(record: AgentRecord, worker: WorkerAgentRecord, populationCap: number): Promise<CreationOutcome> {
    const run = this.tail.then(async (): Promise<CreationOutcome> => {
      if (activeCount(await this.workers.list()) >= populationCap) return "population-cap";
      if (record.agentId !== worker.agentId || (await this.workers.get(worker.agentId))) return "conflict";
      if (!(await this.agents.create(record))) return "conflict";
      await this.workers.add(worker);
      return "created";
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

export class MemoryRecoveryLog implements RecoveryLog {
  private readonly priors: PriorRecovery[] = [];
  private readonly holds = new Map<string, StoredHold>();

  async record(prior: PriorRecovery) {
    this.priors.push({ ...prior, rootWalletId: lower(prior.rootWalletId) });
  }

  async since(rootWalletId: string, from: number) {
    return this.priors.filter((p) => p.rootWalletId === lower(rootWalletId) && p.at >= from).map((p) => ({ ...p }));
  }

  async putHold(hold: StoredHold) {
    if (this.holds.has(hold.id)) throw new Error(`hold ${hold.id} exists`);
    this.holds.set(hold.id, copyHold(hold));
  }

  async updateHold(hold: StoredHold) {
    if (!this.holds.has(hold.id)) throw new Error(`no hold ${hold.id}`);
    this.holds.set(hold.id, copyHold(hold));
  }

  async getHold(id: string) {
    const h = this.holds.get(id);
    return h ? copyHold(h) : undefined;
  }

  async listHolds(rootWalletId: string) {
    return [...this.holds.values()].filter((h) => lower(h.hold.rootWalletId) === lower(rootWalletId)).map(copyHold);
  }
}

export class MemoryPolicyLedger implements PolicyLedger {
  private readonly rows: SignedPolicy[] = [];

  async append(policy: SignedPolicy) {
    if (this.rows.some((p) => lower(p.owner) === lower(policy.owner) && p.sequence === policy.sequence)) return false;
    this.rows.push(structuredClone(policy));
    return true;
  }

  async latest(owner: Address) {
    const mine = this.rows.filter((p) => lower(p.owner) === lower(owner));
    const best = mine.sort((a, b) => b.sequence - a.sequence)[0];
    return best ? structuredClone(best) : undefined;
  }
}

// Postgres implementations, on the tables of migration 0007. The API connects through a role that is a member of
// `monadeum_api` (see `roleScoped`).

interface AgentBody {
  name: string;
  preset?: string;
  limits: { perTxCap: bigint; dailyCap: bigint };
  owner: Address;
}

interface AgentRow {
  agent_id: string;
  agent_index: string;
  registry_id: string | null;
  created_at: string;
  body: string;
}

const AGENT_COLUMNS = "agent_id, agent_index::text AS agent_index, registry_id::text AS registry_id, created_at::text AS created_at, body::text AS body";

function agentFrom(row: AgentRow): AgentRecord {
  const body = decode<AgentBody>(row.body);
  return {
    agentId: row.agent_id,
    owner: getAddress(body.owner),
    index: BigInt(row.agent_index),
    name: body.name,
    preset: body.preset ?? null,
    limits: body.limits,
    registryId: row.registry_id,
    createdAt: Number(row.created_at),
  };
}

export class PgAgentRegistry implements AgentRegistry {
  constructor(private readonly db: Database) {}

  async create(record: AgentRecord) {
    const body: AgentBody = { name: record.name, limits: record.limits, owner: record.owner, ...(record.preset !== null ? { preset: record.preset } : {}) };
    try {
      const { rows } = await this.db.query(
        `INSERT INTO api_agents (agent_id, owner_key, agent_index, registry_id, created_at, body) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT DO NOTHING RETURNING agent_id`,
        [record.agentId, lower(record.owner), record.index.toString(), record.registryId, record.createdAt, encode(body)],
      );
      return rows.length === 1;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async get(agentId: string) {
    const { rows } = await this.db.query<AgentRow>(`SELECT ${AGENT_COLUMNS} FROM api_agents WHERE agent_id = $1`, [agentId]);
    return rows[0] ? agentFrom(rows[0]) : undefined;
  }

  async listByOwner(owner: Address) {
    const { rows } = await this.db.query<AgentRow>(`SELECT ${AGENT_COLUMNS} FROM api_agents WHERE owner_key = $1 ORDER BY created_at, agent_index`, [lower(owner)]);
    return rows.map(agentFrom);
  }

  async nextIndex(owner: Address) {
    const { rows } = await this.db.query<{ next: string }>("SELECT COALESCE(MAX(agent_index) + 1, 0)::text AS next FROM api_agents WHERE owner_key = $1", [lower(owner)]);
    return BigInt(rows[0]!.next);
  }

  async count() {
    const { rows } = await this.db.query<{ n: string }>("SELECT count(*)::text AS n FROM api_agents");
    return Number(rows[0]!.n);
  }
}

/** Key of the transaction-scoped advisory lock that serializes agent creation across API instances. */
const CREATION_LOCK = 0x6d6f6e61;

/** One open transaction as a `Database`, so the stores below run their statements inside it. */
function within(tx: Transaction): Database {
  return {
    query: (text, params) => tx.query(text, params),
    transaction: (fn) => fn(tx),
  };
}

/**
 * Agent creation on Postgres: one transaction, under `monadeum_api` when `db` is role-scoped, that takes the creation
 * lock, counts Active worker agents, inserts the `api_agents` row, and inserts the `worker_agents` row (0008). Any
 * failure rolls both back. A lost race on the (owner, index) pair is `ON CONFLICT DO NOTHING`, so it never aborts
 * the transaction; it answers `conflict` and the transaction writes nothing.
 */
export class PgAgentCreation implements AgentCreation {
  constructor(private readonly db: Database) {}

  create(record: AgentRecord, worker: WorkerAgentRecord, populationCap: number): Promise<CreationOutcome> {
    if (record.agentId !== worker.agentId) return Promise.resolve("conflict");
    return this.db.transaction(async (tx): Promise<CreationOutcome> => {
      await tx.query("SELECT pg_advisory_xact_lock($1)", [CREATION_LOCK]);
      const { rows } = await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM worker_agents WHERE status = 'active'");
      if (Number(rows[0]!.n) >= populationCap) return "population-cap";
      const scoped = within(tx);
      if (!(await new PgAgentRegistry(scoped).create(record))) return "conflict";
      await new PgAgentStore(scoped).add(worker);
      return "created";
    });
  }
}

export class PgRecoveryLog implements RecoveryLog {
  constructor(private readonly db: Database) {}

  async record(prior: PriorRecovery) {
    await this.db.query("INSERT INTO api_recovery_actions (owner_key, agent_id, at) VALUES ($1, $2, $3)", [lower(prior.rootWalletId), prior.agentId, prior.at]);
  }

  async since(rootWalletId: string, from: number) {
    const { rows } = await this.db.query<{ agent_id: string; at: string }>(
      "SELECT agent_id, at::text AS at FROM api_recovery_actions WHERE owner_key = $1 AND at >= $2 ORDER BY at",
      [lower(rootWalletId), from],
    );
    return rows.map((r) => ({ rootWalletId: lower(rootWalletId), agentId: r.agent_id, at: Number(r.at) }));
  }

  async putHold(hold: StoredHold) {
    await this.db.query(
      "INSERT INTO api_recovery_holds (id, owner_key, user_id, released, body) VALUES ($1, $2, $3, $4, $5::jsonb)",
      [hold.id, lower(hold.hold.rootWalletId), hold.userId, hold.released, encode(hold.hold)],
    );
  }

  async updateHold(hold: StoredHold) {
    const { rows } = await this.db.query("UPDATE api_recovery_holds SET released = $2, body = $3::jsonb WHERE id = $1 RETURNING id", [hold.id, hold.released, encode(hold.hold)]);
    if (rows.length === 0) throw new Error(`no hold ${hold.id}`);
  }

  async getHold(id: string) {
    const { rows } = await this.db.query<{ id: string; user_id: string; released: boolean; body: string }>(
      "SELECT id, user_id, released, body::text AS body FROM api_recovery_holds WHERE id = $1",
      [id],
    );
    const r = rows[0];
    return r ? { id: r.id, userId: r.user_id, released: r.released, hold: decode<RecoveryHold>(r.body) } : undefined;
  }

  async listHolds(rootWalletId: string) {
    const { rows } = await this.db.query<{ id: string; user_id: string; released: boolean; body: string }>(
      "SELECT id, user_id, released, body::text AS body FROM api_recovery_holds WHERE owner_key = $1 ORDER BY id",
      [lower(rootWalletId)],
    );
    return rows.map((r) => ({ id: r.id, userId: r.user_id, released: r.released, hold: decode<RecoveryHold>(r.body) }));
  }
}

export class PgPolicyLedger implements PolicyLedger {
  constructor(private readonly db: Database) {}

  async append(policy: SignedPolicy) {
    try {
      const { rows } = await this.db.query(
        `INSERT INTO api_reallocation_policies (owner_key, sequence, policy_hash, signature, document, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT DO NOTHING RETURNING sequence`,
        [lower(policy.owner), policy.sequence, policy.policyHash, policy.signature, JSON.stringify(policy.document), policy.createdAt],
      );
      return rows.length === 1;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async latest(owner: Address) {
    const { rows } = await this.db.query<{ sequence: number; policy_hash: string; signature: string; document: string; created_at: string }>(
      `SELECT sequence, policy_hash, signature, document::text AS document, created_at::text AS created_at
       FROM api_reallocation_policies WHERE owner_key = $1 ORDER BY sequence DESC LIMIT 1`,
      [lower(owner)],
    );
    const r = rows[0];
    if (!r) return undefined;
    return { owner: getAddress(owner), sequence: r.sequence, policyHash: r.policy_hash as Hex, signature: r.signature as Hex, document: JSON.parse(r.document), createdAt: Number(r.created_at) };
  }
}
