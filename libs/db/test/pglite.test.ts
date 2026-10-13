import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_DIR, MigrationError, migrate, pgliteDatabase, type Database } from "../src/index.js";
import { conformance } from "./conformance.js";
import { databaseRules } from "./database-rules.js";
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
databaseRules("pglite", shared.db);

describe("pglite: migration runner", () => {
  it("applies each migration once and records it", async () => {
    const { pg, db } = await fresh();
    try {
      assert.deepEqual(await migrate(db), []);
      const { rows } = await db.query<{ name: string }>("SELECT name FROM store_schema_migrations ORDER BY version");
      assert.deepEqual(rows.map((r) => r.name), ["0001_stores.sql", "0002_indexer_read_model.sql", "0003_risk_policy_versions.sql", "0004_roles_and_grants.sql", "0005_store_grants.sql", "0006_agent_registry.sql", "0007_api.sql", "0008_api_agent_creation.sql", "0009_funding_principal.sql", "0010_indexer_settlement_asset.sql", "0011_trade_positions.sql", "0012_x402_nonce_slots.sql", "0013_evaluation_records.sql", "0014_api_funding.sql", "0015_market_samples_and_policy_operator.sql", "0016_population_breaker.sql"]);
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
