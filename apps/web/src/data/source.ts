import { createMockSource } from "./mock";
import type {
  Agent,
  AgentEvaluation,
  BreakerState,
  EvolutionEvent,
  Limit,
  NepBreakdown,
  Owner,
  Reallocation,
  Trade,
  X402Purchase,
  X402Spend,
} from "./types";

/** Everything the screens read. Async so an API-backed implementation can replace the mock without touching screens. */
export interface PopulationSource {
  listOwners(): Promise<Owner[]>;
  getOwner(id: string): Promise<Owner | null>;
  listAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | null>;
  /** Reallocation moves, oldest evaluation first, optionally for one owner. */
  listReallocations(ownerId?: string): Promise<Reallocation[]>;
  /** Every agent's outcome at the last evaluation. */
  listEvaluations(): Promise<AgentEvaluation[]>;
  getEvaluation(agentId: string): Promise<AgentEvaluation | null>;
  /** First and last evaluation sequence numbers the source holds. */
  evaluationRange(): Promise<{ first: number; last: number }>;
  listTrades(agentId: string): Promise<Trade[]>;
  listPurchases(agentId: string): Promise<X402Purchase[]>;
  getNep(agentId: string): Promise<NepBreakdown | null>;
  listEvents(): Promise<EvolutionEvent[]>;
  getLimits(): Promise<Limit[]>;
  getBreaker(): Promise<BreakerState>;
  getX402Spend(): Promise<X402Spend>;
}

let source: PopulationSource | undefined;

/** The single switch point. Only sample data exists until the API does. */
export function getSource(): PopulationSource {
  return (source ??= createMockSource());
}

/** True while screens show sample data, so they can label it. */
export const IS_SAMPLE_DATA = true;
