import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CanonicalizationError,
  buildPolicyCommitment,
  hashCommitment,
  hashReallocationPolicy,
  parseReallocationPolicy,
  reallocationDomain,
  reallocationDomainSeparator,
  reallocationPolicyDigest,
  reallocationPolicyTypedData,
  revokeReallocationPolicyTypedData,
  verifyCommitment,
} from "../src/index.js";
import { hashStruct } from "viem";
import { REVOKE_REALLOCATION_POLICY_TYPES } from "../src/index.js";
import { POLICY } from "./fixtures/documents.js";

// Cross-implementation vector, ARCHITECTURE.md section 16.5. contracts/test/ReallocationCommitmentVector.t.sol computes
// the same values with the deployed AgentReallocation at CONTRACT on chain CHAIN_ID, and accepts SIGNATURE, which this
// file produced with viem's signTypedData. A change to the encoding on either side fails a test on both sides.
const CHAIN_ID = 10143;
const CONTRACT = "0x000000000000000000000000000000000000A110";
const OWNER_KEY = "0x00000000000000000000000000000000000000000000000000000000000a11ce";
const STRUCT_HASH = "0x1153cf2b0ec916128544d8b04edbb9f2cc616d0e030a2552333efe22ad9bc200";
const DOMAIN_SEPARATOR = "0x700a4ac718cc5571341cc5e413d29a96a8d6de0367c35fd803c51bd5dd931406";
const DIGEST = "0x2cde780a0465cf73e37442db86402816f9f342c7208a5427bf61c58d52fa2b24";
const REVOKE_STRUCT_HASH = "0xdfdaa732c7b796071e007ffed1e1b721153bdfc9e184847fd8508144154416c8"; // owner, nonce 1
const SIGNATURE = "0xf638c40d40a36177d288ae56dc186d53930c554c52c8463284a790fb2a10f2f4648ddaca6f58d3d1eecd6dcbfc7e14faf8dbd5ee88aeebba081c4ab1e51b100c1b";

const domain = reallocationDomain(CHAIN_ID, CONTRACT);
const owner = privateKeyToAccount(OWNER_KEY);

test("the vector: struct hash, domain separator, and digest equal the contract's", () => {
  assert.equal(owner.address, POLICY.owner);
  assert.equal(hashReallocationPolicy(POLICY), STRUCT_HASH);
  assert.equal(reallocationDomainSeparator(domain), DOMAIN_SEPARATOR);
  assert.equal(reallocationPolicyDigest(POLICY, domain), DIGEST);
  const revoke = revokeReallocationPolicyTypedData(POLICY.owner, 1n, domain);
  assert.equal(hashStruct({ data: revoke.message, primaryType: revoke.primaryType, types: REVOKE_REALLOCATION_POLICY_TYPES }), REVOKE_STRUCT_HASH);
});

test("the vector: the owner's signTypedData signature is the one the contract accepts", async () => {
  const signature = await owner.signTypedData(reallocationPolicyTypedData(POLICY, domain));
  assert.equal(signature, SIGNATURE);
  assert.equal(await recoverTypedDataAddress({ ...reallocationPolicyTypedData(POLICY, domain), signature }), POLICY.owner);
});

test("the commitment is the struct hash; verification uses it, not a section 16.4 hash", () => {
  assert.equal(hashCommitment("reallocationPolicy", POLICY), STRUCT_HASH);
  const stored = { ...POLICY, capitalFloor: "60000", nonce: "0" }; // as a JSON record keeps it
  assert.deepEqual(verifyCommitment("reallocationPolicy", POLICY.owner, stored, STRUCT_HASH), {
    ok: true,
    kind: "reallocationPolicy",
    subject: POLICY.owner,
    hash: STRUCT_HASH,
  });
  const result = verifyCommitment("reallocationPolicy", POLICY.owner, { ...POLICY, capBps: 1_400 }, STRUCT_HASH);
  assert.ok(!result.ok && result.alert.reason === "hash-mismatch");
  assert.deepEqual(buildPolicyCommitment(POLICY, SIGNATURE), { owner: POLICY.owner, policyHash: STRUCT_HASH, signature: SIGNATURE });
});

test("address case does not change the commitment; agent order does, as in the contract", () => {
  const lower = { ...POLICY, owner: POLICY.owner.toLowerCase() as `0x${string}` };
  assert.equal(hashReallocationPolicy(lower), STRUCT_HASH);
  assert.notEqual(hashReallocationPolicy({ ...POLICY, agents: [...POLICY.agents].reverse() }), STRUCT_HASH);
});

test("records the contract would refuse, or that are malformed, are invalid", () => {
  const bad: unknown[] = [
    { ...POLICY, capBps: 2_001 },
    { ...POLICY, capBps: 0 },
    { ...POLICY, slotCeilingBps: 40_001 },
    { ...POLICY, slotCeilingBps: 0 },
    { ...POLICY, agents: [POLICY.agents[0]] },
    { ...POLICY, agents: [POLICY.agents[0], POLICY.agents[0]] },
    { ...POLICY, agents: ["0x1234", POLICY.agents[1]] },
    { ...POLICY, owner: "0x1234" },
    { ...POLICY, capitalFloor: -1n },
    { ...POLICY, capitalFloor: "060000" },
    { ...POLICY, nonce: 1.5 },
    { ...POLICY, extra: 1 },
    null,
  ];
  for (const record of bad) assert.throws(() => parseReallocationPolicy(record), CanonicalizationError, JSON.stringify(record, (_, v) => (typeof v === "bigint" ? `${v}` : v)));
  const result = verifyCommitment("reallocationPolicy", POLICY.owner, { ...POLICY, capBps: 2_001 }, STRUCT_HASH);
  assert.ok(!result.ok && result.alert.reason === "invalid-record");
});
