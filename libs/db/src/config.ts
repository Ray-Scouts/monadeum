import pg from "pg";
import { pgDatabase, type Database } from "./database.js";
import { migrate, verifyMigrations } from "./migrate.js";

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

/**
 * How a process reaches its stores. Read by every process that has stores, so they share one set of variables:
 *
 * - `DATABASE_URL`: the Postgres connection string. Unset means in-memory stores, for local development and tests.
 * - `DATABASE_MIGRATIONS`: `verify` (default) checks that every migration is applied and changes nothing; `apply` runs
 *   pending migrations first. A deployed process connects through a role without DDL privileges (migration 0004), so
 *   it verifies, and a separate step applies the schema as the owner.
 * - `MONADEUM_ENV`: `development` (default) or `production`. In production a process refuses to start without
 *   `DATABASE_URL`, so it can never run a real population on stores that a restart erases.
 */
export interface DatabaseSettings {
  url: string | null;
  migrations: "apply" | "verify";
  production: boolean;
}

type Env = Record<string, string | undefined>;

export function loadDatabaseSettings(env: Env): DatabaseSettings {
  const url = env.DATABASE_URL?.trim() || null;
  if (url && !/^postgres(ql)?:\/\//.test(url)) throw new DatabaseConfigError("DATABASE_URL must be a postgres:// or postgresql:// URL");
  const migrations = env.DATABASE_MIGRATIONS?.trim() || "verify";
  if (migrations !== "apply" && migrations !== "verify") throw new DatabaseConfigError("DATABASE_MIGRATIONS must be apply or verify");
  const mode = env.MONADEUM_ENV?.trim() || "development";
  if (mode !== "development" && mode !== "production") throw new DatabaseConfigError("MONADEUM_ENV must be development or production");
  return { url, migrations, production: mode === "production" };
}

/** An open database and the way to release it. */
export interface DatabaseHandle {
  db: Database;
  close(): Promise<void>;
}

/** Opens a connection to `url`. The default is a `pg` Pool; tests pass one that returns PGlite. */
export type Connect = (url: string) => DatabaseHandle;

export const connectPool: Connect = (url) => {
  const pool = new pg.Pool({ connectionString: url });
  return { db: pgDatabase(pool), close: () => pool.end() };
};

/**
 * Opens the database the settings name and applies or verifies the migrations, or returns null for in-memory stores.
 * Refuses in-memory stores in production, and says plainly through `log` when it falls back to them. On any failure
 * the connection is closed before the error is rethrown.
 */
export async function openDatabase(
  settings: DatabaseSettings,
  options: { connect?: Connect; log?: (message: string) => void } = {},
): Promise<DatabaseHandle | null> {
  const log = options.log ?? (() => {});
  if (!settings.url) {
    if (settings.production) throw new DatabaseConfigError("MONADEUM_ENV is production and DATABASE_URL is not set: refusing to start on in-memory stores");
    log("DATABASE_URL is not set: running on in-memory stores. State is not durable and is lost on restart; use this only for local development and tests.");
    return null;
  }
  const handle = (options.connect ?? connectPool)(settings.url);
  try {
    if (settings.migrations === "apply") {
      const applied = await migrate(handle.db);
      log(applied.length > 0 ? `applied migrations: ${applied.join(", ")}` : "migrations: none pending");
    } else {
      await verifyMigrations(handle.db);
      log("migrations: verified, all applied");
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
