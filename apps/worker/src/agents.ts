import type { Provider } from "@monadeum/x402";
import type { Hex } from "viem";

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
 * Durable agent registry and running state. In-memory only: durable stores are added separately, and this interface is
 * what they implement. `update` replaces the record.
 */
export interface AgentStore {
  list(): Promise<AgentRecord[]>;
  get(agentId: string): Promise<AgentRecord | undefined>;
  update(record: AgentRecord): Promise<void>;
  state(agentId: string): Promise<AgentState>;
  saveState(agentId: string, state: AgentState): Promise<void>;
}

export class MemoryAgentStore implements AgentStore {
  private readonly records = new Map<string, AgentRecord>();
  private readonly states = new Map<string, AgentState>();

  add(record: AgentRecord): void {
    if (this.records.has(record.agentId)) throw new Error(`agent ${record.agentId} exists`);
    this.records.set(record.agentId, structuredClone({ ...record, owner: record.owner.toLowerCase() as Hex }));
  }
  async list() {
    return [...this.records.values()].map((r) => structuredClone(r));
  }
  async get(agentId: string) {
    const r = this.records.get(agentId);
    return r ? structuredClone(r) : undefined;
  }
  async update(record: AgentRecord) {
    if (!this.records.has(record.agentId)) throw new Error(`no agent ${record.agentId}`);
    this.records.set(record.agentId, structuredClone(record));
  }
  async state(agentId: string): Promise<AgentState> {
    const s = this.states.get(agentId);
    if (s) return structuredClone(s);
    const record = this.records.get(agentId);
    // A new agent may trade on its first tick.
    return {
      ticksSinceTrade: record?.genome.executionFrequency ?? 1,
      informationByDay: {}, returns: [], tradeCounts: [], measured: [], net: 0, lowFitnessWindows: 0,
    };
  }
  async saveState(agentId: string, state: AgentState) {
    this.states.set(agentId, structuredClone(state));
  }
}
