import {
  PgAgentWalletStore,
  PgChallengeStore,
  PgPaymentLog,
  PgSessionStore,
  PgSponsorshipLedger,
  PgTickStore,
  PgTradeStore,
  PgUserStore,
  type Database,
} from "../src/index.js";
import type { Harness } from "./conformance.js";

export const STORE_TABLES = [
  "wallet_accounts", "wallet_tick_operations", "wallet_sponsorship", "auth_user_wallets", "auth_users",
  "auth_challenges", "auth_sessions", "trade_records", "x402_payments", "tick_records",
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
        ticks: new PgTickStore(db),
      };
    },
  };
}
