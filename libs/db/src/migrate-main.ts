import { readFile } from "node:fs/promises";
import { DatabaseConfigError, connectPool, loadDatabaseSettings, type Connect } from "./config.js";
import { migrate } from "./migrate.js";
import { PROCESS_LOGIN_ROLES, provisionLoginRoles, type LoginRole } from "./provision.js";

type Env = Record<string, string | undefined>;

/** The environment variable prefix of each process's login role password, e.g. DB_API_PASSWORD or DB_API_PASSWORD_FILE. */
const PASSWORD_VARS = {
  api: "DB_API_PASSWORD",
  worker: "DB_WORKER_PASSWORD",
  indexer: "DB_INDEXER_PASSWORD",
  policyOperator: "DB_POLICY_OPERATOR_PASSWORD",
} as const;

async function secret(env: Env, name: string): Promise<string | null> {
  const direct = env[name];
  const file = env[`${name}_FILE`]?.trim();
  if (direct && file) throw new DatabaseConfigError(`set ${name} or ${name}_FILE, not both`);
  if (file) return (await readFile(file, "utf8")).replace(/\r?\n$/, "");
  return direct || null;
}

/**
 * The dedicated, privileged migration step a deployment runs once before the services start (ARCHITECTURE.md
 * section 10, "Process wiring"): with `DATABASE_URL` naming the owning role, it applies every pending migration, then
 * creates or updates the login role of each process whose password is set (`DB_API_PASSWORD`, `DB_WORKER_PASSWORD`,
 * `DB_INDEXER_PASSWORD`, `DB_POLICY_OPERATOR_PASSWORD`, or each with `_FILE`), as members of the group roles the migrations created
 * (`PROCESS_LOGIN_ROLES`). The services then connect through those roles with `DATABASE_MIGRATIONS=verify`.
 * Returns the migrations applied and the roles provisioned. Never logs a password or the connection string.
 */
export async function runMigrationStep(env: Env, options: { connect?: Connect; log?: (message: string) => void } = {}) {
  const log = options.log ?? (() => {});
  const settings = loadDatabaseSettings(env);
  if (!settings.url) throw new DatabaseConfigError("DATABASE_URL is not set: the migration step needs the owning role's connection string");
  const roles: LoginRole[] = [];
  for (const [process, variable] of Object.entries(PASSWORD_VARS) as [keyof typeof PASSWORD_VARS, string][]) {
    const password = await secret(env, variable);
    if (password) roles.push({ ...PROCESS_LOGIN_ROLES[process], password });
    else log(`${variable} is not set: the ${process} login role is not provisioned`);
  }
  const handle = (options.connect ?? connectPool)(settings.url);
  try {
    const applied = await migrate(handle.db);
    log(applied.length > 0 ? `applied migrations: ${applied.join(", ")}` : "migrations: none pending");
    await provisionLoginRoles(handle.db, roles);
    for (const role of roles) log(`login role ${role.name}: member of ${role.memberOf.join(", ")}`);
    return { applied, roles: roles.map((r) => r.name) };
  } finally {
    await handle.close();
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("migrate-main.js")) {
  runMigrationStep(process.env, { log: (message) => console.log(message) }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
