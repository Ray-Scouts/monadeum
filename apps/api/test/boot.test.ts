import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { DatabaseConfigError, migrate, pgliteDatabase, type Connect } from "@monadeum/db";
import { REALLOCATION_PRODUCTION_ACK, ReallocationSwitchError } from "@monadeum/reallocation/switch";
import { FakeChain } from "@monadeum/wallets/testing";
import { bootApi, loadApiConfig } from "../src/index.js";
import { FakePrivy, newWallet } from "./harness.js";

// The process boot, by the same database rules as the worker and the indexer (`@monadeum/db` config).

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

/** Hands out one PGlite instance as if it were the server DATABASE_URL names. */
const onto = (pg: PGlite): Connect => () => ({ db: pgliteDatabase(pg), close: async () => {} });

async function ready(booted: Awaited<ReturnType<typeof bootApi>>) {
  await booted.app.init();
  await booted.app.getHttpAdapter().getInstance().ready();
}

test("without DATABASE_URL the API runs on in-memory stores and says so, except in production", async () => {
  const logs: string[] = [];
  const booted = await bootApi({ env, privy: new FakePrivy(), log: (m) => logs.push(m) });
  assert.equal(booted.durable, false);
  assert.match(logs.join("\n"), /not durable/);
  await booted.close();
  await assert.rejects(bootApi({ env: { ...env, MONADEUM_ENV: "production" } }), DatabaseConfigError);
});

test("in verify mode the API refuses to start on an unmigrated database", async () => {
  const pg = new PGlite();
  try {
    await assert.rejects(bootApi({ env: { ...env, DATABASE_URL: "postgres://test" }, connect: onto(pg), privy: new FakePrivy() }), /migrations not applied/);
  } finally {
    await pg.close();
  }
});

test("on a migrated database the API serves from Postgres, and a restarted process reads its sessions back", async () => {
  const pg = new PGlite();
  try {
    await migrate(pgliteDatabase(pg));
    const options = { env: { ...env, DATABASE_URL: "postgres://test", MONADEUM_ENV: "production" }, connect: onto(pg), privy: new FakePrivy() };
    const first = await bootApi(options);
    assert.equal(first.durable, true);
    await ready(first);
    const account = newWallet();
    const challenge = await first.app.inject({ method: "POST", url: "/auth/wallet/challenge", payload: { address: account.address } });
    const { nonce, message } = JSON.parse(challenge.body);
    const verified = await first.app.inject({
      method: "POST",
      url: "/auth/wallet/verify",
      headers: { origin: "https://app.example.test" },
      payload: { nonce, signature: await account.signMessage({ message }) },
    });
    assert.equal(verified.statusCode, 200);
    const cookie = /monadeum_session=[^;]+/.exec(String(verified.headers["set-cookie"]))![0];
    await first.close();

    const second = await bootApi(options);
    await ready(second);
    const me = await second.app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(JSON.parse(me.body).user.ownerWallet, account.address);
    await second.close();
  } finally {
    await pg.close();
  }
});

test("the reallocation switch is off unless set, and production refuses it on without the study acknowledgement", async () => {
  assert.equal(loadApiConfig(env).settings.reallocation.enabled, false);
  assert.match(loadApiConfig(env).settings.reallocation.reason ?? "", /pre-registered study/);
  assert.equal(loadApiConfig({ ...env, MONADEUM_REALLOCATION_ENABLED: "true" }).settings.reallocation.enabled, true);
  assert.throws(() => loadApiConfig({ ...env, MONADEUM_REALLOCATION_ENABLED: "maybe" }), ReallocationSwitchError);
  const prod = { ...env, MONADEUM_ENV: "production", DATABASE_URL: "postgres://test", MONADEUM_REALLOCATION_ENABLED: "true" };
  let connected = false;
  const connect: Connect = () => {
    connected = true;
    throw new Error("must not connect");
  };
  await assert.rejects(bootApi({ env: prod, privy: new FakePrivy(), connect }), /refusing to start without MONADEUM_REALLOCATION_PRODUCTION_ACK/);
  assert.equal(connected, false, "refused before the database is opened");
  assert.equal(loadApiConfig({ ...prod, MONADEUM_REALLOCATION_PRODUCTION_ACK: REALLOCATION_PRODUCTION_ACK }).settings.reallocation.enabled, true);
});

// WalletsModule over the local encrypted vault (testnet and local development only).

const walletsEnv = (root: string) => ({
  WALLETS_CHAIN_ID: "10143",
  WALLETS_BUNDLER_URL: "https://bundler.example",
  WALLETS_PAYMASTER_URL: "https://paymaster.example",
  WALLETS_SETTLEMENT_ASSET: "0x00000000000000000000000000000000000000a1",
  WALLETS_KURU_ROUTER: "0x00000000000000000000000000000000000000b1",
  WALLETS_KURU_ROUTER_SELECTORS: "0x12345678",
  WALLETS_REALLOCATION_CONTRACT: "0x00000000000000000000000000000000000000c1",
  WALLETS_REALLOCATION_SELECTORS: "0x9abcdef0",
  WALLETS_SPONSORED_OPERATIONS: "10",
  WALLETS_SPONSORED_GAS_WEI: "100000",
  WALLETS_SPEND_POLICY_ADDRESS: "0x00000000000000000000000000000000000000f0",
  WALLETS_SESSION_VAULT_DIR: path.join(root, "session"),
  WALLETS_SESSION_VAULT_PASSPHRASE: "a testnet passphrase, not a real one",
});
const cheap = { N: 2 ** 10, r: 8, p: 1 };

test("without WALLETS_CHAIN_ID wallet operations stay unavailable, and /health says so", async () => {
  const booted = await bootApi({ env, privy: new FakePrivy() });
  try {
    await ready(booted);
    assert.equal(booted.deps.wallets, null);
    const health = await booted.app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), { status: "ok", wallets: "unavailable" });
  } finally {
    await booted.close();
  }
});

test("with WALLETS_* and a file vault, agent creation no longer answers 503 and the vault directory is created with mode 0700", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "monadeum-api-vault-"));
  const booted = await bootApi({ env: { ...env, ...walletsEnv(root) }, privy: new FakePrivy(), wallets: { chain: new FakeChain(), scrypt: cheap } });
  try {
    await ready(booted);
    assert.ok(booted.deps.wallets);
    assert.deepEqual(JSON.parse((await booted.app.inject({ method: "GET", url: "/health" })).body), { status: "ok", wallets: "configured" });
    const account = newWallet();
    const challenge = await booted.app.inject({ method: "POST", url: "/auth/wallet/challenge", payload: { address: account.address } });
    const { nonce, message } = JSON.parse(challenge.body);
    const verified = await booted.app.inject({
      method: "POST",
      url: "/auth/wallet/verify",
      headers: { origin: "https://app.example.test" },
      payload: { nonce, signature: await account.signMessage({ message }) },
    });
    const cookie = /monadeum_session=[^;]+/.exec(String(verified.headers["set-cookie"]))![0];
    const created = await booted.app.inject({
      method: "POST",
      url: "/agents",
      headers: { cookie, origin: "https://app.example.test" },
      payload: { name: "first", perTxCap: "1000", dailyCap: "5000" },
    });
    assert.notEqual(created.statusCode, 503, created.body);
    assert.ok(created.statusCode < 300, created.body);
    assert.equal((await stat(path.join(root, "session"))).mode & 0o777, 0o700);
    assert.ok((await readdir(path.join(root, "session"))).includes("vault.json"));
  } finally {
    await booted.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("WALLETS_CHAIN_ID without a vault, or a file vault with MONADEUM_ENV=production, refuses to start", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "monadeum-api-vault-"));
  try {
    const { WALLETS_SESSION_VAULT_DIR: _dir, WALLETS_SESSION_VAULT_PASSPHRASE: _pw, ...noVault } = walletsEnv(root);
    await assert.rejects(bootApi({ env: { ...env, ...noVault }, privy: new FakePrivy(), wallets: { chain: new FakeChain() } }), /no session key vault/);
    let connected = false;
    const connect: Connect = () => {
      connected = true;
      throw new Error("must not connect");
    };
    await assert.rejects(
      bootApi({ env: { ...env, ...walletsEnv(root), MONADEUM_ENV: "production", DATABASE_URL: "postgres://test" }, privy: new FakePrivy(), connect, wallets: { chain: new FakeChain(), scrypt: cheap } }),
      /testnet and local development only/,
    );
    assert.equal(connected, false, "refused before the database is opened");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
