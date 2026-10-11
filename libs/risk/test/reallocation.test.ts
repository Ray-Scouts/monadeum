import assert from "node:assert/strict";
import { test } from "node:test";
import { hashExecutionPlan, hashRiskPolicy } from "@monadeum/commitment";
import { encodeFunctionData, parseAbi, toFunctionSelector, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  REALLOCATE_ABI,
  evaluateReallocation,
  loadPolicy,
  type ExecutionPlan,
  type PolicyDocument,
  type ReallocationLedger,
  type ReallocationProposal,
  type VerifiedPolicy,
} from "../src/index.js";

// The proposed ReallocationProposal of ARCHITECTURE.md section 16.2: one source's debit per evaluation, carried as
// approve(reallocation, total) then reallocate(evaluation, policyHash, credits), the call shape of issue #31.

const USDC: Hex = "0x00000000000000000000000000000000000000a1";
const ROUTER: Hex = "0x00000000000000000000000000000000000000b2";
const REALLOC: Hex = "0x00000000000000000000000000000000000000c3";
const OWNER: Hex = "0x0000000000000000000000000000000000000a11";
const OTHER_OWNER: Hex = "0x0000000000000000000000000000000000000b22";
const SOURCE: Hex = "0x00000000000000000000000000000000000000d1";
const SINK: Hex = "0x00000000000000000000000000000000000000d2";
const ATTACKER: Hex = "0x00000000000000000000000000000000000000ee";
const POLICY_HASH: Hex = `0x${"ab".repeat(32)}`;
const ERC20 = parseAbi(["function transfer(address to, uint256 amount)", "function approve(address spender, uint256 amount)"]);
const REALLOCATE_SELECTOR = toFunctionSelector("reallocate(uint256,bytes32,(address,uint256)[])");
const operator = privateKeyToAccount(generatePrivateKey());
const UNIT = 1_000_000n;

async function policy(overrides: Partial<PolicyDocument> = {}): Promise<VerifiedPolicy> {
  const document: PolicyDocument = {
    schemaVersion: 1, version: 1, previousHash: null, effectiveFrom: "2026-09-01T00:00:00Z", settlementAsset: USDC,
    allowedCalls: [
      { target: USDC, selector: toFunctionSelector("approve(address,uint256)"), label: "settlement-asset" },
      { target: USDC, selector: toFunctionSelector("transfer(address,uint256)"), label: "settlement-asset" },
      { target: ROUTER, selector: "0xffa5210a", label: "kuru-router" },
      { target: REALLOC, selector: REALLOCATE_SELECTOR, label: "reallocation" },
    ],
    allowedPairs: ["MON/USDC"], perActionCap: 5n * UNIT, sessionDailyCap: 20n * UNIT,
    perTickInformationCap: 100_000n, dailyInformationCap: UNIT, maxPositionFraction: 0.25, ...overrides,
  };
  const signature = await operator.signMessage({ message: { raw: hashRiskPolicy(document) } });
  const verified = await loadPolicy([{ document, signature }], operator.address, new Date("2026-10-01T00:00:00Z"));
  assert.ok(verified);
  return verified;
}

function proposal(amount = 2n * UNIT, overrides: Partial<ReallocationProposal> = {}): ReallocationProposal {
  return {
    schemaVersion: 1, moveKey: `${OWNER}:3:1`, owner: OWNER, evaluation: 3, policyHash: POLICY_HASH,
    sourceAgentId: "1", source: SOURCE, credits: [{ sinkAgentId: "2", sink: SINK, amount }], total: amount, ...overrides,
  };
}

function planFor(p: ReallocationProposal, tweak: { spender?: Hex; approved?: bigint; target?: Hex } = {}): ExecutionPlan {
  const calls = [
    { target: USDC, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [tweak.spender ?? REALLOC, tweak.approved ?? p.total] }) },
    {
      target: tweak.target ?? REALLOC,
      data: encodeFunctionData({
        abi: REALLOCATE_ABI, functionName: "reallocate",
        args: [BigInt(p.evaluation), p.policyHash, p.credits.map((c) => ({ sink: c.sink, amount: c.amount }))],
      }),
    },
  ];
  return { tickKey: p.moveKey, calls, planHash: hashExecutionPlan({ tickKey: p.moveKey, calls }) };
}

function ledger(overrides: Partial<ReallocationLedger> = {}): ReallocationLedger {
  return {
    spentInWindow: 0n, decimals: 6,
    source: { agentId: "1", account: SOURCE, owner: OWNER, status: "active", capital: 10n * UNIT, principal: 10n * UNIT },
    sinks: [{ agentId: "2", account: SINK, owner: OWNER, status: "active", capital: 10n * UNIT, principal: 10n * UNIT }],
    ownerPolicy: { hash: POLICY_HASH, agents: ["1", "2"] },
    ...overrides,
  };
}

const violations = (d: ReturnType<typeof evaluateReallocation>) => (d.approved ? [] : [...d.violations].sort());

test("the reallocate selector is the one the contract exposes", () => {
  assert.equal(REALLOCATE_SELECTOR, "0x4c329bba");
});

test("a debit within the bounds, encoded exactly, is approved and bound to its plan hash", async () => {
  const p = proposal();
  const plan = planFor(p);
  const d = evaluateReallocation(await policy(), p, plan, ledger());
  assert.equal(d.approved, true);
  assert.equal(d.approved && d.planHash, plan.planHash);
});

test("the cap, the floor, and the sink ceiling are enforced, and a policy can only tighten them", async () => {
  const v = await policy();
  // 20 percent of 10 units is the cap: 2 units pass, one base unit more does not.
  assert.deepEqual(violations(evaluateReallocation(v, proposal(2n * UNIT + 1n), planFor(proposal(2n * UNIT + 1n)), ledger())), ["reallocation-bound"]);
  // Floor: a source at 0.07 units may give 0.01 but not 0.0101.
  const poor = ledger({ source: { ...ledger().source, capital: 70_000n } });
  assert.equal(evaluateReallocation(v, proposal(10_000n), planFor(proposal(10_000n)), poor).approved, true);
  assert.deepEqual(violations(evaluateReallocation(v, proposal(10_001n), planFor(proposal(10_001n)), poor)), ["reallocation-bound"]);
  // Ceiling: a sink at 4x its principal takes nothing.
  const full = ledger({ sinks: [{ ...ledger().sinks[0]!, capital: 40n * UNIT }] });
  assert.deepEqual(violations(evaluateReallocation(v, proposal(1n), planFor(proposal(1n)), full)), ["reallocation-bound"]);
  // An owner cap of 0.1 tightens; an owner cap of 0.5 does not loosen past the protocol 0.2.
  const tight = ledger({ ownerPolicy: { hash: POLICY_HASH, agents: ["1", "2"], reallocationCap: 0.1 } });
  assert.deepEqual(violations(evaluateReallocation(v, proposal(), planFor(proposal()), tight)), ["reallocation-bound"]);
  const loose = ledger({ ownerPolicy: { hash: POLICY_HASH, agents: ["1", "2"], reallocationCap: 0.5 } });
  assert.deepEqual(violations(evaluateReallocation(v, proposal(3n * UNIT), planFor(proposal(3n * UNIT)), loose)), ["reallocation-bound"]);
});

test("a sink of another owner, a retired party, or the source as its own sink is a party violation", async () => {
  const v = await policy();
  const foreign = ledger({ sinks: [{ ...ledger().sinks[0]!, owner: OTHER_OWNER }] });
  assert.deepEqual(violations(evaluateReallocation(v, proposal(), planFor(proposal()), foreign)), ["reallocation-party"]);
  const retired = ledger({ sinks: [{ ...ledger().sinks[0]!, status: "retired" }] });
  assert.deepEqual(violations(evaluateReallocation(v, proposal(), planFor(proposal()), retired)), ["reallocation-party"]);
  const self = proposal(UNIT, { credits: [{ sinkAgentId: "1", sink: SOURCE, amount: UNIT }] });
  assert.ok(violations(evaluateReallocation(v, self, planFor(self), ledger())).includes("reallocation-party"));
});

test("no committed policy, a different policy hash, or an agent the policy does not name moves nothing", async () => {
  const v = await policy();
  assert.deepEqual(violations(evaluateReallocation(v, proposal(), planFor(proposal()), ledger({ ownerPolicy: null }))), ["reallocation-policy"]);
  const stale = ledger({ ownerPolicy: { hash: `0x${"cd".repeat(32)}`, agents: ["1", "2"] } });
  assert.deepEqual(violations(evaluateReallocation(v, proposal(), planFor(proposal()), stale)), ["reallocation-policy"]);
  const narrow = ledger({ ownerPolicy: { hash: POLICY_HASH, agents: ["1", "3"] } });
  assert.deepEqual(violations(evaluateReallocation(v, proposal(), planFor(proposal()), narrow)), ["reallocation-policy"]);
});

test("a plan that does not encode the proposal, or approves an attacker, is rejected", async () => {
  const v = await policy();
  const p = proposal();
  assert.ok(violations(evaluateReallocation(v, p, planFor(p, { approved: p.total + 1n }), ledger())).includes("plan-hash-mismatch"));
  const drained = violations(evaluateReallocation(v, p, planFor(p, { spender: ATTACKER }), ledger()));
  assert.ok(drained.includes("recipient-not-allowed") && drained.includes("plan-hash-mismatch"));
  const offList = violations(evaluateReallocation(v, p, planFor(p, { target: ATTACKER }), ledger()));
  assert.ok(offList.includes("call-not-allowed"));
  const otherCredits = proposal(UNIT);
  assert.ok(violations(evaluateReallocation(v, otherCredits, planFor(p), ledger())).includes("plan-hash-mismatch"));
  const sumMismatch = proposal(UNIT, { total: 2n * UNIT });
  assert.ok(violations(evaluateReallocation(v, sumMismatch, planFor(sumMismatch), ledger())).includes("reallocation-bound"));
});

test("the approve counts against the per-action and session caps, and a missing allowlist entry fails closed", async () => {
  const capped = await policy({ perActionCap: UNIT });
  assert.deepEqual(violations(evaluateReallocation(capped, proposal(), planFor(proposal()), ledger())), ["per-action-cap"]);
  const v = await policy();
  assert.deepEqual(violations(evaluateReallocation(v, proposal(), planFor(proposal()), ledger({ spentInWindow: 19n * UNIT }))), ["session-daily-cap"]);
  const noContract = await policy({
    allowedCalls: [{ target: USDC, selector: toFunctionSelector("approve(address,uint256)"), label: "settlement-asset" }],
  });
  const d = violations(evaluateReallocation(noContract, proposal(), planFor(proposal()), ledger()));
  assert.ok(d.includes("call-not-allowed"));
  assert.deepEqual(violations(evaluateReallocation(null, proposal(), planFor(proposal()), ledger())), ["policy-unverified"]);
});
