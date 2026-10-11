import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PgPaymentLog, PgTradeStore } from "@monadeum/db";
import { MemoryTradeStore, type TradeRecord, type TradeStore } from "@monadeum/trading";
import { MemoryPaymentLog, type PaymentLog, type PaymentLogEntry, type Provider } from "@monadeum/x402";
import type { Hex } from "viem";
import { roleScoped } from "../src/index.js";
import { boot, call, createAgent, newWallet, privySignIn, walletSignIn, type Backend, type Booted } from "./harness.js";

// Trade counts and x402 spend: per agent for its owner, and as platform totals in /population. The worker writes these
// records; here they are written as the worker would, through `monadeum_worker` on Postgres, and the API reads them
// through `monadeum_reader`, so a missing grant fails here.

const ACCOUNT = "0x00000000000000000000000000000000000000ab" as Hex;
const hash = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;

function trade(agentId: string, tick: number, status: TradeRecord["status"]): TradeRecord {
  const key = `${agentId}:${tick}`;
  return {
    key,
    order: {
      tickKey: key, agentId, account: ACCOUNT, pair: "WETH/USDC", side: "buy", quoteIn: 1_000_000n, expectedBaseOut: 10n,
      minBaseOut: 9n, maxSlippageBps: 50, reference: { kind: "mid", price: 10n ** 18n }, takerFeeBps: 0, preparedAtBlock: 1n,
    },
    planHash: hash(1),
    calls: [],
    status,
    ref: null,
    fill: status === "filled"
      ? { transactionHash: hash(1000 + tick), blockNumber: 2n, quoteIn: 1_000_000n, baseOut: 10n, grossBaseFilled: 10n, feeSource: "trade-events", feeBase: 0n, executedPrice: 10n ** 18n }
      : null,
    costs: null,
    failure: status === "failed" ? { kind: "policy", reason: "rejected" } : null,
  };
}

function payment(agentId: string, tick: number, provider: Provider, price: bigint): PaymentLogEntry {
  return { key: `${agentId}:${tick}:${provider}:/v1/quote`, provider, price, summary: null, settlementRef: null, anomaly: null, influencedDecision: null };
}

for (const backend of ["memory", "pglite"] as Backend[]) {
  describe(`${backend}: trade counts and x402 spend`, () => {
    let b: Booted;
    const alice = newWallet();
    const mallory = newWallet();
    let aliceAuth: { cookie: string };
    let malloryAuth: { bearer: string };
    let aliceAgent: string;
    let idleAgent: string;
    let malloryAgent: string;

    before(async () => {
      b = await boot(backend);
      aliceAuth = { cookie: (await walletSignIn(b.app, alice)).cookie };
      malloryAuth = { bearer: (await privySignIn(b.app, "did:privy:mallory", mallory)).bearer };
      aliceAgent = (await createAgent(b.app, aliceAuth, alice, "alpha")).agentId;
      idleAgent = (await createAgent(b.app, aliceAuth, alice, "idle")).agentId;
      malloryAgent = (await createAgent(b.app, malloryAuth, mallory, "mallory")).agentId;

      const worker = b.db ? roleScoped(b.db, "monadeum_worker") : null;
      const trades: TradeStore = worker ? new PgTradeStore(worker) : (b.stores.trades as MemoryTradeStore);
      const payments: PaymentLog = worker ? new PgPaymentLog(worker) : (b.stores.payments as MemoryPaymentLog);
      for (const t of [
        trade(aliceAgent, 1, "filled"), trade(aliceAgent, 2, "filled"), trade(aliceAgent, 3, "failed"), trade(aliceAgent, 4, "submitted"),
        trade(malloryAgent, 1, "filled"), trade(malloryAgent, 2, "filled"), trade(malloryAgent, 3, "filled"),
      ]) await trades.write(t);
      for (const p of [
        payment(aliceAgent, 1, "nansen", 30_000n), payment(aliceAgent, 2, "defillama", 5_000n), payment(aliceAgent, 3, "nansen", 20_000n),
        payment(aliceAgent, 4, "nansen", 0n),
        payment(malloryAgent, 1, "nansen", 7_000_000n),
      ]) await payments.write(p);
    });
    after(() => b.close());

    it("serves each agent's filled trades and x402 spend in the list and the detail", async () => {
      const expected = {
        purchases: 3, spent: "55000",
        byProvider: [{ provider: "defillama", spent: "5000" }, { provider: "nansen", spent: "50000" }],
      };
      const list = await call(b.app, "GET", "/agents", { auth: aliceAuth });
      assert.equal(list.status, 200);
      const mine = list.body.agents.find((a: { id: string }) => a.id === aliceAgent);
      assert.equal(mine.tradeCount, 2, "only filled trades count");
      assert.deepEqual(mine.x402, expected);
      const idle = list.body.agents.find((a: { id: string }) => a.id === idleAgent);
      assert.equal(idle.tradeCount, 0);
      assert.deepEqual(idle.x402, { purchases: 0, spent: "0", byProvider: [] });

      const detail = await call(b.app, "GET", `/agents/${aliceAgent}`, { auth: aliceAuth });
      assert.equal(detail.status, 200);
      assert.equal(detail.body.agent.tradeCount, 2);
      assert.deepEqual(detail.body.agent.x402, expected);
    });

    it("never serves another owner's agent activity", async () => {
      const list = await call(b.app, "GET", "/agents", { auth: aliceAuth });
      assert.deepEqual(list.body.agents.map((a: { id: string }) => a.id).sort(), [aliceAgent, idleAgent].sort());
      assert.ok(!JSON.stringify(list.body).includes("7000000"), "mallory's spend is not in alice's list");
      const other = await call(b.app, "GET", `/agents/${malloryAgent}`, { auth: aliceAuth });
      assert.equal(other.status, 404);
      assert.deepEqual(other.body, { error: "not-found" });

      const theirs = await call(b.app, "GET", "/agents", { auth: malloryAuth });
      assert.deepEqual(theirs.body.agents.map((a: { id: string; tradeCount: number }) => [a.id, a.tradeCount]), [[malloryAgent, 3]]);
      assert.equal((await call(b.app, "GET", `/agents/${aliceAgent}`, { auth: malloryAuth })).status, 404);
    });

    it("reports platform totals in /population, by provider and never by agent", async () => {
      const res = await call(b.app, "GET", "/population", { auth: malloryAuth });
      assert.equal(res.status, 200);
      assert.equal(res.body.trades, 5);
      assert.deepEqual(res.body.x402, {
        purchases: 4, spent: "7055000",
        byProvider: [{ provider: "defillama", spent: "5000" }, { provider: "nansen", spent: "7050000" }],
      });
      for (const id of [aliceAgent, idleAgent, malloryAgent]) assert.ok(!JSON.stringify(res.body).includes(id));
    });
  });
}
