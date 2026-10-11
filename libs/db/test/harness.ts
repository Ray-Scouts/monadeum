import {
  PgAgentStore,
  PgAgentWalletStore,
  PgDebitStore,
  PgEvaluationStore,
  PgChallengeStore,
  PgPaymentLog,
  PgPositionStore,
  PgSessionStore,
  PgSponsorshipLedger,
  PgReadModelStore,
  PgTickStore,
  PgTradeStore,
  PgUserStore,
  PgX402SlotStore,
  type Database,
} from "../src/index.js";
import type { Harness } from "./conformance.js";

export const STORE_TABLES = [
  "wallet_accounts", "wallet_tick_operations", "wallet_sponsorship", "auth_user_wallets", "auth_users",
  "auth_challenges", "auth_sessions", "trade_records", "x402_payments", "x402_nonce_slots", "tick_records",
  "indexer_cursor", "indexer_blocks", "indexer_tracked_accounts", "chain_events", "indexer_settings",
  "worker_agent_states", "worker_agents", "reallocation_debits", "trade_positions", "evaluation_records",
];

/** Postgres stores over one migrated database, emptied before each test. */
export function postgresHarness(db: Database): Harness {
  return {
    async fresh() {
      await db.query(`TRUNCATE ${STORE_TABLES.join(", ")} RESTART IDENTITY`);
      return {
        wallets: new PgAgentWalletStore(db),
        ledger: new PgSponsorshipLedger(db),
        users: new PgUserStore(db),
        challenges: new PgChallengeStore(db),
        sessions: new PgSessionStore(db),
        trades: new PgTradeStore(db),
        payments: new PgPaymentLog(db),
        slots: new PgX402SlotStore(db),
        ticks: new PgTickStore(db),
        readModel: new PgReadModelStore(db),
        agents: new PgAgentStore(db),
        debits: new PgDebitStore(db),
        positions: new PgPositionStore(db),
        evaluations: new PgEvaluationStore(db),
      };
    },
  };
}
