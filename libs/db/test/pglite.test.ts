import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_DIR, MigrationError, isUniqueViolation, migrate, pgliteDatabase, type Database } from "../src/index.js";
import { conformance } from "./conformance.js";
import { postgresHarness } from "./harness.js";

// PGlite is Postgres compiled to WebAssembly, run in process, so this suite needs no database service. It is a
// single connection: concurrent calls are serialized, so the concurrency tests here check the statements' logic,
// not row locking between sessions. `postgres.test.ts` runs the same suite against a real server when DATABASE_URL
// is set.

async function fresh(): Promise<{ pg: PGlite; db: Database }> {
  const pg = new PGlite();
  const db = pgliteDatabase(pg);
  await migrate(db);
  return { pg, db };
}

const shared = await fresh();
after(() => shared.pg.close());

conformance("pglite", postgresHarness(shared.db));

describe("pglite: constraints hold without the store code", () => {
  const raw = (sql: string, params: unknown[] = []) => shared.db.query(sql, params);
  const wallet = (address: string, userId: string) =>
    raw("INSERT INTO auth_user_wallets (address_key, user_id, position, address, kind, proof, linked_at) VALUES ($1, $2, 0, $3, 'external', 'wallet-signature', 1)", [address.toLowerCase(), userId, address]);

  it("a wallet address belongs to at most one user", async () => {
    await postgresHarness(shared.db).fresh();
    await raw("INSERT INTO auth_users (id, privy_user_id, owner_wallet, created_at) VALUES ('u1', NULL, NULL, 1), ('u2', NULL, NULL, 1)");
    await wallet("0x00000000000000000000000000000000000000aa", "u1");
    await assert.rejects(wallet("0x00000000000000000000000000000000000000AA", "u2"), isUniqueViolation);
  });

  it("a Privy identity belongs to at most one user", async () => {
    await postgresHarness(shared.db).fresh();
    await raw("INSERT INTO auth_users (id, privy_user_id, owner_wallet, created_at) VALUES ('u1', 'did:privy:x', NULL, 1)");
    await assert.rejects(raw("INSERT INTO auth_users (id, privy_user_id, owner_wallet, created_at) VALUES ('u2', 'did:privy:x', NULL, 1)"), isUniqueViolation);
  });

  it("a session row holds only a SHA-256 digest", async () => {
    await postgresHarness(shared.db).fresh();
    await assert.rejects(raw("INSERT INTO auth_sessions (token_hash, user_id, wallet, expires_at) VALUES ('plaintext-token', 'u1', '0x', 1)"), /check constraint/);
  });

  it("an account address belongs to at most one agent, and a tick key is claimed once", async () => {
    await postgresHarness(shared.db).fresh();
    await raw("INSERT INTO wallet_accounts (agent_id, account_key, body) VALUES ('a', '0x00000000000000000000000000000000000000ab', '{}')");
    await assert.rejects(raw("INSERT INTO wallet_accounts (agent_id, account_key, body) VALUES ('b', '0x00000000000000000000000000000000000000ab', '{}')"), isUniqueViolation);
    await assert.rejects(raw("INSERT INTO wallet_accounts (agent_id, account_key, body) VALUES ('c', '0x00000000000000000000000000000000000000AB', '{}')"), /check constraint/);
    await raw("INSERT INTO wallet_tick_operations (agent_id, tick_key, body) VALUES ('a', 'a:1', '{}')");
    await assert.rejects(raw("INSERT INTO wallet_tick_operations (agent_id, tick_key, body) VALUES ('a', 'a:1', '{}')"), isUniqueViolation);
  });
});

describe("pglite: migration runner", () => {
  it("applies each migration once and records it", async () => {
    const { pg, db } = await fresh();
    try {
      assert.deepEqual(await migrate(db), []);
      const { rows } = await db.query<{ name: string }>("SELECT name FROM store_schema_migrations ORDER BY version");
      assert.deepEqual(rows.map((r) => r.name), ["0001_stores.sql"]);
    } finally {
      await pg.close();
    }
  });

  it("refuses to run when an applied migration was edited, and applies nothing from a failing one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "monadeum-db-migrations-"));
    const pg = new PGlite();
    const db = pgliteDatabase(pg);
    try {
      await cp(MIGRATIONS_DIR, dir, { recursive: true });
      await migrate(db, dir);
      await writeFile(join(dir, "0002_broken.sql"), "CREATE TABLE half_applied (id int);\nSELECT no_such_function();\n");
      await assert.rejects(migrate(db, dir));
      const { rows } = await db.query("SELECT 1 FROM pg_tables WHERE tablename = 'half_applied'");
      assert.equal(rows.length, 0);

      await rm(join(dir, "0002_broken.sql"));
      await writeFile(join(dir, "0001_stores.sql"), "-- edited\n", { flag: "a" });
      await assert.rejects(migrate(db, dir), MigrationError);
    } finally {
      await pg.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a file that is not a numbered migration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "monadeum-db-migrations-"));
    const pg = new PGlite();
    try {
      await writeFile(join(dir, "notes.txt"), "");
      await assert.rejects(migrate(pgliteDatabase(pg), dir), MigrationError);
    } finally {
      await pg.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
