import type { Database } from "./database.js";

/**
 * The group roles the migrations create (0004 and 0007). A process's login role is made a member of some of them and
 * of nothing else in this list.
 */
export const GROUP_ROLES = ["monadeum_indexer", "monadeum_reader", "monadeum_worker", "monadeum_policy_operator", "monadeum_api"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

/** One process's login role: the name it connects as, its password, and the group roles it is a member of. */
export interface LoginRole {
  name: string;
  password: string;
  memberOf: readonly GroupRole[];
}

/**
 * The login role of each deployed process and its memberships (ARCHITECTURE.md section 10, "Roles and grants"):
 * the API runs its statements under `monadeum_api` and the read-model under `monadeum_reader`; the worker connects as
 * a member of `monadeum_worker`; the indexer as a member of `monadeum_indexer`. None of them is the table owner.
 */
export const PROCESS_LOGIN_ROLES = {
  api: { name: "monadeum_api_login", memberOf: ["monadeum_api", "monadeum_reader"] },
  worker: { name: "monadeum_worker_login", memberOf: ["monadeum_worker"] },
  indexer: { name: "monadeum_indexer_login", memberOf: ["monadeum_indexer"] },
} as const satisfies Record<string, { name: string; memberOf: readonly GroupRole[] }>;

export const MIN_ROLE_PASSWORD_LENGTH = 16;

export class ProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionError";
  }
}

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Creates or updates each login role, as the migrating (owner) role, after the migrations have created the group roles.
 * Idempotent: a role that exists gets its password set again (so a rerun rotates it) and its memberships made exact.
 * A role is created `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT`; an existing role with any of
 * those privileges is refused rather than reused. Group memberships outside `memberOf` among `GROUP_ROLES` are revoked.
 *
 * The password never appears in statement text a client sends: it travels as a bind parameter into a transaction-local
 * setting and is quoted with `format('%L')` inside the server, and Postgres stores it hashed (`password_encryption`,
 * scram-sha-256 by default since Postgres 14). Requires CREATEROLE, and ADMIN on the group roles, which the role that
 * created them through the migrations holds.
 */
export async function provisionLoginRoles(db: Database, roles: readonly LoginRole[]): Promise<void> {
  for (const role of roles) {
    if (!ROLE_NAME.test(role.name) || role.name.startsWith("pg_")) throw new ProvisionError(`${role.name} is not a valid role name`);
    if ((GROUP_ROLES as readonly string[]).includes(role.name)) throw new ProvisionError(`${role.name} is a group role, not a login role`);
    if (role.password.length < MIN_ROLE_PASSWORD_LENGTH) throw new ProvisionError(`the password for ${role.name} must be at least ${MIN_ROLE_PASSWORD_LENGTH} characters`);
    if (role.password.includes("\u0000")) throw new ProvisionError(`the password for ${role.name} contains a NUL character`);
    for (const group of role.memberOf) if (!(GROUP_ROLES as readonly string[]).includes(group)) throw new ProvisionError(`${group} is not a monadeum group role`);
  }
  for (const role of roles) {
    await db.transaction(async (tx) => {
      const existing = await tx.query<{ rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean; rolbypassrls: boolean }>(
        "SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1",
        [role.name],
      );
      const row = existing.rows[0];
      if (row && (row.rolsuper || row.rolcreaterole || row.rolcreatedb || row.rolreplication || row.rolbypassrls)) {
        throw new ProvisionError(`${role.name} exists with superuser, createrole, createdb, replication, or bypassrls; refusing to use it as a process login role`);
      }
      await tx.query("SELECT set_config('monadeum.provision_role', $1, true), set_config('monadeum.provision_password', $2, true)", [role.name, role.password]);
      await tx.query(`
        DO $$
        DECLARE
          r text := current_setting('monadeum.provision_role');
          p text := current_setting('monadeum.provision_password');
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', r, p);
          ELSE
            EXECUTE format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD %L', r, p);
          END IF;
        END $$`);
      await tx.query("SELECT set_config('monadeum.provision_password', '', true)");
      for (const group of GROUP_ROLES) {
        const member = await tx.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE g.rolname = $1 AND u.rolname = $2",
          [group, role.name],
        );
        const want = role.memberOf.includes(group);
        const has = (member.rows[0]?.n ?? 0) > 0;
        // Both names were validated against fixed lists above, so they are safe to interpolate as identifiers.
        if (want && !has) await tx.query(`GRANT ${group} TO ${role.name}`);
        if (!want && has) await tx.query(`REVOKE ${group} FROM ${role.name}`);
      }
    });
  }
}
