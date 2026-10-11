import {
  AuthService,
  MemoryChallengeStore,
  MemorySessionStore,
  MemoryUserStore,
  type AuthSettings,
  type ChallengeStore,
  type OwnerWalletHandoff,
  type PrivyVerifier,
  type SessionStore,
  type UserStore,
} from "@monadeum/auth";
import { MemoryAgentStore, MemoryEvaluationStore, type AgentStore, type EvaluationStore } from "@monadeum/agent-registry";
import type { ReallocationPolicyWriter } from "@monadeum/commitment";
import { PgAgentStore, PgAgentWalletStore, PgChallengeStore, PgEvaluationStore, PgPaymentLog, PgReadModelStore, PgSessionStore, PgSponsorshipLedger, PgTradeStore, PgUserStore, type Database } from "@monadeum/db";
import { InMemoryReadModelStore, type ReadModelStore } from "@monadeum/indexer";
import { MemoryTradeStore, type TradeCounts } from "@monadeum/trading";
import { MemoryAgentWalletStore, MemorySponsorshipLedger, type AgentWalletStore, type SponsorshipLedger, type WalletsService } from "@monadeum/wallets";
import { MemoryPaymentLog, type PaymentTotals } from "@monadeum/x402";
import type { ApiSettings } from "./config.js";
import { API_ROLE, READER_ROLE, roleScoped } from "./database.js";
import { defaultClock, type ApiDependencies } from "./dependencies.js";
import { SignatureRelay } from "./relay.js";
import {
  MemoryAgentCreation,
  MemoryAgentRegistry,
  MemoryPolicyLedger,
  MemoryRecoveryLog,
  PgAgentCreation,
  PgAgentRegistry,
  PgPolicyLedger,
  PgRecoveryLog,
  type AgentCreation,
  type AgentRegistry,
  type PolicyLedger,
  type RecoveryLog,
} from "./stores.js";

/** Every store the API reads or writes. */
export interface ApiStores {
  users: UserStore;
  challenges: ChallengeStore;
  sessions: SessionStore;
  walletStore: AgentWalletStore;
  /** The worker's agent registry; the API reads it and writes it only through `creation`. */
  workerAgents: AgentStore;
  ledger: SponsorshipLedger;
  agents: AgentRegistry;
  creation: AgentCreation;
  recovery: RecoveryLog;
  policies: PolicyLedger;
  readModel: ReadModelStore;
  /** The worker's evaluation records (migration 0013), read only. */
  evaluations: EvaluationStore;
  /** The worker's trade store and x402 payment log, read only: the API never writes either. */
  trades: TradeCounts;
  payments: PaymentTotals;
}

/** In-memory stores, for tests and local development only. Nothing survives a restart. */
export function memoryStores(): ApiStores {
  const workerAgents = new MemoryAgentStore();
  const agents = new MemoryAgentRegistry();
  return {
    users: new MemoryUserStore(),
    challenges: new MemoryChallengeStore(),
    sessions: new MemorySessionStore(),
    walletStore: new MemoryAgentWalletStore(),
    workerAgents,
    ledger: new MemorySponsorshipLedger(),
    agents,
    creation: new MemoryAgentCreation(agents, workerAgents),
    recovery: new MemoryRecoveryLog(),
    policies: new MemoryPolicyLedger(),
    readModel: new InMemoryReadModelStore(),
    evaluations: new MemoryEvaluationStore(),
    trades: new MemoryTradeStore(),
    payments: new MemoryPaymentLog(),
  };
}

/**
 * Postgres stores on one migrated database. The module stores and the API's own tables run as `monadeum_api`; the
 * indexer read-model, the worker's trade records, its x402 payment log, and its evaluation records run as
 * `monadeum_reader`, which can only read them (migrations 0004, 0005, and 0013). The API never runs migrations: the
 * schema is applied by the owning role, and the API's login role holds only membership in the two group roles.
 */
export function postgresStores(db: Database): ApiStores {
  const api = roleScoped(db, API_ROLE);
  const reader = roleScoped(db, READER_ROLE);
  return {
    users: new PgUserStore(api),
    challenges: new PgChallengeStore(api),
    sessions: new PgSessionStore(api),
    walletStore: new PgAgentWalletStore(api),
    workerAgents: new PgAgentStore(api),
    ledger: new PgSponsorshipLedger(api),
    agents: new PgAgentRegistry(api),
    creation: new PgAgentCreation(api),
    recovery: new PgRecoveryLog(api),
    policies: new PgPolicyLedger(api),
    readModel: new PgReadModelStore(reader),
    evaluations: new PgEvaluationStore(reader),
    trades: new PgTradeStore(reader),
    payments: new PgPaymentLog(reader),
  };
}

export interface BuildInput {
  stores: ApiStores;
  privy: PrivyVerifier;
  authSettings: AuthSettings;
  settings: ApiSettings;
  /** Builds WalletsModule over the API's wallet store and ledger; omitted or null leaves wallet operations unavailable. */
  wallets?: ((stores: ApiStores) => WalletsService | null) | null;
  policyWriter?: ReallocationPolicyWriter | null;
  handoff?: OwnerWalletHandoff;
  now?: () => number;
  newId?: () => string;
}

export function buildDependencies(input: BuildInput): ApiDependencies {
  const now = input.now ?? defaultClock.now;
  const newId = input.newId ?? defaultClock.newId;
  const { stores } = input;
  return {
    auth: new AuthService(input.privy, stores.users, stores.challenges, stores.sessions, input.authSettings, input.handoff, now),
    wallets: input.wallets ? input.wallets(stores) : null,
    walletStore: stores.walletStore,
    workerAgents: stores.workerAgents,
    agents: stores.agents,
    creation: stores.creation,
    recovery: stores.recovery,
    policies: stores.policies,
    policyWriter: input.policyWriter ?? null,
    readModel: stores.readModel,
    evaluations: stores.evaluations,
    trades: stores.trades,
    payments: stores.payments,
    relay: new SignatureRelay(input.settings.signatureTimeoutMs, input.settings.operationWaitMs),
    settings: input.settings,
    now,
    newId,
  };
}
