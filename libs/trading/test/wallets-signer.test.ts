import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionProposal, Decision } from "@monadeum/risk";
import {
  MemoryAgentWalletStore,
  MemorySessionKeyVault,
  MemorySponsorshipLedger,
  WalletsService,
  buildScope,
} from "@monadeum/wallets";
import { FakeChain } from "@monadeum/wallets/testing";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  KURU_TESTNET_MON_USDC as M,
  MemoryTradeStore,
  TradingService,
  WalletsTradeSigner,
  type Call,
  type LogEntry,
  type TradeSigner,
  type Venue,
} from "../src/index.js";
import { ORDER_BOOK_ABI, ROUTER_ABI } from "../src/market.js";

// TradingService over WalletsTradeSigner over WalletsService over the in-memory chain from @monadeum/wallets/testing.
// A "restart" builds new TradingService, WalletsTradeSigner and WalletsService instances over the same stores, so only
// what was written to a store survives it.

const SWAP_SELECTOR: Hex = "0xffa5210a";
const SWAP_CALL: Call = { target: M.router, data: SWAP_SELECTOR };
const REALLOC = "0x00000000000000000000000000000000000000c1";
const scope = buildScope({
  settlementAsset: M.quote, kuruRouter: M.router, kuruRouterSelectors: [SWAP_SELECTOR], reallocation: REALLOC, reallocationSelectors: ["0x9abcdef0"],
});

function swapLog(sender: Hex, amountIn: bigint, amountOut: bigint): LogEntry {
  return {
    address: M.router,
    topics: encodeEventTopics({ abi: ROUTER_ABI, eventName: "KuruRouterSwap" }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("address, address, address, uint256, uint256"), [sender, M.quote, M.base, amountIn, amountOut]),
  };
}
function tradeLog(taker: Hex, filledSize: bigint): LogEntry {
  return {
    address: M.market,
    topics: encodeEventTopics({ abi: ORDER_BOOK_ABI, eventName: "Trade" }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("uint40, address, bool, uint256, uint96, address, address, uint96"), [
      1, "0x00000000000000000000000000000000000000bb", false, 0n, 0n, M.router, taker, filledSize,
    ]),
  };
}

const venue: Venue = {
  blockNumber: async () => 100n,
  book: async () => ({ bid: 99n * 10n ** 16n, ask: 101n * 10n ** 16n }),
  takerFeeBps: async () => 0,
  quoteBuy: async () => 99n * 10n ** 16n,
  swapCall: async () => SWAP_CALL,
  swapsSince: async () => [],
};

const approved = (planHash: Hex): Decision => ({ approved: true, policyVersion: 1, policyHash: "0x00", planHash });

async function world() {
  const chain = new FakeChain({
    receiptLogs: (account) => [swapLog(account, 1_000_000n, 99n * 10n ** 16n), tradeLog(account, (995n * 10n ** 15n * M.sizePrecision) / 10n ** 18n)],
  });
  const stores = { wallet: new MemoryAgentWalletStore(), vault: new MemorySessionKeyVault(), ledger: new MemorySponsorshipLedger(), trades: new MemoryTradeStore() };
  const wallets = () => new WalletsService(chain, stores.wallet, stores.vault, stores.ledger, { scope, budget: { operations: 100, gasWei: 10n ** 18n }, paymaster: true });
  const ownerAccount = privateKeyToAccount(generatePrivateKey());
  const owner = { address: ownerAccount.address, signer: ownerAccount };
  const w = wallets();
  const deployed = await w.deploy({ agentId: "agent-1", owner, index: 0n, limits: { perTxCap: 10n ** 9n, dailyCap: 10n ** 10n } });
  assert.ok(deployed.ok);
  assert.ok((await w.issueSessionKey({ agentId: "agent-1", owner })).ok);
  const account = deployed.account;
  const trading = (signer: TradeSigner = new WalletsTradeSigner(wallets())) => new TradingService(M, venue, signer, stores.trades);
  const proposal: ActionProposal = {
    schemaVersion: 1, tickKey: "agent-1:7", agentId: "agent-1", account, genomeHash: "0x01", strategyType: "trading",
    state: { capital: 10_000_000n, principal: 10_000_000n, ticksSinceTrade: 3, observedAt: "2026-10-09T00:00:00Z" },
    information: [],
    action: { kind: "trade", pair: "MON/USDC", side: "long", notional: 1_000_000n, maxSlippageBps: 50 },
  };
  const prepared = await trading().prepare(proposal);
  assert.ok(prepared.ok);
  const sessions = () => chain.submitted.filter((s) => s.kind === "session").length;
  return { chain, stores, wallets, trading, trade: prepared.trade, sessions };
}

test("a trade signed through WalletsModule is filled from the wallet receipt's logs", async () => {
  const { trading, trade, sessions } = await world();
  const record = await trading().submit(trade, approved(trade.plan.planHash));
  assert.equal(record.status, "filled");
  assert.equal(record.fill!.quoteIn, 1_000_000n);
  assert.equal(record.fill!.baseOut, 99n * 10n ** 16n);
  assert.equal(record.fill!.feeSource, "trade-events");
  assert.equal(record.costs!.gasWei, 900n);
  assert.equal(sessions(), 1);
});

test("crash after record, before submit: the tick stays claimed, and after a restart it is sent once", async () => {
  const { chain, stores, trading, trade, sessions } = await world();
  chain.options.submit = "unknown";
  const first = await trading().submit(trade, approved(trade.plan.planHash));
  assert.equal(first.status, "claimed", "nothing is known to be in flight, so it is resubmittable, not failed");
  assert.equal(sessions(), 0);

  chain.options.submit = "ok";
  const after = await trading().submit(trade, approved(trade.plan.planHash));
  assert.equal(after.status, "filled");
  assert.equal(sessions(), 1);
  const op = (await stores.wallet.getOperation("agent-1", "agent-1:7"))!;
  assert.equal(op.attempts.length, 2);
  assert.equal(op.attempts[1]!.nonce, op.attempts[0]!.nonce);
});

test("crash after submit: a retry before inclusion resends nothing, and reconciliation after a restart fills it", async () => {
  const { chain, trading, trade, sessions } = await world();
  chain.options.submit = "accepted-then-throw";
  const first = await trading().submit(trade, approved(trade.plan.planHash));
  assert.equal(first.status, "submitted");
  assert.ok(first.ref);

  chain.options.submit = "ok";
  const retry = await trading().submit(trade, approved(trade.plan.planHash));
  assert.equal(retry.status, "submitted");
  assert.equal(retry.ref, first.ref);
  assert.equal(sessions(), 0);

  chain.mine();
  const reconciled = await trading().reconcile("agent-1:7");
  assert.equal(reconciled.state, "recorded");
  assert.equal(reconciled.state === "recorded" && reconciled.record.status, "filled");
  assert.equal(sessions(), 1);
});

test("crash between the wallet's submission and the trade record: lookup by tick key finds the operation without a reference", async () => {
  const { stores, wallets, trading, trade, sessions } = await world();
  const inner = new WalletsTradeSigner(wallets());
  const crashing: TradeSigner = {
    submit: async (r) => {
      await inner.submit(r);
      throw new Error("worker crashed before recording the reference");
    },
    lookup: (r) => inner.lookup(r),
  };
  const first = await trading(crashing).submit(trade, approved(trade.plan.planHash));
  assert.equal(first.status, "claimed");
  assert.equal(first.ref, null, "the trade record never received the operation's reference");
  assert.equal(first.failure?.kind, "network");

  // Restart: reconciliation asks by tick key alone, and WalletsModule's record answers it.
  const again = await trading().reconcile("agent-1:7");
  assert.equal(again.state === "recorded" && again.record.status, "filled");
  assert.ok(stores.trades.get("agent-1:7")!.ref);
  const retry = await trading().submit(trade, approved(trade.plan.planHash));
  assert.equal(retry.status, "filled");
  assert.equal(sessions(), 1);
});

test("a definite refusal from WalletsModule fails the trade without sending; an unreachable bundler keeps it claimed", async () => {
  const revoked = await world();
  const record = (await revoked.stores.wallet.get("agent-1"))!;
  record.session!.status = "revoked";
  await revoked.stores.wallet.update(record);
  const failed = await revoked.trading().submit(revoked.trade, approved(revoked.trade.plan.planHash));
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.failure, { kind: "execution", reason: "revoked" });
  assert.equal(revoked.sessions(), 0);

  const down = await world();
  down.chain.options.submit = "accepted-then-throw";
  await down.trading().submit(down.trade, approved(down.trade.plan.planHash));
  down.chain.options.bundlerDown = true;
  const unknown = await down.trading().reconcile("agent-1:7");
  assert.equal(unknown.state === "recorded" && unknown.record.status, "submitted");
  assert.equal(unknown.state === "recorded" && unknown.record.failure?.kind, "network");
});
