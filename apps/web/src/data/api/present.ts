import { REALLOCATION_OFF_REASON } from "@monadeum/reallocation/switch";
import { formatUnits } from "viem";
import type { WebConfig } from "../config";
import type { ApiAgent, OwnerResponse, PopulationResponse } from "./types";

type Settlement = WebConfig["settlement"];

/** A base-unit amount from the API in the configured settlement asset. The symbol is configuration, never assumed. */
export function amount(baseUnits: string, settlement: Settlement): string {
  if (!/^\d+$/.test(baseUnits)) return baseUnits;
  const value = formatUnits(BigInt(baseUnits), settlement.decimals);
  return settlement.symbol ? `${value} ${settlement.symbol}` : `${value} (settlement asset units)`;
}

const isBase = (v: string) => /^\d+$/.test(v);

/** `part / total` of two base-unit amounts, 0 to 1, computed in integers so large amounts keep their precision. */
export function share(part: string, total: string): number {
  if (!isBase(part) || !isBase(total) || BigInt(total) === 0n) return 0;
  return Number((BigInt(part) * 10_000n) / BigInt(total)) / 10_000;
}

/** A base-unit amount as a JavaScript number, for drawing a chart's shape only, never for arithmetic on money. */
export function plotValue(baseUnits: string, settlement: Settlement): number {
  return isBase(baseUnits) ? Number(formatUnits(BigInt(baseUnits), settlement.decimals)) : 0;
}

/** Whether capital stands at or above principal, or null when either is missing. */
export function aboveOrAtPrincipal(agent: Pick<ApiAgent, "capital" | "principal">): boolean | null {
  if (agent.capital == null || agent.principal == null || !isBase(agent.capital) || !isBase(agent.principal)) return null;
  return BigInt(agent.capital) >= BigInt(agent.principal);
}

/** An agent the worker has retired, by its status or its retirement record. */
export const isRetired = (agent: Pick<ApiAgent, "status" | "retirement">) => agent.status === "retired" || agent.retirement != null;

const PROVIDER_NAME: Record<string, string> = { nansen: "Nansen", defillama: "DeFiLlama" };

/** A provider's display name; one the web does not know is shown as the API names it. */
export const providerName = (provider: string) => PROVIDER_NAME[provider] ?? provider;

/** An instant in milliseconds as a UTC date and time, so every viewer reads the same text. */
export const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** No field the web shows as a figure carries net earnings after costs yet, so it is always named as not served. */
const NET_EARNINGS = "net earnings after costs";

/**
 * The fields the population screen would show that this response leaves null or missing. An agent-level field is
 * named only when none of the caller's agents carries it; with no agents, nothing is known about them.
 */
export function populationNotServed(population: PopulationResponse, agents: ApiAgent[]): string[] {
  const none = (pick: (a: ApiAgent) => unknown) => agents.length > 0 && agents.every((a) => pick(a) == null);
  const fields: string[] = [];
  if (population.capital == null || none((a) => a.capital)) fields.push("capital");
  if (none((a) => a.capitalHistory)) fields.push("capital history");
  fields.push(NET_EARNINGS);
  if (none((a) => a.fitnessPercentile)) fields.push("fitness");
  if (population.trades == null || none((a) => a.tradeCount)) fields.push("trades");
  if (population.x402 == null || none((a) => a.x402)) fields.push("x402 purchases");
  if (population.lastEvaluation == null) fields.push("evaluation outcomes");
  return fields;
}

/** The fields the per-agent view would show that this agent's answer leaves null or missing. */
export function agentNotServed(agent: ApiAgent): string[] {
  const fields: string[] = [];
  if (agent.capital == null) fields.push("capital");
  if (agent.capitalHistory == null) fields.push("capital history");
  fields.push(NET_EARNINGS);
  if (agent.fitnessPercentile == null) fields.push("fitness");
  if (agent.tradeCount == null) fields.push("trades");
  if (agent.x402 == null) fields.push("x402 purchases");
  return fields;
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
    agent.fitnessPercentile == null
      ? "Not ranked here: the API does not serve evaluation results yet, so there is no rank, starvation count, or distance to the capital floor to show."
      : `Fitness percentile in its niche: ${agent.fitnessPercentile}.`,
  );
  return { headline, lines };
}
