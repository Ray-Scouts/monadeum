import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryX402SlotStore, ValidatorPayer, X402PayerError, type PaymentTerms } from "@monadeum/x402";
import { getAddress } from "viem";
import { DisabledX402Payer, WorkerConfigError, agentOfTickKey, buildX402Payer, loadX402PayerConfig, memoryWorkerStores } from "../src/main.js";

const validator = {
  validator: getAddress("0x4024024024024024024024024024024024024024"),
  settlementAsset: getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603"),
  maxValue: 50_000n, paymentsPerEpoch: 4, maxValidity: 300,
  payees: [getAddress("0x85a6cb8303cd90f4a1a1005c04e66ad4d2370b18")],
};
const keys = { x402SigningKey: async () => null };
const terms: PaymentTerms = {
  scheme: "exact", network: "eip155:143", asset: validator.settlementAsset, payTo: validator.payees[0]!, amount: 1n, maxTimeoutSeconds: 60,
  requirement: {}, resource: null,
};

test("the x402 payer is off by default and signs nothing", async () => {
  const config = loadX402PayerConfig({});
  assert.equal(config.enabled, false);
  const payer = buildX402Payer({ config, wallets: keys, validator, slots: new MemoryX402SlotStore() });
  assert.ok(payer instanceof DisabledX402Payer);
  await assert.rejects(payer.authorize({ key: "k", tickKey: "a:1", terms }), X402PayerError);
  assert.equal(loadX402PayerConfig({ WORKER_X402_PAYER_ENABLED: "false" }).enabled, false);
});

test("enabling it needs the switch exactly, a chain id, and WalletsModule's validator settings", () => {
  assert.throws(() => loadX402PayerConfig({ WORKER_X402_PAYER_ENABLED: "yes" }), WorkerConfigError);
  assert.throws(() => loadX402PayerConfig({ WORKER_X402_PAYER_ENABLED: "true" }), WorkerConfigError);
  const config = loadX402PayerConfig({ WORKER_X402_PAYER_ENABLED: "true", WORKER_X402_CHAIN_ID: "143" });
  assert.deepEqual(config, { enabled: true, chainId: 143, assetName: "USDC", assetVersion: "2" });
  assert.throws(() => buildX402Payer({ config, wallets: keys, validator: null, slots: new MemoryX402SlotStore() }), WorkerConfigError);
  assert.ok(buildX402Payer({ config, wallets: keys, validator, slots: new MemoryX402SlotStore() }) instanceof ValidatorPayer);
});

test("the agent of a tick key is everything before the last colon", () => {
  assert.equal(agentOfTickKey("agent-1:7"), "agent-1");
  assert.equal(agentOfTickKey("a:b:12"), "a:b");
  for (const bad of ["agent", ":7", "agent:x"]) assert.throws(() => agentOfTickKey(bad), X402PayerError);
});

test("the worker stores include the x402 nonce slots", () => {
  assert.ok(memoryWorkerStores().x402Slots instanceof MemoryX402SlotStore);
});
