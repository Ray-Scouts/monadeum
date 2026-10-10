import {
  PgAgentWalletStore,
  PgPaymentLog,
  PgSponsorshipLedger,
  PgTickStore,
  PgTradeStore,
  type Database,
} from "@monadeum/db";
import { MemoryTickStore, type TickStore } from "@monadeum/tick";
import { MemoryTradeStore, type TradeStore } from "@monadeum/trading";
import { MemoryAgentWalletStore, MemorySponsorshipLedger, type AgentWalletStore, type SponsorshipLedger } from "@monadeum/wallets";
import { MemoryPaymentLog, type PaymentLog } from "@monadeum/x402";

/** Nest token under which the worker context provides its `WorkerStores`. */
export const WORKER_STORES = Symbol("WORKER_STORES");

/**
 * The module stores the worker's services write, as one bundle so the process picks Postgres or memory for all of
 * them at once, never a mix. Each Postgres table here is granted to `monadeum_worker` (libs/db migration 0005).
 *
 * Not here yet: `AgentStore` and `DebitStore`, which have no Postgres implementation, and the session key vault,
 * which belongs in a secrets manager, never in Postgres (SECURITY.md section 11).
 */
export interface WorkerStores {
  /** False for the in-memory stores: a restart loses every record. */
  durable: boolean;
  ticks: TickStore;
  trades: TradeStore;
  payments: PaymentLog;
  wallets: AgentWalletStore;
  sponsorship: SponsorshipLedger;
}

/** For local development and tests only. */
export function memoryWorkerStores(): WorkerStores {
  return {
    durable: false,
    ticks: new MemoryTickStore(),
    trades: new MemoryTradeStore(),
    payments: new MemoryPaymentLog(),
    wallets: new MemoryAgentWalletStore(),
    sponsorship: new MemorySponsorshipLedger(),
  };
}

export function postgresWorkerStores(db: Database): WorkerStores {
  return {
    durable: true,
    ticks: new PgTickStore(db),
    trades: new PgTradeStore(db),
    payments: new PgPaymentLog(db),
    wallets: new PgAgentWalletStore(db),
    sponsorship: new PgSponsorshipLedger(db),
  };
}
