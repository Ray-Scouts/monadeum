// Shared conformance suite. Every store implementation, in-memory and Postgres, runs exactly these tests, so the
// Postgres stores are held to the semantics the modules were written against.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, AgentRegistry, AgentState, DebitRecord, DebitStore, EvaluationRecord, EvaluationStore } from "@monadeum/agent-registry";
import type { ChallengeStore, SessionStore, UserRecord, UserStore, WalletChallenge } from "@monadeum/auth";
import type { TickRecord, TickStore } from "@monadeum/tick";
import { IndexedContractError, SettlementAssetMismatchError, type BlockHash, type ChainEvent, type ReadModelStore, type SyncBatch } from "@monadeum/read-model";
import type { Position, PositionStore, RealizedPnl, TradeCounts, TradeRecord, TradeStore } from "@monadeum/trading";
import type { AgentWalletRecord, AgentWalletStore, SponsorshipLedger, TickOperationRecord } from "@monadeum/wallets";
import type { PaymentLog, PaymentLogEntry, PaymentTotals, SlotClaim, X402SlotStore } from "@monadeum/x402";
import type { Address, Hex } from "viem";

export interface Stores {
  wallets: AgentWalletStore;
  ledger: SponsorshipLedger;
  users: UserStore;
  challenges: ChallengeStore;
  sessions: SessionStore;
  trades: TradeStore & TradeCounts;
  payments: PaymentLog & PaymentTotals;
  slots: X402SlotStore;
  ticks: TickStore;
  readModel: ReadModelStore;
  agents: AgentRegistry;
  debits: DebitStore;
  positions: PositionStore & RealizedPnl;
  evaluations: EvaluationStore;
}

/** `fresh` returns stores over empty storage. Called once per test. */
export interface Harness {
  fresh(): Promise<Stores>;
}

const addr = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}` as Address;
const mixed = (a: Address): Address => (a.slice(0, 2) + a.slice(2).toUpperCase()) as Address;
const hash = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const ACCOUNT = "0x00000000000000000000000000000000000000ab" as Address;
const BIG = 2n ** 200n + 12345n;

export function wallet(agentId: string, account: Address = ACCOUNT): AgentWalletRecord {
  return {
    agentId,
    owner: addr(1),
    index: 2n ** 70n,
    account,
    deployment: { status: "deployed", userOpHash: hash(9) },
    session: {
      keyAddress: addr(2), permissionId: "0x12345678", enableSignature: "0x5161", enableNonce: 3,
      status: "active", issuedAt: 1_700_000_000, revokedAt: null, revokeUserOpHash: null,
    },
    x402: { keyAddress: addr(3), validator: addr(4), status: "active", installedAt: 1_700_000_001, revokedAt: null },
  };
}

export function slotClaim(slot: number, paymentKey: string, overrides: Partial<SlotClaim> = {}): SlotClaim {
  return {
    account: ACCOUNT, epoch: 2n ** 70n, slot, nonce: hash(100 + slot), paymentKey, payTo: addr(5), value: BIG,
    validAfter: 1_790_000_000n, validBefore: 1_790_000_060n, claimedAt: 1_790_000_005, ...overrides,
  };
}

export function operation(agentId: string, tickKey: string): TickOperationRecord {
  return {
    agentId, tickKey, account: ACCOUNT, callsHash: hash(7),
    attempts: [{ userOpHash: hash(1), nonce: 2n ** 64n + 1n, sponsored: true, reserved: BIG, rejected: false }],
    included: null,
  };
}

function user(id: string, overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id, privyUserId: `did:privy:${id}`, ownerWallet: addr(10), createdAt: 1_700_000_000,
    wallets: [{ address: addr(10), kind: "embedded", proof: "privy-identity-token", linkedAt: 1_700_000_000 }],
    ...overrides,
  };
}

function challenge(nonce: string): WalletChallenge {
  return { nonce, message: `sign in ${nonce}`, address: addr(20), purpose: "link", userId: "u1", expiresAt: 1_700_000_300 };
}

export function trade(key: string, txHash: Hex | null = null): TradeRecord {
  return {
    key,
    order: {
      tickKey: key, agentId: "agent-1", account: ACCOUNT, pair: "MON/USDC", side: "buy", quoteIn: 1_000_000n,
      expectedBaseOut: BIG, minBaseOut: 99n, maxSlippageBps: 50, reference: { kind: "mid", price: 10n ** 18n },
      takerFeeBps: 3, preparedAtBlock: 100n,
    },
    planHash: hash(3),
    calls: [{ target: ACCOUNT, data: "0x095ea7b3" }],
    status: txHash ? "filled" : "claimed",
    ref: txHash ? hash(4) : null,
    fill: txHash
      ? { transactionHash: txHash, blockNumber: 101n, quoteIn: 1_000_000n, baseOut: 99n, grossBaseFilled: 100n, feeSource: "trade-events", feeBase: 1n, executedPrice: 10n ** 18n }
      : null,
    costs: txHash ? { gasWei: 43n * 10n ** 15n, gas: 43_000n, fees: 1n, slippage: -5n } : null,
    failure: null,
  };
}

export function payment(key: string, settlementRef: string | null = null): PaymentLogEntry {
  return { key, provider: "nansen", price: BIG, summary: null, settlementRef, anomaly: "not-paid", influencedDecision: null };
}

export function tickRecord(agentId: string, tick: number): TickRecord {
  return { key: `${agentId}:${tick}`, agentId, tick, status: "started", purchase: null, approved: null, outcome: null };
}

export function agentRecord(agentId: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId, owner: mixed(addr(30)) as Hex, account: addr(31) as Hex, genomeHash: hash(32),
    genome: { riskTolerance: 0.25, executionFrequency: 4, informationBudget: BIG, informationSources: ["nansen", "defillama"], pair: "MON/USDC", assetUniverse: ["MON/USDC"] },
    principal: BIG, status: "active", ...overrides,
  };
}

export function evaluationRecord(agentId: string, sequence: number, overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    sequence, agentId, evaluatedAt: 1_790_000_000_000 + sequence, capital: BIG + BigInt(sequence), adjustedFitness: 0.125 + sequence,
    fitnessPercentile: 0.75, rawSortino: -0.5e-7, zeroDownsideFlag: false, tradeCount: 17, lowWindows: 0, retired: false, retirementRule: null,
    ...overrides,
  };
}

export function debitRecord(key: string, status: DebitRecord["status"] = "approved"): DebitRecord {
  return {
    key, status, planHash: hash(40),
    decision: status === "rejected" ? { approved: false, violations: ["reallocation-bound"], policyVersion: 2, policyHash: hash(41) } : { approved: true, policyVersion: 2, policyHash: hash(41), planHash: hash(40) },
    reason: status === "rejected" ? "reallocation-bound" : null,
  };
}

const block = (n: number, salt = 0): BlockHash => ({ number: BigInt(n), hash: hash(n * 1000 + salt) });

export function chainEvent(n: number, logIndex: number, kind: string, account: Address | null = ACCOUNT): ChainEvent {
  return {
    kind, account, address: addr(500), blockNumber: BigInt(n), blockHash: block(n).hash, transactionHash: hash(n * 10 + logIndex),
    logIndex, data: { amount: (BIG * BigInt(n)).toString(), allowed: logIndex % 2 === 0, nonce: logIndex },
  };
}

export function batch(to: number, events: ChainEvent[], overrides: Partial<SyncBatch> = {}): SyncBatch {
  const numbers = new Set([to, ...events.map((e) => Number(e.blockNumber))]);
  return { events, blocks: [...numbers].map((n) => block(n)), discovered: [], cursor: block(to), pruneBelow: 0n, ...overrides };
}

const sortedAccounts = async (store: ReadModelStore) => (await store.trackedAccounts()).slice().sort();

export function conformance(name: string, harness: Harness): void {
  describe(`${name}: ReadModelStore`, () => {
    it("starts empty", async () => {
      const { readModel } = await harness.fresh();
      assert.equal(await readModel.cursor(), null);
      assert.deepEqual(await readModel.blockHashes(), []);
      assert.deepEqual(await readModel.trackedAccounts(), []);
      assert.deepEqual(await readModel.events(), []);
    });

    it("applies a batch with its cursor and returns rows in chain order, filtered by kind and account", async () => {
      const { readModel } = await harness.fresh();
      const other = addr(600);
      await readModel.apply(batch(10, [chainEvent(7, 2, "spend.spent"), chainEvent(7, 2, "spend.limits-set"), chainEvent(5, 9, "spend.spent", other)], {
        discovered: [{ account: ACCOUNT, firstBlock: 5n }, { account: other, firstBlock: 5n }],
      }));
      await readModel.apply(batch(20, [chainEvent(15, 0, "account.deployed", null)]));
      assert.deepEqual(await readModel.cursor(), block(20));
      assert.deepEqual(
        (await readModel.events()).map((e) => [Number(e.blockNumber), e.logIndex, e.kind]),
        [[5, 9, "spend.spent"], [7, 2, "spend.limits-set"], [7, 2, "spend.spent"], [15, 0, "account.deployed"]],
      );
      assert.deepEqual(await readModel.events({ kind: "spend.spent", account: mixed(ACCOUNT) }), [chainEvent(7, 2, "spend.spent")]);
      assert.deepEqual(await readModel.events({ account: other }), [chainEvent(5, 9, "spend.spent", other)]);
      assert.deepEqual(await readModel.events({ kind: "account.deployed" }), [chainEvent(15, 0, "account.deployed", null)]);
      assert.deepEqual(await sortedAccounts(readModel), [ACCOUNT, other].sort());
      assert.deepEqual(await readModel.blockHashes(), [block(20), block(15), block(10), block(7), block(5)]);
    });

    it("refuses a batch that does not advance the cursor, and stores nothing from it", async () => {
      const { readModel } = await harness.fresh();
      await readModel.apply(batch(10, [chainEvent(10, 0, "spend.spent")]));
      await assert.rejects(readModel.apply(batch(10, [chainEvent(10, 1, "spend.spent")], { discovered: [{ account: addr(601), firstBlock: 10n }] })));
      await assert.rejects(readModel.apply(batch(9, [])));
      assert.deepEqual(await readModel.cursor(), block(10));
      assert.equal((await readModel.events()).length, 1);
      assert.deepEqual(await readModel.trackedAccounts(), []);
    });

    it("reports a finalized bound only while every batch since it was empty was finalized, and keeps it across a rollback", async () => {
      const { readModel } = await harness.fresh();
      assert.equal(await readModel.finalizedThrough(), null);
      await readModel.apply(batch(10, [chainEvent(8, 0, "spend.spent")], { finalized: true }));
      assert.equal(await readModel.finalizedThrough(), 10n);
      await readModel.apply(batch(20, [], { finalized: true }));
      assert.equal(await readModel.finalizedThrough(), 20n);
      await readModel.rollback(block(10));
      assert.equal(await readModel.finalizedThrough(), 10n);
      await readModel.apply(batch(30, []));
      assert.equal(await readModel.finalizedThrough(), null, "a batch without the flag clears it");
      await readModel.apply(batch(40, [], { finalized: true }));
      assert.equal(await readModel.finalizedThrough(), null, "and it stays cleared");

      const fresh = (await harness.fresh()).readModel;
      await fresh.apply(batch(10, []));
      assert.equal(await fresh.finalizedThrough(), null);
    });

    it("records the settlement asset once, lowercase, and refuses a different one", async () => {
      const { readModel } = await harness.fresh();
      assert.equal(await readModel.settlementAsset(), null);
      await readModel.recordSettlementAsset(mixed(addr(700)));
      await readModel.recordSettlementAsset(addr(700));
      assert.equal(await readModel.settlementAsset(), addr(700));
      await assert.rejects(readModel.recordSettlementAsset(addr(701)), SettlementAssetMismatchError);
      assert.equal(await readModel.settlementAsset(), addr(700));
    });

    it("records an indexed contract once, lowercase, only before the first batch, and refuses a different one", async () => {
      const { readModel } = await harness.fresh();
      assert.deepEqual(await readModel.indexedContracts(), {});
      await readModel.recordIndexedContract("reallocation", mixed(addr(710)));
      await readModel.recordIndexedContract("reallocation", addr(710));
      assert.deepEqual(await readModel.indexedContracts(), { reallocation: addr(710) });
      await assert.rejects(readModel.recordIndexedContract("reallocation", addr(711)), IndexedContractError);
      await readModel.apply(batch(10, []));
      // The same address after the first batch is fine; a new name would claim blocks that were read without it.
      await readModel.recordIndexedContract("reallocation", addr(710));
      await assert.rejects(readModel.recordIndexedContract("registry", addr(712)), IndexedContractError);
      assert.deepEqual(await readModel.indexedContracts(), { reallocation: addr(710) });
    });

    it("prunes block hashes below the window but keeps the cursor block", async () => {
      const { readModel } = await harness.fresh();
      await readModel.apply(batch(10, [chainEvent(4, 0, "spend.spent")]));
      await readModel.apply(batch(20, [chainEvent(18, 0, "spend.spent")], { pruneBelow: 12n }));
      assert.deepEqual(await readModel.blockHashes(), [block(20), block(18)]);
      await readModel.apply(batch(30, [], { pruneBelow: 40n }));
      assert.deepEqual(await readModel.blockHashes(), [block(30)]);
    });

    it("keeps an account's first block when it is discovered again", async () => {
      const { readModel } = await harness.fresh();
      await readModel.apply(batch(10, [], { discovered: [{ account: ACCOUNT, firstBlock: 5n }] }));
      await readModel.apply(batch(20, [], { discovered: [{ account: ACCOUNT, firstBlock: 15n }] }));
      await readModel.rollback(block(12));
      assert.deepEqual(await readModel.trackedAccounts(), [ACCOUNT]);
    });

    it("rolls back every row, block hash, and tracked account above the ancestor, and moves the cursor to it", async () => {
      const { readModel } = await harness.fresh();
      await readModel.apply(batch(10, [chainEvent(8, 0, "spend.spent")], { discovered: [{ account: ACCOUNT, firstBlock: 8n }] }));
      await readModel.apply(batch(20, [chainEvent(15, 3, "spend.spent"), chainEvent(19, 1, "spend.spent", addr(600))], {
        discovered: [{ account: addr(600), firstBlock: 19n }],
      }));
      const ancestor = block(12, 7);
      await readModel.rollback(ancestor);
      assert.deepEqual(await readModel.cursor(), ancestor);
      assert.deepEqual(await readModel.events(), [chainEvent(8, 0, "spend.spent")]);
      assert.deepEqual(await readModel.trackedAccounts(), [ACCOUNT]);
      assert.deepEqual(await readModel.blockHashes(), [ancestor, block(10), block(8)]);
      await readModel.apply(batch(13, [chainEvent(13, 0, "spend.spent")]));
      assert.equal((await readModel.events()).length, 2);
    });
  });

  describe(`${name}: AgentWalletStore`, () => {
    it("claims an agent once and returns the record exactly, bigints included", async () => {
      const { wallets } = await harness.fresh();
      assert.equal(await wallets.get("a"), undefined);
      assert.equal(await wallets.claim(wallet("a")), true);
      assert.equal(await wallets.claim(wallet("a", addr(99))), false);
      assert.deepEqual(await wallets.get("a"), wallet("a"));
    });

    it("keeps an account address to one agent, case-insensitively, and finds it either way", async () => {
      const { wallets } = await harness.fresh();
      assert.equal(await wallets.claim(wallet("a")), true);
      assert.equal(await wallets.claim(wallet("b", mixed(ACCOUNT))), false);
      assert.equal(await wallets.get("b"), undefined);
      assert.equal((await wallets.findByAccount(mixed(ACCOUNT)))?.agentId, "a");
      assert.equal(await wallets.findByAccount(addr(77)), undefined);
    });

    it("updates an existing record, refuses a missing one, and refuses another agent's account", async () => {
      const { wallets } = await harness.fresh();
      await wallets.claim(wallet("a"));
      await wallets.claim(wallet("b", addr(55)));
      const next = { ...wallet("a"), session: null, deployment: { status: "pending" as const, userOpHash: null } };
      await wallets.update(next);
      assert.deepEqual(await wallets.get("a"), next);
      await assert.rejects(wallets.update(wallet("missing", addr(66))));
      await assert.rejects(wallets.update(wallet("b", ACCOUNT)));
      assert.equal((await wallets.get("b"))?.account, addr(55));
    });

    it("returns copies, so mutating a result never changes the store", async () => {
      const { wallets } = await harness.fresh();
      await wallets.claim(wallet("a"));
      const got = (await wallets.get("a"))!;
      got.session!.status = "revoked";
      assert.equal((await wallets.get("a"))!.session!.status, "active");
    });

    it("claims a tick operation once per (agent, tick key), before anything is submitted", async () => {
      const { wallets } = await harness.fresh();
      assert.equal(await wallets.claimOperation(operation("a", "a:1")), true);
      assert.equal(await wallets.claimOperation({ ...operation("a", "a:1"), callsHash: hash(8) }), false);
      assert.equal(await wallets.claimOperation(operation("b", "a:1")), true);
      assert.deepEqual(await wallets.getOperation("a", "a:1"), operation("a", "a:1"));
      assert.equal(await wallets.getOperation("a", "a:2"), undefined);
    });

    it("updates a tick operation with its receipt and refuses a missing one", async () => {
      const { wallets } = await harness.fresh();
      await wallets.claimOperation(operation("a", "a:1"));
      const included: TickOperationRecord = {
        ...operation("a", "a:1"),
        included: {
          userOpHash: hash(1),
          receipt: {
            success: true, actualGasCost: BIG, sponsored: true, transactionHash: hash(5), blockNumber: 2n ** 63n,
            logs: [{ address: ACCOUNT, topics: [hash(6)], data: "0x" }], revertReason: null,
          },
        },
      };
      await wallets.updateOperation(included);
      assert.deepEqual(await wallets.getOperation("a", "a:1"), included);
      await assert.rejects(wallets.updateOperation(operation("a", "a:9")));
    });

    it("lists one agent's operations in claim order", async () => {
      const { wallets } = await harness.fresh();
      for (const k of ["a:3", "a:1", "a:2"]) await wallets.claimOperation(operation("a", k));
      await wallets.claimOperation(operation("b", "b:1"));
      await wallets.updateOperation({ ...operation("a", "a:3"), callsHash: hash(11) });
      assert.deepEqual((await wallets.listOperations("a")).map((o) => o.tickKey), ["a:3", "a:1", "a:2"]);
      assert.deepEqual(await wallets.listOperations("c"), []);
    });

    it("lets exactly one of several concurrent claims for a tick win", async () => {
      const { wallets } = await harness.fresh();
      const results = await Promise.all(Array.from({ length: 8 }, () => wallets.claimOperation(operation("a", "a:1"))));
      assert.equal(results.filter(Boolean).length, 1);
    });
  });

  describe(`${name}: SponsorshipLedger`, () => {
    const budget = { operations: 2, gasWei: 1000n };

    it("starts at zero and reserves within both limits only", async () => {
      const { ledger } = await harness.fresh();
      assert.deepEqual(await ledger.usage("a"), { operations: 0, gasWei: 0n });
      assert.equal(await ledger.reserve("a", 0n, budget), false);
      assert.equal(await ledger.reserve("a", 1001n, budget), false);
      assert.equal(await ledger.reserve("a", 600n, budget), true);
      assert.equal(await ledger.reserve("a", 401n, budget), false);
      assert.equal(await ledger.reserve("a", 400n, budget), true);
      assert.equal(await ledger.reserve("a", 1n, { operations: 3, gasWei: 10_000n }), true);
      assert.equal(await ledger.reserve("a", 1n, { operations: 3, gasWei: 10_000n }), false);
      assert.deepEqual(await ledger.usage("a"), { operations: 3, gasWei: 1001n });
      assert.deepEqual(await ledger.usage("b"), { operations: 0, gasWei: 0n });
    });

    it("settles to the actual gas, releases a reservation, and refuses an agent with no reservation", async () => {
      const { ledger } = await harness.fresh();
      await ledger.reserve("a", 500n, budget);
      await ledger.settle("a", 500n, 700n);
      assert.deepEqual(await ledger.usage("a"), { operations: 1, gasWei: 700n });
      await ledger.reserve("a", 200n, budget);
      await ledger.release("a", 200n);
      assert.deepEqual(await ledger.usage("a"), { operations: 1, gasWei: 700n });
      await assert.rejects(ledger.settle("b", 1n, 1n));
      await assert.rejects(ledger.release("b", 1n));
    });

    it("holds wei amounts beyond 64 bits exactly", async () => {
      const { ledger } = await harness.fresh();
      assert.equal(await ledger.reserve("a", BIG, { operations: 1, gasWei: BIG }), true);
      assert.deepEqual(await ledger.usage("a"), { operations: 1, gasWei: BIG });
    });

    it("never lets concurrent reservations exceed the budget", async () => {
      const { ledger } = await harness.fresh();
      const results = await Promise.all(Array.from({ length: 10 }, () => ledger.reserve("a", 100n, { operations: 3, gasWei: 10_000n })));
      assert.equal(results.filter(Boolean).length, 3);
      assert.deepEqual(await ledger.usage("a"), { operations: 3, gasWei: 300n });
    });
  });

  describe(`${name}: UserStore`, () => {
    it("creates a user once and finds it by ID, Privy ID, and wallet in any case", async () => {
      const { users } = await harness.fresh();
      assert.equal(await users.create(user("u1")), true);
      assert.equal(await users.create(user("u1", { privyUserId: "did:privy:other", wallets: [], ownerWallet: null })), false);
      assert.deepEqual(await users.get("u1"), user("u1"));
      assert.equal((await users.byPrivyUserId("did:privy:u1"))?.id, "u1");
      assert.equal((await users.byWallet(mixed(addr(10))))?.id, "u1");
      assert.equal(await users.byWallet(addr(11)), undefined);
      assert.equal(await users.get("u2"), undefined);
    });

    it("refuses a second user holding the same Privy ID or the same wallet", async () => {
      const { users } = await harness.fresh();
      await users.create(user("u1"));
      assert.equal(await users.create(user("u2", { wallets: [], ownerWallet: null, privyUserId: "did:privy:u1" })), false);
      const sameWallet = user("u3", { privyUserId: null, ownerWallet: mixed(addr(10)), wallets: [{ address: mixed(addr(10)), kind: "external", proof: "wallet-signature", linkedAt: 1 }] });
      assert.equal(await users.create(sameWallet), false);
      assert.equal(await users.get("u2"), undefined);
      assert.equal(await users.get("u3"), undefined);
    });

    it("allows several users with no Privy identity", async () => {
      const { users } = await harness.fresh();
      assert.equal(await users.create(user("u1", { privyUserId: null })), true);
      assert.equal(await users.create(user("u2", { privyUserId: null, ownerWallet: addr(12), wallets: [{ address: addr(12), kind: "external", proof: "wallet-signature", linkedAt: 2 }] })), true);
    });

    it("refuses a record that lists the same wallet twice", async () => {
      const { users } = await harness.fresh();
      const w = { address: addr(10), kind: "embedded" as const, proof: "privy-identity-token" as const, linkedAt: 1 };
      assert.equal(await users.create(user("u1", { wallets: [w, { ...w, address: mixed(addr(10)) }] })), false);
      assert.equal(await users.get("u1"), undefined);
    });

    it("links wallets in order, and refuses a link that would cross users without changing either", async () => {
      const { users } = await harness.fresh();
      await users.create(user("u1"));
      await users.create(user("u2", { ownerWallet: addr(20), wallets: [{ address: addr(20), kind: "embedded", proof: "privy-identity-token", linkedAt: 5 }] }));
      const linked = { ...user("u1"), wallets: [...user("u1").wallets, { address: addr(30), kind: "external" as const, proof: "wallet-signature" as const, linkedAt: 9 }, { address: addr(15), kind: "external" as const, proof: "wallet-signature" as const, linkedAt: 10 }] };
      assert.equal(await users.update(linked), true);
      assert.deepEqual(await users.get("u1"), linked);
      const crossing = { ...linked, wallets: [...linked.wallets, { address: mixed(addr(20)), kind: "external" as const, proof: "wallet-signature" as const, linkedAt: 11 }] };
      assert.equal(await users.update(crossing), false);
      assert.deepEqual(await users.get("u1"), linked);
      assert.equal((await users.byWallet(addr(20)))?.id, "u2");
      assert.equal(await users.update({ ...linked, privyUserId: "did:privy:u2" }), false);
      assert.equal(await users.update(user("missing")), false);
    });

    it("sets the owner wallet once and refuses to change or clear it", async () => {
      const { users } = await harness.fresh();
      await users.create(user("u1", { ownerWallet: null, wallets: [] }));
      const owned = user("u1");
      assert.equal(await users.update(owned), true);
      assert.equal(await users.update({ ...owned, ownerWallet: mixed(addr(10)) }), true);
      const second = { address: addr(31), kind: "external" as const, proof: "wallet-signature" as const, linkedAt: 3 };
      assert.equal(await users.update({ ...owned, ownerWallet: addr(31), wallets: [...owned.wallets, second] }), false);
      assert.equal(await users.update({ ...owned, ownerWallet: null }), false);
      assert.equal((await users.get("u1"))?.ownerWallet?.toLowerCase(), addr(10));
    });

    it("lets exactly one of several concurrent sign-ups with one wallet win", async () => {
      const { users } = await harness.fresh();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => users.create(user(`u${i}`, { privyUserId: null }))),
      );
      assert.equal(results.filter(Boolean).length, 1);
    });
  });

  describe(`${name}: ChallengeStore`, () => {
    it("returns a challenge once, then forgets it", async () => {
      const { challenges } = await harness.fresh();
      await challenges.put(challenge("n1"));
      await challenges.put({ ...challenge("n2"), purpose: "sign-in", userId: null });
      assert.deepEqual(await challenges.consume("n1"), challenge("n1"));
      assert.equal(await challenges.consume("n1"), undefined);
      assert.deepEqual(await challenges.consume("n2"), { ...challenge("n2"), purpose: "sign-in", userId: null });
      assert.equal(await challenges.consume("unknown"), undefined);
    });

    it("refuses to issue a nonce twice", async () => {
      const { challenges } = await harness.fresh();
      await challenges.put(challenge("n1"));
      await assert.rejects(challenges.put(challenge("n1")));
    });

    it("hands a challenge to exactly one of several concurrent consumers", async () => {
      const { challenges } = await harness.fresh();
      await challenges.put(challenge("n1"));
      const results = await Promise.all(Array.from({ length: 6 }, () => challenges.consume("n1")));
      assert.equal(results.filter(Boolean).length, 1);
    });
  });

  describe(`${name}: SessionStore`, () => {
    const session = { tokenHash: hash(42), userId: "u1", wallet: addr(10), expiresAt: 1_700_086_400 };

    it("stores, replaces, finds, and deletes a session by token hash", async () => {
      const { sessions } = await harness.fresh();
      await sessions.put(session);
      assert.deepEqual(await sessions.get(session.tokenHash), session);
      await sessions.put({ ...session, expiresAt: 1 });
      assert.deepEqual(await sessions.get(session.tokenHash), { ...session, expiresAt: 1 });
      await sessions.delete(session.tokenHash);
      assert.equal(await sessions.get(session.tokenHash), undefined);
      await sessions.delete(session.tokenHash);
    });

    it("refuses anything that is not a SHA-256 digest, so a plaintext token cannot be stored", async () => {
      const { sessions } = await harness.fresh();
      await assert.rejects(sessions.put({ ...session, tokenHash: "0xplaintext-bearer-token" as Hex }));
      await assert.rejects(sessions.put({ ...session, tokenHash: hash(42).toUpperCase().replace("0X", "0x") as Hex }));
    });
  });

  describe(`${name}: TradeStore`, () => {
    it("claims a tick key once and returns the record exactly", async () => {
      const { trades } = await harness.fresh();
      assert.equal(await trades.claim(trade("t1")), true);
      assert.equal(await trades.claim({ ...trade("t1"), planHash: hash(99) }), false);
      assert.deepEqual(await trades.get("t1"), trade("t1"));
      assert.equal(await trades.get("t2"), undefined);
    });

    it("writes over a record, and writes one that was never claimed", async () => {
      const { trades } = await harness.fresh();
      await trades.claim(trade("t1"));
      const failed: TradeRecord = { ...trade("t1"), status: "failed", failure: { kind: "policy", reason: "rejected", violations: ["per-action-cap"] } };
      await trades.write(failed);
      assert.deepEqual(await trades.get("t1"), failed);
      await trades.write(trade("t2"));
      assert.deepEqual(await trades.get("t2"), trade("t2"));
    });

    it("finds the earliest record by fill transaction hash, case-insensitively", async () => {
      const { trades } = await harness.fresh();
      const tx = `0x${"ab".repeat(32)}` as Hex;
      await trades.claim(trade("t1"));
      await trades.claim(trade("t2"));
      await trades.write(trade("t2", tx));
      await trades.write(trade("t1", tx));
      assert.equal((await trades.findByTransaction(tx.toUpperCase().replace("0X", "0x") as Hex))?.key, "t1");
      assert.deepEqual(await trades.findByTransaction(tx), trade("t1", tx));
      assert.equal(await trades.findByTransaction(hash(1)), undefined);
    });

    it("counts filled trades per agent and in total, and nothing else", async () => {
      const { trades } = await harness.fresh();
      const of = (agentId: string, key: string, tx: Hex | null): TradeRecord => {
        const t = trade(key, tx);
        return { ...t, order: { ...t.order, agentId } };
      };
      await trades.write(of("a", "a:1", hash(11)));
      await trades.write(of("a", "a:2", hash(12)));
      await trades.write(of("a", "a:3", null));
      await trades.write({ ...of("a", "a:4", null), status: "failed", failure: { kind: "policy", reason: "rejected" } });
      await trades.write(of("b", "b:1", hash(13)));
      await trades.write(of("c", "c:1", hash(14)));
      assert.deepEqual(await trades.filledByAgent(["a", "b", "z"]), new Map([["a", 2], ["b", 1], ["z", 0]]));
      assert.deepEqual(await trades.filledByAgent([]), new Map());
      assert.equal(await trades.filledTotal(), 4);
    });

    it("sums each agent's trade costs over every trade that carries them, a reverted one included", async () => {
      const { trades } = await harness.fresh();
      const of = (agentId: string, key: string, tx: Hex | null): TradeRecord => {
        const t = trade(key, tx);
        return { ...t, order: { ...t.order, agentId } };
      };
      await trades.write(of("a", "a:1", hash(21)));
      await trades.write({ ...of("a", "a:2", null), status: "failed", costs: { gasWei: 10n ** 15n, gas: 1_000n, fees: 0n, slippage: 0n }, failure: { kind: "execution", reason: "reverted" } });
      await trades.write(of("a", "a:3", null));
      await trades.write(of("b", "b:1", hash(22)));
      assert.deepEqual(
        await trades.costsByAgent(["a", "z"]),
        new Map([
          ["a", { gasWei: 44n * 10n ** 15n, gas: 44_000n, fees: 1n, slippage: -5n }],
          ["z", { gasWei: 0n, gas: 0n, fees: 0n, slippage: 0n }],
        ]),
      );
      assert.deepEqual(await trades.costsByAgent([]), new Map());
    });

    it("lets exactly one of several concurrent claims for a tick win", async () => {
      const { trades } = await harness.fresh();
      const results = await Promise.all(Array.from({ length: 8 }, () => trades.claim(trade("t1"))));
      assert.equal(results.filter(Boolean).length, 1);
    });
  });

  describe(`${name}: PaymentLog`, () => {
    it("claims a purchase key once, writes over it, and finds it by settlement reference", async () => {
      const { payments } = await harness.fresh();
      assert.equal(await payments.claim(payment("p1")), true);
      assert.equal(await payments.claim(payment("p1")), false);
      assert.deepEqual(await payments.get("p1"), payment("p1"));
      const settled = { ...payment("p1", "ref-1"), anomaly: null, summary: "nansen price=1", influencedDecision: true };
      await payments.write(settled);
      await payments.write(payment("p2", "ref-1"));
      assert.deepEqual(await payments.get("p1"), settled);
      assert.deepEqual(await payments.findBySettlement("ref-1"), settled);
      assert.equal(await payments.findBySettlement("ref-2"), undefined);
      assert.equal(await payments.get("p3"), undefined);
    });

    it("tallies spend per agent and in total from entries with a nonzero price, by provider", async () => {
      const { payments } = await harness.fresh();
      const entry = (key: string, provider: "nansen" | "defillama", price: bigint): PaymentLogEntry => ({ ...payment(key), provider, price, anomaly: null });
      await payments.write(entry("a:1:nansen:/q", "nansen", BIG));
      await payments.write(entry("a:2:defillama:/q", "defillama", 7n));
      await payments.write(entry("a:3:nansen:/q", "nansen", 5n));
      await payments.write(entry("a:4:nansen:/q", "nansen", 0n));
      await payments.write(entry("b:1:nansen:/q", "nansen", 3n));
      await payments.write(entry("ab:1:nansen:/q", "nansen", 100n));
      const byAgent = await payments.spendByAgent(["a", "b", "z"]);
      assert.deepEqual(byAgent.get("a"), {
        purchases: 3, spent: BIG + 12n,
        byProvider: [{ provider: "defillama", spent: 7n }, { provider: "nansen", spent: BIG + 5n }],
      });
      assert.deepEqual(byAgent.get("b"), { purchases: 1, spent: 3n, byProvider: [{ provider: "nansen", spent: 3n }] });
      assert.deepEqual(byAgent.get("z"), { purchases: 0, spent: 0n, byProvider: [] });
      assert.equal(byAgent.size, 3);
      assert.deepEqual(await payments.spendByAgent([]), new Map());
      assert.deepEqual(await payments.spendTotal(), {
        purchases: 5, spent: BIG + 115n,
        byProvider: [{ provider: "defillama", spent: 7n }, { provider: "nansen", spent: BIG + 108n }],
      });
    });

    it("lets exactly one of several concurrent claims for a purchase win", async () => {
      const { payments } = await harness.fresh();
      const results = await Promise.all(Array.from({ length: 8 }, () => payments.claim(payment("p1"))));
      assert.equal(results.filter(Boolean).length, 1);
    });
  });

  describe(`${name}: X402SlotStore`, () => {
    it("claims a slot once, never for a second payment, and finds it by payment and by nonce", async () => {
      const { slots } = await harness.fresh();
      assert.equal(await slots.claim(slotClaim(0, "p1")), true);
      assert.equal(await slots.claim(slotClaim(0, "p2")), false, "the slot is taken");
      assert.equal(await slots.claim(slotClaim(1, "p1")), false, "the payment already holds a slot");
      assert.equal(await slots.claim(slotClaim(2, "p3", { nonce: hash(100) })), false, "the nonce is taken");
      assert.equal(await slots.claim(slotClaim(0, "p4", { epoch: 2n ** 70n + 1n, nonce: hash(400) })), true, "the same slot in another hour");
      assert.deepEqual(await slots.findByPayment("p1"), slotClaim(0, "p1"));
      assert.deepEqual(await slots.findByNonce(mixed(ACCOUNT), hash(100).toUpperCase().replace("0X", "0x") as Hex), slotClaim(0, "p1"));
      assert.equal(await slots.findByPayment("p2"), undefined);
      assert.equal(await slots.findByNonce(addr(77), hash(100)), undefined);
    });

    it("lets exactly one of several concurrent claims for a slot win", async () => {
      const { slots } = await harness.fresh();
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => slots.claim(slotClaim(0, `p${i}`, { nonce: hash(500 + i) }))));
      assert.equal(results.filter(Boolean).length, 1);
    });
  });

  describe(`${name}: TickStore`, () => {
    it("claims a tick once and returns the record exactly", async () => {
      const { ticks } = await harness.fresh();
      assert.equal(await ticks.claim(tickRecord("a", 1)), true);
      assert.equal(await ticks.claim({ ...tickRecord("a", 1), status: "recorded" }), false);
      assert.deepEqual(await ticks.get("a:1"), tickRecord("a", 1));
      assert.equal(await ticks.get("a:2"), undefined);
    });

    it("writes the purchase and the approval before submission, then the final outcome, bigints included", async () => {
      const { ticks } = await harness.fresh();
      await ticks.claim(tickRecord("a", 1));
      const t = trade("a:1");
      const approved: TickRecord = {
        ...tickRecord("a", 1),
        status: "approved",
        purchase: { tickKey: "a:1", provider: "nansen", resource: "/signal?pair=MON", maxPrice: BIG },
        approved: {
          proposal: {
            schemaVersion: 1, tickKey: "a:1", agentId: "a", account: ACCOUNT, genomeHash: hash(12), strategyType: "trading",
            state: { capital: BIG, principal: 10n ** 6n, ticksSinceTrade: 3, observedAt: "2026-10-10T00:00:00Z" },
            information: [],
            action: { kind: "trade", pair: "MON/USDC", side: "long", notional: 1_000_000n, maxSlippageBps: 50 },
          },
          trade: { order: t.order, plan: { tickKey: "a:1", calls: t.calls, planHash: t.planHash } },
          decision: { approved: true, policyVersion: 2, policyHash: hash(13), planHash: t.planHash },
        },
      };
      await ticks.write(approved);
      assert.deepEqual(await ticks.get("a:1"), approved);
      const recorded: TickRecord = { ...approved, status: "recorded", outcome: { kind: "executed", trade: trade("a:1", hash(14)) } };
      await ticks.write(recorded);
      assert.deepEqual(await ticks.get("a:1"), recorded);
      const failed: TickRecord = { ...tickRecord("a", 2), status: "recorded", outcome: { kind: "failed", step: "policy", reason: "rejected", violations: ["per-action-cap"] } };
      await ticks.write(failed);
      assert.deepEqual(await ticks.get("a:2"), failed);
      assert.equal(await ticks.claim(tickRecord("a", 2)), false);
    });

    it("lets exactly one of several concurrent enqueues for a tick win", async () => {
      const { ticks } = await harness.fresh();
      const results = await Promise.all(Array.from({ length: 8 }, () => ticks.claim(tickRecord("a", 1))));
      assert.equal(results.filter(Boolean).length, 1);
    });
  });

  describe(`${name}: AgentStore`, () => {
    it("adds agents once, lists them by ID, and lowercases the owner", async () => {
      const { agents } = await harness.fresh();
      await agents.add(agentRecord("b"));
      await agents.add(agentRecord("a"));
      await assert.rejects(agents.add(agentRecord("a")), /exists/);
      assert.deepEqual((await agents.list()).map((a) => a.agentId), ["a", "b"]);
      const stored = await agents.get("a");
      assert.deepEqual(stored, { ...agentRecord("a"), owner: addr(30) });
      assert.equal(await agents.get("missing"), undefined);
    });

    it("updates an existing agent and refuses an unknown one", async () => {
      const { agents } = await harness.fresh();
      await agents.add(agentRecord("a"));
      await agents.update({ ...agentRecord("a"), status: "retired" });
      assert.equal((await agents.get("a"))?.status, "retired");
      await assert.rejects(agents.update(agentRecord("missing")), /no agent/);
    });

    it("returns the initial state until one is saved, then the saved state exactly", async () => {
      const { agents } = await harness.fresh();
      await agents.add(agentRecord("a"));
      const initial = await agents.state("a");
      assert.deepEqual(initial, { ticksSinceTrade: 4, informationByDay: {}, returns: [], tradeCounts: [], measured: [], net: 0, lowFitnessWindows: 0 });
      assert.equal((await agents.state("missing")).ticksSinceTrade, 1);
      const saved: AgentState = {
        ticksSinceTrade: 0, informationByDay: { "2026-10-10": BIG }, returns: [0.0125, -0.5e-7], tradeCounts: [1, 0],
        measured: ["a:1", "a:2"], net: -1.25, lowFitnessWindows: 2,
      };
      await agents.saveState("a", saved);
      assert.deepEqual(await agents.state("a"), saved);
      await agents.saveState("a", { ...saved, lowFitnessWindows: 3 });
      assert.equal((await agents.state("a")).lowFitnessWindows, 3);
      await assert.rejects(agents.saveState("missing", saved), /no agent/);
    });
  });

  describe(`${name}: DebitStore`, () => {
    it("claims a key once, then replaces the record on write", async () => {
      const { debits } = await harness.fresh();
      assert.equal(await debits.claim(debitRecord("o:1:a")), true);
      assert.equal(await debits.claim(debitRecord("o:1:a", "rejected")), false);
      assert.deepEqual(await debits.get("o:1:a"), debitRecord("o:1:a"));
      await debits.write({ ...debitRecord("o:1:a"), status: "settled" });
      assert.equal((await debits.get("o:1:a"))?.status, "settled");
      await debits.write(debitRecord("o:1:b", "rejected"));
      assert.deepEqual(await debits.get("o:1:b"), debitRecord("o:1:b", "rejected"));
      assert.equal(await debits.get("missing"), undefined);
    });

    it("lets exactly one of several concurrent claims for a key win", async () => {
      const { debits } = await harness.fresh();
      const results = await Promise.all(Array.from({ length: 8 }, () => debits.claim(debitRecord("o:1:a"))));
      assert.equal(results.filter(Boolean).length, 1);
    });
  });

  describe(`${name}: PositionStore`, () => {
    const position = (agentId: string, overrides: Partial<Position> = {}): Position => ({
      agentId, pair: "WETH/USDC", size: BIG, basis: 2_500_000_000n, realized: -12_345n, closing: null,
      applied: { [`${agentId}:1`]: 0n, [`${agentId}:2`]: -12_345n }, ...overrides,
    });

    it("returns nothing for an agent that never traded, and a written position exactly", async () => {
      const { positions } = await harness.fresh();
      assert.equal(await positions.get("a"), undefined);
      await positions.write(position("a"));
      assert.deepEqual(await positions.get("a"), position("a"));
      assert.equal(await positions.get("b"), undefined);
    });

    it("reads each agent's realized P&L, 0 without a position", async () => {
      const { positions } = await harness.fresh();
      await positions.write(position("a", { realized: -12_000n }));
      assert.deepEqual(await positions.realizedByAgent(["a", "b"]), new Map([["a", -12_000n], ["b", 0n]]));
      assert.deepEqual(await positions.realizedByAgent([]), new Map());
    });

    it("replaces a position whole on write, the close mark and the settled keys included", async () => {
      const { positions } = await harness.fresh();
      await positions.write(position("a", { closing: "a:3" }));
      const closed = position("a", { size: 0n, basis: 0n, realized: 99_000n, closing: null, applied: { "a:3": 99_000n } });
      await positions.write(closed);
      assert.deepEqual(await positions.get("a"), closed);
    });

    it("returns a copy: changing what it returned changes nothing stored", async () => {
      const { positions } = await harness.fresh();
      await positions.write(position("a"));
      const read = (await positions.get("a"))!;
      read.size = 0n;
      read.applied["a:9"] = 1n;
      assert.deepEqual(await positions.get("a"), position("a"));
    });
  });
  describe(`${name}: EvaluationStore`, () => {
    it("records every field exactly, nulls and bigints included, and returns nothing before any evaluation", async () => {
      const { evaluations } = await harness.fresh();
      assert.deepEqual(await evaluations.latest(), []);
      assert.deepEqual(await evaluations.history("a", 50), []);
      const unranked = evaluationRecord("b", 1, { adjustedFitness: null, fitnessPercentile: null, rawSortino: null, zeroDownsideFlag: true, tradeCount: 0 });
      const retired = evaluationRecord("a", 1, { capital: 0n, lowWindows: 3, retired: true, retirementRule: "starvation", reallocation: { kind: "retired", reason: null, amount: null, rank: null } });
      await evaluations.record([retired, unranked]);
      assert.deepEqual(await evaluations.history("a", 50), [retired]);
      assert.deepEqual(await evaluations.latest(), [retired, unranked]);
      await evaluations.record([]);
    });

    it("records the reallocation outcome with its reason, amount, and rank", async () => {
      const { evaluations } = await harness.fresh();
      const sent = evaluationRecord("a", 2, { reallocation: { kind: "sent", reason: null, amount: 2_000_000n, rank: { position: 1, of: 3, quota: 1 } } });
      const held = evaluationRecord("b", 2, { reallocation: { kind: "held", reason: "ceiling", amount: null, rank: { position: 3, of: 3, quota: 1 } } });
      const off = evaluationRecord("c", 2, { reallocation: { kind: "off", reason: "not-covered", amount: null, rank: null } });
      await evaluations.record([sent, held, off]);
      assert.deepEqual(await evaluations.latest(), [sent, held, off]);
    });

    it("keeps the first record of an (agent, sequence) when an evaluation is recorded again", async () => {
      const { evaluations } = await harness.fresh();
      await evaluations.record([evaluationRecord("a", 1)]);
      await evaluations.record([evaluationRecord("a", 1, { lowWindows: 2, capital: 5n }), evaluationRecord("b", 1)]);
      assert.deepEqual(await evaluations.history("a", 50), [evaluationRecord("a", 1)]);
      assert.deepEqual((await evaluations.latest()).map((r) => r.agentId), ["a", "b"]);
    });

    it("returns the most recent records oldest first, bounded, and only the highest sequence as latest", async () => {
      const { evaluations } = await harness.fresh();
      for (const sequence of [3, 1, 2, 4]) await evaluations.record([evaluationRecord("a", sequence)]);
      await evaluations.record([evaluationRecord("b", 2)]);
      assert.deepEqual((await evaluations.history("a", 3)).map((r) => r.sequence), [2, 3, 4]);
      assert.deepEqual((await evaluations.history("a", 50)).map((r) => r.sequence), [1, 2, 3, 4]);
      assert.deepEqual(await evaluations.history("a", 0), []);
      assert.deepEqual(await evaluations.latest(), [evaluationRecord("a", 4)]);
    });

    it("returns copies: changing what it returned changes nothing stored", async () => {
      const { evaluations } = await harness.fresh();
      await evaluations.record([evaluationRecord("a", 1)]);
      const [read] = await evaluations.history("a", 1);
      read!.capital = 0n;
      assert.deepEqual(await evaluations.history("a", 1), [evaluationRecord("a", 1)]);
    });
  });
}
