export interface AllocationInput {
  capital: number;
  principal: number;
  fraction: number;
  maxChildCapital: number;
}

export interface Allocation {
  childCapital: number;
  parentCapitalAfter: number;
}

export const PROTOCOL_GENOME_FIELDS = ["k", "nMin", "pMut", "reproductionFraction"] as const;

export function allocateCapital(input: AllocationInput): Allocation {
  const profit = Math.max(0, input.capital - input.principal);
  let childCapital = Math.min(input.fraction * profit, input.maxChildCapital);
  if (input.capital - childCapital < input.principal) {
    childCapital = Math.max(0, input.capital - input.principal);
  }
  return { childCapital, parentCapitalAfter: input.capital - childCapital };
}

export function assertGenomeHasNoProtocolFields(genome: object): void {
  for (const field of PROTOCOL_GENOME_FIELDS) {
    if (field in genome) throw new Error(`protocol field leaked into genome: ${field}`);
  }
}
