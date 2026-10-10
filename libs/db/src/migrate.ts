import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Database, Queryable } from "./database.js";

/** The migrations shipped with this package, `libs/db/migrations`. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
// Arbitrary constant key for the transaction-level advisory lock that serializes concurrent runners.
const LOCK_KEY = 7_302_118_401;

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/** Reads `NNNN_name.sql` files in version order. Any other file in the directory is an error, not silently skipped. */
export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).sort();
  const out: Migration[] = [];
  for (const name of files) {
    const match = NAME.exec(name);
    if (!match) throw new MigrationError(`unexpected file in the migrations directory: ${name}`);
    const version = match[1]!;
    if (out.some((m) => m.version === version)) throw new MigrationError(`two migrations share version ${version}`);
    const sql = await readFile(`${dir}/${name}`, "utf8");
    out.push({ version, name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return out;
}

/**
 * Applies every migration not yet recorded, in order, all in one transaction under an advisory lock, so concurrent
 * runners apply each migration once and a failure applies none. Refuses to run when an applied migration's file was
 * changed or removed. Returns the names it applied.
 */
export async function migrate(db: Database, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    await tx.exec(`CREATE TABLE IF NOT EXISTS store_schema_migrations (
      version     text PRIMARY KEY,
      name        text NOT NULL,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await tx.query<AppliedRow>(
      "SELECT version, name, checksum FROM store_schema_migrations ORDER BY version",
    );
    checkApplied(migrations, rows, dir);
    const applied = new Set(rows.map((r) => r.version));
    const done: string[] = [];
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      await tx.exec(m.sql);
      await tx.query("INSERT INTO store_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [m.version, m.name, m.checksum]);
      done.push(m.name);
    }
    return done;
  });
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
}

function checkApplied(migrations: Migration[], rows: AppliedRow[], dir: string): void {
  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const row of rows) {
    const file = known.get(row.version);
    if (!file) throw new MigrationError(`applied migration ${row.name} is missing from ${dir}`);
    if (file.checksum !== row.checksum) throw new MigrationError(`applied migration ${row.name} was changed after it was applied`);
  }
}

/**
 * Checks, without changing anything, that every migration in `dir` is applied and that no applied file was changed or
 * removed. For a process that connects through a role without DDL privileges (migration 0004: no process connects as
 * the table owner), so the schema is applied by a separate, privileged step and the process only confirms it. Throws
 * `MigrationError` naming what is pending or changed.
 */
export async function verifyMigrations(db: Queryable, dir: string = MIGRATIONS_DIR): Promise<void> {
  const migrations = await loadMigrations(dir);
  const { rows: table } = await db.query<{ present: boolean }>("SELECT to_regclass('store_schema_migrations') IS NOT NULL AS present");
  const rows = table[0]?.present
    ? (await db.query<AppliedRow>("SELECT version, name, checksum FROM store_schema_migrations ORDER BY version")).rows
    : [];
  checkApplied(migrations, rows, dir);
  const applied = new Set(rows.map((r) => r.version));
  const pending = migrations.filter((m) => !applied.has(m.version)).map((m) => m.name);
  if (pending.length > 0) throw new MigrationError(`migrations not applied: ${pending.join(", ")}`);
}
