import type { Pool } from "pg";

/** One statement against the database. Values that are not plain JSON scalars are selected as text by the stores. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }>;
}

/** A connection inside an open transaction. */
export interface Transaction extends Queryable {
  /** Runs a script of several statements, without parameters. Used by the migration runner. */
  exec(sql: string): Promise<void>;
}

/**
 * The narrow surface the stores need. `transaction` runs `fn` on one connection inside BEGIN and COMMIT, and rolls
 * back and rethrows when `fn` throws. Implemented here for a `pg` Pool and for PGlite.
 */
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** Wraps a `pg` Pool. The caller owns the pool and ends it. */
export function pgDatabase(pool: Pool): Database {
  return {
    async query(text, params) {
      const result = await pool.query(text, params as unknown[] | undefined);
      return { rows: result.rows };
    },
    async transaction(fn) {
      const client = await pool.connect();
      let broken: Error | undefined;
      try {
        await client.query("BEGIN");
        try {
          const value = await fn({
            async query(text, params) {
              const result = await client.query(text, params as unknown[] | undefined);
              return { rows: result.rows };
            },
            async exec(sql) {
              await client.query(sql);
            },
          });
          await client.query("COMMIT");
          return value;
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch (rollback) {
            // A connection that cannot roll back is not returned to the pool.
            broken = rollback instanceof Error ? rollback : new Error(String(rollback));
          }
          throw error;
        }
      } finally {
        client.release(broken);
      }
    },
  };
}

/** The part of PGlite's API the adapter uses, typed structurally so PGlite stays a development dependency. */
export interface PgliteLike {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: { query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>; exec(sql: string): Promise<unknown> }) => Promise<T>): Promise<T>;
}

/** Wraps an in-process PGlite instance, for tests and local development. It is one connection, so it serializes. */
export function pgliteDatabase(db: PgliteLike): Database {
  return {
    async query<R>(text: string, params?: readonly unknown[]) {
      const result = await db.query<R>(text, params ? [...params] : undefined);
      return { rows: result.rows };
    },
    async transaction(fn) {
      return db.transaction((tx) =>
        fn({
          async query<R>(text: string, params?: readonly unknown[]) {
            const result = await tx.query<R>(text, params ? [...params] : undefined);
            return { rows: result.rows };
          },
          async exec(sql) {
            await tx.exec(sql);
          },
        }),
      );
    },
  };
}

/** SQLSTATE 23505, unique_violation, raised by both `pg` and PGlite as `error.code`. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}
