import { CAPITAL_FLOOR, RETIREMENT_WINDOWS, SLOT_CEILING, STARVATION_PERCENTILE } from "@monadeum/reallocation/constants";
import { REALLOCATION_OFF_REASON } from "@monadeum/reallocation/switch";
import { formatUnits } from "viem";
import type { WebConfig } from "../config";
import type { EvolutionEvent } from "../types";
import type { ApiAgent, CapitalFlowResponse, OwnerResponse, PopulationResponse, ReallocationOutcome, SelectionEventView } from "./types";

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

/** A signed base-unit amount, such as net earnings, in the settlement asset. */
export function signedAmount(baseUnits: string, settlement: Settlement): string {
  return baseUnits.startsWith("-") ? `-${amount(baseUnits.slice(1), settlement)}` : amount(baseUnits, settlement);
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

/** Net earnings after costs are served per agent, not as a population total, so the population screen names them as not served. */
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
  if (agent.earnings == null) fields.push(NET_EARNINGS);
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

/** What the explainer reads besides the agent and its owner: the caller's capital flow and the settlement asset. */
export interface ExplainContext {
  flow: CapitalFlowResponse | null;
  settlement: Settlement;
}

/** The capital floor (`EVOLUTION.md` section 6) in base units of the settlement asset. */
export function floorBaseUnits(settlement: Settlement): bigint {
  return BigInt(Math.round(CAPITAL_FLOOR * 10 ** settlement.decimals));
}

const others = (n: number) => (n === 1 ? "another of your agents" : `${n} of your other agents`);

/**
 * What the indexed reallocations did to this agent: its most recent evaluation with a move, what it sent and received
 * there, or that nothing has moved. Never a rank: the API does not serve one.
 */
function movementLines(agent: ApiAgent, context: ExplainContext | undefined): string[] {
  const flow = context?.flow;
  if (!context || !flow || !flow.reallocationsIndexed) {
    return ["Reallocations are not indexed on this deployment, so this page cannot show whether capital moved at the last evaluation."];
  }
  const mine = flow.reallocations.filter((r) => r.sourceAgentId === agent.id || r.sinkAgentId === agent.id);
  if (mine.length === 0) return ["No reallocation has moved capital into or out of this agent."];
  const latest = Math.max(...mine.map((r) => r.evaluation));
  const at = mine.filter((r) => r.evaluation === latest);
  const total = (rs: typeof at) => rs.reduce((sum, r) => sum + (isBase(r.amount) ? BigInt(r.amount) : 0n), 0n).toString();
  const sent = at.filter((r) => r.sourceAgentId === agent.id);
  const received = at.filter((r) => r.sinkAgentId === agent.id);
  const lines: string[] = [];
  if (sent.length > 0) lines.push(`At evaluation ${latest}, its most recent move, it sent ${amount(total(sent), context.settlement)} to ${others(sent.length)}, because it ranked lowest among the agents your policy covers.`);
  if (received.length > 0) lines.push(`At evaluation ${latest}, its most recent move, it received ${amount(total(received), context.settlement)} from ${others(received.length)}, because it ranked highest among the agents your policy covers.`);
  return lines;
}

const OFF_TEXT: Record<string, string> = {
  "one-agent": "it is your only live agent, and reallocation only moves capital between agents of the same owner",
  "no-policy": "no reallocation policy of yours was in force",
  "not-covered": "your policy in force did not name it",
  "too-few-covered": "your policy named fewer than two agents, so nothing could move",
  "policy-invalid": "your policy was rejected as a whole: it asked for looser bounds than the protocol allows, or named an agent it cannot",
};

/**
 * The worker's recorded outcome for the agent's latest evaluation (`evaluationOutcomes` of `@monadeum/reallocation`,
 * the function the sample screens use too), in plain language: what moved, or the binding reason nothing did. Its
 * rank is stated by position in the owner's pool, never with the ranking formula.
 */
export function outcomeExplained(o: ReallocationOutcome, context?: ExplainContext): { headline: string; line: string } | null {
  const at = `At evaluation ${o.evaluation}`;
  const r = o.rank;
  const pool = r ? `among the ${r.of} agents your policy covers` : "among the agents your policy covers";
  const lowest = r && r.quota > 1 ? `in the bottom ${r.quota}` : "lowest";
  const highest = r && r.quota > 1 ? `in the top ${r.quota}` : "highest";
  const money = (v: string | null) => (v === null ? "capital" : context ? amount(v, context.settlement) : `${v} base units`);
  const source = !!r && r.position <= r.quota;
  switch (o.kind) {
    case "sent":
      return { headline: "Sent capital", line: `${at} it sent ${money(o.amount)}, because it ranked ${lowest} ${pool}.` };
    case "received":
      return { headline: "Received capital", line: `${at} it received ${money(o.amount)}, because it ranked ${highest} ${pool}.` };
    case "unranked":
      return { headline: "Not ranked", line: `${at} it was not ranked: it had no adjusted fitness, which needs trades in the evaluation window.` };
    case "off":
      return { headline: "Reallocation was off for it", line: `${at} nothing moved for this agent: ${OFF_TEXT[o.reason ?? ""] ?? "reallocation was off for it"}.` };
    case "held": {
      const headline = "Ranked, nothing moved";
      switch (o.reason) {
        case "floor":
          return { headline, line: `${at} it ranked ${lowest} ${pool}, but sent nothing: its capital is at the capital floor, which a source never goes below.` };
        case "ceiling":
          return { headline, line: `${at} it ranked ${highest} ${pool}, but received nothing: it is at its slot ceiling, the most reallocation can fill it to.` };
        case "zero-downside":
          return { headline, line: `${at} it ranked ${highest} ${pool}, but received nothing: it is flagged for zero downside, so it cannot receive capital while the flag is set.` };
        case "middle":
          return { headline, line: `${at} it ranked ${r ? `${r.position} of ${r.of}, counting from the lowest,` : "in the middle"} ${pool}, and only the lowest and highest ranked agents move capital.` };
        case "alone":
          return { headline, line: `${at} it was the only ranked agent ${pool}, and reallocation needs at least two.` };
        case "counterpart":
          return source
            ? { headline, line: `${at} it ranked ${lowest} ${pool}, but sent nothing: the agent that would have received was at its slot ceiling or flagged for zero downside.` }
            : { headline, line: `${at} it ranked ${highest} ${pool}, but received nothing: the agent that would have sent was at the capital floor.` };
        default:
          return { headline, line: `${at} it was ranked ${pool}, and nothing moved.` };
      }
    }
    default:
      return null;
  }
}

const listOf = (parts: { agentId: string; amount: string }[], names: ReadonlyMap<string, string>, settlement: Settlement) =>
  parts.map((p) => `${names.get(p.agentId) ?? p.agentId} (${amount(p.amount, settlement)})`).join(", ");

const RULE_TEXT: Record<string, string> = {
  capital_floor: "its capital fell below the capital floor",
  starvation: `it sat in the bottom ${Math.round(STARVATION_PERCENTILE * 100)} percent of its niche for ${RETIREMENT_WINDOWS} evaluations in a row`,
};

/** The API's selection events as the event feed shows them: what happened, in plain language, dated by the worker's clock. */
export function feedEvents(events: readonly SelectionEventView[], names: ReadonlyMap<string, string>, settlement: Settlement): EvolutionEvent[] {
  return events.map((e) => {
    if (e.kind === "retirement") {
      const name = names.get(e.agentId) ?? e.agentId;
      return {
        id: `retirement-${e.evaluation}-${e.agentId}`,
        kind: "retirement",
        minutesAgo: 0,
        when: utc(e.at),
        title: `${name} retired at evaluation ${e.evaluation}`,
        body: `It retired because ${RULE_TEXT[e.rule] ?? `of the ${e.rule} rule`}. Its capital stayed in its own account.`,
        agentIds: [e.agentId],
        tags: [e.rule],
      };
    }
    const total = e.sources.reduce((sum, s) => sum + (isBase(s.amount) ? BigInt(s.amount) : 0n), 0n).toString();
    return {
      id: `reallocation-${e.evaluation}`,
      kind: "reallocation",
      minutesAgo: 0,
      when: utc(e.at),
      title: `Evaluation ${e.evaluation} moved ${amount(total, settlement)} between your agents`,
      body: `From ${listOf(e.sources, names, settlement) || "none"} to ${listOf(e.sinks, names, settlement) || "none"}. This is what the worker submitted; the capital-flow screen lists the moves the chain recorded.`,
      agentIds: [...e.sources, ...e.sinks].map((p) => p.agentId),
      tags: [`evaluation ${e.evaluation}`],
    };
  });
}

/** How close the agent is to the starvation rule and the capital floor, from its last evaluation record. */
function proximityLines(agent: ApiAgent, context: ExplainContext | undefined): string[] {
  if (agent.fitnessPercentile == null && agent.lowWindows == null && agent.capital == null) {
    return ["Not ranked yet: there is no evaluation result for this agent, so there is no rank, starvation count, or distance to the capital floor to show."];
  }
  const lines: string[] = [];
  lines.push(
    agent.fitnessPercentile == null
      ? "Not ranked at its last evaluation: it has no adjusted fitness yet, which needs trades in the evaluation window."
      : `Fitness percentile in its niche: ${Math.round(agent.fitnessPercentile)}.`,
  );
  if (agent.lowWindows != null) {
    lines.push(
      `${agent.lowWindows} of ${RETIREMENT_WINDOWS} low windows: it retires if it sits in the bottom ${Math.round(STARVATION_PERCENTILE * 100)} percent of its niche for ${RETIREMENT_WINDOWS} evaluations in a row.`,
    );
  }
  if (context && agent.capital != null && isBase(agent.capital)) {
    const floor = floorBaseUnits(context.settlement);
    const capital = BigInt(agent.capital);
    lines.push(
      capital >= floor
        ? `Capital ${amount(agent.capital, context.settlement)}, ${amount((capital - floor).toString(), context.settlement)} above the ${amount(floor.toString(), context.settlement)} capital floor; an agent below the floor retires.`
        : `Capital ${amount(agent.capital, context.settlement)} is below the ${amount(floor.toString(), context.settlement)} capital floor, so it retires at its next evaluation.`,
    );
  }
  return lines;
}

/** The slot ceiling for a covered agent: how far reallocation could fill it, and the zero-downside flag. */
function ceilingLines(agent: ApiAgent, slotCeiling: number | null, context: ExplainContext | undefined): string[] {
  const lines: string[] = [];
  const multiple = slotCeiling ?? SLOT_CEILING;
  if (context && agent.principal != null && isBase(agent.principal) && BigInt(agent.principal) > 0n) {
    const ceiling = (BigInt(agent.principal) * BigInt(Math.round(multiple * 10_000))) / 10_000n;
    const capital = agent.capital != null && isBase(agent.capital) ? BigInt(agent.capital) : null;
    const room = capital === null ? null : capital >= ceiling ? 0n : ceiling - capital;
    lines.push(
      `Through reallocation it never rises above ${multiple} times its principal, ${amount(ceiling.toString(), context.settlement)}` +
        (room === null ? "." : room === 0n ? "; it is at that ceiling, so it cannot receive capital now." : `; it can receive up to ${amount(room.toString(), context.settlement)} more.`),
    );
  }
  if (agent.zeroDownsideFlag) lines.push("It is flagged for zero downside: it had no losing tick in the window, so it keeps trading but cannot receive capital through reallocation while the flag is set.");
  return lines;
}

/**
 * What the reallocation and retirement mechanism did to this agent, from what the API serves (issue #43): retirement
 * from its evaluation record, moves from the indexed reallocations in the caller's capital flow, and how close it is to
 * the starvation rule, the capital floor, and its slot ceiling. The API serves no rank, so the explainer never claims
 * one beyond what a move itself shows. While the deployment's reallocation switch is off, every agent reads as off,
 * whatever policy was recorded, and no policy step is suggested.
 */
export function explainAgent(agent: ApiAgent, owner: OwnerResponse | null, context?: ExplainContext): Explainer {
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
    lines.push(`Your signed policy (sequence ${policy.sequence}) names this agent.`);
    const recorded = agent.reallocationOutcome ? outcomeExplained(agent.reallocationOutcome, context) : null;
    if (recorded) {
      headline = recorded.headline;
      lines.push(recorded.line);
    }
    lines.push(...movementLines(agent, context));
    lines.push("Where a policy is in force, reallocation can take an agent below its own principal while your total across your agents stays the same.");
    lines.push(...ceilingLines(agent, policy.slotCeiling, context));
  }
  lines.push(...proximityLines(agent, context));
  return { headline, lines };
}
