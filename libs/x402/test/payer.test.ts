import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MemoryAgentWalletStore,
  MemorySessionKeyVault,
  MemorySponsorshipLedger,
  WalletsService,
  X402_LIMITS,
  buildScope,
  kernelWrappedHash,
  x402AuthorizationDigest,
  x402Nonce,
  type SettlementAssetDomain,
} from "@monadeum/wallets";
import { FakeChain } from "@monadeum/wallets/testing";
import { decodeAbiParameters, encodeAbiParameters, getAddress, parseAbiParameters, recoverAddress, slice, keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  MemoryPaymentLog,
  MemoryX402SlotStore,
  ValidatorPayer,
  X402Client,
  X402PayerError,
  decodeHeader,
  encodeHeader,
  reconcileSettlements,
  settlementsFromLogs,
  type ChainLog,
  type PaymentPayload,
  type PaymentTerms,
} from "../src/index.js";

const USDC = getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
const VALIDATOR = getAddress("0x4024024024024024024024024024024024024024");
const NANSEN = getAddress("0x85a6cb8303cd90f4a1a1005c04e66ad4d2370b18");
const DEFILLAMA = getAddress("0x2222222222222222222222222222222222222222");
const ATTACKER = getAddress("0x3333333333333333333333333333333333333333");
const asset: SettlementAssetDomain = { address: USDC, chainId: 143, name: "USDC", version: "2" };
const NETWORK = "eip155:143";
const NOW = 1_790_000_800n; // 800 seconds into an hour

async function world(options: { now?: bigint; paymentsPerEpoch?: number } = {}) {
  const chain = new FakeChain();
  chain.deployContract(VALIDATOR);
  const x402Vault = new MemorySessionKeyVault();
  const limits = { ...X402_LIMITS, paymentsPerEpoch: options.paymentsPerEpoch ?? X402_LIMITS.paymentsPerEpoch };
  const scope = buildScope({
    settlementAsset: USDC, kuruRouter: getAddress("0x00000000000000000000000000000000000000b1"), kuruRouterSelectors: ["0x12345678"],
    reallocation: getAddress("0x00000000000000000000000000000000000000c1"), reallocationSelectors: ["0x9abcdef0"],
  });
  const wallets = new WalletsService(chain, new MemoryAgentWalletStore(), new MemorySessionKeyVault(), new MemorySponsorshipLedger(), {
    scope, budget: { operations: 10, gasWei: 100_000n }, paymaster: true,
    x402: { validator: VALIDATOR, settlementAsset: USDC, ...limits, payees: [NANSEN, DEFILLAMA], vault: x402Vault },
  });
  const ownerAccount = privateKeyToAccount(generatePrivateKey());
  const owner = { address: ownerAccount.address, signer: ownerAccount };
  const deployed = await wallets.deploy({ agentId: "agent-1", owner, index: 0n, limits: { perTxCap: 1n, dailyCap: 1n } });
  assert.equal(deployed.ok, true);
  if (!deployed.ok) throw new Error("unreachable");
  const slots = new MemoryX402SlotStore();
  let now = options.now ?? NOW;
  const payer = new ValidatorPayer(wallets, slots, {
    asset, ...limits, payees: [NANSEN, DEFILLAMA], agentOf: (k) => k.slice(0, k.lastIndexOf(":")), now: () => now,
  });
  return { wallets, owner, slots, payer, account: deployed.account, setNow: (t: bigint) => { now = t; } };
}

const terms = (overrides: Partial<PaymentTerms> = {}): PaymentTerms => ({
  scheme: "exact", network: NETWORK, asset: USDC, payTo: NANSEN, amount: 50_000n, maxTimeoutSeconds: 60,
  requirement: { scheme: "exact", network: NETWORK, amount: "50000", asset: USDC, payTo: NANSEN, maxTimeoutSeconds: 60 }, resource: null,
  ...overrides,
});

test("the payer claims a slot durably, then signs a bounded authorization the validator accepts", async () => {
  const w = await world();
  const p = await w.payer.authorize({ key: "agent-1:7:nansen:/x", tickKey: "agent-1:7", terms: terms() });
  const a = p.payload.authorization;
  assert.equal(a.from, w.account);
  assert.equal(a.to, NANSEN);
  assert.equal(a.value, "50000");
  assert.equal(BigInt(a.validAfter), NOW - 5n);
  assert.equal(BigInt(a.validBefore) - BigInt(a.validAfter), 60n, "the provider's timeout, under maxValidity");
  assert.equal(a.nonce, x402Nonce(w.account, (NOW - 5n) / 3600n, 0n));
  const claim = await w.slots.findByPayment("agent-1:7:nansen:/x");
  assert.deepEqual([claim?.slot, claim?.nonce, claim?.value, claim?.payTo], [0, a.nonce, 50_000n, NANSEN]);

  // The signature is the validator's: 0x01 | validator | fields | x402 key's signature of Kernel's wrapped hash.
  const sig = p.payload.signature as Hex;
  assert.equal(slice(sig, 0, 1), "0x01");
  assert.equal(getAddress(slice(sig, 1, 21)), VALIDATOR);
  const [, , , , slot] = decodeAbiParameters(parseAbiParameters("address, uint256, uint256, uint256, uint256"), slice(sig, 21, 181));
  assert.equal(slot, 0n);
  const auth = { from: w.account, to: NANSEN, value: 50_000n, validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce as Hex };
  const signer = await recoverAddress({ hash: kernelWrappedHash(w.account, 143, x402AuthorizationDigest(asset, auth)), signature: slice(sig, 181) });
  assert.equal(signer, (await w.wallets.x402SigningKey("agent-1"))!.keyAddress);
  assert.deepEqual(p.accepted, terms().requirement);
});

test("slots are taken in order within the hour, never reused, and exhausted slots fail closed", async () => {
  const w = await world({ paymentsPerEpoch: 2 });
  const first = await w.payer.authorize({ key: "k1", tickKey: "agent-1:1", terms: terms() });
  const second = await w.payer.authorize({ key: "k2", tickKey: "agent-1:2", terms: terms() });
  assert.notEqual(first.payload.authorization.nonce, second.payload.authorization.nonce);
  await assert.rejects(w.payer.authorize({ key: "k3", tickKey: "agent-1:3", terms: terms() }), /every nonce slot/);
  assert.equal(await w.slots.findByPayment("k3"), undefined);
  w.setNow(NOW + 3600n);
  const next = await w.payer.authorize({ key: "k3", tickKey: "agent-1:3", terms: terms() });
  assert.equal((await w.slots.findByPayment("k3"))?.slot, 0, "slot 0 again, in the next hour, with a new nonce");
  assert.notEqual(next.payload.authorization.nonce, first.payload.authorization.nonce);
});

test("a payment key is never signed twice", async () => {
  const w = await world();
  await w.payer.authorize({ key: "k1", tickKey: "agent-1:1", terms: terms() });
  await assert.rejects(w.payer.authorize({ key: "k1", tickKey: "agent-1:1", terms: terms() }), /already holds a slot/);
});

test("terms outside the configuration are refused before any slot is claimed", async () => {
  const w = await world();
  for (const bad of [
    terms({ network: "eip155:10143" }),
    terms({ scheme: "upto" as "exact" }),
    terms({ asset: ATTACKER }),
    terms({ payTo: ATTACKER }),
    terms({ amount: 50_001n }),
    terms({ amount: 0n }),
  ]) {
    await assert.rejects(w.payer.authorize({ key: "k", tickKey: "agent-1:1", terms: bad }), X402PayerError);
  }
  assert.equal(await w.slots.findByPayment("k"), undefined);
});

test("an agent without an active x402 key gets nothing signed, including after revocation", async () => {
  const w = await world();
  await assert.rejects(w.payer.authorize({ key: "k", tickKey: "agent-2:1", terms: terms() }), /no active x402 key/);
  assert.equal((await w.wallets.revokeSessionKey({ agentId: "agent-1", owner: w.owner })).ok, true);
  await assert.rejects(w.payer.authorize({ key: "k", tickKey: "agent-1:1", terms: terms() }), /no active x402 key/);
});

test("end to end through the client: the payload in PAYMENT-SIGNATURE is the payer's, and the slot maps back to the payment", async () => {
  const w = await world();
  const box: { sent: PaymentPayload | null } = { sent: null };
  const http = (async (_url: URL, init: RequestInit) => {
    const header = new Headers(init.headers).get("payment-signature");
    if (!header) {
      return new Response("{}", { status: 402, headers: { "payment-required": encodeHeader({ x402Version: 2, resource: { url: "https://nansen.example/x" }, accepts: [terms().requirement] }) } });
    }
    box.sent = decodeHeader(header) as PaymentPayload;
    return Response.json({ provider: "nansen", price: 1, observedAt: "2026-10-10T00:00:00Z" }, {
      status: 200, headers: { "payment-response": encodeHeader({ success: true, transaction: `0x${"ab".repeat(32)}`, network: NETWORK, payer: w.account }) },
    });
  }) as typeof fetch;
  const log = new MemoryPaymentLog();
  const client = new X402Client({ nansen: { baseUrl: "https://nansen.example", payTo: NANSEN }, defillama: { baseUrl: "https://defillama.example", payTo: DEFILLAMA } },
    USDC, NETWORK, w.payer, log, http);
  const r = await client.buy({ tickKey: "agent-1:9", provider: "nansen", resource: "/x", maxPrice: 50_000n });
  assert.equal(r.ok, true);
  const sent = box.sent;
  assert.ok(sent);
  const claim = await w.slots.findByNonce(w.account, sent!.payload.authorization.nonce as Hex);
  assert.equal(claim?.paymentKey, "agent-1:9:nansen:/x");
  assert.equal((await log.get("agent-1:9:nansen:/x"))?.settlementRef, `0x${"ab".repeat(32)}`);
});

// Monitoring

function usdcLogs(entries: { authorizer: Address; nonce: Hex; to: Address; value: bigint; tx: Hex }[]): ChainLog[] {
  const logs: ChainLog[] = [];
  let i = 0;
  for (const e of entries) {
    logs.push({
      address: USDC, transactionHash: e.tx, blockNumber: 10n, logIndex: i++, data: "0x",
      topics: [keccak256(toHex("AuthorizationUsed(address,bytes32)")), encodeAbiParameters(parseAbiParameters("address"), [e.authorizer]), e.nonce],
    });
    logs.push({
      address: USDC, transactionHash: e.tx, blockNumber: 10n, logIndex: i++, data: encodeAbiParameters(parseAbiParameters("uint256"), [e.value]),
      topics: [keccak256(toHex("Transfer(address,address,uint256)")), encodeAbiParameters(parseAbiParameters("address"), [e.authorizer]), encodeAbiParameters(parseAbiParameters("address"), [e.to])],
    });
  }
  return logs;
}

test("monitoring matches a logged settlement and alerts on an unmatched or mismatched one", async () => {
  const w = await world();
  const log = new MemoryPaymentLog();
  const p = await w.payer.authorize({ key: "k1", tickKey: "agent-1:1", terms: terms() });
  const nonce = p.payload.authorization.nonce as Hex;
  const txHash = `0x${"cd".repeat(32)}` as Hex;
  await log.write({ key: "k1", provider: "nansen", price: 50_000n, summary: null, settlementRef: txHash, anomaly: null, influencedDecision: null });

  const stranger = `0x${"ee".repeat(32)}` as Hex;
  const observed = settlementsFromLogs(usdcLogs([
    { authorizer: w.account, nonce, to: NANSEN, value: 50_000n, tx: txHash },
    { authorizer: w.account, nonce: stranger, to: ATTACKER, value: 50_000n, tx: `0x${"01".repeat(32)}` },
    { authorizer: ATTACKER, nonce: stranger, to: ATTACKER, value: 1n, tx: `0x${"02".repeat(32)}` },
  ]), USDC, [w.account]);
  assert.equal(observed.length, 2, "only the agent account's settlements");
  assert.deepEqual([observed[0]!.to, observed[0]!.value], [NANSEN, 50_000n]);

  const alerts = await reconcileSettlements(observed, { slots: w.slots, log });
  assert.deepEqual(alerts.map((a) => a.type), ["x402-settlement-unmatched"]);
  assert.equal(alerts[0]!.settlement.nonce, stranger);

  const wrongAmount = await reconcileSettlements([{ ...observed[0]!, value: 49_999n }], { slots: w.slots, log });
  assert.deepEqual(wrongAmount.map((a) => a.type), ["x402-settlement-mismatch"]);
  const wrongTx = await reconcileSettlements([{ ...observed[0]!, transactionHash: `0x${"09".repeat(32)}` }], { slots: w.slots, log });
  assert.equal(wrongTx[0]?.type, "x402-settlement-mismatch");
  const noTransfer = await reconcileSettlements([{ ...observed[0]!, to: null, value: null }], { slots: w.slots, log });
  assert.equal(noTransfer[0]?.type, "x402-settlement-mismatch");
});
