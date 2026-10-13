import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { hashGenome, hashStrategyVersion, type Address, type GenomeV1, type StrategyVersionV1 } from "./documents.js";
import { hashReallocationPolicy, type ReallocationPolicyV1 } from "./reallocation.js";
import { verifyCommitment, type VerificationResult } from "./verify.js";

// Typed seams for the on-chain writes. The agent commitment is written by the agent's own account to
// contracts/src/AgentCommitments.sol, as one call in the owner-signed operation that deploys the account
// (WalletsModule); the policy commitment is stored and checked by contracts/src/AgentReallocation.sol.

/** The two creation-time hashes of an agent (ARCHITECTURE.md section 9). */
export interface AgentCreationCommitment {
  owner: Address;
  genomeHash: Hex;
  strategyVersionHash: Hex;
}

/** What `AgentCommitments.commitmentOf(account)` returns: both hashes are the zero hash when the account has none. */
export interface OnChainAgentCommitment {
  genomeHash: Hex;
  strategyVersionHash: Hex;
}

/** The subset of contracts/src/IAgentCommitments.sol the platform calls. */
export const AGENT_COMMITMENTS_ABI = parseAbi([
  "function commit(bytes32 genomeHash, bytes32 strategyVersionHash)",
  "function commitmentOf(address account) view returns ((bytes32 genomeHash, bytes32 strategyVersionHash))",
  "event AgentCommitted(address indexed account, bytes32 genomeHash, bytes32 strategyVersionHash)",
]);

/**
 * The call an agent's account makes to commit its own hashes. It goes into the owner-signed operation that deploys the
 * account, so the commitment lands with the account or not at all. There is deliberately no call that replaces a
 * commitment: the contract is write-once (genomes are fixed at creation, EVOLUTION.md section 3.1), and a write to a
 * live agent's genome is a SECURITY.md section 12 alert, not an operation.
 */
export function agentCommitmentCall(
  registry: Address,
  commitment: Pick<AgentCreationCommitment, "genomeHash" | "strategyVersionHash">,
): { to: Address; value: bigint; data: Hex } {
  return {
    to: registry,
    value: 0n,
    data: encodeFunctionData({ abi: AGENT_COMMITMENTS_ABI, functionName: "commit", args: [commitment.genomeHash, commitment.strategyVersionHash] }),
  };
}

export interface AgentCommitmentReader {
  /** Both hashes are the zero hash when the account has committed nothing. Throws when the chain cannot be read. */
  readAgentCommitment(account: Address): Promise<OnChainAgentCommitment>;
}

/** The part of a viem public client the reader uses. */
export interface CommitmentReadClient {
  readContract(args: { address: Address; abi: typeof AGENT_COMMITMENTS_ABI; functionName: "commitmentOf"; args: readonly [Address] }): Promise<unknown>;
}

/** Reads `commitmentOf` on the deployed AgentCommitments contract. */
export function contractAgentCommitmentReader(client: CommitmentReadClient, registry: Address): AgentCommitmentReader {
  return {
    async readAgentCommitment(account) {
      const c = (await client.readContract({ address: registry, abi: AGENT_COMMITMENTS_ABI, functionName: "commitmentOf", args: [account] })) as OnChainAgentCommitment;
      return { genomeHash: c.genomeHash, strategyVersionHash: c.strategyVersionHash };
    },
  };
}

/**
 * Verifies an agent's off-chain genome record and the strategy version it runs under against the account's on-chain
 * commitment. One result per kind; each failure carries the SECURITY.md section 12 alert (`verifyCommitment`).
 */
export function verifyAgentCommitment(
  subject: string,
  records: { genome: unknown; strategyVersion: unknown },
  onChain: OnChainAgentCommitment,
): [genome: VerificationResult, strategyVersion: VerificationResult] {
  return [
    verifyCommitment("genome", subject, records.genome, onChain.genomeHash),
    verifyCommitment("strategyVersion", subject, records.strategyVersion, onChain.strategyVersionHash),
  ];
}

/** Committed on every owner change to the policy, including revocation (EVOLUTION.md section 3.1, item 8). */
export interface ReallocationPolicyCommitment {
  owner: Address;
  /** EIP-712 struct hash of the policy (ARCHITECTURE.md section 16.5), or null to revoke. */
  policyHash: Hex | null;
  /** The owner's root-wallet EIP-712 signature over the policy digest in the contract's domain; absent on revocation. */
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
