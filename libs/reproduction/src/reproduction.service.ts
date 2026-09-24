import { Injectable } from "@nestjs/common";
import { allocateCapital, type Allocation, type AllocationInput } from "./allocate.js";
import { UnconfiguredSettlement, type ReproductionSettlement } from "./settlement.js";

export interface Eligibility {
  eligible: boolean;
  failed: string[];
}

@Injectable()
export class ReproductionService {
  constructor(private readonly settlement: ReproductionSettlement = new UnconfiguredSettlement()) {}

  allocate(input: AllocationInput): Allocation {
    return allocateCapital(input);
  }

  settle(input: {
    tick: number;
    evalEvery: number;
    eligibility: Eligibility;
    allocation: Allocation;
    parentId: string;
    childId: string;
  }): { moved: boolean; amount: number } {
    if (input.tick % input.evalEvery !== 0) throw new Error("off_cadence");
    if (!input.eligibility.eligible || input.allocation.childCapital <= 0) return { moved: false, amount: 0 };
    const result = this.settlement.transfer({
      parentId: input.parentId,
      childId: input.childId,
      amount: input.allocation.childCapital,
    });
    return { moved: true, amount: result.amount };
  }
}
