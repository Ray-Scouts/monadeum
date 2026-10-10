import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  APPROVE_SELECTOR,
  MemoryAgentWalletStore,
  MemorySessionKeyVault,
  MemorySponsorshipLedger,
  ScopeError,
  TRANSFER_SELECTOR,
  WalletsService,
  buildScope,
  callsInScope,
  isRevokedOnChain,
  type OwnerSigner,
  type SponsorshipBudget,
} from "../src/index.js";
import { FakeChain, type FakeOptions } from "./fake-chain.js";

const USDC = getAddress("0x00000000000000000000000000000000000000a1");
const ROUTER = getAddress("0x00000000000000000000000000000000000000b1");
const REALLOC = getAddress("0x00000000000000000000000000000000000000c1");
const ROUTER_SWAP = "0x12345678" as Hex;
const REALLOC_MOVE = "0x9abcdef0" as Hex;
const scope = buildScope({ settlementAsset: USDC, kuruRouter: ROUTER, kuruRouterSelectors: [ROUTER_SWAP], reallocation: REALLOC, reallocationSelectors: [REALLOC_MOVE] });
const limits = { perTxCap: 1_000_000n, dailyCap: 5_000_000n };

function ownerSigner(): OwnerSigner {
  // Generated per test run, never persisted. Stands in for the user's embedded wallet.
  const account = privateKeyToAccount(generatePrivateKey());
  return { address: account.address, signer: account };
}

function setup(options: FakeOptions = {}, budget: SponsorshipBudget = { operations: 3, gasWei: 10_000n }, paymaster = true) {
  const chain = new FakeChain(options);
  const store = new MemoryAgentWalletStore();
  const vault = new MemorySessionKeyVault();
  const ledger = new MemorySponsorshipLedger();
  const service = new WalletsService(chain, store, vault, ledger, { scope, budget, paymaster });
  return { chain, store, vault, ledger, service, owner: ownerSigner() };
}

const approveRouter = (amount: bigint) => ({ to: USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, amount] }) });
const swap = { to: ROUTER, value: 0n, data: `${ROUTER_SWAP}00` as Hex };

async function deployed(options?: FakeOptions, budget?: SponsorshipBudget, paymaster?: boolean) {
  const s = setup(options, budget, paymaster);
  const r = await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");
  return { ...s, account: r.account };
}

// Scope

test("the scope is exactly the SECURITY.md section 1 allowlist", () => {
  assert.deepEqual(scope.map((c) => [c.label, c.target, c.selector]), [
    ["settlement-asset", USDC, TRANSFER_SELECTOR],
    ["settlement-asset", USDC, APPROVE_SELECTOR],
    ["kuru-router", ROUTER, ROUTER_SWAP],
    ["reproduction", REALLOC, REALLOC_MOVE],
  ]);
  assert.ok(Object.isFrozen(scope));
});

test("the scope rejects aliased targets, empty selector lists, and malformed selectors", () => {
  const base = { settlementAsset: USDC, kuruRouter: ROUTER, kuruRouterSelectors: [ROUTER_SWAP], reallocation: REALLOC, reallocationSelectors: [REALLOC_MOVE] };
  assert.throws(() => buildScope({ ...base, reallocation: USDC }), ScopeError);
  assert.throws(() => buildScope({ ...base, kuruRouterSelectors: [] }), ScopeError);
  assert.throws(() => buildScope({ ...base, reallocationSelectors: ["0x1234"] }), ScopeError);
  assert.throws(() => buildScope({ ...base, kuruRouterSelectors: [ROUTER_SWAP, ROUTER_SWAP] }), ScopeError);
  assert.throws(() => buildScope({ ...base, kuruRouter: "0x0000000000000000000000000000000000000000" }), ScopeError);
});

test("calls outside the allowlist, with native value, or without a selector are out of scope", () => {
  assert.equal(callsInScope(scope, [approveRouter(5n), swap]), true);
  assert.equal(callsInScope(scope, [{ ...swap, value: 1n }]), false);
  assert.equal(callsInScope(scope, [{ to: USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [ROUTER, ROUTER, 1n] }) }]), false);
  assert.equal(callsInScope(scope, [{ to: ROUTER, value: 0n, data: "0x" }]), false);
  assert.equal(callsInScope(scope, [{ to: "0x00000000000000000000000000000000000000d1", value: 0n, data: `${ROUTER_SWAP}00` }]), false);
  assert.equal(callsInScope(scope, []), false);
});

// Deployment

test("deployment deploys and configures the spend policy in one operation, and a repeat sends nothing", async () => {
  const { chain, service, owner, account } = await deployed();
  assert.equal(chain.submitted.length, 1);
  assert.equal(chain.submitted[0]!.kind, "owner");
  assert.equal(await chain.policyConfigured(account, scope, limits), true);
  const again = await service.deploy({ agentId: "agent-1", owner, index: 0n, limits });
  assert.deepEqual(again, { ok: true, account, created: false, operation: null });
  assert.equal(chain.submitted.length, 1);
});

test("concurrent deployments for one agent send exactly one operation", async () => {
  const { chain, service, owner } = setup();
  const results = await Promise.all([1, 2, 3].map(() => service.deploy({ agentId: "agent-1", owner, index: 0n, limits })));
  assert.equal(chain.submitted.length, 1);
  assert.deepEqual(results.map((r) => r.ok && r.created), [true, false, false]);
});

test("a deployment whose operation is already pending waits for it instead of resending", async () => {
  const { chain, store, service, owner } = setup();
  const account = await chain.accountAddress(owner.address, 0n);
  // A previous process submitted the deployment and crashed before recording the result.
  const prepared = await chain.prepareOwnerOperation({ owner, index: 0n, account, calls: chain.configurationCalls(scope, limits), sponsored: false });
  const hash = await prepared.submit();
  await store.claim({ agentId: "agent-1", owner: owner.address, index: 0n, account, deployment: { status: "pending", userOpHash: hash }, session: null });
  const r = await service.deploy({ agentId: "agent-1", owner, index: 0n, limits });
  assert.equal(r.ok && r.created, false);
  assert.equal(chain.submitted.length, 1);
  assert.equal((await store.get("agent-1"))!.deployment.status, "deployed");
});

test("deployment fails closed when the spend policy contract is missing or the account is misconfigured", async () => {
  const missing = setup({ policyDeployed: false });
  assert.deepEqual(await missing.service.deploy({ agentId: "agent-1", owner: missing.owner, index: 0n, limits }), { ok: false, reason: "policy-unavailable" });
  assert.equal(missing.chain.submitted.length, 0);

  const s = setup();
  const account = await s.chain.accountAddress(s.owner.address, 0n);
  s.chain.acct(account).deployed = true; // deployed elsewhere, spend policy never configured
  const r = await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "misconfigured");
  assert.equal(s.chain.submitted.length, 0);
});

test("one agent cannot be redeployed under another owner or index, and one account cannot serve two agents", async () => {
  const { service, owner } = await deployed();
  const other = ownerSigner();
  assert.equal((await service.deploy({ agentId: "agent-1", owner: other, index: 0n, limits })).ok, false);
  assert.equal((await service.deploy({ agentId: "agent-1", owner, index: 1n, limits })).ok, false);
  const twin = await service.deploy({ agentId: "agent-2", owner, index: 0n, limits });
  assert.equal(!twin.ok && twin.reason, "conflict");
  assert.equal((await service.deploy({ agentId: "agent-2", owner, index: 1n, limits })).ok, true);
});

// Issuance

test("a session key is issued only for a deployed account, held only in the vault, and issuance is idempotent", async () => {
  const fresh = setup();
  await fresh.store.claim({ agentId: "agent-1", owner: fresh.owner.address, index: 0n, account: await fresh.chain.accountAddress(fresh.owner.address, 0n), deployment: { status: "pending", userOpHash: null }, session: null });
  assert.deepEqual(await fresh.service.issueSessionKey({ agentId: "agent-1", owner: fresh.owner }), { ok: false, reason: "not-deployed" });

  const { service, vault, store, owner } = await deployed();
  const issued = await service.issueSessionKey({ agentId: "agent-1", owner });
  assert.equal(issued.ok && issued.issued, true);
  if (!issued.ok) return;
  const key = await vault.get("agent-1");
  assert.ok(key);
  assert.equal(privateKeyToAccount(key).address, issued.keyAddress);
  assert.ok(!JSON.stringify(await store.get("agent-1"), (_, v) => (typeof v === "bigint" ? v.toString() : v)).includes(key.slice(2)));
  const again = await service.issueSessionKey({ agentId: "agent-1", owner });
  assert.deepEqual(again, { ok: true, keyAddress: issued.keyAddress, permissionId: issued.permissionId, issued: false });
  assert.equal(await vault.get("agent-1"), key);
});

test("only the account owner can issue or revoke", async () => {
  const { service } = await deployed();
  const stranger = ownerSigner();
  assert.equal((await service.issueSessionKey({ agentId: "agent-1", owner: stranger })).ok, false);
  assert.equal((await service.revokeSessionKey({ agentId: "agent-1", owner: stranger })).ok, false);
});

test("the session key signs in-scope calls and never signs out-of-scope ones", async () => {
  const { service, chain, owner } = await deployed();
  await service.issueSessionKey({ agentId: "agent-1", owner });
  const ok = await service.execute({ agentId: "agent-1", calls: [approveRouter(10n), swap] });
  assert.equal(ok.ok, true);
  const before = chain.prepareCalls;
  const outside = await service.execute({ agentId: "agent-1", calls: [{ to: "0x00000000000000000000000000000000000000d1", value: 0n, data: `${ROUTER_SWAP}00` }] });
  assert.deepEqual(outside, { ok: false, reason: "out-of-scope" });
  assert.equal(chain.prepareCalls, before);
});

// Revocation

test("revocation is immediate, verified on chain, and a revoked key cannot sign afterwards", async () => {
  const { service, chain, vault, owner, account } = await deployed();
  const issued = await service.issueSessionKey({ agentId: "agent-1", owner });
  assert.equal((await service.execute({ agentId: "agent-1", calls: [swap] })).ok, true);
  if (!issued.ok) return;

  const r = await service.revokeSessionKey({ agentId: "agent-1", owner });
  assert.equal(r.ok, true);
  assert.equal(await vault.get("agent-1"), null);
  const status = await service.revocationStatus("agent-1");
  assert.equal(status?.revoked, true);
  assert.equal(status?.keyDestroyed, true);

  const before = chain.prepareCalls;
  assert.deepEqual(await service.execute({ agentId: "agent-1", calls: [swap] }), { ok: false, reason: "revoked" });
  assert.equal(chain.prepareCalls, before, "the module does not even prepare an operation for a revoked key");
  assert.equal(chain.revoked(account, issued.permissionId, status!.enableNonce), true);
});

test("a key revoked before its first use cannot enable itself with the owner's approval", async () => {
  const { service, chain, vault, store, owner, account } = await deployed();
  const issued = await service.issueSessionKey({ agentId: "agent-1", owner });
  if (!issued.ok) return;
  const key = (await vault.get("agent-1"))!;
  const record = (await store.get("agent-1"))!;
  assert.equal((await service.revokeSessionKey({ agentId: "agent-1", owner })).ok, true);
  // An attacker who copied the key and the approval tries the enable path directly.
  const session = record.session!;
  await assert.rejects(chain.prepareSessionOperation({
    owner: owner.address, index: 0n, account, sessionKey: key, calls: [swap], sponsored: false,
    approval: { permissionId: session.permissionId, enableSignature: session.enableSignature, enableNonce: session.enableNonce },
  }), /AA24/);
});

test("revocation is sponsored outside the per-agent budget, even when the budget is exhausted", async () => {
  const { service, chain, ledger, owner, account } = await deployed({}, { operations: 1, gasWei: 10_000n });
  await service.issueSessionKey({ agentId: "agent-1", owner });
  const usage = await ledger.usage("agent-1");
  assert.equal((await service.sponsorship("agent-1")).exhausted, true);
  assert.equal(chain.acct(account).balance, 0n);
  const r = await service.revokeSessionKey({ agentId: "agent-1", owner });
  assert.equal(r.ok && r.operation?.sponsored, true);
  assert.deepEqual(await ledger.usage("agent-1"), usage, "the revocation is not charged to the budget");
  assert.equal((await service.revocationStatus("agent-1"))!.revoked, true);
});

test("paymaster down at revocation: the key is destroyed, the account pays if it can, otherwise paymaster-unavailable", async () => {
  const { service, chain, vault, ledger, owner, account } = await deployed({}, { operations: 1, gasWei: 10_000n });
  await service.issueSessionKey({ agentId: "agent-1", owner });
  chain.options.paymaster = "down";
  const r = await service.revokeSessionKey({ agentId: "agent-1", owner });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "paymaster-unavailable");
  assert.equal(typeof r.revokedLocallyAt, "number");
  assert.equal(await vault.get("agent-1"), null);
  assert.deepEqual(await service.execute({ agentId: "agent-1", calls: [swap] }), { ok: false, reason: "revoked" });
  assert.equal((await service.revocationStatus("agent-1"))!.revoked, false, "the chain still accepts the key until the owner operation lands");

  // Paymaster still down, but the account now holds MON: it pays its own revocation (section 14).
  chain.acct(account).balance = 10_000n;
  const paid = await service.revokeSessionKey({ agentId: "agent-1", owner });
  assert.equal(paid.ok && paid.operation?.sponsored, false);
  assert.equal((await service.revocationStatus("agent-1"))!.revoked, true);
  assert.deepEqual(await ledger.usage("agent-1"), { operations: 1, gasWei: 900n });
});

test("without a configured paymaster, revocation is paid by the account or reported as paymaster-unavailable", async () => {
  const s = setup({}, { operations: 10, gasWei: 1_000_000n }, false);
  const account = await s.chain.accountAddress(s.owner.address, 0n);
  s.chain.acct(account).balance = 1_000n;
  assert.equal((await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits })).ok, true);
  await s.service.issueSessionKey({ agentId: "agent-1", owner: s.owner });
  const r = await s.service.revokeSessionKey({ agentId: "agent-1", owner: s.owner });
  assert.equal(!r.ok && r.reason, "paymaster-unavailable");
});

test("a new key can be issued after revocation, and the old one stays dead", async () => {
  const { service, chain, store, owner, account } = await deployed();
  const first = await service.issueSessionKey({ agentId: "agent-1", owner });
  assert.equal((await service.execute({ agentId: "agent-1", calls: [swap] })).ok, true);
  const old = (await store.get("agent-1"))!.session!;
  await service.revokeSessionKey({ agentId: "agent-1", owner });
  const second = await service.issueSessionKey({ agentId: "agent-1", owner });
  assert.equal(first.ok && second.ok && first.keyAddress !== second.keyAddress, true);
  chain.acct(account).balance = 10_000n; // covers any operation past the sponsorship budget
  assert.equal((await service.execute({ agentId: "agent-1", calls: [swap] })).ok, true);
  assert.equal(chain.revoked(account, old.permissionId, old.enableNonce), true);
});

test("on-chain revocation requires both a dead validator and a moved nonce", () => {
  const live = { installed: true, validatorNonce: 1, currentNonce: 1, validNonceFrom: 0 };
  assert.equal(isRevokedOnChain(live, 1), false);
  assert.equal(isRevokedOnChain({ ...live, installed: false }, 1), false, "uninstalled but the approval could re-enable it");
  assert.equal(isRevokedOnChain({ ...live, currentNonce: 2, validNonceFrom: 2 }, 1), true, "installed below validNonceFrom");
  assert.equal(isRevokedOnChain({ installed: false, validatorNonce: 0, currentNonce: 2, validNonceFrom: 2 }, 1), true);
  assert.equal(isRevokedOnChain({ installed: true, validatorNonce: 2, currentNonce: 2, validNonceFrom: 2 }, 1), false, "a later install is live");
});

// Sponsorship budget

test("sponsorship stops at the operation budget and the account pays afterwards", async () => {
  const { service, chain, ledger, owner, account } = await deployed({}, { operations: 2, gasWei: 1_000_000n });
  await service.issueSessionKey({ agentId: "agent-1", owner });
  chain.acct(account).balance = 10_000n;
  const second = await service.execute({ agentId: "agent-1", calls: [swap] });
  const third = await service.execute({ agentId: "agent-1", calls: [swap] });
  assert.equal(second.ok && second.sponsored, true);
  assert.equal(third.ok && third.sponsored, false);
  assert.deepEqual(await ledger.usage("agent-1"), { operations: 2, gasWei: 1800n });
  assert.equal(chain.acct(account).balance, 9_000n);
  const view = await service.sponsorship("agent-1");
  assert.equal(view.exhausted, true);
});

test("sponsorship stops when the next operation's worst case would exceed the gas budget", async () => {
  const { service, chain, ledger, owner, account } = await deployed({}, { operations: 100, gasWei: 1_500n });
  await service.issueSessionKey({ agentId: "agent-1", owner });
  chain.acct(account).balance = 5_000n;
  const r = await service.execute({ agentId: "agent-1", calls: [swap] });
  assert.equal(r.ok && r.sponsored, false, "900 used, 1000 worst case does not fit in 1500");
  assert.deepEqual(await ledger.usage("agent-1"), { operations: 1, gasWei: 900n });
});

test("with the budget exhausted and no balance, the operation is not sent", async () => {
  const { service, chain, owner } = await deployed({}, { operations: 1, gasWei: 1_000_000n });
  await service.issueSessionKey({ agentId: "agent-1", owner });
  const sent = chain.submitted.length;
  assert.deepEqual(await service.execute({ agentId: "agent-1", calls: [swap] }), { ok: false, reason: "insufficient-gas" });
  assert.equal(chain.submitted.length, sent);
});

test("paymaster down: nothing is sponsored or reserved, the account pays if it can, otherwise fail closed", async () => {
  const s = setup({ paymaster: "down" });
  const r = await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits });
  assert.deepEqual(r, { ok: false, reason: "insufficient-gas" });
  assert.equal(s.chain.submitted.length, 0);
  assert.deepEqual(await s.ledger.usage("agent-1"), { operations: 0, gasWei: 0n });

  const account = await s.chain.accountAddress(s.owner.address, 0n);
  s.chain.acct(account).balance = 5_000n; // counterfactual address prefunded by the owner
  const paid = await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits });
  assert.equal(paid.ok && paid.operation?.sponsored, false);
  assert.deepEqual(await s.ledger.usage("agent-1"), { operations: 0, gasWei: 0n });
});

test("without a configured paymaster nothing is ever sponsored", async () => {
  const s = setup({}, { operations: 10, gasWei: 1_000_000n }, false);
  const account = await s.chain.accountAddress(s.owner.address, 0n);
  s.chain.acct(account).balance = 5_000n;
  const r = await s.service.deploy({ agentId: "agent-1", owner: s.owner, index: 0n, limits });
  assert.equal(r.ok && r.operation?.sponsored, false);
});

test("a rejected submission releases its reservation; an ambiguous one keeps it", async () => {
  const rejected = setup({ submit: "rejected" });
  const r1 = await rejected.service.deploy({ agentId: "agent-1", owner: rejected.owner, index: 0n, limits });
  assert.equal(!r1.ok && r1.reason, "rejected");
  assert.deepEqual(await rejected.ledger.usage("agent-1"), { operations: 0, gasWei: 0n });

  const unknown = setup({ submit: "unknown" });
  const r2 = await unknown.service.deploy({ agentId: "agent-1", owner: unknown.owner, index: 0n, limits });
  assert.equal(!r2.ok && r2.reason, "submission-unknown");
  assert.deepEqual(await unknown.ledger.usage("agent-1"), { operations: 1, gasWei: 1000n });
});

test("the ledger never reserves past either limit", async () => {
  const ledger = new MemorySponsorshipLedger();
  const budget = { operations: 2, gasWei: 100n };
  assert.equal(await ledger.reserve("a", 60n, budget), true);
  assert.equal(await ledger.reserve("a", 50n, budget), false);
  assert.equal(await ledger.reserve("a", 40n, budget), true);
  assert.equal(await ledger.reserve("a", 0n, { operations: 9, gasWei: 1000n }), false);
  assert.equal(await ledger.reserve("a", 1n, { operations: 2, gasWei: 1000n }), false);
  assert.deepEqual(await ledger.usage("a"), { operations: 2, gasWei: 100n });
});
