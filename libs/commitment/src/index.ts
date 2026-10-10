export { CanonicalizationError, canonicalJson, canonicalSet, taggedHash } from "./canonical.js";
export type { CommitmentTag } from "./canonical.js";
export {
  TAGS,
  hashCommitment,
  hashGenome,
  hashReallocationPolicy,
  hashStrategyVersion,
  normalize,
  normalizeGenome,
  normalizeReallocationPolicy,
  normalizeStrategyVersion,
} from "./documents.js";
export type { Address, BaseUnits, CommitmentKind, GenomeV1, ReallocationPolicyV1, StrategyVersionV1 } from "./documents.js";
export { verifyCommitment } from "./verify.js";
export type { CommitmentAlert, MismatchReason, VerificationResult } from "./verify.js";
export { buildAgentCreationCommitment, buildPolicyCommitment } from "./onchain.js";
export type {
  AgentCommitmentReader,
  AgentCommitmentRecord,
  AgentCommitmentWriter,
  AgentCreationCommitment,
  ReallocationPolicyCommitment,
  ReallocationPolicyReader,
  ReallocationPolicyWriter,
} from "./onchain.js";
