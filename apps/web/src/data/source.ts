import { createMockSource } from "./mock";
import type {
  Agent,
  BreakerState,
  EvolutionEvent,
  Limit,
  NepBreakdown,
  Reproduction,
  Trade,
  X402Purchase,
  X402Spend,
} from "./types";

/** Everything the screens read. Async so an API-backed implementation can replace the mock without touching screens. */
export interface PopulationSource {
  listAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | null>;
  listReproductions(): Promise<Reproduction[]>;
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
