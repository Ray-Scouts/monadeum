import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PROCESS_LOGIN_ROLES, ProvisionError, pgliteDatabase, provisionLoginRoles, runMigrationStep, verifyMigrations, type Connect, type Database } from "../src/index.js";

// The deployment's migration step: migrations as the owner, then one login role per process as members of the group
// roles (ARCHITECTURE.md section 10, "Roles and grants").

const onto = (pg: PGlite): Connect => () => ({ db: pgliteDatabase(pg), close: async () => {} });

async function memberships(db: Database, role: string) {
  const { rows } = await db.query<{ g: string }>(
    "SELECT g.rolname AS g FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = $1 ORDER BY 1",
    [role],
  );
  return [...new Set(rows.map((r) => r.g))].sort();
}

async function attributes(db: Database, role: string) {
  const { rows } = await db.query<{ rolcanlogin: boolean; rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolinherit: boolean }>(
    "SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolinherit FROM pg_roles WHERE rolname = $1",
    [role],
  );
  return rows[0];
}

/** Runs `sql` as `role`, the way a process that logged in as it would, and reports whether Postgres allowed it. */
async function allowedAs(db: Database, role: string, sql: string) {
  try {
    await db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE ${role}`);
      await tx.query(sql);
      throw new Error("rollback");
    });
  } catch (error) {
    return error instanceof Error && error.message === "rollback";
  }
  return true;
}

describe("migration step", () => {
  it("applies the migrations, then provisions each process's login role in exactly its group roles", async () => {
    const pg = new PGlite();
    const root = await mkdtemp(path.join(tmpdir(), "monadeum-provision-"));
    try {
      await writeFile(path.join(root, "worker"), "worker password from a file\n");
      const logs: string[] = [];
      const env = {
        DATABASE_URL: "postgres://owner@db/monadeum",
        DB_API_PASSWORD: "api password long enough",
        DB_WORKER_PASSWORD_FILE: path.join(root, "worker"),
        DB_INDEXER_PASSWORD: "indexer password long enough",
      };
      const result = await runMigrationStep(env, { connect: onto(pg), log: (m) => logs.push(m) });
      assert.ok(result.applied.length > 0);
      assert.deepEqual(result.roles, ["monadeum_api_login", "monadeum_worker_login", "monadeum_indexer_login"]);
      const db = pgliteDatabase(pg);
      await verifyMigrations(db);
      assert.deepEqual(await memberships(db, "monadeum_api_login"), ["monadeum_api", "monadeum_reader"]);
      assert.deepEqual(await memberships(db, "monadeum_worker_login"), ["monadeum_worker"]);
      assert.deepEqual(await memberships(db, "monadeum_indexer_login"), ["monadeum_indexer"]);
      for (const role of Object.values(PROCESS_LOGIN_ROLES)) {
        assert.deepEqual(await attributes(db, role.name), { rolcanlogin: true, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolinherit: true });
      }
      assert.ok(!logs.join("\n").includes("password long enough"), "no password is logged");
      assert.ok(!logs.join("\n").includes("worker password from a file"), "no password is logged");

      // The login roles hold their group's grants and nothing else: the worker cannot write the read-model.
      assert.equal(await allowedAs(db, "monadeum_indexer_login", "INSERT INTO indexer_settings (id, settlement_asset) VALUES (1, '0x00000000000000000000000000000000000000a1')"), true);
      assert.equal(await allowedAs(db, "monadeum_worker_login", "DELETE FROM chain_events"), false);
      assert.equal(await allowedAs(db, "monadeum_worker_login", "SELECT count(*) FROM store_schema_migrations"), true);

      // A rerun applies nothing, keeps the roles, and makes memberships exact again.
      await db.query("GRANT monadeum_indexer TO monadeum_worker_login");
      const again = await runMigrationStep(env, { connect: onto(pg) });
      assert.deepEqual(again.applied, []);
      assert.deepEqual(await memberships(db, "monadeum_worker_login"), ["monadeum_worker"]);
    } finally {
      await pg.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a short password, an unknown group, a group role name, and an existing privileged role", async () => {
    const pg = new PGlite();
    try {
      const db = pgliteDatabase(pg);
      await runMigrationStep({ DATABASE_URL: "postgres://owner@db/monadeum" }, { connect: onto(pg) });
      await assert.rejects(provisionLoginRoles(db, [{ name: "x_login", password: "short", memberOf: ["monadeum_worker"] }]), ProvisionError);
      await assert.rejects(provisionLoginRoles(db, [{ name: "x_login", password: "long enough password", memberOf: ["pg_read_all_data" as never] }]), ProvisionError);
      await assert.rejects(provisionLoginRoles(db, [{ name: "monadeum_worker", password: "long enough password", memberOf: ["monadeum_worker"] }]), ProvisionError);
      await assert.rejects(provisionLoginRoles(db, [{ name: "x; DROP TABLE y", password: "long enough password", memberOf: [] }]), ProvisionError);
      await db.query("CREATE ROLE powerful_login LOGIN CREATEROLE");
      await assert.rejects(provisionLoginRoles(db, [{ name: "powerful_login", password: "long enough password", memberOf: ["monadeum_worker"] }]), /refusing/);
      // A password with quotes is stored, not interpreted.
      await provisionLoginRoles(db, [{ name: "quoted_login", password: "it's a 'quoted' password; DROP ROLE x", memberOf: ["monadeum_reader"] }]);
      assert.deepEqual(await memberships(db, "quoted_login"), ["monadeum_reader"]);
    } finally {
      await pg.close();
    }
  });

  it("refuses to run without DATABASE_URL", async () => {
    await assert.rejects(runMigrationStep({}), /DATABASE_URL is not set/);
  });
});
