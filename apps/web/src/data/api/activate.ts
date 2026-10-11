import type { WebConfig } from "../config";
import { ApiError } from "./client";
import { amount } from "./present";
import type { ActivateResult, ApiAgent, Operation, SessionView } from "./types";

/**
 * "Activate this agent": the owner approves the agent's session key. Every state below comes from what the API
 * answered; "active" appears only once the API reports the key issued and the chain's permission state accepting it.
 */
export type ActivateView =
  | { state: "idle" }
  | { state: "requesting" }
  | { state: "signing"; operation: Operation }
  | { state: "active"; session: SessionView | null; message: string }
  | { state: "failed"; message: string }
  | { state: "unavailable"; message: string }
  | { state: "error"; message: string };

type Settlement = WebConfig["settlement"];

export const ACTIVATE_COPY = {
  what: "Activating gives this agent a session key: a key the platform holds so the agent can act from its own account without asking you each time. Your wallet signs one approval. It sends no transaction and costs no gas.",
  again: "This agent was stopped, so its previous key is revoked for good. Activating again issues a new key under the same rules.",
  can: (agent: ApiAgent, settlement: Settlement) => [
    "Make only the calls on the account's allowlist: trades through the configured exchange router, approvals and transfers of the settlement asset to those allowlisted contracts, and moves between your own agents through the reallocation contract.",
    `Spend at most ${amount(agent.limits.perTxCap, settlement)} per transaction and ${amount(agent.limits.dailyCap, settlement)} per rolling day. The account's spend policy enforces these caps on chain, not the platform.`,
  ],
  cannot: [
    "Send funds to an address of its choosing: a transfer or approval must name an allowlisted contract, and the account's policy checks that on chain.",
    "Change its own limits or allowlist, or take control of the account. Only your wallet can.",
    "Sign messages on the account's behalf, so it cannot authorize a token permit.",
  ],
  limit:
    "One limit of these guarantees: whether the exchange router can be made to forward funds to another address is a property of the router that has not been checked yet.",
  stop: "You can revoke the key at any time with \"Stop this agent\". Your balance stays in the agent's account, which your wallet owns.",
  testnet:
    "Activating does not make the agent trade yet. In this release the worker has no tick runner or market configured (on testnet included), and an unfunded agent is not ticked, so the agent stays idle after activation.",
};

/** What the chain says about the key, in plain language. */
export function sessionFacts(session: SessionView): { verdict: string; facts: string[] } {
  const s = session.state;
  return {
    verdict: session.acceptedOnChain
      ? s.installed
        ? "Accepted on chain: the permission is installed on the account."
        : "Accepted on chain: the account will install the permission with the agent's first operation."
      : "Not accepted on chain: the account would refuse an operation signed by this key.",
    facts: [
      `Session key ${session.keyAddress}`,
      `Permission validator installed: ${s.installed ? "yes" : "not yet"}`,
      `Account nonce ${s.currentNonce}, approval bound to nonce ${session.enableNonce}, valid from nonce ${s.validNonceFrom}`,
      `Key held by the platform: ${session.keyHeld ? "yes" : "no"}`,
    ],
  };
}

export function activateViewFromOperation(operation: Operation): ActivateView {
  if (operation.status === "awaiting-signature" || operation.status === "running") return { state: "signing", operation };
  if (operation.status === "failed") {
    return { state: "failed", message: `Activation did not complete (${operation.error ?? "unknown"}). No key was kept. You can start it again.` };
  }
  const r = operation.result as ActivateResult | null;
  if (!r?.result) return { state: "failed", message: "The API reported no activation result. Nothing is assumed; reload the page to check." };
  if (!r.result.ok) {
    return { state: "failed", message: `Activation was refused (${r.result.reason}${r.result.detail ? `: ${r.result.detail}` : ""}). No key was kept. You can start it again.` };
  }
  if (r.session && !r.session.acceptedOnChain) {
    return { state: "failed", message: "A key was issued, but the chain does not accept it. Stop this agent to destroy it, then activate again." };
  }
  return { state: "active", session: r.session, message: r.result.issued ? "Activated. The session key is issued and the chain accepts it." : "This agent already had an active session key." };
}

export function activateViewFromError(error: unknown): ActivateView {
  if (error instanceof ApiError) {
    if (error.status === 503 || error.reason === "wallets-unavailable") {
      return { state: "unavailable", message: "This server cannot issue session keys: it has no chain or session key vault configured. Nothing was changed." };
    }
    if (error.reason === "already-active") return { state: "active", session: null, message: "This agent already has an active session key." };
    if (error.reason === "not-deployed") return { state: "error", message: "The agent's account is not deployed yet. Deploy it first." };
    if (error.reason === "revocation-pending") return { state: "error", message: "The previous key's revocation is not verified on chain yet. Finish the stop first." };
    if (error.reason === "agent-retired") return { state: "error", message: "This agent is retired, so it is not given a new session key." };
    if (error.reason === "not-found") return { state: "error", message: "This agent was not found among your agents." };
    if (error.status === 401) return { state: "error", message: "Your session has ended. Sign in again, then retry." };
    return { state: "error", message: `The activation request failed (${error.reason}). Nothing is assumed to have changed.` };
  }
  return { state: "error", message: error instanceof Error ? error.message : "The activation request failed." };
}
