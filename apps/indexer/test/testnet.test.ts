import assert from "node:assert/strict";
import { test } from "node:test";
import { ViemIndexerChain } from "../src/chain.js";
import { loadIndexerConfig } from "../src/config.js";
import { createIndexer } from "../src/main.js";

// Opt-in: reads Monad testnet. Needs INDEXER_TESTNET=1 plus the variables in apps/indexer/README.md. When
// INDEXER_START_BLOCK is unset, it starts 200 blocks below the head and indexes one batch.
const enabled = process.env.INDEXER_TESTNET === "1";

test("syncs a confirmed range of Monad testnet without error", { skip: !enabled && "set INDEXER_TESTNET=1 to run" }, async () => {
  const chain = new ViemIndexerChain(process.env.INDEXER_RPC_URL);
  const head = await chain.headBlockNumber();
  const env = { INDEXER_CHAIN_ID: "10143", INDEXER_START_BLOCK: String(head - 200n), ...process.env };
  const config = loadIndexerConfig(env);
  const { indexer, store } = createIndexer(config, chain);
  await indexer.verifyChain(config.chainId);
  const result = await indexer.syncOnce();
  assert.equal(result.status, "indexed");
  const cursor = await store.cursor();
  assert.ok(cursor);
  assert.equal((await chain.block(cursor.number))?.hash, cursor.hash);
});
