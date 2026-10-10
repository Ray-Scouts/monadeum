import assert from "node:assert/strict";
import { test } from "node:test";
import { entryPoint07Address } from "viem/account-abstraction";
import { DEFAULT_KERNEL_FACTORY, IndexerConfigError, loadIndexerConfig } from "../src/config.js";

const base = { INDEXER_CHAIN_ID: "10143", INDEXER_SPEND_POLICY_ADDRESS: "0x1111111111111111111111111111111111111111", INDEXER_START_BLOCK: "100" };

test("loads defaults and lowercases addresses", () => {
  const config = loadIndexerConfig(base);
  assert.equal(config.entryPoint, entryPoint07Address.toLowerCase());
  assert.deepEqual(config.sync, { startBlock: 100n, batchSize: 100n, syncTo: "finalized", confirmations: 10n, reorgWindow: 1000n });
  // Kernel v3.1 meta factory, from the SDK's address map.
  assert.equal(config.kernelFactory, DEFAULT_KERNEL_FACTORY);
  assert.equal(DEFAULT_KERNEL_FACTORY, "0xd703aae79538628d27099b8c4f621be4ccd142d5");
  assert.equal(loadIndexerConfig({ ...base, INDEXER_SYNC_TO: "confirmations" }).sync.syncTo, "confirmations");
  assert.equal(config.pollIntervalMs, 1000);
  assert.equal(config.rpcUrl, undefined);
});

test("rejects missing, malformed, or unsupported values", () => {
  for (const env of [
    { ...base, INDEXER_CHAIN_ID: "143" },
    { ...base, INDEXER_START_BLOCK: "" },
    { ...base, INDEXER_START_BLOCK: "-1" },
    { ...base, INDEXER_SPEND_POLICY_ADDRESS: "0x12" },
    { ...base, INDEXER_BATCH_SIZE: "0" },
    { ...base, INDEXER_CONFIRMATIONS: "20", INDEXER_REORG_WINDOW: "20" },
    { ...base, INDEXER_RPC_URL: "ws://node" },
    { ...base, INDEXER_SYNC_TO: "latest" },
    { ...base, INDEXER_KERNEL_FACTORY_ADDRESS: "0x1234" },
  ]) {
    assert.throws(() => loadIndexerConfig(env), IndexerConfigError, JSON.stringify(env));
  }
});
