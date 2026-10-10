import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import pg from "pg";
import { migrate, pgDatabase } from "../src/index.js";
import { conformance } from "./conformance.js";
import { postgresHarness } from "./harness.js";

// Opt-in: runs the conformance suite against a real Postgres server when DATABASE_URL is set, for example
//   DATABASE_URL=postgres://localhost/monadeum_test bun run --filter @monadeum/db test
// Unlike PGlite, a pool has several connections, so the concurrency tests exercise row locking and unique-index
// arbitration between sessions. Everything is created in a throwaway schema, which is dropped afterwards; nothing
// outside it is touched.

const url = process.env.DATABASE_URL;

if (!url) {
  test("postgres conformance (skipped: set DATABASE_URL to run it)", { skip: true }, () => {});
} else {
  const schema = `monadeum_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });
  const db = pgDatabase(pool);
  await migrate(db);
  after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  conformance("postgres", postgresHarness(db));
}
