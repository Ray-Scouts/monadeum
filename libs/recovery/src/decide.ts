export const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
export const RECOVERY_DELAY_MS = 15 * 60 * 1000;
export const RECOVERY_DISTINCT_LIMIT = 3;

export type RecoveryKind = "revoke" | "sweep" | "rotate";

export interface PriorRecovery {
  rootWalletId: string;
  agentId: string;
  at: number;
}

export interface RecoveryHold {
  rootWalletId: string;
  agentIds: string[];
  kind: RecoveryKind;
  requestedAt: number;
  confirmedAt: number | null;
  confirmedCount: number | null;
}

export type RecoveryDecision =
  | { outcome: "execute"; agentIds: string[] }
  | { outcome: "hold"; hold: RecoveryHold }
  | { outcome: "wait"; hold: RecoveryHold; readyAt: number }
  | { outcome: "reject"; reason: string };

export interface RecoveryRequest {
  rootWalletId: string;
  agentIds: string[];
  kind: RecoveryKind;
  now: number;
  priors: readonly PriorRecovery[];
}

function distinctInWindow(request: RecoveryRequest): Set<string> {
  const seen = new Set<string>();
  const start = request.now - RECOVERY_WINDOW_MS;
  for (const prior of request.priors) {
    if (prior.rootWalletId !== request.rootWalletId) continue;
    if (prior.at < start || prior.at > request.now) continue;
    seen.add(prior.agentId);
  }
  return seen;
}

export function decideRecovery(request: RecoveryRequest): RecoveryDecision {
  const ids = [...new Set(request.agentIds)];
  if (ids.length === 0) return { outcome: "reject", reason: "no_agents" };
  const seen = distinctInWindow(request);
  const next = new Set(seen);
  for (const id of ids) next.add(id);
  const bulk = ids.length >= 2;
  const overLimit = next.size > RECOVERY_DISTINCT_LIMIT;
  if (!bulk && !overLimit) return { outcome: "execute", agentIds: ids };
  return {
    outcome: "hold",
    hold: {
      rootWalletId: request.rootWalletId,
      agentIds: ids,
      kind: request.kind,
      requestedAt: request.now,
      confirmedAt: null,
      confirmedCount: null,
    },
  };
}

export function confirmHold(hold: RecoveryHold, statedCount: number, now: number): RecoveryDecision {
  if (statedCount !== hold.agentIds.length) {
    return { outcome: "reject", reason: "count_mismatch" };
  }
  const confirmed: RecoveryHold = { ...hold, confirmedAt: now, confirmedCount: statedCount };
  return { outcome: "wait", hold: confirmed, readyAt: now + RECOVERY_DELAY_MS };
}

export function releaseHold(hold: RecoveryHold, now: number): RecoveryDecision {
  if (hold.confirmedAt === null || hold.confirmedCount !== hold.agentIds.length) {
    return { outcome: "reject", reason: "not_confirmed" };
  }
  const readyAt = hold.confirmedAt + RECOVERY_DELAY_MS;
  if (now < readyAt) return { outcome: "wait", hold, readyAt };
  return { outcome: "execute", agentIds: hold.agentIds };
}
