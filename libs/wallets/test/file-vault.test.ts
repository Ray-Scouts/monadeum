import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_SCRYPT,
  FileSessionKeyVault,
  FileVaultError,
  MemoryAgentWalletStore,
  MemorySponsorshipLedger,
  WalletsConfigError,
  loadFileVaults,
  loadWalletsRuntime,
  type OwnerSigner,
  type ScryptParams,
} from "../src/index.js";
import { FakeChain } from "../src/testing.js";

// The local encrypted SessionKeyVault (testnet and local development only, SECURITY.md section 11).

/** Cheap parameters so the suite stays fast; the default is DEFAULT_SCRYPT. */
const scrypt: ScryptParams = { N: 2 ** 10, r: 8, p: 1 };
const passphrase = "correct horse battery staple";

async function scratch() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "monadeum-vault-test-"));
  return { root, dir: (name: string) => path.join(root, name), done: () => fs.rm(root, { recursive: true, force: true }) };
}

const mode = async (p: string) => (await fs.stat(p)).mode & 0o777;

test("keys round-trip, are encrypted at rest, and every file is 0600 in a 0700 directory", async () => {
  const s = await scratch();
  try {
    const vault = await FileSessionKeyVault.open({ directory: s.dir("session"), passphrase, purpose: "session", scrypt });
    const key = generatePrivateKey();
    await vault.put("agent-1", key);
    assert.equal(await vault.get("agent-1"), key);
    assert.equal(await vault.get("agent-2"), null);
    assert.equal(await mode(s.dir("session")), 0o700);
    const files = await fs.readdir(s.dir("session"));
    assert.deepEqual(files.filter((f) => f.startsWith(".tmp-")), [], "no temporary file is left behind");
    for (const f of files) {
      assert.equal(await mode(path.join(s.dir("session"), f)), 0o600, f);
      const raw = await fs.readFile(path.join(s.dir("session"), f), "utf8");
      assert.ok(!raw.toLowerCase().includes(key.slice(2).toLowerCase()), `${f} holds the key in plaintext`);
      assert.ok(!raw.includes(passphrase), `${f} holds the passphrase`);
      assert.ok(!raw.includes("agent-1"), `${f} names the agent`);
    }
  } finally {
    await s.done();
  }
});

test("put refuses an agent that already holds a key; destroy is idempotent and makes get return null", async () => {
  const s = await scratch();
  try {
    const vault = await FileSessionKeyVault.open({ directory: s.dir("v"), passphrase, purpose: "session", scrypt });
    const key = generatePrivateKey();
    await vault.put("agent-1", key);
    await assert.rejects(vault.put("agent-1", generatePrivateKey()), /already held/);
    assert.equal(await vault.get("agent-1"), key, "a refused put does not replace the key");
    await vault.destroy("agent-1");
    await vault.destroy("agent-1");
    assert.equal(await vault.get("agent-1"), null);
    const replacement = generatePrivateKey();
    await vault.put("agent-1", replacement);
    assert.equal(await vault.get("agent-1"), replacement);
    await assert.rejects(vault.put("agent-2", "0x1234"), FileVaultError);
  } finally {
    await s.done();
  }
});

test("a reopened vault reads its keys; a wrong passphrase or the other purpose is refused at open", async () => {
  const s = await scratch();
  try {
    const key = generatePrivateKey();
    const first = await FileSessionKeyVault.open({ directory: s.dir("v"), passphrase, purpose: "session", scrypt });
    await first.put("agent-1", key);
    first.close();
    // The parameters recorded at creation are used on open, whatever the caller passes.
    const second = await FileSessionKeyVault.open({ directory: s.dir("v"), passphrase, purpose: "session", scrypt: { N: 2, r: 1, p: 1 } });
    assert.equal(await second.get("agent-1"), key);
    await assert.rejects(FileSessionKeyVault.open({ directory: s.dir("v"), passphrase: `${passphrase}!`, purpose: "session", scrypt }), /passphrase does not open/);
    await assert.rejects(FileSessionKeyVault.open({ directory: s.dir("v"), passphrase, purpose: "x402", scrypt }), /is a session vault, not a x402 vault/);
    await assert.rejects(FileSessionKeyVault.open({ directory: s.dir("w"), passphrase: "too short", purpose: "session", scrypt }), /at least 16/);
  } finally {
    await s.done();
  }
});

test("a key file moved to another agent, another vault, or modified fails closed instead of reading as absent", async () => {
  const s = await scratch();
  try {
    const session = await FileSessionKeyVault.open({ directory: s.dir("session"), passphrase, purpose: "session", scrypt });
    const x402 = await FileSessionKeyVault.open({ directory: s.dir("x402"), passphrase, purpose: "x402", scrypt });
    await session.put("agent-1", generatePrivateKey());
    const name = (await fs.readdir(s.dir("session"))).find((f) => f.endsWith(".key"))!;
    const content = await fs.readFile(path.join(s.dir("session"), name));

    // Same vault, another agent's name: the agent ID is associated data.
    await session.put("agent-2", generatePrivateKey());
    const other = (await fs.readdir(s.dir("session"))).find((f) => f.endsWith(".key") && f !== name)!;
    await fs.writeFile(path.join(s.dir("session"), other), content);
    await assert.rejects(session.get("agent-2"), /does not decrypt/);

    // Same agent in the x402 vault, even under the same passphrase: the purpose is associated data and the salt differs.
    await fs.writeFile(path.join(s.dir("x402"), name), content, { mode: 0o600 });
    await assert.rejects(x402.get("agent-1"), /does not decrypt/);

    // One flipped ciphertext character.
    const parsed = JSON.parse(content.toString("utf8"));
    parsed.sealed.ct = (parsed.sealed.ct[0] === "0" ? "1" : "0") + parsed.sealed.ct.slice(1);
    await fs.writeFile(path.join(s.dir("session"), name), JSON.stringify(parsed));
    await assert.rejects(session.get("agent-1"), /does not decrypt/);
  } finally {
    await s.done();
  }
});

test("a vault directory group or others can read is refused", async () => {
  const s = await scratch();
  try {
    await fs.mkdir(s.dir("open"), { mode: 0o755 });
    await fs.chmod(s.dir("open"), 0o755);
    await assert.rejects(FileSessionKeyVault.open({ directory: s.dir("open"), passphrase, purpose: "session", scrypt }), /must be 0700/);
  } finally {
    await s.done();
  }
});

test("two processes on one directory: both open it, read each other's keys, and only one put wins", async () => {
  const s = await scratch();
  try {
    const [api, worker] = await Promise.all([
      FileSessionKeyVault.open({ directory: s.dir("v"), passphrase, purpose: "session", scrypt }),
      FileSessionKeyVault.open({ directory: s.dir("v"), passphrase, purpose: "session", scrypt }),
    ]);
    const key = generatePrivateKey();
    await api.put("agent-1", key);
    assert.equal(await worker.get("agent-1"), key);
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => worker.put("agent-2", generatePrivateKey())));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    await worker.destroy("agent-1");
    assert.equal(await api.get("agent-1"), null, "a destroy in one process is seen by the other");
  } finally {
    await s.done();
  }
});

test("loadFileVaults: unset is null; production, a shared or nested directory, and an ambiguous passphrase are refused", async () => {
  const s = await scratch();
  try {
    assert.equal(await loadFileVaults({}), null);
    const base = {
      WALLETS_SESSION_VAULT_DIR: s.dir("session"),
      WALLETS_SESSION_VAULT_PASSPHRASE: passphrase,
      WALLETS_X402_VAULT_DIR: s.dir("x402"),
      WALLETS_X402_VAULT_PASSPHRASE: `${passphrase} x402`,
    };
    await assert.rejects(loadFileVaults({ ...base, MONADEUM_ENV: "production" }, { scrypt }), /testnet and local development only/);
    await assert.rejects(loadFileVaults({ ...base, WALLETS_X402_VAULT_DIR: s.dir("session") }, { scrypt }), /separate directory/);
    await assert.rejects(loadFileVaults({ ...base, WALLETS_X402_VAULT_DIR: path.join(s.dir("session"), "x402") }, { scrypt }), /separate directory/);
    await assert.rejects(loadFileVaults({ WALLETS_X402_VAULT_DIR: s.dir("x402"), WALLETS_X402_VAULT_PASSPHRASE: passphrase }, { scrypt }), /WALLETS_SESSION_VAULT_DIR is not/);
    await assert.rejects(loadFileVaults({ ...base, WALLETS_SESSION_VAULT_PASSPHRASE_FILE: s.dir("pw") }, { scrypt }), /not both/);
    await assert.rejects(loadFileVaults({ WALLETS_SESSION_VAULT_DIR: s.dir("session") }, { scrypt }), /PASSPHRASE or/);

    // A passphrase file, as a Docker secret provides it, with the trailing newline an editor adds.
    await fs.writeFile(s.dir("pw"), `${passphrase}\n`, { mode: 0o600 });
    const vaults = await loadFileVaults(
      { WALLETS_SESSION_VAULT_DIR: s.dir("session"), WALLETS_SESSION_VAULT_PASSPHRASE_FILE: s.dir("pw"), WALLETS_X402_VAULT_DIR: s.dir("x402"), WALLETS_X402_VAULT_PASSPHRASE: `${passphrase} x402` },
      { scrypt },
    );
    assert.ok(vaults && vaults.x402);
    assert.notEqual(vaults.session, vaults.x402);
    assert.equal(vaults.session.purpose, "session");
    assert.equal(vaults.x402.purpose, "x402");
    // The same passphrase typed directly opens the vault the file created.
    assert.ok(await loadFileVaults({ WALLETS_SESSION_VAULT_DIR: s.dir("session"), WALLETS_SESSION_VAULT_PASSPHRASE: passphrase }, { scrypt }));
  } finally {
    await s.done();
  }
});

const USDC = getAddress("0x00000000000000000000000000000000000000a1");
const walletsEnv = {
  WALLETS_CHAIN_ID: "10143",
  WALLETS_BUNDLER_URL: "https://bundler.example",
  WALLETS_PAYMASTER_URL: "https://paymaster.example",
  WALLETS_SETTLEMENT_ASSET: USDC,
  WALLETS_KURU_ROUTER: "0x00000000000000000000000000000000000000b1",
  WALLETS_KURU_ROUTER_SELECTORS: "0x12345678",
  WALLETS_REALLOCATION_CONTRACT: "0x00000000000000000000000000000000000000c1",
  WALLETS_REALLOCATION_SELECTORS: "0x9abcdef0",
  WALLETS_SPONSORED_OPERATIONS: "10",
  WALLETS_SPONSORED_GAS_WEI: "100000",
  WALLETS_SPEND_POLICY_ADDRESS: "0x00000000000000000000000000000000000000f0",
};

function owner(): OwnerSigner {
  const account = privateKeyToAccount(generatePrivateKey());
  return { address: account.address, signer: account };
}

test("loadWalletsRuntime: nothing without WALLETS_CHAIN_ID, and a vault is required once it is set", async () => {
  const s = await scratch();
  try {
    assert.equal(await loadWalletsRuntime({}), null);
    await assert.rejects(loadWalletsRuntime(walletsEnv, { chain: new FakeChain(), scrypt }), WalletsConfigError);
    const vaultEnv = { ...walletsEnv, WALLETS_SESSION_VAULT_DIR: s.dir("session"), WALLETS_SESSION_VAULT_PASSPHRASE: passphrase };
    const x402Env = { WALLETS_X402_VALIDATOR_ADDRESS: "0x4024024024024024024024024024024024024024", WALLETS_X402_PAYEES: "0x2222222222222222222222222222222222222222" };
    await assert.rejects(loadWalletsRuntime({ ...vaultEnv, ...x402Env }, { chain: new FakeChain(), scrypt }), /no x402 key vault/);
    await assert.rejects(loadWalletsRuntime({ ...vaultEnv, MONADEUM_ENV: "production" }, { chain: new FakeChain(), scrypt }), FileVaultError);
  } finally {
    await s.done();
  }
});

test("WalletsService on the file vault: issuance writes the key to disk and revocation destroys it", async () => {
  const s = await scratch();
  try {
    const env = { ...walletsEnv, WALLETS_SESSION_VAULT_DIR: s.dir("session"), WALLETS_SESSION_VAULT_PASSPHRASE: passphrase };
    const runtime = await loadWalletsRuntime(env, { chain: new FakeChain(), scrypt });
    assert.ok(runtime);
    const service = runtime.build(new MemoryAgentWalletStore(), new MemorySponsorshipLedger());
    const o = owner();
    const deployed = await service.deploy({ agentId: "agent-1", owner: o, index: 0n, limits: { perTxCap: 1_000n, dailyCap: 5_000n } });
    assert.equal(deployed.ok, true, deployed.ok ? "" : deployed.reason);
    const issued = await service.issueSessionKey({ agentId: "agent-1", owner: o });
    assert.equal(issued.ok, true);
    if (!issued.ok) throw new Error("unreachable");
    const held = await runtime.vaults.session.get("agent-1");
    assert.ok(held);
    assert.equal(privateKeyToAccount(held).address, issued.keyAddress);
    const revoked = await service.revokeSessionKey({ agentId: "agent-1", owner: o });
    assert.equal(revoked.ok, true);
    assert.equal(await runtime.vaults.session.get("agent-1"), null);
    assert.equal((await service.revocationStatus("agent-1"))?.keyDestroyed, true);
    runtime.close();
  } finally {
    await s.done();
  }
});

test("the default scrypt parameters are recorded in the header and open within Node's memory limit", async () => {
  const s = await scratch();
  try {
    const vault = await FileSessionKeyVault.open({ directory: s.dir("v"), passphrase, purpose: "session" });
    const header = JSON.parse(await fs.readFile(path.join(s.dir("v"), "vault.json"), "utf8"));
    assert.deepEqual({ name: header.kdf.name, N: header.kdf.N, r: header.kdf.r, p: header.kdf.p }, { name: "scrypt", ...DEFAULT_SCRYPT });
    assert.equal(Buffer.from(header.kdf.salt, "hex").length, 16);
    vault.close();
    assert.ok(await FileSessionKeyVault.open({ directory: s.dir("v"), passphrase, purpose: "session" }));
  } finally {
    await s.done();
  }
});
