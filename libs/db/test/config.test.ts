import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  DatabaseConfigError,
  MigrationError,
  loadDatabaseSettings,
  migrate,
  openDatabase,
  pgliteDatabase,
  verifyMigrations,
  type Connect,
} from "../src/index.js";

/** A connector that hands out one PGlite instance and records whether it was closed. */
function pglite(pg: PGlite): { connect: Connect; closed: () => boolean } {
  let closed = false;
  return {
    connect: () => ({ db: pgliteDatabase(pg), close: async () => void (closed = true) }),
    closed: () => closed,
  };
}

describe("database settings", () => {
  it("defaults to in-memory, verify, development", () => {
    assert.deepEqual(loadDatabaseSettings({}), { url: null, migrations: "verify", production: false });
  });

  it("reads every variable and rejects values it does not know", () => {
    assert.deepEqual(
      loadDatabaseSettings({ DATABASE_URL: "postgres://u@h/db", DATABASE_MIGRATIONS: "apply", MONADEUM_ENV: "production" }),
      { url: "postgres://u@h/db", migrations: "apply", production: true },
    );
    assert.throws(() => loadDatabaseSettings({ DATABASE_URL: "mysql://h/db" }), DatabaseConfigError);
    assert.throws(() => loadDatabaseSettings({ DATABASE_MIGRATIONS: "skip" }), DatabaseConfigError);
    assert.throws(() => loadDatabaseSettings({ MONADEUM_ENV: "prod" }), DatabaseConfigError);
  });
});

describe("openDatabase", () => {
  it("returns null for in-memory stores and says state is not durable", async () => {
    const logs: string[] = [];
    assert.equal(await openDatabase(loadDatabaseSettings({}), { log: (m) => logs.push(m) }), null);
    assert.match(logs.join("\n"), /in-memory stores\. State is not durable/);
  });

  it("refuses in-memory stores in production", async () => {
    await assert.rejects(openDatabase(loadDatabaseSettings({ MONADEUM_ENV: "production" })), DatabaseConfigError);
  });

  it("applies the migrations in apply mode", async () => {
    const pg = new PGlite();
    try {
      const { connect } = pglite(pg);
      const handle = await openDatabase(loadDatabaseSettings({ DATABASE_URL: "postgres://test", DATABASE_MIGRATIONS: "apply" }), { connect });
      assert.ok(handle);
      await verifyMigrations(handle.db);
    } finally {
      await pg.close();
    }
  });

  it("in verify mode, refuses an unmigrated database, changes nothing, and closes the connection", async () => {
    const pg = new PGlite();
    try {
      const { connect, closed } = pglite(pg);
      await assert.rejects(openDatabase(loadDatabaseSettings({ DATABASE_URL: "postgres://test" }), { connect }), /migrations not applied: 0001_stores\.sql/);
      assert.equal(closed(), true);
      const { rows } = await pgliteDatabase(pg).query("SELECT 1 FROM pg_tables WHERE tablename = 'store_schema_migrations'");
      assert.equal(rows.length, 0);
    } finally {
      await pg.close();
    }
  });

  it("in verify mode, accepts a migrated database and refuses one with a changed migration", async () => {
    const pg = new PGlite();
    try {
      const db = pgliteDatabase(pg);
      await migrate(db);
      const { connect } = pglite(pg);
      assert.ok(await openDatabase(loadDatabaseSettings({ DATABASE_URL: "postgres://test" }), { connect }));
      await db.query("UPDATE store_schema_migrations SET checksum = 'x' WHERE version = '0002'");
      await assert.rejects(verifyMigrations(db), MigrationError);
    } finally {
      await pg.close();
    }
  });
});
