import { Injectable } from "@nestjs/common";
import type { Move, ReallocationPolicy } from "./plan.js";

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

export interface TransferRequest extends Move {
  /** Idempotent against (owner, evaluation sequence number, source, sink), ARCHITECTURE.md section 5. */
  key: string;
  sequence: number;
}

/** Submits one move as one atomic transfer through the owner-scoped reallocation contract. */
export interface ReallocationSettlement {
  transfer(request: TransferRequest): { amount: number };
}

@Injectable()
export class UnconfiguredSettlement implements ReallocationSettlement {
  transfer(): { amount: number } {
    throw new Error("reallocation contract is not configured");
  }
}
