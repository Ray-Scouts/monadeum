import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { migrate, pgliteDatabase, type Database } from "@monadeum/db";
import { ApiConfigError, loadApiConfig } from "../src/index.js";

// The grants of migrations 0007 and 0008, checked statement by statement as the two roles the API runs under. The e2e suite
// shows the grants are sufficient; this shows they are no wider than stated.

const DENIED = (error: unknown) => (error as { code?: string }).code === "42501";

class Rollback extends Error {}

async function as(db: Database, role: string, sql: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE ${role}`);
      await tx.query(sql);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const pg = new PGlite();
const db = pgliteDatabase(pg);
await migrate(db);
after(() => pg.close());

describe("migration 0007 grants", () => {
  it("monadeum_api cannot read or write the indexer read-model", async () => {
    for (const sql of [
      "SELECT * FROM chain_events",
      "SELECT * FROM indexer_cursor",
      "SELECT * FROM agent_spend_limits",
      "INSERT INTO indexer_tracked_accounts (account, first_block) VALUES ('0x0000000000000000000000000000000000000001', 1)",
    ]) {
      await assert.rejects(as(db, "monadeum_api", sql), DENIED, sql);
    }
  });

  it("only monadeum_api has any privilege on the auth tables and the API's tables", async () => {
    const tables = ["auth_sessions", "auth_users", "auth_user_wallets", "auth_challenges", "api_agents", "api_recovery_actions", "api_recovery_holds", "api_reallocation_policies"];
    for (const role of ["monadeum_reader", "monadeum_worker", "monadeum_indexer", "monadeum_policy_operator"]) {
      for (const table of tables) await assert.rejects(as(db, role, `SELECT * FROM ${table}`), DENIED, `${role} on ${table}`);
    }
  });

  it("0007 widens no other role: the reader still only reads the module store tables 0005 granted", async () => {
    await as(db, "monadeum_reader", "SELECT * FROM wallet_accounts");
    await assert.rejects(as(db, "monadeum_reader", "UPDATE wallet_accounts SET body = body"), DENIED);
    await assert.rejects(as(db, "monadeum_worker", "SELECT * FROM api_agents"), DENIED);
  });

  it("monadeum_api reads and creates worker agents (0008), and changes or deletes none", async () => {
    await as(db, "monadeum_api", "SELECT * FROM worker_agents");
    await as(db, "monadeum_api", "INSERT INTO worker_agents (agent_id, owner, status, body) VALUES ('a', '0x0000000000000000000000000000000000000001', 'active', '{}')");
    for (const sql of [
      "UPDATE worker_agents SET status = 'retired'",
      "UPDATE worker_agents SET body = body",
      "TRUNCATE worker_agents",
      "DELETE FROM worker_agents",
      "SELECT * FROM worker_agent_states",
      "SELECT * FROM reallocation_debits",
    ]) {
      await assert.rejects(as(db, "monadeum_api", sql), DENIED, sql);
    }
  });

  it("monadeum_api cannot rewrite history: no update or delete of recovery actions or signed policies, no tick records", async () => {
    for (const sql of [
      "DELETE FROM api_recovery_actions",
      "UPDATE api_recovery_actions SET at = 0",
      "UPDATE api_reallocation_policies SET signature = '0x00'",
      "DELETE FROM api_reallocation_policies",
      "DELETE FROM api_agents",
      "UPDATE api_agents SET owner_key = '0x0000000000000000000000000000000000000001'",
      "DELETE FROM wallet_accounts",
      "SELECT * FROM wallet_tick_operations",
      "SELECT * FROM risk_policy_versions",
      "SELECT * FROM trade_records",
    ]) {
      await assert.rejects(as(db, "monadeum_api", sql), DENIED, sql);
    }
  });

  it("monadeum_api can use what it is granted", async () => {
    await as(db, "monadeum_api", "SELECT * FROM auth_sessions");
    await as(db, "monadeum_api", "SELECT * FROM store_schema_migrations");
    await as(db, "monadeum_api", "DELETE FROM auth_challenges");
    await as(db, "monadeum_api", "INSERT INTO api_recovery_actions (owner_key, agent_id, at) VALUES ('0x0000000000000000000000000000000000000001', 'a', 1)");
    await as(db, "monadeum_reader", "SELECT * FROM chain_events");
  });
});

describe("migration 0014 grants", () => {
  it("only monadeum_api touches funding authorizations, and it cannot delete one", async () => {
    for (const role of ["monadeum_reader", "monadeum_worker", "monadeum_indexer", "monadeum_policy_operator"]) {
      await assert.rejects(as(db, role, "SELECT * FROM api_funding_authorizations"), DENIED, role);
    }
    await as(db, "monadeum_api", "SELECT * FROM api_funding_authorizations");
    await as(db, "monadeum_api", "UPDATE api_funding_authorizations SET error = error");
    for (const sql of ["DELETE FROM api_funding_authorizations", "TRUNCATE api_funding_authorizations"]) {
      await assert.rejects(as(db, "monadeum_api", sql), DENIED, sql);
    }
  });
});

describe("configuration", () => {
  const base = {
    AUTH_PRIVY_APP_ID: "app",
    AUTH_PRIVY_VERIFICATION_KEY: "-----BEGIN PUBLIC KEY-----\\nAAAA\\n-----END PUBLIC KEY-----",
    AUTH_CHAIN_ID: "10143",
    AUTH_SIWE_DOMAIN: "app.example.test",
    AUTH_SIWE_URI: "https://app.example.test",
    API_MAX_PER_TX_CAP: "1000000",
    API_MAX_DAILY_CAP: "5000000",
    API_AGENT_PAIR: "WETH/USDC",
  };

  it("derives the allowed origin from AuthModule's sign-in URI and applies the proposed defaults", () => {
    const config = loadApiConfig(base);
    assert.equal(config.settings.allowedOrigin, "https://app.example.test");
    assert.equal(config.settings.authRateLimit, 10);
    assert.equal(config.settings.authRateWindowMs, 60_000);
    assert.deepEqual(config.database, { url: null, migrations: "verify", production: false });
    assert.equal(config.trustProxy, false);
    assert.equal(config.host, "127.0.0.1");
  });

  it("rejects missing or inconsistent limits and malformed settings", () => {
    assert.throws(() => loadApiConfig({ ...base, API_MAX_DAILY_CAP: undefined }), ApiConfigError);
    assert.throws(() => loadApiConfig({ ...base, API_MAX_PER_TX_CAP: "9000000" }), ApiConfigError);
    assert.throws(() => loadApiConfig({ ...base, API_MAX_PER_TX_CAP: "0" }), ApiConfigError);
    assert.throws(() => loadApiConfig({ ...base, API_AUTH_RATE_LIMIT: "0" }), ApiConfigError);
    assert.throws(() => loadApiConfig({ ...base, API_TRUST_PROXY: "yes" }), ApiConfigError);
  });
});
