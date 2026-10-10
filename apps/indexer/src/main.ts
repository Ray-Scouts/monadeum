import { ViemIndexerChain } from "./chain.js";
import { loadIndexerConfig, type IndexerConfig } from "./config.js";
import { defaultRegistry } from "./handlers/index.js";
import { Indexer } from "./indexer.js";
import { InMemoryReadModelStore, type ReadModelStore } from "./store.js";
import type { IndexerChain } from "./types.js";

/**
 * Builds the indexer process. The store defaults to the in-memory read-model: the Postgres store described by
 * `sql/001_read_model.sql` is not implemented yet, so a restart re-indexes from INDEXER_START_BLOCK.
 */
export function createIndexer(config: IndexerConfig, chain: IndexerChain = new ViemIndexerChain(config.rpcUrl), store: ReadModelStore = new InMemoryReadModelStore()) {
  const registry = defaultRegistry({ spendPolicy: config.spendPolicy, entryPoint: config.entryPoint });
  return { indexer: new Indexer(chain, store, registry, config.sync), store, registry };
}

async function main() {
  const config = loadIndexerConfig();
  const { indexer } = createIndexer(config);
  await indexer.verifyChain(config.chainId);
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => controller.abort());
  await indexer.run(controller.signal, config.pollIntervalMs, (m) => console.log(m));
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.js")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
