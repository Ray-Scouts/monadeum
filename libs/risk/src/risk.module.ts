import { Injectable, Module } from "@nestjs/common";
import type { Hex } from "viem";
import {
  evaluateInformation,
  evaluateTrade,
  loadPolicy,
  type ActionProposal,
  type ExecutionPlan,
  type InformationRequest,
  type Ledger,
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

  information(request: InformationRequest, ledger: Ledger) {
    return evaluateInformation(this.policy, request, ledger);
  }

  trade(proposal: ActionProposal, plan: ExecutionPlan, ledger: Ledger) {
    return evaluateTrade(this.policy, proposal, plan, ledger);
  }
}

@Module({
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
