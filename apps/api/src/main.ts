import "reflect-metadata";
import { PrivyTokenVerifier, type PrivyVerifier } from "@monadeum/auth";
import { openDatabase, type Connect } from "@monadeum/db";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { ApiModule, configureApp } from "./app.module.js";
import { buildDependencies, memoryStores, postgresStores } from "./build.js";
import { loadApiConfig } from "./config.js";

export interface ApiBootOptions {
  /** The process environment: the API, AuthModule, and `@monadeum/db` variables. */
  env: Record<string, string | undefined>;
  /** Overrides how DATABASE_URL is opened, for tests. */
  connect?: Connect;
  /** Overrides Privy token verification, for tests. */
  privy?: PrivyVerifier;
  log?: (message: string) => void;
}

/**
 * Builds the API process from its environment, by the same database rules as the worker and the indexer
 * (`loadDatabaseSettings`, `openDatabase`): with DATABASE_URL set it verifies (or, with DATABASE_MIGRATIONS=apply,
 * applies) the migrations and runs on the Postgres stores, under `monadeum_api` and `monadeum_reader`; without it, it
 * runs on in-memory stores and says state is not durable, which it refuses to do with MONADEUM_ENV=production.
 *
 * WalletsModule is not constructed here: it needs a session key vault backed by a secrets manager, shared with the
 * worker, and none exists yet (SECURITY.md section 11). Until it does, agent deployment and the stop endpoint answer
 * 503 in a running process; they are exercised in the tests against WalletsModule's test chain.
 */
export async function bootApi(options: ApiBootOptions) {
  const config = loadApiConfig(options.env);
  const database = await openDatabase(config.database, { connect: options.connect, log: options.log });
  try {
    const deps = buildDependencies({
      stores: database ? postgresStores(database.db) : memoryStores(),
      privy: options.privy ?? new PrivyTokenVerifier(config.auth.privy.appId, config.auth.privy.verificationKey),
      authSettings: config.auth.settings,
      settings: config.settings,
    });
    const adapter = new FastifyAdapter({ trustProxy: config.trustProxy, bodyLimit: 64 * 1024 });
    const app = configureApp(await NestFactory.create<NestFastifyApplication>(ApiModule.forRoot(deps), adapter, { logger: ["error", "warn"] }), deps);
    return {
      app,
      deps,
      config,
      durable: database !== null,
      close: async () => {
        await app.close();
        await database?.close();
      },
    };
  } catch (error) {
    await database?.close();
    throw error;
  }
}

async function main() {
  const log = (message: string) => console.log(message);
  const booted = await bootApi({ env: process.env, log });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void booted.close());
  await booted.app.listen(booted.config.port, booted.config.host);
  log(`api listening on ${booted.config.host}:${booted.config.port} on ${booted.durable ? "Postgres" : "in-memory"} stores; wallet operations unavailable`);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.js")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
