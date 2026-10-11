import { randomUUID } from "node:crypto";
import type { AgentStore } from "@monadeum/agent-registry";
import type { AuthService } from "@monadeum/auth";
import type { ReallocationPolicyWriter } from "@monadeum/commitment";
import type { ReadModelStore } from "@monadeum/indexer";
import type { TradeCounts } from "@monadeum/trading";
import type { AgentWalletStore, WalletsService } from "@monadeum/wallets";
import type { PaymentTotals } from "@monadeum/x402";
import { HttpException } from "@nestjs/common";
import type { ApiSettings } from "./config.js";
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
  /** TradingModule's trade store, read for filled-trade counts, through `monadeum_reader` on Postgres. */
  trades: TradeCounts;
  /** X402Module's payment log, read for x402 spend, through `monadeum_reader` on Postgres. */
  payments: PaymentTotals;
  relay: SignatureRelay;
  settings: ApiSettings;
  now: () => number;
  newId: () => string;
}

export const defaultClock = { now: Date.now, newId: randomUUID };

/** An error the client sees as `{ error, detail? }` with `status`. Reasons are stable identifiers, not prose. */
export function fail(status: number, error: string, detail?: string): never {
  throw new HttpException(detail ? { error, detail } : { error }, status);
}
