// Shared conformance suite. Every store implementation, in-memory and Postgres, runs exactly these tests, so the
// Postgres stores are held to the semantics the modules were written against.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, AgentRegistry, AgentState, DebitRecord, DebitStore } from "@monadeum/agent-registry";
import type { ChallengeStore, SessionStore, UserRecord, UserStore, WalletChallenge } from "@monadeum/auth";
import type { TickRecord, TickStore } from "@monadeum/tick";
import type { BlockHash, ChainEvent, ReadModelStore, SyncBatch } from "@monadeum/read-model";
import type { TradeRecord, TradeStore } from "@monadeum/trading";
import type { AgentWalletRecord, AgentWalletStore, SponsorshipLedger, TickOperationRecord } from "@monadeum/wallets";
import type { PaymentLog, PaymentLogEntry } from "@monadeum/x402";
import type { Address, Hex } from "viem";

export interface Stores {
  wallets: AgentWalletStore;
  ledger: SponsorshipLedger;
  users: UserStore;
  challenges: ChallengeStore;
  sessions: SessionStore;
  trades: TradeStore;
  payments: PaymentLog;
  ticks: TickStore;
  readModel: ReadModelStore;
  agents: AgentRegistry;
  debits: DebitStore;
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

    it("lets exactly one of several concurrent claims for a purchase win", async () => {
      const { payments } = await harness.fresh();
      const results = await Promise.all(Array.from({ length: 8 }, () => payments.claim(payment("p1"))));
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
}
