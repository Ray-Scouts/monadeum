import { getAddress, hashDomain, hashStruct, hashTypedData, isAddress, type Hex } from "viem";
import { CanonicalizationError } from "./canonical.js";
import type { Address } from "./documents.js";

// An owner's reallocation policy (EVOLUTION.md section 3.1, item 8) is committed on-chain as its EIP-712 struct hash,
// the value contracts/src/AgentReallocation.sol recomputes in `hashPolicy` and stores per owner (ARCHITECTURE.md
// section 16.5). It is not a section 16.4 JCS hash: the contract has to recompute the commitment from the policy's
// fields, and an EIP-712 struct hash is what it can recompute. The owner's signature is over the EIP-712 digest in the
// contract's domain. This module is the one off-chain definition of that encoding; a fixed vector shared with
// contracts/test/ReallocationCommitmentVector.t.sol keeps the two sides equal.

/** Protocol bounds a policy can only tighten (EVOLUTION.md section 3.1), in the contract's units. */
export const REALLOCATION_CAP_BPS = 2_000;
export const SLOT_CEILING_BPS = 40_000;

export const REALLOCATION_DOMAIN_NAME = "Monadeum Reallocation";
export const REALLOCATION_DOMAIN_VERSION = "1";

export const REALLOCATION_POLICY_TYPES = {
  ReallocationPolicy: [
    { name: "owner", type: "address" },
    { name: "agents", type: "address[]" },
    { name: "capBps", type: "uint16" },
    { name: "slotCeilingBps", type: "uint32" },
    { name: "capitalFloor", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const REVOKE_REALLOCATION_POLICY_TYPES = {
  RevokeReallocationPolicy: [
    { name: "owner", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/**
 * The policy exactly as the owner signs it and the contract checks it. `agents` keeps the signed order, because the
 * struct hash depends on it; the set of covered agents does not. `capitalFloor` is in settlement-asset base units.
 * `nonce` is the owner's current policy nonce on the contract, consumed by every commit and revocation.
 */
export interface ReallocationPolicyV1 {
  owner: Address;
  agents: readonly Address[];
  capBps: number;
  slotCeilingBps: number;
  capitalFloor: bigint;
  nonce: bigint;
}

/** The EIP-712 domain of one deployed reallocation contract: the contract's own address on its chain. */
export interface ReallocationDomain {
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: Address;
}

export function reallocationDomain(chainId: number | bigint, verifyingContract: Address): ReallocationDomain {
  return {
    name: REALLOCATION_DOMAIN_NAME,
    version: REALLOCATION_DOMAIN_VERSION,
    chainId: BigInt(chainId),
    verifyingContract: address(verifyingContract, "$.verifyingContract"),
  };
}

function address(value: unknown, path: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) throw new CanonicalizationError(path, "expected a 20-byte address");
  return getAddress(value);
}

function uint(value: unknown, path: string, max: bigint): bigint {
  let n: bigint;
  if (typeof value === "bigint") n = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) n = BigInt(value);
  else if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) n = BigInt(value);
  else throw new CanonicalizationError(path, "expected a non-negative integer");
  if (n < 0n || n > max) throw new CanonicalizationError(path, `expected an integer from 0 to ${max}`);
  return n;
}

const UINT256_MAX = 2n ** 256n - 1n;

/**
 * Parses a stored or submitted policy record and applies the checks the contract applies at commit, except those that
 * need chain state (agent registration and status, the token-scaled protocol floor, the current nonce). It is
 * stricter than the contract in one respect: duplicate agents are refused, so "at least two agents" means two distinct
 * agents. Throws CanonicalizationError, which verification reports as an invalid record.
 */
export function parseReallocationPolicy(input: unknown): ReallocationPolicyV1 {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new CanonicalizationError("$", "expected an object");
  const p = input as Record<string, unknown>;
  const keys = ["owner", "agents", "capBps", "slotCeilingBps", "capitalFloor", "nonce"];
  for (const k of Object.keys(p)) if (!keys.includes(k)) throw new CanonicalizationError(`$.${k}`, "unknown field");
  if (!Array.isArray(p.agents)) throw new CanonicalizationError("$.agents", "expected an array");
  const agents = p.agents.map((a, i) => address(a, `$.agents[${i}]`));
  if (new Set(agents).size !== agents.length) throw new CanonicalizationError("$.agents", "duplicate agent");
  if (agents.length < 2) throw new CanonicalizationError("$.agents", "a policy names at least two agents");
  const capBps = Number(uint(p.capBps, "$.capBps", BigInt(REALLOCATION_CAP_BPS)));
  const slotCeilingBps = Number(uint(p.slotCeilingBps, "$.slotCeilingBps", BigInt(SLOT_CEILING_BPS)));
  if (capBps === 0) throw new CanonicalizationError("$.capBps", "expected at least 1");
  if (slotCeilingBps === 0) throw new CanonicalizationError("$.slotCeilingBps", "expected at least 1");
  return {
    owner: address(p.owner, "$.owner"),
    agents,
    capBps,
    slotCeilingBps,
    capitalFloor: uint(p.capitalFloor, "$.capitalFloor", UINT256_MAX),
    nonce: uint(p.nonce, "$.nonce", UINT256_MAX),
  };
}

function message(policy: ReallocationPolicyV1) {
  const p = parseReallocationPolicy(policy);
  return { ...p, agents: [...p.agents], capBps: p.capBps, slotCeilingBps: p.slotCeilingBps };
}

/** The typed data the owner's root wallet signs, for viem's `signTypedData`. */
export function reallocationPolicyTypedData(policy: ReallocationPolicyV1, domain: ReallocationDomain) {
  return { domain, types: REALLOCATION_POLICY_TYPES, primaryType: "ReallocationPolicy" as const, message: message(policy) };
}

/** The on-chain commitment: the EIP-712 struct hash, equal to `AgentReallocation.hashPolicy`. */
export function hashReallocationPolicy(policy: ReallocationPolicyV1): Hex {
  return hashStruct({ data: message(policy), primaryType: "ReallocationPolicy", types: REALLOCATION_POLICY_TYPES });
}

/** The digest the owner signs: keccak256(0x1901 || domainSeparator || structHash). */
export function reallocationPolicyDigest(policy: ReallocationPolicyV1, domain: ReallocationDomain): Hex {
  return hashTypedData(reallocationPolicyTypedData(policy, domain));
}

/** The typed data for a revocation by signature (`revokePolicyBySig`). */
export function revokeReallocationPolicyTypedData(owner: Address, nonce: bigint, domain: ReallocationDomain) {
  return {
    domain,
    types: REVOKE_REALLOCATION_POLICY_TYPES,
    primaryType: "RevokeReallocationPolicy" as const,
    message: { owner: address(owner, "$.owner"), nonce: uint(nonce, "$.nonce", UINT256_MAX) },
  };
}

/** Equal to `AgentReallocation.domainSeparator` for the same chain and contract. */
export function reallocationDomainSeparator(domain: ReallocationDomain): Hex {
  return hashDomain({
    domain,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  });
}
