import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { DatabaseConfigError, migrate, pgliteDatabase, type Connect } from "@monadeum/db";
import { bootApi } from "../src/index.js";
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
