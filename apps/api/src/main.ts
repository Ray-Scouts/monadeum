import "reflect-metadata";
import { PrivyTokenVerifier, type PrivyVerifier } from "@monadeum/auth";
import { openDatabase, type Connect } from "@monadeum/db";
import { loadWalletsRuntime, type WalletsRuntimeOptions } from "@monadeum/wallets";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { ApiModule, configureApp } from "./app.module.js";
import { buildDependencies, memoryStores, postgresStores } from "./build.js";
import { loadApiConfig } from "./config.js";
import { loadFundingRuntime, type FundingRuntime, type FundingRuntimeOptions } from "./funding-runtime.js";

export interface ApiBootOptions {
  /** The process environment: the API, AuthModule, and `@monadeum/db` variables. */
  env: Record<string, string | undefined>;
  /** Overrides how DATABASE_URL is opened, for tests. */
  connect?: Connect;
  /** Overrides Privy token verification, for tests. */
  privy?: PrivyVerifier;
  /** Overrides WalletsModule's chain adapter and the vaults' scrypt parameters, for tests. */
  wallets?: WalletsRuntimeOptions;
  /** Overrides the funding relayer's chain adapter and its vault's scrypt parameters, for tests. */
  funding?: FundingRuntimeOptions;
  log?: (message: string) => void;
}

/**
 * Builds the API process from its environment, by the same database rules as the worker and the indexer
 * (`loadDatabaseSettings`, `openDatabase`): with DATABASE_URL set it verifies (or, with DATABASE_MIGRATIONS=apply,
 * applies) the migrations and runs on the Postgres stores, under `monadeum_api` and `monadeum_reader`; without it, it
 * runs on in-memory stores and says state is not durable, which it refuses to do with MONADEUM_ENV=production.
 *
 * WalletsModule is constructed when `WALLETS_CHAIN_ID` is set (`loadWalletsRuntime`), over the API's own wallet store
 * and sponsorship ledger and the session key vault it shares with the worker, so a revocation here destroys the key the
 * worker holds. The only vault implemented is the local encrypted file vault, for testnet and local development; it
 * refuses MONADEUM_ENV=production (SECURITY.md section 11). Without `WALLETS_CHAIN_ID`, agent deployment and the stop
 * endpoint answer 503.
 */
export async function bootApi(options: ApiBootOptions) {
  const config = loadApiConfig(options.env);
  const wallets = await loadWalletsRuntime(options.env, options.wallets);
  let funding: FundingRuntime | null = null;
  let database;
  try {
    funding = await loadFundingRuntime(options.env, options.funding);
    if (funding) options.log?.(`funding relayer ${funding.relayer} on chain ${funding.chain.chainId}: fund it with testnet MON to pay the gas of relayed transfers`);
    database = await openDatabase(config.database, { connect: options.connect, log: options.log });
  } catch (error) {
    wallets?.close();
    funding?.close();
    throw error;
  }
  try {
    const deps = buildDependencies({
      stores: database ? postgresStores(database.db) : memoryStores(),
      privy: options.privy ?? new PrivyTokenVerifier(config.auth.privy.appId, config.auth.privy.verificationKey),
      authSettings: config.auth.settings,
      settings: config.settings,
      wallets: wallets ? (stores) => wallets.build(stores.walletStore, stores.ledger) : null,
      funding: funding ? { chain: funding.chain, settings: funding.config.settings } : null,
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
        wallets?.close();
        funding?.close();
      },
    };
  } catch (error) {
    await database?.close();
    wallets?.close();
    funding?.close();
    throw error;
  }
}

async function main() {
  const log = (message: string) => console.log(message);
  const booted = await bootApi({ env: process.env, log });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void booted.close());
  await booted.app.listen(booted.config.port, booted.config.host);
  log(`api listening on ${booted.config.host}:${booted.config.port} on ${booted.durable ? "Postgres" : "in-memory"} stores; wallet operations ${booted.deps.wallets ? "configured" : "unavailable (WALLETS_CHAIN_ID is not set)"}; funding ${booted.deps.funding ? `relayed by ${booted.deps.funding.chain.relayer}` : "unavailable (API_FUNDING_RELAYER_VAULT_DIR is not set)"}`);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.js")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
