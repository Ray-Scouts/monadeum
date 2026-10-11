import { REALLOCATION_OFF_REASON } from "@monadeum/reallocation/switch";
import { formatUnits } from "viem";
import type { WebConfig } from "../config";
import type { ApiAgent, OwnerResponse } from "./types";

type Settlement = WebConfig["settlement"];

/** A base-unit amount from the API in the configured settlement asset. The symbol is configuration, never assumed. */
export function amount(baseUnits: string, settlement: Settlement): string {
  if (!/^\d+$/.test(baseUnits)) return baseUnits;
  const value = formatUnits(BigInt(baseUnits), settlement.decimals);
  return settlement.symbol ? `${value} ${settlement.symbol}` : `${value} (settlement asset units)`;
}

export const DEPLOYMENT_LABEL: Record<ApiAgent["deployment"], string> = {
  "not-started": "Account not deployed",
  pending: "Deployment pending",
  deployed: "Account deployed",
};

export function sessionLabel(session: ApiAgent["session"]): { text: string; tone: "accent" | "warn" | "off" } {
  if (!session) return { text: "No session key", tone: "off" };
  if (session.status === "active") return { text: "Session key active", tone: "accent" };
  if (session.status === "revoking") return { text: "Stopping: key destroyed, on-chain revocation pending", tone: "warn" };
  return { text: "Stopped: session key revoked", tone: "off" };
}

const NO_RETURN_CLAIM = "Nothing on this page implies that reallocation or selection produces returns.";

/**
 * Plain statement of the product state after the genome-edge study, shown wherever reallocation appears while it is off.
 * The reason is the one the API and the worker use (`@monadeum/reallocation/switch`), so the copy cannot drift from it.
 */
export const REALLOCATION_OFF = `${REALLOCATION_OFF_REASON} ${NO_RETURN_CLAIM}`;

/** Shown instead while a deployment has reallocation on. It states the mechanism's limits, never a return. */
export const REALLOCATION_ON = `Reallocation is on for this deployment. It moves capital only between your own agents that a policy you signed names, within the protocol bounds. ${NO_RETURN_CLAIM}`;

/** On only when the API says so. A missing or malformed answer reads as off: the web never claims more than the API reports. */
export function reallocationEnabled(owner: OwnerResponse | null | undefined): boolean {
  return owner?.reallocation?.enabled === true;
}

/** The note for the deployment's switch: the API's reason when it is off, falling back to the shared one. */
export function reallocationNote(owner: OwnerResponse | null | undefined): string {
  if (reallocationEnabled(owner)) return REALLOCATION_ON;
  const reason = owner?.reallocation?.reason;
  return reason ? `${reason} ${NO_RETURN_CLAIM}` : REALLOCATION_OFF;
}

export interface Explainer {
  headline: string;
  lines: string[];
}

/**
 * What the reallocation and retirement mechanism did to this agent, from what the API serves today (issue #43). The
 * API does not serve evaluation outcomes yet, so this never claims a rank, a move, or a held reason it cannot see.
 * While the deployment's reallocation switch is off, every agent reads as off, whatever policy was recorded, and no
 * policy step is suggested.
 */
export function explainAgent(agent: ApiAgent, owner: OwnerResponse | null): Explainer {
  const lines: string[] = [];
  if (agent.retirement) {
    return {
      headline: "Retired",
      lines: [`Retired at evaluation ${agent.retirement.evaluation} under the ${agent.retirement.rule} rule. Its capital stayed in its account.`],
    };
  }
  const policy = owner?.policy ?? null;
  let headline: string;
  if (!reallocationEnabled(owner)) {
    headline = "Reallocation is off";
    lines.push("Reallocation is off for every agent on this deployment, so capital never moves into or out of this agent through reallocation.");
    if (policy) lines.push(`The policy you signed earlier (sequence ${policy.sequence}) has no effect while reallocation is off.`);
  } else if (!policy) {
    headline = "Reallocation is off for you";
    lines.push("You have not signed a reallocation policy, so capital never moves into or out of this agent through reallocation.");
  } else if (!policy.agentIds.includes(agent.id)) {
    // The API records a policy's agents by agent ID (`document.agentIds`), not by identity registry ID.
    headline = "Not covered by your policy";
    lines.push("Your signed policy does not name this agent, so reallocation never moves its capital.");
  } else {
    headline = "Covered by your policy";
    lines.push(
      `Your signed policy (sequence ${policy.sequence}) names this agent. Reallocations are not indexed yet, so this page cannot show whether capital moved at the last evaluation.`,
      "Where a policy is in force, reallocation can take an agent below its own principal while your total across your agents stays the same.",
    );
  }
  lines.push(
    agent.fitnessPercentile === null
      ? "Not ranked here: the API does not serve evaluation results yet, so there is no rank, starvation count, or distance to the capital floor to show."
      : `Fitness percentile in its niche: ${agent.fitnessPercentile}.`,
  );
  return { headline, lines };
}
