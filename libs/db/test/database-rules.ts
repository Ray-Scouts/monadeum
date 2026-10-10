// Rules the database enforces on its own, independent of the store code: constraints, transactions, the append-only
// policy table, and the role grants. Run against PGlite and, when DATABASE_URL is set, a real server.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashRiskPolicy } from "@monadeum/commitment";
import { loadPolicy, type PolicyDocument } from "@monadeum/risk";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PgPolicyVersions, PgReadModelStore, isUniqueViolation, type Database } from "../src/index.js";
import { batch, chainEvent } from "./conformance.js";
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
