import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress, isAddressEqual, recoverAddress, keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  MemoryAgentWalletStore,
  MemorySessionKeyVault,
  MemorySponsorshipLedger,
  WalletsService,
  X402_PROPOSED_LIMITS,
  buildScope,
  decodeX402ModuleCall,
  loadWalletsConfig,
  type OwnerSigner,
  type X402WalletSettings,
} from "../src/index.js";
import { FakeChain, type FakeOptions } from "../src/testing.js";

const USDC = getAddress("0x00000000000000000000000000000000000000a1");
const ROUTER = getAddress("0x00000000000000000000000000000000000000b1");
const REALLOC = getAddress("0x00000000000000000000000000000000000000c1");
const VALIDATOR = getAddress("0x4024024024024024024024024024024024024024");
const NANSEN = getAddress("0x85a6cb8303cd90f4a1a1005c04e66ad4d2370b18");
const DEFILLAMA = getAddress("0x2222222222222222222222222222222222222222");
const scope = buildScope({ settlementAsset: USDC, kuruRouter: ROUTER, kuruRouterSelectors: ["0x12345678"], reallocation: REALLOC, reallocationSelectors: ["0x9abcdef0"] });
const limits = { perTxCap: 1_000_000n, dailyCap: 5_000_000n };

function owner(): OwnerSigner {
  const account = privateKeyToAccount(generatePrivateKey());
  return { address: account.address, signer: account };
}

function setup(options: FakeOptions = {}, withValidatorCode = true) {
  const chain = new FakeChain(options);
  if (withValidatorCode) chain.deployContract(VALIDATOR);
  const store = new MemoryAgentWalletStore();
  const vault = new MemorySessionKeyVault();
  const x402Vault = new MemorySessionKeyVault();
  const x402: X402WalletSettings = { validator: VALIDATOR, settlementAsset: USDC, ...X402_PROPOSED_LIMITS, payees: [NANSEN, DEFILLAMA], vault: x402Vault };
  const service = new WalletsService(chain, store, vault, new MemorySponsorshipLedger(), { scope, budget: { operations: 10, gasWei: 100_000n }, paymaster: true, x402 });
  return { chain, store, vault, x402Vault, service, owner: owner(), x402 };
}

async function deployed(options?: FakeOptions) {
  const s = setup(options);
  const r = await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits });
  assert.equal(r.ok, true, show(r));
  if (!r.ok) throw new Error("unreachable");
  return { ...s, account: r.account };
}

const show = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
const x402Calls = (calls: { to: string; data: Hex }[]) => calls.map((c) => decodeX402ModuleCall(c.data)).filter((c) => c !== null);

test("deployment installs the x402 validator in the same owner-signed operation, with a key of its own", async () => {
  const s = await deployed();
  assert.equal(s.chain.submitted.length, 1, "one operation deploys, configures, and installs");
  const installs = x402Calls(s.chain.submitted[0]!.calls);
  assert.equal(installs.length, 1);
  assert.equal(installs[0]!.kind, "install");
  assert.equal(installs[0]!.validator, VALIDATOR);
  assert.ok(s.chain.submitted[0]!.calls.some((c) => isAddressEqual(c.to, s.account)), "the install is a call the account makes to itself");

  const record = await s.store.get("agent-1");
  assert.equal(record?.x402?.status, "active");
  assert.equal(record?.x402?.validator, VALIDATOR);
  const key = await s.x402Vault.get("agent-1");
  assert.ok(key);
  assert.equal(privateKeyToAccount(key!).address, record!.x402!.keyAddress);
  assert.equal(await s.vault.get("agent-1"), null, "the session-key vault does not hold the x402 key");
  assert.equal(await s.chain.x402Configured(s.account, VALIDATOR, {
    signer: record!.x402!.keyAddress, maxValue: 50_000n, paymentsPerEpoch: 4, maxValidity: 300, payees: [NANSEN, DEFILLAMA],
  }), true);
});

test("the x402 signing key signs raw hashes as the recorded key and never exposes the private key", async () => {
  const s = await deployed();
  const signing = await s.service.x402SigningKey("agent-1");
  assert.ok(signing);
  assert.equal(signing!.account, s.account);
  assert.equal(signing!.validator, VALIDATOR);
  assert.deepEqual(Object.keys(signing!).sort(), ["account", "keyAddress", "sign", "validator"]);
  const hash = keccak256(toHex("x"));
  assert.equal(await recoverAddress({ hash, signature: await signing!.sign({ hash }) }), signing!.keyAddress);
  assert.equal(await s.service.x402SigningKey("unknown"), null);
});

test("the two keys must live in separate vaults", () => {
  const vault = new MemorySessionKeyVault();
  assert.throws(() => new WalletsService(new FakeChain(), new MemoryAgentWalletStore(), vault, new MemorySponsorshipLedger(), {
    scope, budget: { operations: 1, gasWei: 1n }, paymaster: true,
    x402: { validator: VALIDATOR, settlementAsset: USDC, ...X402_PROPOSED_LIMITS, payees: [NANSEN], vault },
  }), /separate/);
});

test("a validator address without code fails deployment closed, before anything is signed", async () => {
  const s = setup({}, false);
  const r = await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits });
  assert.deepEqual(r, { ok: false, reason: "policy-unavailable", detail: "the x402 validator has no code" });
  assert.equal(s.chain.submitted.length, 0);
});

test("revocation uninstalls the x402 validator with the session key in one operation and destroys both keys", async () => {
  const s = await deployed();
  assert.equal((await s.service.issueSessionKey({ agentId: "agent-1", owner: s.owner })).ok, true);
  const r = await s.service.revokeSessionKey({ agentId: "agent-1", owner: s.owner });
  assert.equal(r.ok, true, show(r));
  const revocation = s.chain.submitted.at(-1)!;
  assert.deepEqual(x402Calls(revocation.calls), [{ kind: "uninstall", validator: VALIDATOR }]);
  assert.equal(await s.chain.x402Installed(s.account, VALIDATOR), false);
  assert.equal(await s.x402Vault.get("agent-1"), null);
  assert.equal(await s.vault.get("agent-1"), null);
  assert.equal((await s.store.get("agent-1"))?.x402?.status, "revoked");
  assert.equal(await s.service.x402SigningKey("agent-1"), null);
  const status = await s.service.revocationStatus("agent-1");
  assert.equal(status?.revoked, true);
  assert.deepEqual(status?.x402, { installed: false, keyDestroyed: true });
});

test("revocation without a session key still uninstalls the x402 validator", async () => {
  const s = await deployed();
  const r = await s.service.revokeSessionKey({ agentId: "agent-1", owner: s.owner });
  assert.equal(r.ok, true, show(r));
  assert.equal(await s.chain.x402Installed(s.account, VALIDATOR), false);
  assert.equal(await s.x402Vault.get("agent-1"), null);
});

test("the x402 key is gone locally at once even when the on-chain uninstall cannot be sent", async () => {
  const s = await deployed();
  s.chain.options.paymaster = "down";
  const r = await s.service.revokeSessionKey({ agentId: "agent-1", owner: s.owner });
  assert.equal(r.ok, false);
  assert.equal(await s.x402Vault.get("agent-1"), null);
  assert.equal(await s.service.x402SigningKey("agent-1"), null);
  assert.equal((await s.store.get("agent-1"))?.x402?.status, "revoking");
  assert.equal((await s.service.installX402({ agentId: "agent-1", owner: s.owner })).ok, false, "no reinstall while revocation is unverified");
});

test("after revocation the owner can install a new x402 key; a repeat call sends nothing", async () => {
  const s = await deployed();
  const old = (await s.store.get("agent-1"))!.x402!.keyAddress;
  await s.service.revokeSessionKey({ agentId: "agent-1", owner: s.owner });
  const r = await s.service.installX402({ agentId: "agent-1", owner: s.owner });
  assert.equal(r.ok, true, show(r));
  if (!r.ok) return;
  assert.equal(r.installed, true);
  assert.notEqual(r.keyAddress, old, "a revoked key is never reused");
  const sent = s.chain.submitted.length;
  const again = await s.service.installX402({ agentId: "agent-1", owner: s.owner });
  assert.deepEqual(again.ok && { installed: again.installed, key: again.keyAddress }, { installed: false, key: r.keyAddress });
  assert.equal(s.chain.submitted.length, sent);
});

test("installX402 refuses a stranger and an undeployed agent", async () => {
  const s = await deployed();
  assert.equal((await s.service.installX402({ agentId: "agent-1", owner: owner() })).ok, false);
  assert.deepEqual(await s.service.installX402({ agentId: "nobody", owner: s.owner }), { ok: false, reason: "unknown-agent" });
});

test("a deployment whose response was lost is confirmed from chain state on retry, without a second install", async () => {
  const s = setup({ submit: "accepted-then-throw" });
  const first = await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits });
  assert.equal(first.ok, false);
  assert.equal((await s.store.get("agent-1"))?.x402?.status, "installing", "the key's address is recorded before submission");
  s.chain.mine();
  s.chain.options.submit = "ok";
  const second = await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits });
  assert.equal(second.ok, true, show(second));
  assert.equal((await s.store.get("agent-1"))?.x402?.status, "active");
  assert.equal(s.chain.submitted.length, 1);
});

test("configuration: x402 is off unless a validator is set, and defaults to the proposed limits", () => {
  const env = {
    WALLETS_CHAIN_ID: "10143",
    WALLETS_BUNDLER_URL: "https://bundler.example",
    WALLETS_SETTLEMENT_ASSET: USDC,
    WALLETS_KURU_ROUTER: ROUTER,
    WALLETS_KURU_ROUTER_SELECTORS: "0x12345678",
    WALLETS_REALLOCATION_CONTRACT: REALLOC,
    WALLETS_REALLOCATION_SELECTORS: "0x9abcdef0",
    WALLETS_SPONSORED_OPERATIONS: "3",
    WALLETS_SPONSORED_GAS_WEI: "1000",
    WALLETS_SPEND_POLICY_ADDRESS: "0x00000000000000000000000000000000000000f0",
  };
  assert.equal(loadWalletsConfig(env).x402, null);
  const on = loadWalletsConfig({ ...env, WALLETS_X402_VALIDATOR_ADDRESS: VALIDATOR, WALLETS_X402_PAYEES: `${NANSEN},${DEFILLAMA}` }).x402;
  assert.deepEqual(on, { validator: VALIDATOR, settlementAsset: USDC, maxValue: 50_000n, paymentsPerEpoch: 4, maxValidity: 300, payees: [NANSEN, DEFILLAMA] });
  for (const bad of [
    { WALLETS_X402_PAYEES: "" },
    { WALLETS_X402_PAYEES: "0xnope" },
    { WALLETS_X402_MAX_VALUE: "0" },
    { WALLETS_X402_MAX_VALIDITY: "3601" },
    { WALLETS_X402_PAYMENTS_PER_EPOCH: "-1" },
  ]) {
    assert.throws(() => loadWalletsConfig({ ...env, WALLETS_X402_VALIDATOR_ADDRESS: VALIDATOR, WALLETS_X402_PAYEES: NANSEN, ...bad }));
  }
});
