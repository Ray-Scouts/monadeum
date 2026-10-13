import assert from "node:assert/strict";
import { test } from "node:test";
import { KURU_TESTNET_MON_USDC, MemoryMidSampleStore } from "@monadeum/trading";
import { createPublicClient, getAddress, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";
import { RpcChainReader, rpcReads } from "../src/chain.js";
import { WorkerConfigError, loadTickRunnerConfig } from "../src/config.js";
import { KuruMidSignal, rpcBookReader } from "../src/market.js";
import { runWorker } from "../src/main.js";
import { MemoryPolicyVersions } from "../src/policy.js";
import { PolicyGatedRunner } from "../src/runner.js";

const SIGNER = "0x39bbb6191953E222897E6b73b7c7226B7908a509";
const ENABLED = {
  WORKER_TICK_RUNNER: "enabled",
  WORKER_RPC_URL: "https://testnet-rpc.monad.xyz",
  WORKER_POLICY_SIGNER: SIGNER,
  WALLETS_CHAIN_ID: "10143",
  TRADING_KURU_MARKET: "0x46b66f84317941eC371E7791753f35653341aeBC",
  WORKER_SETTLEMENT_ASSET_ADDRESS: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  WORKER_BREAKER_CAPITAL_AT_RISK: "1000000000",
};

test("the tick runner is off by default and when disabled; enabled, it requires every dependency up front", () => {
  assert.deepEqual(loadTickRunnerConfig({}), { enabled: false });
  assert.deepEqual(loadTickRunnerConfig({ WORKER_TICK_RUNNER: "disabled" }), { enabled: false });
  assert.throws(() => loadTickRunnerConfig({ WORKER_TICK_RUNNER: "true" }), WorkerConfigError);
  assert.deepEqual(loadTickRunnerConfig(ENABLED), {
    enabled: true, rpcUrl: "https://testnet-rpc.monad.xyz", policySigner: getAddress(SIGNER), maxSlippageBps: 100,
    marketData: { maxAgeSeconds: 60, maxSpreadBps: 200 }, breaker: { capitalAtRisk: 1_000_000_000n, reallocationVolume: null },
  });
  assert.deepEqual(loadTickRunnerConfig({ ...ENABLED, WORKER_BREAKER_REALLOCATION_VOLUME: "5" }), {
    enabled: true, rpcUrl: "https://testnet-rpc.monad.xyz", policySigner: getAddress(SIGNER), maxSlippageBps: 100,
    marketData: { maxAgeSeconds: 60, maxSpreadBps: 200 }, breaker: { capitalAtRisk: 1_000_000_000n, reallocationVolume: 5n },
  });
  for (const name of ["WORKER_RPC_URL", "WORKER_POLICY_SIGNER", "WALLETS_CHAIN_ID", "TRADING_KURU_MARKET", "WORKER_SETTLEMENT_ASSET_ADDRESS", "WORKER_BREAKER_CAPITAL_AT_RISK"] as const) {
    assert.throws(() => loadTickRunnerConfig({ ...ENABLED, [name]: "" }), new RegExp(name), name);
  }
  for (const env of [
    { ...ENABLED, WORKER_RPC_URL: "ws://node" },
    { ...ENABLED, WORKER_POLICY_SIGNER: "0x12" },
    { ...ENABLED, WORKER_X402_PAYER_ENABLED: "true" },
    { ...ENABLED, WORKER_MAX_SLIPPAGE_BPS: "10000" },
    { ...ENABLED, WORKER_MARKET_MAX_AGE_SECONDS: "0" },
    { ...ENABLED, WORKER_MARKET_MAX_SPREAD_BPS: "10001" },
    { ...ENABLED, WORKER_BREAKER_CAPITAL_AT_RISK: "0" },
    { ...ENABLED, WORKER_BREAKER_CAPITAL_AT_RISK: "1.5" },
    { ...ENABLED, WORKER_BREAKER_REALLOCATION_VOLUME: "-1" },
  ]) {
    assert.throws(() => loadTickRunnerConfig(env), WorkerConfigError, JSON.stringify(env));
  }
});

test("production refuses to start without the tick runner enabled, and an enabled runner with a missing dependency, before opening anything", async () => {
  const prod = {
    MONADEUM_ENV: "production", DATABASE_URL: "postgres://unused", REDIS_URL: "redis://localhost:6379", WORKER_TICK_INTERVAL_MS: "3600000",
    WORKER_SETTLEMENT_ASSET_ADDRESS: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  };
  let connected = false;
  const connect = () => {
    connected = true;
    throw new Error("must not connect");
  };
  await assert.rejects(runWorker({ env: prod, connect }), /no tick runner is configured: set WORKER_TICK_RUNNER=enabled/);
  await assert.rejects(runWorker({ env: { ...prod, ...ENABLED, WORKER_POLICY_SIGNER: "" }, connect }), /WORKER_POLICY_SIGNER is not set/);
  assert.equal(connected, false);
});

test("a policy store that cannot be read skips the tick, like a missing policy", async () => {
  const logs: string[] = [];
  let ticked = 0;
  const runner = new PolicyGatedRunner({
    worker: { tick: async () => { ticked++; return null; }, evaluate: async () => null } as never,
    risk: { load: async () => true, active: () => null },
    policies: { list: async () => { throw new Error("connection refused"); } },
    signer: SIGNER,
    target: { settlementAsset: getAddress(ENABLED.WORKER_SETTLEMENT_ASSET_ADDRESS), pair: "WMON/USDC", router: KURU_TESTNET_MON_USDC.router, tradedBase: null },
    clock: () => new Date(),
    log: (m) => logs.push(m),
  });
  assert.equal(await runner.tick("1", 10), null);
  assert.equal(ticked, 0);
  assert.match(logs.join("\n"), /could not be read \(connection refused\)/);
  assert.match((await new PolicyGatedRunner({
    worker: { tick: async () => null, evaluate: async () => null } as never, risk: { load: async () => false, active: () => null },
    policies: new MemoryPolicyVersions(), signer: SIGNER, target: { settlementAsset: SIGNER, pair: "x/y", router: SIGNER, tradedBase: null },
    clock: () => new Date(), log: () => {},
  }).checkPolicy()) ?? "", /no signed risk policy version is stored/);
});

// Opt-in and read-only: WORKER_TESTNET=1 and MONAD_TESTNET_RPC. Reads the chain id, the settlement asset, the spend
// policy, an account's holdings, and a Kuru book through the runner's own readers. Nothing is signed or sent.
const rpc = process.env.MONAD_TESTNET_RPC;
const live = process.env.WORKER_TESTNET === "1" && Boolean(rpc);

test("testnet, read only: the runner's chain reader and market signal read the deployment", { skip: !live && "set WORKER_TESTNET=1 and MONAD_TESTNET_RPC" }, async () => {
  const reads = rpcReads(createPublicClient({ chain: monadTestnet, transport: http(rpc) }));
  assert.equal(await reads.getChainId(), 10143);
  const settlementAsset = getAddress(process.env.WORKER_TESTNET_SETTLEMENT_ASSET ?? ENABLED.WORKER_SETTLEMENT_ASSET_ADDRESS);
  const spendPolicy = getAddress(process.env.WORKER_TESTNET_SPEND_POLICY ?? "0xe54512401B8fCD0DCc3f4Aa4929b99F05AbA3f05");
  const traded = getAddress(process.env.WORKER_TESTNET_TRADED_ASSET ?? "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541");
  const chain = new RpcChainReader(reads, { settlementAsset, spendPolicy, tradedAsset: traded });
  assert.equal(await chain.decimals(), 6);
  assert.equal((await chain.policySettlementAsset()).toLowerCase(), settlementAsset.toLowerCase());
  const account = getAddress(process.env.WORKER_TESTNET_ACCOUNT ?? spendPolicy) as Address;
  const holdings = await chain.holdings(account);
  assert.ok(holdings.settlement >= 0n && holdings.native >= 0n && holdings.traded !== null);
  assert.ok((await chain.windowTotal(account)) >= 0n);

  // The configured market once it exists, else Kuru's own MON/USDC testnet book, which needs no deployment of ours.
  const market = getAddress(process.env.WORKER_TESTNET_MARKET ?? KURU_TESTNET_MON_USDC.market);
  const reading = await rpcBookReader(reads, market).read();
  assert.ok(reading.blockNumber > 0n);
  const signal = new KuruMidSignal({
    market, symbol: "MON", reader: rpcBookReader(reads, market), samples: new MemoryMidSampleStore(), tickIntervalMs: 3_600_000,
    limits: { maxAgeSeconds: 60, maxSpreadBps: 10_000 }, clock: () => new Date(),
  });
  const sample = await signal.sample();
  console.log(`book ${market}: bid ${reading.bid} ask ${reading.ask} at block ${reading.blockNumber}; sample ${sample ? sample.mid : "none (empty, one-sided, or stale)"}`);
  console.log(`holdings of ${account}: settlement ${holdings.settlement}, traded ${holdings.traded}, MON ${holdings.native}`);
});
