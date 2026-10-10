import type { Decision } from "@monadeum/risk";
import type { Provider } from "@monadeum/x402";
import type { Hex } from "viem";

// The worker's agent registry, per-agent running state, and reallocation debit records: the store interfaces and
// their in-memory implementations. A package of its own so `@monadeum/db` can implement them on Postgres without
// depending on `apps/worker` (ARCHITECTURE.md section 10, database layer entry).

/** What the worker knows about one agent. Written by agent creation (AgentsModule); the worker only reads it. */
export interface AgentRecord {
  agentId: string;
  /** The owner's root wallet, lowercase. */
  owner: Hex;
  account: Hex;
  genomeHash: Hex;
  genome: {
    riskTolerance: number;
    executionFrequency: number;
    /** Per-tick information budget, settlement-asset base units. */
    informationBudget: bigint;
    informationSources: readonly Provider[];
    pair: string;
    assetUniverse: readonly string[];
  };
  /** Owner deposits minus owner withdrawals, base units. Reallocation never changes it. */
  principal: bigint;
  status: "active" | "retired";
}

/** The worker's per-agent running state: trade cadence, information spend, and the fitness history. */
export interface AgentState {
  ticksSinceTrade: number;
  /** Information spend per UTC day, base units. */
  informationByDay: Record<string, bigint>;
  /** Per-tick return net of every cost (EVOLUTION.md section 2.1), oldest first. */
  returns: number[];
  /** Filled trades per tick, aligned with `returns`. */
  tradeCounts: number[];
  /** Tick keys already measured, so a measurement replayed after a crash is not counted twice. */
  measured: string[];
  /** Net economic performance so far, settlement-asset units. */
  net: number;
  lowFitnessWindows: number;
}

/**
 * The agent registry and running state as the worker uses them. `update` replaces the record of an existing agent
 * and throws for an unknown one; `state` returns the initial state for an agent with none saved; `saveState` throws
 * for an unknown agent.
 */
export interface AgentStore {
  list(): Promise<AgentRecord[]>;
  get(agentId: string): Promise<AgentRecord | undefined>;
  update(record: AgentRecord): Promise<void>;
  state(agentId: string): Promise<AgentState>;
  saveState(agentId: string, state: AgentState): Promise<void>;
}

/** The registry with the write agent creation makes. `add` throws when the agent ID exists; it lowercases the owner. */
export interface AgentRegistry extends AgentStore {
  add(record: AgentRecord): Promise<void>;
}

/** The state of an agent before its first tick: a new agent may trade on its first tick. */
export function initialState(record: AgentRecord | undefined): AgentState {
  return {
    ticksSinceTrade: record?.genome.executionFrequency ?? 1,
    informationByDay: {}, returns: [], tradeCounts: [], measured: [], net: 0, lowFitnessWindows: 0,
  };
}

/** For tests and local development. Not durable. */
export class MemoryAgentStore implements AgentRegistry {
  private readonly records = new Map<string, AgentRecord>();
  private readonly states = new Map<string, AgentState>();

  async add(record: AgentRecord): Promise<void> {
    if (this.records.has(record.agentId)) throw new Error(`agent ${record.agentId} exists`);
    this.records.set(record.agentId, structuredClone({ ...record, owner: record.owner.toLowerCase() as Hex }));
  }
  async list() {
    return [...this.records.values()].sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0)).map((r) => structuredClone(r));
  }
  async get(agentId: string) {
    const r = this.records.get(agentId);
    return r ? structuredClone(r) : undefined;
  }
  async update(record: AgentRecord) {
    if (!this.records.has(record.agentId)) throw new Error(`no agent ${record.agentId}`);
    this.records.set(record.agentId, structuredClone({ ...record, owner: record.owner.toLowerCase() as Hex }));
  }
  async state(agentId: string): Promise<AgentState> {
    const s = this.states.get(agentId);
    return s ? structuredClone(s) : initialState(this.records.get(agentId));
  }
  async saveState(agentId: string, state: AgentState) {
    if (!this.records.has(agentId)) throw new Error(`no agent ${agentId}`);
    this.states.set(agentId, structuredClone(state));
  }
}

export interface DebitRecord {
  key: string;
  /** approved: written before submission. settled / failed / rejected: final. */
  status: "approved" | "settled" | "failed" | "rejected";
  planHash: Hex | null;
  decision: Decision;
  reason: string | null;
}

/** Durable per-debit record keyed by (owner, evaluation sequence, source). `claim` is insert-if-absent. */
export interface DebitStore {
  get(key: string): Promise<DebitRecord | undefined>;
  claim(record: DebitRecord): Promise<boolean>;
  write(record: DebitRecord): Promise<void>;
}

/** For tests and local development. Not durable. */
export class MemoryDebitStore implements DebitStore {
  private readonly rows = new Map<string, DebitRecord>();
  async get(key: string) {
    const r = this.rows.get(key);
    return r ? structuredClone(r) : undefined;
  }
  async claim(record: DebitRecord) {
    if (this.rows.has(record.key)) return false;
    this.rows.set(record.key, structuredClone(record));
    return true;
  }
  async write(record: DebitRecord) {
    this.rows.set(record.key, structuredClone(record));
  }
  all(): DebitRecord[] {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
}
