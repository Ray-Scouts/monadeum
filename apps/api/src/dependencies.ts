import { randomUUID } from "node:crypto";
import type { AgentStore, EvaluationStore } from "@monadeum/agent-registry";
import type { AuthService } from "@monadeum/auth";
import type { ReallocationPolicyWriter } from "@monadeum/commitment";
import type { ReadModelStore } from "@monadeum/indexer";
import type { PositionStore, RealizedPnl, TradeCounts } from "@monadeum/trading";
import type { AgentWalletStore, WalletsService } from "@monadeum/wallets";
import type { PaymentTotals } from "@monadeum/x402";
import { HttpException } from "@nestjs/common";
import type { ApiSettings } from "./config.js";
import type { EvidenceCrossCheck } from "./evidence-crosscheck.js";
import type { FundingChain } from "./funding-chain.js";
import type { FundingSettings } from "./funding-runtime.js";
import type { FundingStore } from "./funding-store.js";
import type { SignatureRelay } from "./relay.js";
import type { AgentCreation, AgentRegistry, PolicyLedger, RecoveryLog } from "./stores.js";

/** Nest injection token for `ApiDependencies`. */
export const API_DEPENDENCIES = "API_DEPENDENCIES";

/**
 * Everything the request handlers use, assembled by the process (`main.ts`) or a test. The API holds no owner key: the
 * WalletsService it is given signs owner operations only through the SignatureRelay, and its session key vault must
 * be the same vault the worker uses, so a revocation here destroys the key the worker holds. On testnet that is the
 * local encrypted file vault on a directory both processes mount; production needs a secrets manager.
 */
export interface ApiDependencies {
  auth: AuthService;
  /** Null when WALLETS_CHAIN_ID is not set (no chain, bundler, or session key vault): deployment and stop answer 503. */
  wallets: WalletsService | null;
  /** WalletsModule's store, read for an agent's account address and session status. */
  walletStore: AgentWalletStore;
  /** The worker's agent registry: read to serve an agent's genome and principal, and to refuse a request when it names a different owner than the API's record. */
  workerAgents: AgentStore;
  agents: AgentRegistry;
  /** Agent creation's write: the API's record and the worker's agent record together (migration 0008). */
  creation: AgentCreation;
  recovery: RecoveryLog;
  policies: PolicyLedger;
  /** Commits a signed reallocation policy on chain. Null until the reallocation contract (issue #31) is deployed. */
  policyWriter: ReallocationPolicyWriter | null;
  /** The indexer's read-model, read through `monadeum_reader` on Postgres. */
  readModel: ReadModelStore;
  /**
   * The worker's per-agent evaluation records, read through `monadeum_reader` on Postgres, which can only read them.
   * Served per agent only to the agent's owner, and to everyone else only as the population aggregate.
   */
  evaluations: EvaluationStore;
  /** TradingModule's trade store, read for filled-trade counts, through `monadeum_reader` on Postgres. */
  trades: TradeCounts;
  /** X402Module's payment log, read for x402 spend, through `monadeum_reader` on Postgres. */
  payments: PaymentTotals;
  /** TradingModule's positions, read for realized P&L, through `monadeum_reader` on Postgres; `get` serves the public evidence page. */
  positions: RealizedPnl & Pick<PositionStore, "get">;
  /** The Envio HyperSync cross-check of the evidence endpoint (ARCHITECTURE.md section 10). Null unless `ENVIO_API_TOKEN` is set: the field is then absent. */
  crossCheck: EvidenceCrossCheck | null;
  relay: SignatureRelay;
  /** The relayed funding transfer. Null when no relayer is configured: the funding endpoints answer 503. */
  funding: FundingDependencies | null;
  settings: ApiSettings;
  now: () => number;
  newId: () => string;
}

/** The funding relayer's chain adapter (which holds its key), its limits, and the authorization store. */
export interface FundingDependencies {
  chain: FundingChain;
  settings: FundingSettings;
  store: FundingStore;
}

export const defaultClock = { now: Date.now, newId: randomUUID };

/** An error the client sees as `{ error, detail? }` with `status`. Reasons are stable identifiers, not prose. */
export function fail(status: number, error: string, detail?: string): never {
  throw new HttpException(detail ? { error, detail } : { error }, status);
}
