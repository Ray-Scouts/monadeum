-- Grants on the module store tables from 0001, which 0004 left for when the processes were wired to the database
-- (ARCHITECTURE.md section 10, database layer entry). The roles are the group roles 0004 creates.
--
-- - monadeum_worker writes the tables of the modules the worker runs: WalletsModule (accounts, per-tick operations,
--   sponsorship), TradingModule (trades), X402Module (payments), and the tick loop (ticks). SELECT, INSERT, and UPDATE
--   only: every write is an insert-if-absent claim or an upsert of a claimed record, and no worker store deletes.
-- - monadeum_reader reads those tables, for the dashboard and API. It writes nothing.
-- - The auth tables belong to the API process, which has no role yet. Nothing is granted on them here, so only the
--   owner can touch them until that role and its grants are added in their own migration.
-- - Every process role may read the migration ledger, so a process that does not run migrations can verify that the
--   schema it expects is applied (`verifyMigrations`).

REVOKE ALL ON wallet_accounts, wallet_tick_operations, wallet_sponsorship, trade_records, x402_payments, tick_records FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON wallet_accounts, wallet_tick_operations, wallet_sponsorship, trade_records, x402_payments, tick_records
  TO monadeum_worker;
GRANT SELECT ON wallet_accounts, wallet_tick_operations, wallet_sponsorship, trade_records, x402_payments, tick_records
  TO monadeum_reader;

REVOKE ALL ON auth_users, auth_user_wallets, auth_challenges, auth_sessions FROM PUBLIC;

REVOKE ALL ON store_schema_migrations FROM PUBLIC;
GRANT SELECT ON store_schema_migrations TO monadeum_indexer, monadeum_reader, monadeum_worker;
