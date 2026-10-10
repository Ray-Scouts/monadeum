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

/** Plain statement of the product state after the genome-edge study. Shown wherever reallocation appears. */
export const REALLOCATION_OFF =
  "Reallocation is off by default. A pre-registered study on on-chain market data found that, for the current strategy, selecting between agents adds nothing measurable, so the product runs each agent on its own capital and keeps reallocation off. Nothing on this page implies that reallocation or selection produces returns.";

export interface Explainer {
  headline: string;
  lines: string[];
}

/**
 * What the reallocation and retirement mechanism did to this agent, from what the API serves today (issue #43). The
 * API does not serve evaluation outcomes yet, so this never claims a rank, a move, or a held reason it cannot see.
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
  if (!policy) {
    headline = "Reallocation is off for you";
    lines.push("You have not signed a reallocation policy, so capital never moves into or out of this agent through reallocation.");
  } else if (agent.registryId === null || !policy.agentIds.includes(agent.registryId)) {
    headline = "Not covered by your policy";
    lines.push(
      agent.registryId === null
        ? "This agent has no identity registry ID yet, so no policy can name it, and reallocation never moves its capital."
        : "Your signed policy does not name this agent, so reallocation never moves its capital.",
    );
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
