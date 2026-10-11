import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Address } from "viem";
import { bootApi, loadFundingConfig } from "../src/index.js";
import { FakeFundingChain } from "./fake-funding.js";
import { FakePrivy } from "./harness.js";

// The funding relayer's key in its own encrypted vault, created on first boot (testnet and local development only).

const env = {
  AUTH_PRIVY_APP_ID: "app",
  AUTH_PRIVY_VERIFICATION_KEY: "-----BEGIN PUBLIC KEY-----\\nAAAA\\n-----END PUBLIC KEY-----",
  AUTH_CHAIN_ID: "10143",
  AUTH_SIWE_DOMAIN: "app.example.test",
  AUTH_SIWE_URI: "https://app.example.test",
  API_MAX_PER_TX_CAP: "1000000",
  API_MAX_DAILY_CAP: "5000000",
  API_AGENT_PAIR: "WETH/USDC",
};

const fundingEnv = (root: string) => ({
  API_FUNDING_RELAYER_VAULT_DIR: path.join(root, "relayer"),
  API_FUNDING_RELAYER_VAULT_PASSPHRASE: "a relayer passphrase, not a real one",
  API_FUNDING_SETTLEMENT_ASSET: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  API_FUNDING_MAX_PER_TRANSFER: "100000000",
});
const cheap = { N: 2 ** 10, r: 8, p: 1 };

async function ready(booted: Awaited<ReturnType<typeof bootApi>>) {
  await booted.app.init();
  await booted.app.getHttpAdapter().getInstance().ready();
}

test("the funding relayer key is created on first boot, kept across restarts, and only its address is served", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "monadeum-api-relayer-"));
  const logs: string[] = [];
  const options = {
    env: { ...env, ...fundingEnv(root) },
    privy: new FakePrivy(),
    log: (m: string) => logs.push(m),
    funding: { scrypt: cheap, chain: (relayer: Address) => new FakeFundingChain(relayer, async () => true, () => 0n) },
  };
  try {
    const first = await bootApi(options);
    await ready(first);
    const health = JSON.parse((await first.app.inject({ method: "GET", url: "/health" })).body);
    assert.equal(health.funding, "configured");
    assert.match(health.fundingRelayer, /^0x[0-9a-fA-F]{40}$/);
    assert.match(logs.join("\n"), new RegExp(`funding relayer ${health.fundingRelayer}`));
    assert.equal(first.deps.funding?.settings.dailyTransfersPerUser, 3);
    assert.equal(first.deps.funding?.settings.validitySeconds, 600);
    await first.close();
    assert.equal((await stat(path.join(root, "relayer"))).mode & 0o777, 0o700);
    assert.equal((await readdir(path.join(root, "relayer"))).filter((f) => f.endsWith(".key")).length, 1);

    const second = await bootApi(options);
    await ready(second);
    assert.equal(JSON.parse((await second.app.inject({ method: "GET", url: "/health" })).body).fundingRelayer, health.fundingRelayer, "the same key after a restart");
    await second.close();
    assert.doesNotMatch(logs.join("\n"), /0x[0-9a-fA-F]{64}/, "no key is logged");

    await assert.rejects(bootApi({ ...options, env: { ...options.env, API_FUNDING_RELAYER_VAULT_PASSPHRASE: "another passphrase entirely" } }), /does not open/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the funding relayer refuses production, a shared vault directory, and missing or out-of-range settings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "monadeum-api-relayer-"));
  try {
    const base = { ...env, ...fundingEnv(root) };
    await assert.rejects(bootApi({ env: { ...base, MONADEUM_ENV: "production", DATABASE_URL: "postgres://test" }, privy: new FakePrivy() }), /testnet and local development only/);
    assert.throws(() => loadFundingConfig({ ...base, WALLETS_SESSION_VAULT_DIR: path.join(root, "relayer") }), /separate directory/);
    assert.throws(() => loadFundingConfig({ ...base, WALLETS_X402_VAULT_DIR: root }), /separate directory/);
    assert.throws(() => loadFundingConfig({ ...base, API_FUNDING_MAX_PER_TRANSFER: undefined }), /API_FUNDING_MAX_PER_TRANSFER/);
    assert.throws(() => loadFundingConfig({ ...base, API_FUNDING_SETTLEMENT_ASSET: "usdc" }), /API_FUNDING_SETTLEMENT_ASSET/);
    assert.throws(() => loadFundingConfig({ ...base, API_FUNDING_VALIDITY_SECONDS: "7200" }), /API_FUNDING_VALIDITY_SECONDS/);
    assert.throws(() => loadFundingConfig({ ...base, API_FUNDING_RPC_URL: "http://rpc.example" }), /https/);
    assert.equal(loadFundingConfig(env), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
