import type { GenomeV1 } from "@monadeum/commitment";
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
  /**
   * The full genome document `genomeHash` commits to, normalized as `libs/commitment` hashes it (ARCHITECTURE.md
   * sections 9 and 16.4). `genome` above is the part the worker reads, derived from it. Written by agent creation;
   * absent only on records written before creation stored it, which cannot be verified against their hash.
   */
  genomeDocument?: GenomeV1;
  /**
   * Owner deposits minus owner withdrawals, base units, floored at 0. Reallocation never changes it. 0 at creation;
   * the worker's principal job recomputes it from finalized indexed transfers (EVOLUTION.md section 1.1,
   * `principalFrom` in `@monadeum/read-model`). The worker neither ticks nor evaluates an agent whose principal is 0.
   */
  principal: bigint;
  /**
   * The finalized block the principal job computed `principal` through when it last changed it, or absent while it
   * is still the creation value. The job never writes a value computed through an earlier block than this one.
   */
  principalBlock?: bigint;
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

/**
 * One agent's outcome in one evaluation (ARCHITECTURE.md section 5), as the worker computed it. Written once per
 * Active, funded agent per evaluation, after the evaluation's last step; never changed afterwards.
 */
export interface EvaluationRecord {
  /** The evaluation sequence: the evaluation tick divided by the evaluation cadence. */
  sequence: number;
  agentId: string;
  /** When the worker ran the evaluation, milliseconds since the Unix epoch, from the worker's clock. */
  evaluatedAt: number;
  /** The agent account's settlement-asset balance read during the evaluation, base units. */
  capital: bigint;
  /** Adjusted fitness (EVOLUTION.md section 2), or null when the agent has none this window. */
  adjustedFitness: number | null;
  /**
   * The adjusted fitness percentile within the agent's niche, in [0, 1], computed exactly as the section 6 starvation
   * check computes it: `percentile` of `@monadeum/fitness` over the adjusted fitness of every Active agent in the
   * niche that has one, the agent's own included. Null when the agent has no adjusted fitness.
   */
  fitnessPercentile: number | null;
  rawSortino: number | null;
  zeroDownsideFlag: boolean;
  /** Filled trades in the trailing window. */
  tradeCount: number;
  /** The starvation count carried out of this evaluation: consecutive bottom-decile windows within the niche. */
  lowWindows: number;
  retired: boolean;
  /** The section 6 rule that retired the agent in this evaluation, or null when it was not retired. */
  retirementRule: string | null;
}

/**
 * The evaluation history the worker writes and the API reads. `record` is insert-if-absent per (agent, sequence): a
 * record already present is kept unchanged, so a rerun of an evaluation does not rewrite what the first run recorded.
 */
export interface EvaluationStore {
  record(records: readonly EvaluationRecord[]): Promise<void>;
  /** The agent's most recent `limit` records, oldest first. */
  history(agentId: string, limit: number): Promise<EvaluationRecord[]>;
  /** Every record of the highest sequence recorded, ordered by agent ID; empty before any evaluation is recorded. */
  latest(): Promise<EvaluationRecord[]>;
}

/** For tests and local development. Not durable. */
export class MemoryEvaluationStore implements EvaluationStore {
  private readonly rows = new Map<string, EvaluationRecord>();

  async record(records: readonly EvaluationRecord[]) {
    for (const r of records) {
      const key = `${r.agentId}:${r.sequence}`;
      if (!this.rows.has(key)) this.rows.set(key, structuredClone(r));
    }
  }
  async history(agentId: string, limit: number) {
    const mine = [...this.rows.values()].filter((r) => r.agentId === agentId).sort((a, b) => a.sequence - b.sequence);
    return (limit > 0 ? mine.slice(-limit) : []).map((r) => structuredClone(r));
  }
  async latest() {
    let top = -1;
    for (const r of this.rows.values()) if (r.sequence > top) top = r.sequence;
    return [...this.rows.values()]
      .filter((r) => r.sequence === top)
      .sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0))
      .map((r) => structuredClone(r));
  }
}

/** The two signals of the population-level circuit breaker (SECURITY.md section 9, layer 3). */
export type BreakerSignal = "capital-at-risk" | "reallocation-volume";

/**
 * One entry of the breaker's append-only log. The worker appends a `trip` when a signal crosses its threshold; only a
 * human, through the policy operator's CLI, appends a `clear`. The latest entry is the breaker's state.
 */
export type BreakerEvent =
  | { kind: "trip"; signal: BreakerSignal; observed: bigint; threshold: bigint; actor: string; reason: string; recordedAt: number }
  | { kind: "clear"; actor: string; reason: string; recordedAt: number };

export interface BreakerStore {
  append(event: BreakerEvent): Promise<void>;
  /** The most recent entry, or null when the log is empty. */
  latest(): Promise<BreakerEvent | null>;
}

/** For tests and local development. Not durable: a restart forgets a trip, so production uses the Postgres store. */
export class MemoryBreakerStore implements BreakerStore {
  readonly events: BreakerEvent[] = [];
  async append(event: BreakerEvent) {
    this.events.push(structuredClone(event));
  }
  async latest() {
    const last = this.events.at(-1);
    return last ? structuredClone(last) : null;
  }
}
