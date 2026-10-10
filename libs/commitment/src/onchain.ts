import type { Hex } from "viem";
import {
  hashGenome,
  hashReallocationPolicy,
  hashStrategyVersion,
  type Address,
  type GenomeV1,
  type ReallocationPolicyV1,
  type StrategyVersionV1,
} from "./documents.js";

// Typed seams for the on-chain writes. No contract is implemented here: agent creation belongs to AgentsModule and
// the identity registry, and the policy hash is checked by the reallocation contract (issue #31).

/** Written once, in the same transaction that creates the agent (ARCHITECTURE.md section 9). */
export interface AgentCreationCommitment {
  owner: Address;
  genomeHash: Hex;
  strategyVersionHash: Hex;
}

/** What the identity registry holds for an agent. */
export interface AgentCommitmentRecord extends AgentCreationCommitment {
  agentId: bigint;
}

/**
 * Agent creation with its commitments. There is deliberately no method that writes a genome or genome hash for an
 * existing agent: genomes are fixed at creation (EVOLUTION.md section 3.1), and a write to a live agent's genome is a
 * SECURITY.md section 12 alert, not an operation.
 */
export interface AgentCommitmentWriter {
  createAgent(commitment: AgentCreationCommitment): Promise<{ agentId: bigint; txHash: Hex }>;
}

export interface AgentCommitmentReader {
  /** Null when no agent with this ID exists. */
  readAgentCommitment(agentId: bigint): Promise<AgentCommitmentRecord | null>;
}

/** Committed on every owner change to the policy, including revocation (EVOLUTION.md section 3.1, item 8). */
export interface ReallocationPolicyCommitment {
  owner: Address;
  /** Section 16.4 hash of the policy document, or null to revoke. */
  policyHash: Hex | null;
  /** The owner's root-wallet signature over the policy hash; absent on revocation. */
  signature?: Hex;
}

export interface ReallocationPolicyWriter {
  commitPolicy(commitment: ReallocationPolicyCommitment): Promise<{ txHash: Hex }>;
}

export interface ReallocationPolicyReader {
  /** Null when the owner has no policy in force. */
  readPolicyHash(owner: Address): Promise<Hex | null>;
}

/** Computes both creation-time hashes from the off-chain documents, so callers never hash by hand. */
export function buildAgentCreationCommitment(owner: Address, genome: GenomeV1, strategyVersion: StrategyVersionV1): AgentCreationCommitment {
  return { owner, genomeHash: hashGenome(genome), strategyVersionHash: hashStrategyVersion(strategyVersion) };
}

export function buildPolicyCommitment(policy: ReallocationPolicyV1, signature: Hex): ReallocationPolicyCommitment {
  return { owner: policy.owner, policyHash: hashReallocationPolicy(policy), signature };
}
