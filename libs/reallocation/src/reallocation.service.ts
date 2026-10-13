import { Injectable } from "@nestjs/common";
import { EVALUATION_CADENCE } from "./constants.js";
import { groupDebits } from "./debits.js";
import { evaluationOutcomes } from "./outcomes.js";
import { planEvaluation, type AgentState, type EvaluationPlan } from "./plan.js";
import { NoPolicies, UnconfiguredSettlement, type PolicySource, type ReallocationSettlement, type SourceDebit } from "./ports.js";
import { evaluateRetirement, type RetirementDecision, type RetirementInput } from "./retirement.js";

/** What happened to one source's debit at one evaluation. */
export interface SettledDebit extends SourceDebit {
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

  /**
   * What `plan` did to each agent of `population`, under the same policies: off and why, unranked, sent, received, or
   * held with the binding reason, with the agent's rank in its owner's pool (`evaluationOutcomes`). `moved` names the
   * agents whose debits or credits were actually submitted, when the caller dropped some of the plan's moves.
   */
  outcomes(population: readonly AgentState[], plan: EvaluationPlan, moved?: { sent: ReadonlySet<string>; received: ReadonlySet<string> }) {
    return evaluationOutcomes(population, this.policies.current(), plan, moved);
  }

  retirement(input: RetirementInput): RetirementDecision {
    return evaluateRetirement(input);
  }

  /**
   * Submits every planned move, grouped into one debit per source, in base units rounded down (`groupDebits`). A failed
   * debit is recorded and not retried inside the same evaluation; the next evaluation recomputes the plan from fresh
   * state (ARCHITECTURE.md section 5).
   */
  async settle(sequence: number, plan: EvaluationPlan, decimals: number): Promise<SettledDebit[]> {
    const settled: SettledDebit[] = [];
    for (const debit of groupDebits(sequence, plan, decimals)) {
      try {
        await this.settlement.debit(debit);
        settled.push({ ...debit, ok: true });
      } catch (error) {
        settled.push({ ...debit, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return settled;
  }
}
