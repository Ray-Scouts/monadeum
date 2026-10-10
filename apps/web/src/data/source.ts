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

/**
 * The sample source. It backs every screen in `sample` mode (`data/config.ts`), the default for local development and
 * tests. In `api` mode the screens read `apps/api` through `data/api/client.ts` instead, in the browser, because the
 * credential (a Privy access token or the wallet session cookie) lives there.
 */
export function getSource(): PopulationSource {
  return (source ??= createMockSource());
}

/** The screens that read `getSource()` always show sample data, so they label it. */
export const IS_SAMPLE_DATA = true;
