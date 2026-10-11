import { PgReadModelStore, loadDatabaseSettings, openDatabase, type Connect } from "@monadeum/db";
import { ViemIndexerChain } from "./chain.js";
import { loadIndexerConfig, type IndexerConfig } from "./config.js";
import { defaultRegistry } from "./handlers/index.js";
import { Indexer } from "./indexer.js";
import { InMemoryReadModelStore, type ReadModelStore } from "./store.js";
import type { IndexerChain } from "./types.js";

/** Builds the indexer over a given chain and store. `bootIndexer` picks the store from the environment. */
export function createIndexer(config: IndexerConfig, chain: IndexerChain = new ViemIndexerChain(config.rpcUrl), store: ReadModelStore = new InMemoryReadModelStore()) {
  const registry = defaultRegistry({ spendPolicy: config.spendPolicy, entryPoint: config.entryPoint, kernelFactory: config.kernelFactory, settlementAsset: config.settlementAsset });
  return { indexer: new Indexer(chain, store, registry, config.sync), store, registry };
}

export interface IndexerBootOptions {
  /** The process environment: the INDEXER_* variables and the database variables of `@monadeum/db`. */
  env: Record<string, string | undefined>;
  /** Overrides the chain, for tests. */
  chain?: IndexerChain;
  /** Overrides how DATABASE_URL is opened, for tests. */
  connect?: Connect;
  log?: (message: string) => void;
}

/**
 * Builds the indexer process from its environment. With DATABASE_URL set it applies or verifies the migrations and
 * writes `PgReadModelStore`, so a restart resumes after the stored cursor; it should connect through a role that is a
 * member of `monadeum_indexer`, the only role granted writes on the read-model. Without it, it runs on the in-memory
 * store and re-indexes from INDEXER_START_BLOCK on every start, which it refuses to do with MONADEUM_ENV=production.
 */
export async function bootIndexer(options: IndexerBootOptions) {
  const config = loadIndexerConfig(options.env);
  const database = await openDatabase(loadDatabaseSettings(options.env), { connect: options.connect, log: options.log });
  const store = database ? new PgReadModelStore(database.db) : new InMemoryReadModelStore();
  const built = createIndexer(config, options.chain, store);
  return {
    ...built,
    config,
    durable: database !== null,
    close: async () => {
      await database?.close();
    },
  };
}

async function main() {
  const log = (message: string) => console.log(message);
  const { indexer, config, close } = await bootIndexer({ env: process.env, log });
  try {
    await indexer.verifyChain(config.chainId);
    const controller = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => controller.abort());
    await indexer.run(controller.signal, config.pollIntervalMs, log);
  } finally {
    await close();
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.js")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
