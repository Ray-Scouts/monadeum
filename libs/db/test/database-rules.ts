// Rules the database enforces on its own, independent of the store code: constraints, transactions, the append-only
// policy table, and the role grants. Run against PGlite and, when DATABASE_URL is set, a real server.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashRiskPolicy } from "@monadeum/commitment";
import { loadPolicy, type PolicyDocument } from "@monadeum/risk";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  PgAgentStore,
  PgAgentWalletStore,
  PgDebitStore,
  PgPaymentLog,
  PgPolicyVersions,
  PgReadModelStore,
  PgSponsorshipLedger,
  PgTickStore,
  PgTradeStore,
  isUniqueViolation,
  verifyMigrations,
  type Database,
  type Transaction,
} from "../src/index.js";
import { agentRecord, batch, chainEvent, debitRecord, operation, payment, tickRecord, trade, wallet } from "./conformance.js";
import { postgresHarness } from "./harness.js";

const DENIED = (error: unknown) => (error as { code?: string }).code === "42501";

class Rollback extends Error {}

/** Runs one statement as `role` in a transaction that is always rolled back, so nothing it does persists. */
async function as(db: Database, role: string, sql: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE ${role}`);
      await tx.query(sql);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/**
 * The same database, with every statement and transaction run as `role` through SET LOCAL ROLE, so the stores can be
 * exercised under a process role's grants. Unlike `as`, writes commit.
 */
function asRole(db: Database, role: string): Database {
  const enter = async (tx: Transaction) => {
    await tx.query(`SET LOCAL ROLE ${role}`);
  };
  return {
    query<R>(text: string, params?: readonly unknown[]) {
      return db.transaction(async (tx) => {
        await enter(tx);
        return tx.query<R>(text, params);
      });
    },
    transaction(fn) {
      return db.transaction(async (tx) => {
        await enter(tx);
        return fn(tx);
      });
    },
  };
}

function policy(version: number, previousHash: Hex | null): PolicyDocument {
  return {
    schemaVersion: 1, version, previousHash, effectiveFrom: `2026-09-0${version}T00:00:00Z`,
    settlementAsset: "0x00000000000000000000000000000000000000c0",
    allowedCalls: [{ target: "0x00000000000000000000000000000000000000c0", selector: "0x095ea7b3", label: "settlement-asset" }],
    allowedPairs: ["MON/USDC"], perActionCap: 2n ** 70n, sessionDailyCap: 20_000_000n, perTickInformationCap: 100_000n,
    dailyInformationCap: 1_000_000n, maxPositionFraction: 0.25,
  };
}

export function databaseRules(name: string, db: Database): void {
  const raw = (sql: string, params: unknown[] = []) => db.query(sql, params);
  const reset = () => postgresHarness(db).fresh();

  describe(`${name}: constraints hold without the store code`, () => {
    const wallet = (address: string, userId: string) =>
      raw("INSERT INTO auth_user_wallets (address_key, user_id, position, address, kind, proof, linked_at) VALUES ($1, $2, 0, $3, 'external', 'wallet-signature', 1)", [address.toLowerCase(), userId, address]);

    it("a wallet address belongs to at most one user", async () => {
      await reset();
      await raw("INSERT INTO auth_users (id, privy_user_id, owner_wallet, created_at) VALUES ('u1', NULL, NULL, 1), ('u2', NULL, NULL, 1)");
      await wallet("0x00000000000000000000000000000000000000aa", "u1");
      await assert.rejects(wallet("0x00000000000000000000000000000000000000AA", "u2"), isUniqueViolation);
    });

    it("a Privy identity belongs to at most one user", async () => {
      await reset();
      await raw("INSERT INTO auth_users (id, privy_user_id, owner_wallet, created_at) VALUES ('u1', 'did:privy:x', NULL, 1)");
      await assert.rejects(raw("INSERT INTO auth_users (id, privy_user_id, owner_wallet, created_at) VALUES ('u2', 'did:privy:x', NULL, 1)"), isUniqueViolation);
    });

    it("a session row holds only a SHA-256 digest", async () => {
      await reset();
      await assert.rejects(raw("INSERT INTO auth_sessions (token_hash, user_id, wallet, expires_at) VALUES ('plaintext-token', 'u1', '0x', 1)"), /check constraint/);
    });

    it("an account address belongs to at most one agent, and a tick key is claimed once", async () => {
      await reset();
      await raw("INSERT INTO wallet_accounts (agent_id, account_key, body) VALUES ('a', '0x00000000000000000000000000000000000000ab', '{}')");
      await assert.rejects(raw("INSERT INTO wallet_accounts (agent_id, account_key, body) VALUES ('b', '0x00000000000000000000000000000000000000ab', '{}')"), isUniqueViolation);
      await assert.rejects(raw("INSERT INTO wallet_accounts (agent_id, account_key, body) VALUES ('c', '0x00000000000000000000000000000000000000AB', '{}')"), /check constraint/);
      await raw("INSERT INTO wallet_tick_operations (agent_id, tick_key, body) VALUES ('a', 'a:1', '{}')");
      await assert.rejects(raw("INSERT INTO wallet_tick_operations (agent_id, tick_key, body) VALUES ('a', 'a:1', '{}')"), isUniqueViolation);
    });

    it("an indexer batch that fails part way stores nothing, not even its cursor", async () => {
      await reset();
      const store = new PgReadModelStore(db);
      const duplicate = chainEvent(5, 0, "spend.spent");
      await assert.rejects(store.apply(batch(10, [chainEvent(4, 0, "spend.spent"), duplicate, duplicate], { discovered: [{ account: duplicate.account!, firstBlock: 4n }] })));
      assert.equal(await store.cursor(), null);
      assert.deepEqual(await store.events(), []);
      assert.deepEqual(await store.blockHashes(), []);
      assert.deepEqual(await store.trackedAccounts(), []);
    });
  });

  describe(`${name}: append-only policy documents`, () => {
    it("stores signed versions that loadPolicy verifies, and refuses to change or remove them", async () => {
      const operator = privateKeyToAccount(generatePrivateKey());
      const versions = new PgPolicyVersions(db);
      const v1 = policy(1, null);
      const v2 = policy(2, hashRiskPolicy(v1));
      for (const document of [v1, v2]) {
        await versions.append({ document, signer: operator.address, signature: await operator.signMessage({ message: { raw: hashRiskPolicy(document) } }) });
      }
      await assert.rejects(versions.append({ document: v2, signer: operator.address, signature: "0x00" }), /already stored/);

      const rows = await versions.list();
      assert.deepEqual(rows.map((r) => r.document), [v1, v2]);
      const verified = await loadPolicy(rows, operator.address, new Date("2026-10-01T00:00:00Z"));
      assert.equal(verified?.hash, hashRiskPolicy(v2));

      await assert.rejects(raw("UPDATE risk_policy_versions SET signature = '0x00'"), /append-only/);
      await assert.rejects(raw("DELETE FROM risk_policy_versions"), /append-only/);
      await assert.rejects(raw("TRUNCATE risk_policy_versions"), /append-only/);
      assert.equal((await versions.list()).length, 2);
    });
  });

  describe(`${name}: role grants`, () => {
    const policyRow = `INSERT INTO risk_policy_versions (version, document, policy_hash, signer, signature)
      VALUES (99, '{"version": 99}', '0x${"ab".repeat(32)}', '0x${"00".repeat(20)}', '0x00')`;
    const eventRow = `INSERT INTO chain_events (block_number, block_hash, log_index, kind, account, address, tx_hash, data)
      VALUES (1, '0x${"00".repeat(32)}', 0, 'spend.spent', NULL, '0x${"00".repeat(20)}', '0x${"00".repeat(32)}', '{}')`;

    it("only the indexer role writes the read-model; readers only read", async () => {
      await as(db, "monadeum_indexer", eventRow);
      await as(db, "monadeum_indexer", "DELETE FROM chain_events");
      await as(db, "monadeum_reader", "SELECT * FROM chain_events");
      await as(db, "monadeum_reader", "SELECT * FROM agent_spend_limits");
      await assert.rejects(as(db, "monadeum_reader", eventRow), DENIED);
      await assert.rejects(as(db, "monadeum_reader", "DELETE FROM chain_events"), DENIED);
      await assert.rejects(as(db, "monadeum_worker", eventRow), DENIED);
      await assert.rejects(as(db, "monadeum_policy_operator", "UPDATE indexer_cursor SET block_hash = block_hash"), DENIED);
    });

    it("the worker reads the read-model for principal and writes none of it; readers see funding transfers", async () => {
      await reset();
      await new PgReadModelStore(asRole(db, "monadeum_indexer")).apply(batch(10, [chainEvent(8, 0, "settlement.transfer-in")], { finalized: true }));
      const worker = new PgReadModelStore(asRole(db, "monadeum_worker"));
      assert.equal(await worker.finalizedThrough(), 10n);
      assert.equal((await worker.events({ kind: "settlement.transfer-in" })).length, 1);
      await assert.rejects(worker.apply(batch(20, [], { finalized: true })), DENIED);
      await assert.rejects(worker.rollback({ number: 1n, hash: `0x${"00".repeat(32)}` }), DENIED);
      for (const sql of ["DELETE FROM chain_events", "UPDATE indexer_cursor SET finalized = true", "DELETE FROM indexer_blocks", "SELECT * FROM indexer_blocks"]) {
        await assert.rejects(as(db, "monadeum_worker", sql), DENIED, sql);
      }
      await as(db, "monadeum_reader", "SELECT * FROM agent_settlement_transfers");
      // 0010: the indexer records the settlement asset once; the worker and readers only read it; nobody changes it.
      const asset = `0x${"ab".repeat(20)}` as Hex;
      await new PgReadModelStore(asRole(db, "monadeum_indexer")).recordSettlementAsset(asset);
      assert.equal(await worker.settlementAsset(), asset);
      await as(db, "monadeum_reader", "SELECT * FROM indexer_settings");
      for (const role of ["monadeum_indexer", "monadeum_worker", "monadeum_reader"]) {
        await assert.rejects(as(db, role, `UPDATE indexer_settings SET settlement_asset = '0x${"cd".repeat(20)}'`), DENIED, role);
        await assert.rejects(as(db, role, "DELETE FROM indexer_settings"), DENIED, role);
      }
      await assert.rejects(as(db, "monadeum_worker", `INSERT INTO indexer_settings (id, settlement_asset) VALUES (1, '${asset}')`), DENIED);
      await assert.rejects(as(db, "monadeum_indexer", "SELECT * FROM worker_agents"), DENIED);
    });

    it("the worker role runs every worker store, and nothing else writes them", async () => {
      await reset();
      const worker = asRole(db, "monadeum_worker");
      const wallets = new PgAgentWalletStore(worker);
      assert.equal(await wallets.claim(wallet("a")), true);
      await wallets.update(wallet("a"));
      assert.equal((await wallets.findByAccount(wallet("a").account))?.agentId, "a");
      assert.equal(await wallets.claimOperation(operation("a", "a:1")), true);
      await wallets.updateOperation(operation("a", "a:1"));
      assert.equal((await wallets.listOperations("a")).length, 1);
      const ledger = new PgSponsorshipLedger(worker);
      const budget = { operations: 5, gasWei: 1_000n };
      assert.equal(await ledger.reserve("a", 100n, budget), true);
      await ledger.settle("a", 100n, 40n);
      assert.equal(await ledger.reserve("a", 100n, budget), true);
      await ledger.release("a", 100n);
      const trades = new PgTradeStore(worker);
      const filled = `0x${"cd".repeat(32)}` as Hex;
      assert.equal(await trades.claim(trade("a:1")), true);
      await trades.write(trade("a:1", filled));
      assert.equal((await trades.findByTransaction(filled))?.key, "a:1");
      const payments = new PgPaymentLog(worker);
      assert.equal(await payments.claim(payment("a:1")), true);
      await payments.write(payment("a:1", "ref-1"));
      assert.equal((await payments.findBySettlement("ref-1"))?.key, "a:1");
      const ticks = new PgTickStore(worker);
      assert.equal(await ticks.claim(tickRecord("a", 1)), true);
      await ticks.write({ ...tickRecord("a", 1), status: "recorded" });
      assert.equal((await ticks.get("a:1"))?.status, "recorded");
      await new PgPolicyVersions(worker).list();

      const reader = asRole(db, "monadeum_reader");
      assert.equal((await new PgTradeStore(reader).get("a:1"))?.key, "a:1");
      assert.equal((await new PgTickStore(reader).get("a:1"))?.status, "recorded");
      await assert.rejects(new PgTradeStore(reader).claim(trade("a:2")), DENIED);
      await assert.rejects(new PgTickStore(reader).write(tickRecord("a", 2)), DENIED);
      await assert.rejects(new PgAgentWalletStore(asRole(db, "monadeum_indexer")).claim(wallet("b", `0x${"ef".repeat(20)}` as Hex)), DENIED);
      await assert.rejects(new PgPaymentLog(asRole(db, "monadeum_policy_operator")).get("a:1"), DENIED);
    });

    it("the worker role reads and retires agents, saves state, and records debits, but never creates an agent", async () => {
      await reset();
      await new PgAgentStore(db).add(agentRecord("a"));
      const worker = asRole(db, "monadeum_worker");
      const agents = new PgAgentStore(worker);
      assert.equal((await agents.list()).length, 1);
      await agents.saveState("a", { ...(await agents.state("a")), lowFitnessWindows: 1 });
      await agents.saveState("a", { ...(await agents.state("a")), lowFitnessWindows: 2 });
      await agents.update({ ...agentRecord("a"), status: "retired" });
      assert.equal((await agents.get("a"))?.status, "retired");
      await assert.rejects(agents.add(agentRecord("b")), DENIED);
      const debits = new PgDebitStore(worker);
      assert.equal(await debits.claim(debitRecord("o:1:a")), true);
      await debits.write({ ...debitRecord("o:1:a"), status: "settled" });

      const reader = asRole(db, "monadeum_reader");
      assert.equal((await new PgAgentStore(reader).state("a")).lowFitnessWindows, 2);
      assert.equal((await new PgDebitStore(reader).get("o:1:a"))?.status, "settled");
      await assert.rejects(new PgDebitStore(reader).claim(debitRecord("o:1:b")), DENIED);
      await assert.rejects(new PgAgentStore(reader).saveState("a", await agents.state("a")), DENIED);
      await assert.rejects(new PgAgentStore(asRole(db, "monadeum_indexer")).list(), DENIED);
      for (const table of ["worker_agents", "worker_agent_states", "reallocation_debits"]) {
        await assert.rejects(as(db, "monadeum_worker", `DELETE FROM ${table}`), DENIED, table);
      }
    });

    it("no role deletes worker records, and no process role touches the auth tables", async () => {
      for (const table of ["wallet_accounts", "wallet_tick_operations", "wallet_sponsorship", "trade_records", "x402_payments", "tick_records"]) {
        await assert.rejects(as(db, "monadeum_worker", `DELETE FROM ${table}`), DENIED, table);
        await assert.rejects(as(db, "monadeum_worker", `TRUNCATE ${table}`), DENIED, table);
        const column = table === "wallet_sponsorship" ? "operations" : "body";
        await assert.rejects(as(db, "monadeum_reader", `UPDATE ${table} SET ${column} = ${column}`), DENIED, table);
      }
      for (const role of ["monadeum_worker", "monadeum_reader", "monadeum_indexer", "monadeum_policy_operator"]) {
        for (const table of ["auth_users", "auth_user_wallets", "auth_challenges", "auth_sessions"]) {
          await assert.rejects(as(db, role, `SELECT * FROM ${table}`), DENIED, `${role} on ${table}`);
        }
      }
    });

    it("every process role can verify the migrations, and none can change the ledger", async () => {
      for (const role of ["monadeum_worker", "monadeum_reader", "monadeum_indexer"]) {
        await verifyMigrations(asRole(db, role));
        await assert.rejects(as(db, role, "DELETE FROM store_schema_migrations"), DENIED, role);
      }
    });

    it("only the operator role appends policy versions, the worker only reads them, and nobody changes them", async () => {
      await as(db, "monadeum_policy_operator", policyRow);
      await as(db, "monadeum_worker", "SELECT * FROM risk_policy_versions");
      await assert.rejects(as(db, "monadeum_worker", policyRow), DENIED);
      await assert.rejects(as(db, "monadeum_indexer", policyRow), DENIED);
      await assert.rejects(as(db, "monadeum_reader", "SELECT * FROM risk_policy_versions"), DENIED);
      await assert.rejects(as(db, "monadeum_policy_operator", "UPDATE risk_policy_versions SET signature = '0x00'"), DENIED);
      await assert.rejects(as(db, "monadeum_policy_operator", "DELETE FROM risk_policy_versions"), DENIED);
    });
  });
}
