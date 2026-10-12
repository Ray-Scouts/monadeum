import { Injectable, Module } from "@nestjs/common";
import type { Hex } from "viem";
import {
  evaluateInformation,
  evaluateReallocation,
  evaluateTrade,
  loadPolicy,
  type ActionProposal,
  type ExecutionPlan,
  type InformationRequest,
  type Ledger,
  type ReallocationLedger,
  type ReallocationProposal,
  type SignedPolicy,
  type VerifiedPolicy,
} from "./policy.js";

@Injectable()
export class RiskService {
  private policy: VerifiedPolicy | null = null;

  async load(rows: readonly SignedPolicy[], signer: Hex, now = new Date()): Promise<boolean> {
    this.policy = await loadPolicy(rows, signer, now);
    return this.policy !== null;
  }

  /** The policy the last `load` verified and found in effect, or null, in which case every request is rejected. */
  active(): VerifiedPolicy | null {
    return this.policy;
  }

  information(request: InformationRequest, ledger: Ledger) {
    return evaluateInformation(this.policy, request, ledger);
  }

  trade(proposal: ActionProposal, plan: ExecutionPlan, ledger: Ledger) {
    return evaluateTrade(this.policy, proposal, plan, ledger);
  }

  reallocation(proposal: ReallocationProposal, plan: ExecutionPlan, ledger: ReallocationLedger) {
    return evaluateReallocation(this.policy, proposal, plan, ledger);
  }
}

@Module({
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
