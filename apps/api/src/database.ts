import type { Database } from "@monadeum/db";

/** The group roles the API runs its statements under (migrations 0004 and 0007). */
export const API_ROLE = "monadeum_api";
export const READER_ROLE = "monadeum_reader";

/**
 * Runs every statement of `db` inside a transaction under `SET LOCAL ROLE role`, so the statement has exactly the
 * privileges granted to that group role, whatever else the login role may hold. The API reads the indexer read-model
 * through `monadeum_reader`, which can only read it, and writes its own stores through `monadeum_api`, which has no
 * privilege on the read-model. The login role must be a member of both. The cost is one extra statement and a
 * transaction per query, accepted for the MVP's request volume.
 */
export function roleScoped(db: Database, role: string): Database {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`invalid role name ${role}`);
  return {
    query<R>(text: string, params?: readonly unknown[]) {
      return db.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE ${role}`);
        return tx.query<R>(text, params);
      });
    },
    transaction(fn) {
      return db.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE ${role}`);
        return fn(tx);
      });
    },
  };
}
