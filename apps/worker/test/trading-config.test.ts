import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkerConfigError, bootWorker, loadWorkerTrading } from "../src/main.js";

// The testnet market as deploy/.env.testnet.example configures it (ARCHITECTURE.md section 10, "Testnet market").
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const MARKET = "0x46b66f84317941eC371E7791753f35653341aeBC";
const testnet = {
  TRADING_PAIR: "WMON/USDC",
  TRADING_KURU_ROUTER: "0x7EFbE105Ca7415dE98F96622173458ac1c054630",
  TRADING_KURU_MARKET: MARKET,
  TRADING_BASE: WMON,
  TRADING_QUOTE: USDC,
  TRADING_SIZE_PRECISION: "10000000000",
  TRADING_MON_PRICE_MARKET: MARKET,
  TRADING_MON_PRICE_BASE: WMON,
  TRADING_WRAPPED_NATIVE: WMON,
  WORKER_SETTLEMENT_ASSET_ADDRESS: USDC.toLowerCase(),
};

test("the worker reads the trading market from TRADING_*, and none when it is unset", async () => {
  assert.equal(loadWorkerTrading({}), null);
  const logs: string[] = [];
  const booted = await bootWorker({ env: testnet, log: (m) => logs.push(m) });
  assert.equal(booted.trading?.market.pair, "WMON/USDC");
  assert.equal(booted.trading?.monPrice?.source, "kuru-wmon-usdc-mid");
  assert.match(logs.join("\n"), /trading: WMON\/USDC on Kuru market/);
  await booted.close();
});

test("the worker refuses a market not quoted in the settlement asset, or a malformed one", async () => {
  assert.throws(() => loadWorkerTrading({ ...testnet, WORKER_SETTLEMENT_ASSET_ADDRESS: WMON }), WorkerConfigError);
  assert.throws(() => loadWorkerTrading({ ...testnet, TRADING_WRAPPED_NATIVE: "" }), WorkerConfigError);
  await assert.rejects(bootWorker({ env: { ...testnet, TRADING_KURU_ROUTER: "nope" } }), WorkerConfigError);
});
