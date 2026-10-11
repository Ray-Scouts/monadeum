import { MemoryAgentStore, MemoryDebitStore, type AgentRegistry, type DebitStore } from "@monadeum/agent-registry";
import {
  PgAgentStore,
  PgAgentWalletStore,
  PgDebitStore,
  PgPaymentLog,
  PgReadModelStore,
  PgSponsorshipLedger,
  PgTickStore,
  PgTradeStore,
  type Database,
} from "@monadeum/db";
import { InMemoryReadModelStore, type ReadModelReader } from "@monadeum/read-model";
import { MemoryTickStore, type TickStore } from "@monadeum/tick";
import { MemoryTradeStore, type TradeStore } from "@monadeum/trading";
import { MemoryAgentWalletStore, MemorySponsorshipLedger, type AgentWalletStore, type SponsorshipLedger } from "@monadeum/wallets";
import { MemoryPaymentLog, type PaymentLog } from "@monadeum/x402";

/** Nest token under which the worker context provides its `WorkerStores`. */
export const WORKER_STORES = Symbol("WORKER_STORES");

/**
 * The stores the worker reads and writes, as one bundle so the process picks Postgres or memory for all of them at
 * once, never a mix. Their Postgres tables are granted to `monadeum_worker` in libs/db migrations 0005 and 0006; on
 * `worker_agents` the worker may read and update (retire) but not insert, because agent creation is not the worker's.
 *
 * Not here: the owner reallocation policy source, which is still the in-memory `OwnerPolicies`, and the session key
 * vault, which belongs in a secrets manager, never in Postgres (SECURITY.md section 11).
 */
export interface WorkerStores {
  /** False for the in-memory stores: a restart loses every record. */
  durable: boolean;
  agents: AgentRegistry;
  debits: DebitStore;
  ticks: TickStore;
  trades: TradeStore;
  payments: PaymentLog;
  wallets: AgentWalletStore;
  sponsorship: SponsorshipLedger;
  /**
   * The indexer's read-model, read only, for the principal job (migration 0009 grants `monadeum_worker` SELECT on it
   * and nothing more). Ticks and evaluations never read it. In memory it stays empty, so no principal changes.
   */
  readModel: ReadModelReader;
}

/** For local development and tests only. */
export function memoryWorkerStores(): WorkerStores {
  return {
    durable: false,
    agents: new MemoryAgentStore(),
    debits: new MemoryDebitStore(),
    ticks: new MemoryTickStore(),
    trades: new MemoryTradeStore(),
    payments: new MemoryPaymentLog(),
    wallets: new MemoryAgentWalletStore(),
    sponsorship: new MemorySponsorshipLedger(),
    readModel: new InMemoryReadModelStore(),
  };
}

export function postgresWorkerStores(db: Database): WorkerStores {
  return {
    durable: true,
    agents: new PgAgentStore(db),
    debits: new PgDebitStore(db),
    ticks: new PgTickStore(db),
    trades: new PgTradeStore(db),
    payments: new PgPaymentLog(db),
    wallets: new PgAgentWalletStore(db),
    sponsorship: new PgSponsorshipLedger(db),
    readModel: new PgReadModelStore(db),
  };
}
