import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { hashRiskPolicy } from "@monadeum/commitment";
import { pgliteDatabase, type Connect } from "@monadeum/db";
import { loadPolicy } from "@monadeum/risk";
import { loadWalletsConfig } from "@monadeum/wallets";
import { ethers } from "ethers";
import { recoverMessageAddress, toFunctionSelector, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadWorkerTrading } from "../src/config.js";
import {
  MemoryPolicyVersions,
  PolicyError,
  appendVersion,
  buildPolicyDocument,
  coverageProblems,
  latestVersion,
  policyFromJson,
  policyTarget,
  policyToJson,
  signWithKeystore,
} from "../src/policy.js";
import { runPolicyCli } from "../src/policy-main.js";

// The policy operator's tools (ARCHITECTURE.md section 16.1): build the deployment's document from the same WALLETS_*
// and TRADING_* configuration the worker trades under, sign it, verify it extends the stored chain, append it.

const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
const ROUTER = "0x7EFbE105Ca7415dE98F96622173458ac1c054630";
const MARKET = "0x46b66f84317941eC371E7791753f35653341aeBC";

/** The testnet deployment's configuration, as deploy/.env.testnet.example and the compose file give it. */
const ENV = {
  WALLETS_CHAIN_ID: "10143",
  WALLETS_BUNDLER_URL: "https://bundler.example",
  WALLETS_SPEND_POLICY_ADDRESS: "0xe54512401B8fCD0DCc3f4Aa4929b99F05AbA3f05",
  WALLETS_SETTLEMENT_ASSET: USDC,
  WALLETS_KURU_ROUTER: ROUTER,
  WALLETS_KURU_ROUTER_SELECTORS: "0xffa5210a",
  WALLETS_REALLOCATION_CONTRACT: "0x4e7500415e81017670a9cFb8763f873EE6694A7f",
  WALLETS_REALLOCATION_SELECTORS: "0x4c329bba",
  WALLETS_TRADED_ASSETS: WMON,
  WALLETS_SPONSORED_OPERATIONS: "20",
  WALLETS_SPONSORED_GAS_WEI: "500000000000000000",
  TRADING_PAIR: "WMON/USDC",
  TRADING_KURU_ROUTER: ROUTER,
  TRADING_KURU_MARKET: MARKET,
  TRADING_BASE: WMON,
  TRADING_QUOTE: USDC,
  TRADING_SIZE_PRECISION: "10000000000",
  TRADING_MON_PRICE_MARKET: MARKET,
  TRADING_MON_PRICE_BASE: WMON,
  TRADING_WRAPPED_NATIVE: WMON,
  WORKER_SETTLEMENT_ASSET_ADDRESS: USDC,
};

const deployment = () => policyTarget(loadWalletsConfig(ENV), loadWorkerTrading(ENV)!);
const operator = privateKeyToAccount(generatePrivateKey());
const sign = async (document: Parameters<typeof hashRiskPolicy>[0], by = operator) => by.signMessage({ message: { raw: hashRiskPolicy(document) } });
const NOW = "2026-10-12T00:00:00.000Z";

test("the testnet document allows exactly WalletsModule's scope, the market's pair, and approve on WMON, with no information spend", () => {
  const { scope, target } = deployment();
  const document = buildPolicyDocument({ scope, target, perActionCap: 1_000_000n, sessionDailyCap: 5_000_000n, effectiveFrom: NOW, previous: null });
  assert.deepEqual([document.version, document.previousHash, document.settlementAsset], [1, null, USDC]);
  assert.deepEqual(document.allowedPairs, ["WMON/USDC"]);
  const calls = document.allowedCalls.map((c) => `${c.label}:${c.target}:${c.selector}`).sort();
  assert.deepEqual(calls, [
    `kuru-router:${ROUTER}:0xffa5210a`,
    "reallocation:0x4e7500415e81017670a9cFb8763f873EE6694A7f:0x4c329bba",
    `settlement-asset:${USDC}:${toFunctionSelector("approve(address,uint256)")}`,
    `settlement-asset:${USDC}:${toFunctionSelector("transfer(address,uint256)")}`,
    `traded-asset:${WMON}:${toFunctionSelector("approve(address,uint256)")}`,
  ].sort());
  assert.deepEqual([document.perTickInformationCap, document.dailyInformationCap, document.maxPositionFraction], [0n, 0n, 0.25]);
  assert.deepEqual(coverageProblems(document, target), []);

  // Exact JSON round trip: the hash the operator signs is the hash the worker verifies.
  const back = policyFromJson(policyToJson(document));
  assert.equal(hashRiskPolicy(back), hashRiskPolicy(document));
  assert.throws(() => policyFromJson({ ...JSON.parse(policyToJson(document)), extra: 1 }), PolicyError);
  assert.throws(() => policyFromJson({ ...JSON.parse(policyToJson(document)), perActionCap: 1e6 }), PolicyError);

  assert.throws(() => buildPolicyDocument({ scope, target, perActionCap: 0n, sessionDailyCap: 1n, effectiveFrom: NOW, previous: null }), PolicyError);
  assert.throws(() => buildPolicyDocument({ scope, target, perActionCap: 2n, sessionDailyCap: 1n, effectiveFrom: NOW, previous: null }), PolicyError);
  // A scope without approve on the traded base cannot cover a close.
  assert.throws(() => buildPolicyDocument({ scope: scope.filter((c) => c.label !== "traded-asset"), target, perActionCap: 1n, sessionDailyCap: 1n, effectiveFrom: NOW, previous: null }), /traded base/);
});

test("a configuration whose wallets and market disagree is refused before any document is built", () => {
  const wallets = loadWalletsConfig(ENV);
  assert.throws(() => policyTarget(loadWalletsConfig({ ...ENV, WALLETS_TRADED_ASSETS: "" }), loadWorkerTrading(ENV)!), /WALLETS_TRADED_ASSETS/);
  assert.throws(() => policyTarget(wallets, loadWorkerTrading({ ...ENV, TRADING_KURU_ROUTER: "0x0000000000000000000000000000000000000001" })!), /ROUTER/);
});

test("appending verifies the pinned signer and the chain: version, previousHash, and effectiveFrom order", async () => {
  const { scope, target } = deployment();
  const store = new MemoryPolicyVersions();
  const v1 = buildPolicyDocument({ scope, target, perActionCap: 1_000_000n, sessionDailyCap: 5_000_000n, effectiveFrom: NOW, previous: null });
  const stranger = privateKeyToAccount(generatePrivateKey());
  await assert.rejects(appendVersion(store, v1, await sign(v1, stranger), operator.address), /not by the pinned operator/);
  const verified = await appendVersion(store, v1, await sign(v1), operator.address);
  assert.equal(verified.document.version, 1);
  await assert.rejects(appendVersion(store, v1, await sign(v1), operator.address), /next version is 2/);

  const previous = await latestVersion(await store.list(), operator.address);
  const v2 = buildPolicyDocument({ scope, target, perActionCap: 500_000n, sessionDailyCap: 2_000_000n, effectiveFrom: "2026-10-13T00:00:00Z", previous });
  assert.equal(v2.previousHash, hashRiskPolicy(v1));
  await assert.rejects(appendVersion(store, { ...v2, previousHash: `0x${"00".repeat(32)}` }, await sign({ ...v2, previousHash: `0x${"00".repeat(32)}` }), operator.address), /previousHash/);
  assert.throws(() => buildPolicyDocument({ scope, target, perActionCap: 1n, sessionDailyCap: 1n, effectiveFrom: "2026-10-01T00:00:00Z", previous }), /earlier/);
  await appendVersion(store, v2, await sign(v2), operator.address);

  // The worker's view: version 1 before v2 takes effect, version 2 after.
  assert.equal((await loadPolicy(await store.list(), operator.address, new Date("2026-10-12T12:00:00Z")))?.document.version, 1);
  assert.equal((await loadPolicy(await store.list(), operator.address, new Date("2026-10-13T12:00:00Z")))?.document.version, 2);
});

test("signing with an encrypted JSON keystore gives the signature loadPolicy verifies, and a wrong password signs nothing", async () => {
  const { scope, target } = deployment();
  const document = buildPolicyDocument({ scope, target, perActionCap: 1_000_000n, sessionDailyCap: 5_000_000n, effectiveFrom: NOW, previous: null });
  const wallet = ethers.Wallet.createRandom();
  const keystore = await wallet.encrypt("operator passphrase", { scrypt: { N: 1024 } });
  const { signer, signature } = await signWithKeystore(document, keystore, "operator passphrase");
  assert.equal(signer, wallet.address);
  assert.equal((await loadPolicy([{ document, signature }], signer, new Date("2026-10-12T01:00:00Z")))?.document.version, 1);
  await assert.rejects(signWithKeystore(document, keystore, "wrong"), /could not be decrypted/);
});

test("cast wallet sign <hash> (Foundry 1.8.5) signs the 32 raw bytes under EIP-191, as loadPolicy verifies", async () => {
  // Recorded on 2026-10-12 from a throwaway keystore made with `cast wallet new`, signing 0x11..11 with
  // `cast wallet sign --keystore <file> 0x11..11`. Only the address and the signature are kept here, never the key.
  const hash = `0x${"11".repeat(32)}` as Hex;
  const signature = "0xec41ff06afcbd23b854e3bab5e5b82c120762a9ef150c6b68d130711360632126fdb3bf9e52fe739102eefc358b48d766fb7cc851bc8ff97255950c651d0d6771b";
  assert.equal(await recoverMessageAddress({ message: { raw: hash }, signature }), "0x39bbb6191953E222897E6b73b7c7226B7908a509");
});

test("the CLI builds, signs, appends, and shows versions over Postgres, and refuses a version the worker would not verify", async () => {
  const pg = new PGlite();
  const connect: Connect = () => ({ db: pgliteDatabase(pg), close: async () => {} });
  const files = new Map<string, string>();
  const logs: string[] = [];
  const wallet = ethers.Wallet.createRandom();
  files.set("/keystore", await wallet.encrypt("pw", { scrypt: { N: 1024 } }));
  files.set("/password", "pw\n");
  const io = {
    log: (m: string) => logs.push(m),
    readFile: async (p: string) => files.get(p) ?? assert.fail(`no file ${p}`),
    writeFile: async (p: string, c: string) => void files.set(p, c),
    connect,
    now: () => new Date(NOW),
  };
  const env = { ...ENV, DATABASE_URL: "postgres://operator@db/monadeum", DATABASE_MIGRATIONS: "apply", WORKER_POLICY_SIGNER: wallet.address };
  try {
    await runPolicyCli(["build", "--per-action-cap", "1000000", "--session-daily-cap", "5000000", "--out", "/v1.json"], env, io);
    const hash = hashRiskPolicy(policyFromJson(files.get("/v1.json")!));
    assert.ok(logs.some((l) => l.includes(`hash to sign (EIP-191 over these 32 bytes): ${hash}`)));
    await runPolicyCli(["sign", "--document", "/v1.json", "--keystore", "/keystore", "--password-file", "/password", "--out", "/v1.signed.json"], env, io);
    assert.ok(!logs.join("\n").includes("pw\n") && !files.get("/v1.signed.json")!.includes("ciphertext"), "no key material is written or logged");
    await runPolicyCli(["append", "--signed", "/v1.signed.json"], env, io);
    await runPolicyCli(["show"], env, io);
    assert.match(logs.join("\n"), /in effect now: version 1/);

    // A signature by anyone but the pinned operator is refused, and so is a document that does not extend the chain.
    const stranger = privateKeyToAccount(generatePrivateKey());
    await runPolicyCli(["build", "--per-action-cap", "1", "--session-daily-cap", "1", "--effective-from", "2026-10-14T00:00:00Z", "--out", "/v2.json"], env, io);
    const v2 = policyFromJson(files.get("/v2.json")!);
    assert.equal(v2.version, 2);
    await assert.rejects(runPolicyCli(["append", "--document", "/v2.json", "--signature", await sign(v2, stranger)], env, io), /pinned operator/);
    await assert.rejects(runPolicyCli(["append", "--document", "/v1.json", "--signature", JSON.parse(files.get("/v1.signed.json")!).signature], env, io), /next version is 2/);
    const { rows } = await pgliteDatabase(pg).query<{ n: number }>("SELECT count(*)::int AS n FROM risk_policy_versions");
    assert.equal(rows[0]!.n, 1);
    await assert.rejects(runPolicyCli(["append", "--signed", "/v1.signed.json"], { ...env, WORKER_POLICY_SIGNER: "" }, io), /WORKER_POLICY_SIGNER/);
  } finally {
    await pg.close();
  }
});
