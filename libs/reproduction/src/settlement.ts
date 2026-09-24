export interface SettlementRequest {
  parentId: string;
  childId: string;
  amount: number;
}

export interface ReproductionSettlement {
  transfer(request: SettlementRequest): { amount: number };
}

import { Injectable } from "@nestjs/common";

@Injectable()
export class UnconfiguredSettlement implements ReproductionSettlement {
  transfer(): { amount: number } {
    throw new Error("reproduction contract is not configured");
  }
}
