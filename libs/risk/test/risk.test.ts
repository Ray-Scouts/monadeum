import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  canonicalJson,
  evaluateInformation,
  evaluateTrade,
  hashOf,
  loadPolicy,
  RiskService,
  type ActionProposal,
  type ExecutionPlan,
  type Ledger,
  type PolicyDocument,
  type SignedPolicy,
  type VerifiedPolicy,
} from "../src/index.js";

const USDC: Hex = "0x00000000000000000000000000000000000000a1";
const ROUTER: Hex = "0x00000000000000000000000000000000000000b2";
const ATTACKER: Hex = "0x00000000000000000000000000000000000000ee";
const OTHER: Hex = "0x00000000000000000000000000000000000000cc";
const ERC20 = parseAbi(["function transfer(address to, uint256 amount)", "function approve(address spender, uint256 amount)"]);
const ROUTER_ABI = parseAbi(["function placeOrder(uint256 size)"]);
const selector = (data: Hex) => data.slice(0, 10) as Hex;
const approve = (spender: Hex, amount: bigint) => encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, amount] });
const transfer = (to: Hex, amount: bigint) => encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, amount] });
const order = encodeFunctionData({ abi: ROUTER_ABI, functionName: "placeOrder", args: [1n] });

const operator = privateKeyToAccount(generatePrivateKey());

function doc(version: number, previousHash: Hex | null, overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return {
    schemaVersion: 1,
    version,
    previousHash,
    effectiveFrom: "2026-09-01T00:00:00Z",
    settlementAsset: USDC,
    allowedCalls: [
      { target: USDC, selector: selector(approve(ROUTER, 0n)), label: "settlement-asset" },
      { target: USDC, selector: selector(transfer(ROUTER, 0n)), label: "settlement-asset" },
      { target: ROUTER, selector: selector(order), label: "kuru-router" },
    ],
    allowedPairs: ["MON/USDC"],
    perActionCap: 5_000_000n,
    sessionDailyCap: 20_000_000n,
    perTickInformationCap: 100_000n,
    dailyInformationCap: 1_000_000n,
    maxPositionFraction: 0.25,
    ...overrides,
  };
}

async function sign(document: PolicyDocument, account = operator): Promise<SignedPolicy> {
  return { document, signature: await account.signMessage({ message: { raw: hashOf("monadeum:policy:v1", document) } }) };
}

async function chain(overrides: Partial<PolicyDocument>[] = [{}]): Promise<SignedPolicy[]> {
  const rows: SignedPolicy[] = [];
  let previous: Hex | null = null;
  for (const [i, o] of overrides.entries()) {
    const row = await sign(doc(i + 1, previous, o));
    rows.push(row);
    previous = hashOf("monadeum:policy:v1", row.document);
  }
  return rows;
}

const NOW = new Date("2026-09-27T00:00:00Z");
const ledger: Ledger = {
  capital: 40_000_000n,
  spentInWindow: 0n,
  informationBudget: 1_000_000n,
  informationToday: 0n,
  informationThisTick: 0n,
  assetUniverse: ["MON/USDC"],
};

function proposal(notional: bigint, pair = "MON/USDC"): ActionProposal {
  return {
    schemaVersion: 1,
    tickKey: "agent-1:7",
    agentId: "agent-1",
    account: OTHER,
    genomeHash: hashOf("monadeum:genome:v1", { strategyType: "trading" }),
    strategyType: "trading",
    state: { capital: 40_000_000n, principal: 10_000_000n, ticksSinceTrade: 3, observedAt: "2026-09-27T00:00:00Z" },
    information: [],
    action: { kind: "trade", pair, side: "long", notional, maxSlippageBps: 50 },
  };
}

function plan(calls: { target: Hex; data: Hex }[], tickKey = "agent-1:7"): ExecutionPlan {
  return { tickKey, calls, planHash: hashOf("monadeum:plan:v1", { tickKey, calls }) };
}

async function active(): Promise<VerifiedPolicy> {
  const policy = await loadPolicy(await chain(), operator.address, NOW);
  assert.ok(policy);
  return policy;
}

test("a well-formed trade is approved and bound to its plan hash", async () => {
  const policy = await active();
  const p = plan([{ target: USDC, data: approve(ROUTER, 4_000_000n) }, { target: ROUTER, data: order }]);
  const decision = evaluateTrade(policy, proposal(4_000_000n), p, ledger);
  assert.equal(decision.approved, true);
  if (decision.approved) {
    assert.equal(decision.planHash, p.planHash);
    assert.equal(decision.policyVersion, 1);
    assert.equal(decision.policyHash, policy.hash);
  }
});

test("scenario A: an approve or transfer to an attacker is rejected even though the token is allowlisted", async () => {
  const policy = await active();
  const drain = evaluateTrade(policy, proposal(4_000_000n), plan([{ target: USDC, data: approve(ATTACKER, 2n ** 256n - 1n) }]), ledger);
  assert.equal(drain.approved, false);
  if (!drain.approved) assert.deepEqual(drain.violations.sort(), ["per-action-cap", "recipient-not-allowed", "session-daily-cap"]);
  const sweep = evaluateTrade(policy, proposal(4_000_000n), plan([{ target: USDC, data: transfer(ATTACKER, 1n) }]), ledger);
  assert.equal(sweep.approved, false);
  if (!sweep.approved) assert.deepEqual(sweep.violations, ["recipient-not-allowed"]);
});

test("scenario C: an information purchase from an unlisted provider is rejected", async () => {
  const policy = await active();
  const request = { tickKey: "agent-1:7", agentId: "agent-1", provider: "evil" as "nansen", maxPrice: 1n };
  const decision = evaluateInformation(policy, request, ledger);
  assert.equal(decision.approved, false);
  if (!decision.approved) assert.deepEqual(decision.violations, ["provider-not-allowed"]);
  assert.equal(evaluateInformation(policy, { ...request, provider: "nansen" }, ledger).approved, true);
  const overTick = evaluateInformation(policy, { ...request, provider: "nansen", maxPrice: 100_001n }, ledger);
  assert.equal(overTick.approved, false);
});

test("scenario F: unknown pair, off-allowlist contract, wrong decimals, and malformed calldata are rejected", async () => {
  const policy = await active();
  const good = [{ target: USDC, data: approve(ROUTER, 1_000_000n) }];
  const pair = evaluateTrade(policy, proposal(1_000_000n, "FAKE/USDC"), plan(good), ledger);
  assert.ok(!pair.approved && pair.violations.includes("pair-not-allowed"));
  const outsideUniverse = evaluateTrade(policy, proposal(1_000_000n), plan(good), { ...ledger, assetUniverse: [] });
  assert.ok(!outsideUniverse.approved && outsideUniverse.violations.includes("pair-not-allowed"));
  const contract = evaluateTrade(policy, proposal(1_000_000n), plan([{ target: OTHER, data: order }]), ledger);
  assert.ok(!contract.approved && contract.violations.includes("call-not-allowed"));
  const decimals = evaluateTrade(policy, proposal(1_000_000n * 10n ** 12n), plan([{ target: USDC, data: approve(ROUTER, 10n ** 18n) }]), ledger);
  assert.ok(!decimals.approved);
  if (!decimals.approved) assert.deepEqual(decimals.violations.sort(), ["per-action-cap", "position-fraction", "session-daily-cap"]);
  const malformed = evaluateTrade(policy, proposal(1_000_000n), plan([{ target: USDC, data: "0x095ea7b3" }]), ledger);
  assert.ok(!malformed.approved && malformed.violations.includes("call-not-allowed"));
});

test("the genome information budget caps a purchase below the policy per-tick cap", async () => {
  const policy = await active();
  const request = { tickKey: "agent-1:7", agentId: "agent-1", provider: "nansen" as const, maxPrice: 60_000n };
  assert.equal(evaluateInformation(policy, request, ledger).approved, true);
  const d = evaluateInformation(policy, request, { ...ledger, informationBudget: 50_000n });
  assert.ok(!d.approved && d.violations.includes("information-cap"));
});

test("a malformed call target is rejected, not thrown", async () => {
  const policy = await active();
  const calls = [{ target: undefined as unknown as Hex, data: order }];
  const d = evaluateTrade(policy, proposal(1_000_000n), { tickKey: "agent-1:7", calls, planHash: "0x00" }, ledger);
  assert.ok(!d.approved && d.violations.includes("call-not-allowed"));
  const noCalls = evaluateTrade(policy, proposal(1_000_000n), { tickKey: "agent-1:7" } as ExecutionPlan, ledger);
  assert.equal(noCalls.approved, false);
});

test("a plan changed after hashing, or for another tick, is rejected", async () => {
  const policy = await active();
  const p = plan([{ target: USDC, data: approve(ROUTER, 1_000_000n) }]);
  const tampered = { ...p, calls: [{ target: USDC, data: approve(ROUTER, 4_000_000n) }] };
  const d1 = evaluateTrade(policy, proposal(1_000_000n), tampered, ledger);
  assert.ok(!d1.approved && d1.violations.includes("plan-hash-mismatch"));
  const d2 = evaluateTrade(policy, proposal(1_000_000n), plan(p.calls, "agent-1:8"), ledger);
  assert.ok(!d2.approved && d2.violations.includes("plan-hash-mismatch"));
});

test("the session daily cap counts what was already spent today", async () => {
  const policy = await active();
  const p = plan([{ target: USDC, data: approve(ROUTER, 4_000_000n) }]);
  const d = evaluateTrade(policy, proposal(4_000_000n), p, { ...ledger, spentInWindow: 17_000_000n });
  assert.ok(!d.approved && d.violations.includes("session-daily-cap"));
});

test("a policy that fails verification rejects every request", async () => {
  const rows = await chain([{}, { perActionCap: 6_000_000n }]);
  assert.equal((await loadPolicy(rows, operator.address, NOW))?.document.version, 2);

  const edited = [rows[0], { ...rows[1], document: { ...rows[1].document, perActionCap: 10n ** 30n } }];
  assert.equal(await loadPolicy(edited, operator.address, NOW), null);

  const impostor = privateKeyToAccount(generatePrivateKey());
  assert.equal(await loadPolicy([rows[0], await sign(rows[1].document, impostor)], operator.address, NOW), null);

  const broken = [rows[0], await sign(doc(2, null))];
  assert.equal(await loadPolicy(broken, operator.address, NOW), null);

  const backdated = await sign(doc(2, hashOf("monadeum:policy:v1", rows[0].document), { effectiveFrom: "2026-08-01T00:00:00Z" }));
  assert.equal(await loadPolicy([rows[0], backdated], operator.address, NOW), null);

  const badCalls = await sign(doc(1, null, { allowedCalls: [{ target: 1 as unknown as Hex, selector: "0x", label: "kuru-router" }] }));
  assert.equal(await loadPolicy([badCalls], operator.address, NOW), null);

  const future = await sign({ ...doc(1, null), schemaVersion: 2 as 1 });
  assert.equal(await loadPolicy([future], operator.address, NOW), null);

  const service = new RiskService();
  assert.equal(await service.load(edited, operator.address, NOW), false);
  const d = service.trade(proposal(1n), plan([]), ledger);
  assert.ok(!d.approved && d.violations[0] === "policy-unverified");
});

test("a version not yet in effect is not the active policy", async () => {
  const rows = await chain([{}, { effectiveFrom: "2026-10-01T00:00:00Z" }]);
  assert.equal((await loadPolicy(rows, operator.address, NOW))?.document.version, 1);
});

test("canonical hashing: key order is irrelevant, bigints hash as decimal strings, tags separate kinds", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: -0, c: "x" }] }), '{"a":[2,{"c":"x","d":0}],"b":1}');
  assert.equal(hashOf("monadeum:policy:v1", { x: 5n, y: 1 }), hashOf("monadeum:policy:v1", { y: 1, x: "5" }));
  assert.notEqual(hashOf("monadeum:policy:v1", { x: 1 }), hashOf("monadeum:plan:v1", { x: 1 }));
  assert.throws(() => canonicalJson({ x: Number.NaN }));
});
