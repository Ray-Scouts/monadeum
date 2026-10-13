import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { decodeFunctionData, keccak256 } from "viem";
import {
  AGENT_COMMITMENTS_ABI,
  CanonicalizationError,
  agentCommitmentCall,
  buildAgentCreationCommitment,
  buildPolicyCommitment,
  canonicalJson,
  contractAgentCommitmentReader,
  hashCommitment,
  hashGenome,
  hashReallocationPolicy,
  hashStrategyVersion,
  normalizeGenome,
  taggedHash,
  verifyAgentCommitment,
  verifyCommitment,
  type GenomeV1,
} from "../src/index.js";
import { referenceKeccak256 } from "./keccak-reference.js";
import { GENOME, POLICY, SPEC_GENOME_CANONICAL, STRATEGY } from "./fixtures/documents.js";

// Fixed vector for the section 16.4 example genome. Computed with viem's keccak256 and with the independent reference
// implementation in keccak-reference.ts; the test below re-checks that both still agree with it.
const SPEC_GENOME_HASH = "0x2d9f122951f7536592f0abc24282c094bba5d43ee5ea4414091d1c0a3b8ce589";

const genome = (overrides: Partial<Record<keyof GenomeV1, unknown>> = {}): GenomeV1 => ({ ...GENOME, ...overrides }) as GenomeV1;

test("section 16.4 example normalizes to the exact canonical bytes the specification states", () => {
  assert.equal(canonicalJson(normalizeGenome(GENOME)), SPEC_GENOME_CANONICAL);
});

test("section 16.4 example hash is the fixed vector, recomputed by two independent keccak256 implementations", () => {
  const preimage = new Uint8Array([...new TextEncoder().encode("monadeum:genome:v1"), 0, ...new TextEncoder().encode(SPEC_GENOME_CANONICAL)]);
  assert.equal(referenceKeccak256(preimage), SPEC_GENOME_HASH);
  assert.equal(hashGenome(GENOME), SPEC_GENOME_HASH);
});

test("the reference keccak256 matches published vectors, so it is a valid cross-check", () => {
  assert.equal(referenceKeccak256(new Uint8Array()), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(referenceKeccak256(new TextEncoder().encode("abc")), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  // Crosses the 136-byte rate boundary
  const long = new TextEncoder().encode("a".repeat(200));
  assert.equal(referenceKeccak256(long), keccak256(long));
});

test("round trip: two separate process invocations produce the same hashes as this process", () => {
  const script = fileURLToPath(new URL("./fixtures/print-hashes.js", import.meta.url));
  const first = execFileSync(process.execPath, [script], { encoding: "utf8" });
  const second = execFileSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(first, second);
  assert.deepEqual(JSON.parse(first), {
    genome: hashGenome(GENOME),
    strategy: hashStrategyVersion(STRATEGY),
    policy: hashReallocationPolicy(POLICY),
  });
});

test("round trip: parsing the canonical bytes back and re-hashing gives the same hash", () => {
  assert.equal(hashGenome(JSON.parse(SPEC_GENOME_CANONICAL)), hashGenome(GENOME));
});

test("a single-field change changes the hash, for every genome field", () => {
  const base = hashGenome(GENOME);
  const changes: Partial<Record<keyof GenomeV1, unknown>>[] = [
    { assetUniverse: ["PAIR_A"] },
    { riskTolerance: 0.11 },
    { executionFrequency: 6 },
    { timeHorizon: 21 },
    { entryThreshold: 0.0021 },
    { exitThreshold: 0.001 },
    { informationSources: ["nansen"] },
    { informationBudget: "500001" },
    { modelConfiguration: "high" },
  ];
  const seen = new Set([base]);
  for (const change of changes) {
    const h = hashGenome(genome(change));
    assert.ok(!seen.has(h), `change ${JSON.stringify(change)} must produce a new hash`);
    seen.add(h);
  }
  assert.notEqual(hashStrategyVersion({ ...STRATEGY, version: "1.0.1" }), hashStrategyVersion(STRATEGY));
  assert.notEqual(hashReallocationPolicy({ ...POLICY, nonce: 1n }), hashReallocationPolicy(POLICY));
});

test("key order and set order are irrelevant; set duplicates are dropped", () => {
  const reversed = Object.fromEntries(Object.entries(GENOME).reverse());
  assert.equal(hashGenome(reversed as unknown as GenomeV1), hashGenome(GENOME));
  assert.equal(hashGenome(genome({ assetUniverse: ["PAIR_A", "PAIR_B"] })), hashGenome(genome({ assetUniverse: ["PAIR_B", "PAIR_A", "PAIR_B"] })));
});

test("numbers: ECMAScript serialization per RFC 8785, -0 is 0, non-finite and non-integer values are rejected", () => {
  // RFC 8785 appendix B and section 3.2.2.3 examples
  const cases: [number, string][] = [
    [-0, "0"],
    [1e21, "1e+21"],
    [1e-7, "1e-7"],
    [0.000001, "0.000001"],
    [333333333.33333329, "333333333.3333333"],
    [4.5, "4.5"],
    [2e-3, "0.002"],
    [1e30, "1e+30"],
    [9007199254740992, "9007199254740992"],
    [295147905179352830000, "295147905179352830000"],
    [5e-324, "5e-324"],
    [-1.7976931348623157e308, "-1.7976931348623157e+308"],
  ];
  for (const [n, expected] of cases) assert.equal(canonicalJson(n), expected);
  assert.equal(hashGenome(genome({ exitThreshold: -0 })), hashGenome(genome({ exitThreshold: 0 })));
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => canonicalJson(bad), CanonicalizationError);
    assert.throws(() => hashGenome(genome({ riskTolerance: bad })), CanonicalizationError);
  }
  assert.throws(() => hashGenome(genome({ executionFrequency: 5.5 })), CanonicalizationError);
  assert.throws(() => hashGenome(genome({ timeHorizon: 2 ** 53 })), CanonicalizationError);
});

test("base-unit amounts: bigint and canonical decimal string hash the same, floats and non-canonical strings are rejected", () => {
  assert.equal(hashGenome(genome({ informationBudget: 500000n })), hashGenome(GENOME));
  for (const bad of [500000, "0500000", "+500000", "5e5", "500000.0", "-1", "", -1n]) {
    assert.throws(() => hashGenome(genome({ informationBudget: bad })), CanonicalizationError, `rejects ${String(bad)}`);
  }
});

test("missing versus null: an absent optional field is omitted, null is always rejected", () => {
  assert.throws(() => canonicalJson({ a: null }), CanonicalizationError);
  assert.throws(() => canonicalJson([1, undefined]), CanonicalizationError);
  const { modelConfiguration: __, ...missingRequired } = GENOME;
  assert.throws(() => hashCommitment("genome", missingRequired), CanonicalizationError);
});

test("unknown fields and derived values are rejected, never silently hashed", () => {
  assert.throws(() => hashCommitment("genome", { ...GENOME, fitness: 0.4 }), CanonicalizationError);
  assert.throws(() => hashCommitment("genome", { ...GENOME, id: "row-1" }), CanonicalizationError);
  assert.throws(() => hashCommitment("genome", { ...GENOME, schemaVersion: 2 }), CanonicalizationError);
});

test("unicode: RFC 8785 key order by UTF-16 code units, minimal escaping, no normalization, lone surrogates rejected", () => {
  // RFC 8785 section 3.2.3 sorting example
  const keys = { "€": "Euro Sign", "\r": "Carriage Return", "דּ": "Hebrew Letter Dalet With Dagesh", "1": "One", "😀": "Emoji: Grinning Face", "\u0080": "Control", "ö": "Latin Small Letter O With Diaeresis" };
  assert.equal(
    canonicalJson(keys),
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
  );
  // RFC 8785 section 3.2.2.2 string example, built from code units so the source carries no escape ambiguity
  const rfcInput = String.fromCharCode(0x20ac, 0x24, 0x0f, 0x0a, 0x41, 0x27, 0x42, 0x22, 0x5c, 0x5c, 0x22, 0x2f);
  assert.equal(canonicalJson(rfcInput), String.fromCharCode(0x22, 0x20ac) + '$\\u000f\\nA\'B\\"\\\\\\\\\\"/"');
  // Precomposed and decomposed forms are different bytes and different genomes
  assert.notEqual(hashGenome(genome({ modelConfiguration: "café" })), hashGenome(genome({ modelConfiguration: "café" })));
  // Set order is UTF-16 code unit order: U+FB33 sorts after U+1F600, whose high surrogate is 0xD83D
  assert.deepEqual(normalizeGenome(genome({ assetUniverse: ["דּ", "😀", "Z", "a"] })).assetUniverse, ["Z", "a", "😀", "דּ"]);
  assert.throws(() => hashGenome(genome({ modelConfiguration: "x\ud800" })), CanonicalizationError);
  assert.throws(() => hashGenome(genome({ modelConfiguration: "\udc00x" })), CanonicalizationError);
});

test("domain tags separate kinds whose JSON is identical", () => {
  const value = { schemaVersion: 1 };
  const hashes = new Set([taggedHash("monadeum:genome:v1", value), taggedHash("monadeum:strategy:v1", value), taggedHash("monadeum:policy:v1", value), taggedHash("monadeum:plan:v1", value)]);
  assert.equal(hashes.size, 4);
});

test("verification: a matching record passes", () => {
  const result = verifyCommitment("genome", "agent-1", GENOME, hashGenome(GENOME).toUpperCase().replace("0X", "0x"));
  assert.deepEqual(result, { ok: true, kind: "genome", subject: "agent-1", hash: hashGenome(GENOME) });
});

test("verification: every failure is a typed section 12 alert", () => {
  const onChain = hashGenome(GENOME);
  const altered = verifyCommitment("genome", "agent-1", genome({ riskTolerance: 0.2 }), onChain);
  assert.equal(altered.ok, false);
  if (altered.ok) return;
  assert.equal(altered.alert.rule, "security-12-commitment-mismatch");
  assert.equal(altered.alert.severity, "critical");
  assert.equal(altered.alert.reason, "hash-mismatch");
  assert.equal(altered.alert.recomputedHash, hashGenome(genome({ riskTolerance: 0.2 })));

  const reasons = [
    verifyCommitment("genome", "agent-1", GENOME, `0x${"0".repeat(64)}`),
    verifyCommitment("genome", "agent-1", GENOME, "0x1234"),
    verifyCommitment("genome", "agent-1", { ...GENOME, extra: 1 }, onChain),
    verifyCommitment("strategyVersion", "agent-1", GENOME, onChain),
    verifyCommitment("reallocationPolicy", POLICY.owner, POLICY, onChain),
  ].map((r) => (r.ok ? "ok" : r.alert.reason));
  assert.deepEqual(reasons, ["no-on-chain-commitment", "malformed-on-chain-hash", "invalid-record", "invalid-record", "hash-mismatch"]);
});

test("creation and policy commitments carry the section 16.4 hashes", () => {
  const owner = "0x00000000000000000000000000000000000000aa";
  assert.deepEqual(buildAgentCreationCommitment(owner, GENOME, STRATEGY), {
    owner,
    genomeHash: hashGenome(GENOME),
    strategyVersionHash: hashStrategyVersion(STRATEGY),
  });
  const signature = `0x${"11".repeat(65)}` as const;
  assert.deepEqual(buildPolicyCommitment(POLICY, signature), { owner: POLICY.owner, policyHash: hashReallocationPolicy(POLICY), signature });
});

test("the agent commitment call is IAgentCommitments.commit with the two hashes, value 0", () => {
  const registry = "0x00000000000000000000000000000000000000c0";
  const commitment = { genomeHash: hashGenome(GENOME), strategyVersionHash: hashStrategyVersion(STRATEGY) };
  const call = agentCommitmentCall(registry, commitment);
  assert.equal(call.to, registry);
  assert.equal(call.value, 0n);
  // Selector of `commit(bytes32,bytes32)`, as contracts/src/IAgentCommitments.sol declares it.
  assert.equal(call.data.slice(0, 10), keccak256(new TextEncoder().encode("commit(bytes32,bytes32)")).slice(0, 10));
  const decoded = decodeFunctionData({ abi: AGENT_COMMITMENTS_ABI, data: call.data });
  assert.deepEqual(decoded.args, [commitment.genomeHash, commitment.strategyVersionHash]);
});

test("an agent's genome and strategy version verify against the account's commitment, and every gap is an alert", async () => {
  const account = "0x00000000000000000000000000000000000000a1";
  const registry = "0x00000000000000000000000000000000000000c0";
  const stored = { genomeHash: hashGenome(GENOME), strategyVersionHash: hashStrategyVersion(STRATEGY) };
  const reads: unknown[] = [];
  const reader = contractAgentCommitmentReader({ readContract: async (args) => (reads.push(args), stored) }, registry);
  const onChain = await reader.readAgentCommitment(account);
  assert.deepEqual(reads, [{ address: registry, abi: AGENT_COMMITMENTS_ABI, functionName: "commitmentOf", args: [account] }]);
  assert.deepEqual(verifyAgentCommitment("agent-1", { genome: GENOME, strategyVersion: STRATEGY }, onChain).map((r) => r.ok), [true, true]);

  const otherCode = { ...STRATEGY, codeDigest: `0x${"22".repeat(32)}` };
  const zero = `0x${"0".repeat(64)}` as const;
  const outcomes = [
    verifyAgentCommitment("agent-1", { genome: { ...GENOME, timeHorizon: GENOME.timeHorizon + 1 }, strategyVersion: STRATEGY }, onChain),
    verifyAgentCommitment("agent-1", { genome: GENOME, strategyVersion: otherCode }, onChain),
    verifyAgentCommitment("agent-1", { genome: GENOME, strategyVersion: STRATEGY }, { genomeHash: zero, strategyVersionHash: zero }),
  ].map((pair) => pair.map((r) => (r.ok ? "ok" : `${r.alert.kind}:${r.alert.reason}`)));
  assert.deepEqual(outcomes, [
    ["genome:hash-mismatch", "ok"],
    ["ok", "strategyVersion:hash-mismatch"],
    ["genome:no-on-chain-commitment", "strategyVersion:no-on-chain-commitment"],
  ]);
});
