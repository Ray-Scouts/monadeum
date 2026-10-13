import { RECOVERY_DELAY_MS, RECOVERY_DISTINCT_LIMIT, RECOVERY_WINDOW_MS } from "@monadeum/recovery/decide";
import { ApiError } from "./client";
import type { HoldView, Operation, RevocationStatus, StopLocal, StopResponse } from "./types";

/**
 * What the "stop this agent" control shows (issue #44). The stop revokes the agent's session key; it is not
 * retirement, which is the evaluation's performance rule. Every state below is derived from what the API answered,
 * never assumed: "stopped" appears only once the API reports the on-chain revocation verified.
 */
export type StopView =
  | { state: "idle" }
  | { state: "requesting" }
  | { state: "unavailable"; message: string }
  | { state: "no-session"; message: string }
  | { state: "held"; hold: HoldView; message: string }
  | { state: "stopping"; local: StopLocal[]; operation: Operation; message: string }
  | { state: "stopped"; operation: Operation; message: string }
  | { state: "failed"; operation: Operation | null; message: string }
  | { state: "error"; message: string };

const minutes = (ms: number) => Math.round(ms / 60_000);

export const STOP_COPY = {
  what: "Emergency stop. Revokes this agent's session key so it can no longer sign transactions. Its balance stays in its account, which your wallet owns.",
  notRetirement:
    "This is not retirement. Retirement is the evaluation's performance rule (capital floor or repeated low windows); a stop is your decision and takes effect now.",
  confirm: "Stop this agent now? The platform destroys its session key at once. Your wallet is then asked to sign the on-chain revocation.",
};

const offChainLine = (local: StopLocal[]) =>
  local.every((l) => l.session === "revoking" || l.session === "revoked")
    ? "The session key was destroyed on the platform, so it can no longer sign through Monadeum."
    : "The platform has not confirmed that the session key was destroyed.";

export function stopViewFromOperation(local: StopLocal[], operation: Operation): StopView {
  const results = Array.isArray(operation.result) ? (operation.result as { result?: { ok?: boolean; reason?: string } }[]) : [];
  if (operation.status === "succeeded" && results.length > 0 && results.every((r) => r.result?.ok === true)) {
    return { state: "stopped", operation, message: "Stopped. The revocation is verified on chain: the permission is removed and the enable signature can no longer reinstall it." };
  }
  if (operation.status === "failed" || operation.status === "succeeded") {
    return {
      state: "failed",
      operation,
      message: `${offChainLine(local)} The on-chain step did not complete, so the key may still be installed on the account. Start the stop again to retry it.`,
    };
  }
  const next = operation.status === "awaiting-signature" ? "Sign the on-chain revocation below to finish." : "Waiting for the on-chain revocation to be included.";
  return { state: "stopping", local, operation, message: `${offChainLine(local)} ${next}` };
}

export function stopViewFromResponse(response: StopResponse): StopView {
  if (response.status === "held") {
    return {
      state: "held",
      hold: response.hold,
      message: `Held. This would make more than ${RECOVERY_DISTINCT_LIMIT} agents stopped from your owner wallet within ${minutes(RECOVERY_WINDOW_MS)} minutes, so the bulk recovery hold applies: confirm it, then it can be released after ${minutes(RECOVERY_DELAY_MS)} minutes. Nothing has been revoked yet.`,
    };
  }
  return stopViewFromOperation(response.local, response.operation);
}

export function stopViewFromError(error: unknown): StopView {
  if (error instanceof ApiError) {
    if (error.status === 503 || error.reason === "wallets-unavailable") {
      return {
        state: "unavailable",
        message:
          "This server cannot stop agents yet: it has no session key vault configured, so it cannot revoke a key. Nothing was changed by this request.",
      };
    }
    if (error.reason === "no-session") return { state: "no-session", message: "This agent has no session key, so it cannot transact. There is nothing to stop." };
    if (error.reason === "not-found") return { state: "error", message: "This agent was not found among your agents." };
    if (error.status === 401) return { state: "error", message: "Your session has ended. Sign in again, then retry." };
    return { state: "error", message: `The stop request failed (${error.reason}). Nothing is assumed to have changed; check the revocation status below.` };
  }
  return { state: "error", message: error instanceof Error ? error.message : "The stop request failed." };
}

/** The revocation status as anyone could check it against the account, in plain language. */
export function revocationFacts(status: RevocationStatus): { verdict: string; facts: string[] } {
  const s = status.state;
  return {
    verdict: status.revoked ? "Revoked on chain" : status.keyDestroyed ? "Key destroyed on the platform, not yet revoked on chain" : "Not revoked",
    facts: [
      `Permission validator installed: ${s.installed ? "yes" : "no"}`,
      `Validator nonce ${s.validatorNonce}, valid from nonce ${s.validNonceFrom}`,
      `Account nonce ${s.currentNonce}, enable signature bound to nonce ${status.enableNonce}`,
      `Session key held by the platform: ${status.keyDestroyed ? "no, destroyed" : "yes"}`,
    ],
  };
}
