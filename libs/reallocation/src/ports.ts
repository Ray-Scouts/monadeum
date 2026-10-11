import { Injectable } from "@nestjs/common";
import type { ReallocationPolicy } from "./plan.js";

/**
 * Where the owners' policies in force come from. An implementation returns only policies whose owner signature has
 * been verified against the hash committed on-chain (ARCHITECTURE.md section 9); the planner checks everything else.
 */
export interface PolicySource {
  current(): readonly ReallocationPolicy[];
}

/** No policy for anyone: reallocation is off by default (EVOLUTION.md section 3.1 item 8). */
@Injectable()
export class NoPolicies implements PolicySource {
  current(): readonly ReallocationPolicy[] {
    return [];
  }
}

/** In-memory policies, one per owner. A revocation takes effect at the next evaluation that reads `current()`. */
export class MemoryPolicyStore implements PolicySource {
  private readonly policies = new Map<string, ReallocationPolicy>();

  set(policy: ReallocationPolicy): void {
    this.policies.set(policy.owner, { ...policy, agents: [...policy.agents] });
  }

  revoke(owner: string): void {
    const policy = this.policies.get(owner);
    if (policy) this.policies.set(owner, { ...policy, revoked: true });
  }

  current(): readonly ReallocationPolicy[] {
    return [...this.policies.values()];
  }
}

/**
 * One source's debit at one evaluation: every credit the plan gives that source's sinks, in settlement-asset base
 * units rounded down. The reallocation contract (contracts/src/AgentReallocation.sol) accepts exactly one `reallocate` call per source per
 * evaluation, so a source's moves are submitted together as one atomic operation, never one per (source, sink) pair.
 */
export interface SourceDebit {
  /** `${owner}:${sequence}:${source}`, the idempotency key of the debit (ARCHITECTURE.md section 5). */
  key: string;
  owner: string;
  /** Evaluation sequence number. */
  sequence: number;
  source: string;
  credits: { sink: string; amount: bigint }[];
  /** Sum of the credits. */
  total: bigint;
}

/** Submits one source's debit as one atomic operation through the owner-scoped reallocation contract. */
export interface ReallocationSettlement {
  debit(request: SourceDebit): Promise<void>;
}

/** Fail-closed default until the reallocation contract (contracts/src/AgentReallocation.sol) is deployed and wired in: nothing is submitted. */
@Injectable()
export class UnconfiguredSettlement implements ReallocationSettlement {
  async debit(): Promise<void> {
    throw new Error("reallocation contract is not configured");
  }
}
