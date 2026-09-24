import { Injectable } from "@nestjs/common";
import { confirmHold, decideRecovery, releaseHold, type PriorRecovery, type RecoveryHold, type RecoveryKind, type RecoveryDecision } from "./decide.js";

@Injectable()
export class RecoveryService {
  request(input: {
    rootWalletId: string;
    agentIds: string[];
    kind: RecoveryKind;
    now: number;
    priors: readonly PriorRecovery[];
  }): RecoveryDecision {
    return decideRecovery(input);
  }

  confirm(hold: RecoveryHold, statedCount: number, now: number): RecoveryDecision {
    return confirmHold(hold, statedCount, now);
  }

  release(hold: RecoveryHold, now: number): RecoveryDecision {
    return releaseHold(hold, now);
  }
}
