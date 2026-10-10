import { Injectable } from "@nestjs/common";
import { EVALUATION_CADENCE } from "./constants.js";
import { planEvaluation, type AgentState, type EvaluationPlan } from "./plan.js";
import { NoPolicies, UnconfiguredSettlement, type PolicySource, type ReallocationSettlement } from "./ports.js";
import { evaluateRetirement, type RetirementDecision, type RetirementInput } from "./retirement.js";

export interface SettledMove {
  key: string;
  owner: string;
  source: string;
  sink: string;
  amount: number;
  ok: boolean;
  error?: string;
}

@Injectable()
export class ReallocationService {
  constructor(
    private readonly policies: PolicySource = new NoPolicies(),
    private readonly settlement: ReallocationSettlement = new UnconfiguredSettlement(),
  ) {}

  /** Plans an evaluation. Runs only on the evaluation cadence, never on every tick (EVOLUTION.md section 3.1 item 3). */
  plan(tick: number, population: readonly AgentState[]): EvaluationPlan {
    if (!Number.isInteger(tick) || tick <= 0 || tick % EVALUATION_CADENCE !== 0) throw new Error("off_cadence");
    return planEvaluation(population, this.policies.current());
  }

  retirement(input: RetirementInput): RetirementDecision {
    return evaluateRetirement(input);
  }

  /**
   * Submits every planned move, one transfer each. A failed move is recorded and not retried inside the same
   * evaluation; the next evaluation recomputes the plan from fresh state (ARCHITECTURE.md section 5).
   */
  settle(sequence: number, plan: EvaluationPlan): SettledMove[] {
    return plan.moves.map((move) => {
      const key = `${move.owner}:${sequence}:${move.source}:${move.sink}`;
      try {
        const result = this.settlement.transfer({ ...move, key, sequence });
        return { key, ...move, amount: result.amount, ok: true };
      } catch (error) {
        return { key, ...move, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }
}
