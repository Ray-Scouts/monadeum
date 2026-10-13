import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PgPaymentLog, PgPositionStore, PgTradeStore } from "@monadeum/db";
import { MemoryPositionStore, MemoryTradeStore, type PositionStore, type TradeRecord, type TradeStore } from "@monadeum/trading";
import { MemoryPaymentLog, type PaymentLog, type PaymentLogEntry } from "@monadeum/x402";
import type { Hex } from "viem";
import { PUBLIC_RATE_LIMIT, roleScoped } from "../src/index.js";
import { boot, call, createAgent, index, newWallet, walletSignIn, type Backend, type Booted } from "./harness.js";

// The public evidence endpoint: unauthenticated, read-only, every record tied to a chain reference, and nothing that
// identifies a user. Records are written as the worker and indexer would write them.

const ACCOUNT = "0x00000000000000000000000000000000000000ab" as Hex;
const hash = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;

function trade(agentId: string, tick: number, side: "buy" | "sell", status: TradeRecord["status"] = "filled"): TradeRecord {
  const key = `${agentId}:${tick}`;
  const common = { tickKey: key, agentId, account: ACCOUNT, pair: "WETH/USDC", maxSlippageBps: 50, reference: { kind: "mid" as const, price: 10n ** 18n }, takerFeeBps: 0, preparedAtBlock: 1n };
  const order = side === "buy"
    ? { ...common, side: "buy" as const, quoteIn: 1_000_000n, expectedBaseOut: 10n, minBaseOut: 9n }
    : { ...common, side: "sell" as const, baseIn: 10n, expectedQuoteOut: 1_100_000n, minQuoteOut: 1_000_000n };
  const fill = side === "buy"
    ? { transactionHash: hash(1000 + tick), blockNumber: 2n, quoteIn: 1_000_000n, baseOut: 10n, grossBaseFilled: 10n, feeSource: "trade-events" as const, feeBase: 0n, executedPrice: 10n ** 18n }
    : { side: "sell" as const, transactionHash: hash(1000 + tick), blockNumber: 3n, baseIn: 10n, quoteOut: 1_100_000n, grossQuoteOut: 1_100_000n, feeSource: "taker-fee-bps" as const, feeQuote: 0n, executedPrice: 11n * 10n ** 17n };
  return {
    key, order, planHash: hash(1), calls: [], status, ref: null,
    fill: status === "filled" ? fill : null,
    costs: status === "filled" ? { gasWei: 5n, gas: 7n, fees: 0n, slippage: 1n } : null,
    failure: status === "failed" ? { kind: "policy", reason: "rejected by the risk engine" } : null,
  };
}

const payment = (agentId: string, tick: number, settlementRef: string | null, anomaly: string | null = null): PaymentLogEntry => ({
  key: `${agentId}:${tick}:nansen:/v1/quote`, provider: "nansen", price: 30_000n, summary: "private summary text", settlementRef, anomaly, influencedDecision: null,
});

for (const backend of ["memory", "pglite"] as Backend[]) {
  describe(`${backend}: public evidence`, () => {
    let b: Booted;

    before(async () => {
      b = await boot(backend);
    });
    after(() => b.close());

    it("answers without a credential, with an honest empty document and a cache header", async () => {
      const res = await call(b.app, "GET", "/public/evidence");
      assert.equal(res.status, 200);
      assert.match(String(res.headers["cache-control"]), /public, max-age=\d+/);
      assert.equal(res.body.chainId, 10143);
      assert.ok(!Number.isNaN(Date.parse(res.body.generatedAt)));
      for (const kind of ["deployed", "limitsSet", "callAllowed", "spent"]) assert.deepEqual(res.body.events[kind], { count: 0, items: [] });
      assert.deepEqual(res.body.trades, { count: 0, items: [] });
      assert.deepEqual(res.body.payments, { count: 0, items: [] });
    });

    it("lists indexed events, filled trades with their realized P&L, and settled payments, and nothing private", async () => {
      const owner = newWallet();
      const session = await walletSignIn(b.app, owner);
      const { agentId, account } = await createAgent(b.app, { cookie: session.cookie }, owner, "secret-agent-name");

      await index(b, account, [
        { kind: "account.deployed", data: { userOpHash: hash(7), factory: "0x00000000000000000000000000000000000000f1", paymaster: "0x00000000000000000000000000000000000000f2" } },
        { kind: "spend.limits-set", data: { perTxCap: "1000000", dailyCap: "5000000" } },
        { kind: "spend.call-allowed", data: { target: "0x00000000000000000000000000000000000000b1", selector: "0x12345678", allowed: true } },
        { kind: "spend.spent", data: { amount: "250000", windowTotal: "250000" } },
      ]);

      const worker = b.db ? roleScoped(b.db, "monadeum_worker") : null;
      const trades: TradeStore = worker ? new PgTradeStore(worker) : (b.stores.trades as MemoryTradeStore);
      const positions: PositionStore = worker ? new PgPositionStore(worker) : (b.stores.positions as unknown as MemoryPositionStore);
      const payments: PaymentLog = worker ? new PgPaymentLog(worker) : (b.stores.payments as MemoryPaymentLog);
      for (const t of [trade(agentId, 1, "buy"), trade(agentId, 2, "sell"), trade(agentId, 3, "buy", "failed"), trade(agentId, 4, "buy", "submitted")]) await trades.write(t);
      await positions.write({ agentId, pair: "WETH/USDC", size: 0n, basis: 0n, realized: 99_999n, closing: null, applied: { [`${agentId}:2`]: 99_999n } });
      for (const p of [payment(agentId, 1, hash(2001)), payment(agentId, 2, hash(2002), "duplicate-grant"), payment(agentId, 3, null, "not-paid")]) await payments.write(p);

      const res = await call(b.app, "GET", "/public/evidence");
      assert.equal(res.status, 200);
      const { events, trades: t, payments: p } = res.body;
      for (const kind of ["deployed", "limitsSet", "callAllowed", "spent"]) {
        assert.equal(events[kind].count, 1);
        assert.equal(events[kind].items[0].account, account.toLowerCase());
        assert.match(events[kind].items[0].transactionHash, /^0x[0-9a-f]{64}$/);
      }
      assert.equal(events.limitsSet.items[0].perTxCap, "1000000");
      assert.equal(events.spent.items[0].amount, "250000");

      assert.equal(t.count, 2, "only filled trades count; failed and in-flight records have no fill hash");
      const sell = t.items.find((x: { side: string }) => x.side === "sell");
      assert.equal(sell.transactionHash, hash(1002));
      assert.equal(sell.realizedPnl, "99999");
      assert.equal(sell.executedPrice, (11n * 10n ** 17n).toString());
      const buy = t.items.find((x: { side: string }) => x.side === "buy");
      assert.equal(buy.realizedPnl, null, "a buy realizes nothing and the position store holds no figure for it");
      assert.deepEqual(buy.costs, { gasWei: "5", gas: "7", fees: "0", slippage: "1" });

      assert.equal(p.count, 2, "a payment without a settlement transaction is not listed or counted");
      assert.deepEqual(p.items.map((x: { settlementTransaction: string }) => x.settlementTransaction).sort(), [hash(2001), hash(2002)]);
      assert.equal(p.items.find((x: { settlementTransaction: string }) => x.settlementTransaction === hash(2002)).reconciliation, "anomaly");

      // Nothing that identifies a user or an agent, and none of the private text the stores hold.
      const text = JSON.stringify(res.body).toLowerCase();
      for (const secret of [agentId, "secret-agent-name", owner.address, session.userId, "did:privy", "private summary text", "@", "signature", "session", "email", "key"]) {
        assert.ok(!text.includes(secret.toLowerCase()), `the public document must not contain ${secret}`);
      }
      const keys = new Set<string>();
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
      };
      walk(res.body);
      for (const k of ["owner", "agentId", "userId", "email", "key", "tickKey", "summary", "privyId"]) assert.ok(!keys.has(k), `no ${k} field`);
    });
  });
}

describe("public evidence rate limit", () => {
  it("answers 429 once a client exceeds the public limit, and the auth throttler is not shared", async () => {
    const b = await boot("memory");
    try {
      let last = 200;
      for (let i = 0; i < PUBLIC_RATE_LIMIT + 1; i++) last = (await call(b.app, "GET", "/public/evidence")).status;
      assert.equal(last, 429);
    } finally {
      await b.close();
    }
  });
});
