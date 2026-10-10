import { CAPITAL_FLOOR, RETIREMENT_WINDOWS } from "@monadeum/reallocation/constants";
import { pct, usd } from "@/lib/format";
import { boundsFor, offerOf, roomOf, type Bounds } from "./evaluate";
import type { Agent, AgentEvaluation, HeldReason, Outcome, Owner } from "./types";

export type ExplainTone = "good" | "warn" | "bad" | "accent" | "off";

/** What the mechanism did to an agent at the last evaluation, in plain language: what happened, why, and what would change it. */
export interface Explanation {
  label: string;
  tone: ExplainTone;
  headline: string;
  why: string;
  change: string;
}

/** Counterparts of this agent's moves at that evaluation, already labelled. */
export interface Counterpart {
  label: string;
  amount: number;
}

const list = (cs: Counterpart[]) => cs.map((c) => `${c.label} (${usd(c.amount)})`).join(", ");

/** How the agent was picked as a source or a sink, in words, without the ranking formula. */
function picked(rank: AgentEvaluation["rank"], side: "lowest" | "highest"): string {
  if (!rank) return "";
  if (rank.quota === 1) return `it ranked ${side} of the ${rank.of} agents in its owner's ranking pool`;
  return `it ranked in the ${side === "lowest" ? "bottom" : "top"} ${rank.quota} of the ${rank.of} agents in its owner's ranking pool`;
}

export function explain(agent: Agent, ev: AgentEvaluation, owner: Owner | null, counterparts: Counterpart[] = []): Explanation {
  const b = boundsFor(owner);
  const at = `evaluation ${ev.evaluation}`;
  const ceilingCapital = b.ceiling * agent.principal;
  const o = ev.outcome;
  switch (o.kind) {
    case "off": {
      const label = "Reallocation off";
      if (o.reason === "one-agent")
        return {
          label,
          tone: "off",
          headline: "Reallocation is off: its owner has one agent.",
          why: "Reallocation only moves capital between agents of the same owner, so an owner with one agent gets no benefit from it. Nothing moved.",
          change: "Its owner creates a second agent and signs a reallocation policy that covers both.",
        };
      if (o.reason === "no-policy")
        return {
          label,
          tone: "off",
          headline: "Reallocation is off for this owner.",
          why: "Its owner has not signed a reallocation policy, so capital never moves between their agents. This is the default.",
          change: "Its owner signs a policy with their root wallet that names this agent and at least one other.",
        };
      if (o.reason === "not-covered")
        return {
          label,
          tone: "off",
          headline: "Reallocation is off for this agent.",
          why: "Its owner's policy does not name this agent, so it is never a source or a sink. Nothing moved.",
          change: "Its owner signs a new policy that includes it.",
        };
      if (o.reason === "policy-invalid")
        return {
          label,
          tone: "off",
          headline: "Reallocation is off: its owner's policy is not in force.",
          why: "The policy asks for looser bounds than the protocol allows, or names an agent it cannot, so it is rejected as a whole and nothing moves.",
          change: "Its owner signs a policy that stays within the protocol bounds and names only their own agents.",
        };
      return {
        label,
        tone: "off",
        headline: "Reallocation is off: its owner's policy names fewer than two agents.",
        why: "Reallocation needs at least two covered agents, so nothing moved.",
        change: "Its owner signs a policy that names at least two of their active agents.",
      };
    }
    case "unranked":
      return o.reason === "paused"
        ? {
            label: "Not ranked",
            tone: "off",
            headline: `Not ranked at ${at}: it is paused.`,
            why: "Only active agents are ranked. A paused agent keeps its capital and is never a source or a sink.",
            change: "Its owner resumes it. It is ranked again at the next evaluation.",
          }
        : {
            label: "Not ranked",
            tone: "off",
            headline: `Not ranked at ${at}: it has no adjusted fitness yet.`,
            why: "It has no trades in the evaluation window, so there is nothing to rank it on. It neither sent nor received capital.",
            change: "It completes trades in the window. It is ranked at the first evaluation after that.",
          };
    case "sent":
      return {
        label: "Sent capital",
        tone: "warn",
        headline: `Sent ${usd(o.amount)} at ${at}${counterparts.length ? ` to ${list(counterparts)}` : ""}.`,
        why: `It was a source because ${picked(ev.rank, "lowest")}. A source offers at most ${pct(b.cap)} of its capital per evaluation and never goes below the ${usd(b.floor)} floor.`,
        change: "Ranking above the lowest agents in its owner's pool at the next evaluation stops the outflow.",
      };
    case "received":
      return {
        label: "Received capital",
        tone: "good",
        headline: `Received ${usd(o.amount)} at ${at}${counterparts.length ? ` from ${list(counterparts)}` : ""}.`,
        why: `It was a sink because ${picked(ev.rank, "highest")}. A sink never rises above ${b.ceiling} times its principal, ${usd(ceilingCapital)}, through reallocation.`,
        change: "It stops receiving when it no longer ranks highest, reaches its ceiling, or is flagged for zero downside.",
      };
    case "held": {
      const label = "Ranked, nothing moved";
      const source = !!ev.rank && ev.rank.position <= ev.rank.quota;
      switch (o.reason) {
        case "floor":
          return {
            label,
            tone: "accent",
            headline: `Ranked lowest at ${at}, but sent nothing: it is at the capital floor.`,
            why: `A source never goes below the ${usd(b.floor)} floor, and its capital, ${usd(agent.capital)}, is already there.`,
            change: `Trading lifts its capital above the floor. If it falls below the floor, it retires.`,
          };
        case "ceiling":
          return {
            label,
            tone: "accent",
            headline: `Ranked highest at ${at}, but received nothing: it is at its slot ceiling.`,
            why: `A sink never rises above ${b.ceiling} times its principal, ${usd(ceilingCapital)}, through reallocation. Its capital is ${usd(agent.capital)}.`,
            change: "Its capital falls below the ceiling, or its owner deposits more, which raises its principal and the ceiling with it.",
          };
        case "zero-downside":
          return {
            label,
            tone: "warn",
            headline: `Ranked highest at ${at}, but received nothing: it is flagged for zero downside.`,
            why: "It had no losing tick in the window. While the flag is set it keeps trading but cannot receive capital through reallocation.",
            change: "An operator reviews and clears the flag, or a later window shows a loss.",
          };
        case "middle":
          return {
            label,
            tone: "accent",
            headline: `Ranked in the middle of its owner's pool at ${at}, so nothing moved.`,
            why: `Only the lowest and highest ranked agents move capital${ev.rank ? `; it ranked ${ev.rank.position} of ${ev.rank.of}, counting from the lowest` : ""}.`,
            change: "It becomes the lowest or the highest ranked agent in its owner's pool.",
          };
        case "alone":
          return {
            label,
            tone: "accent",
            headline: `The only ranked agent in its owner's pool at ${at}, so nothing moved.`,
            why: "Reallocation needs at least two ranked agents. The other covered agents are paused or have no adjusted fitness yet.",
            change: "Another covered agent is ranked at a later evaluation.",
          };
        case "counterpart":
          return source
            ? {
                label,
                tone: "accent",
                headline: `Ranked lowest at ${at}, but sent nothing.`,
                why: "The agent that would have received could take nothing: it is at its slot ceiling or flagged for zero downside.",
                change: "The top-ranked agent in its owner's pool has room below its ceiling and no flag.",
              }
            : {
                label,
                tone: "accent",
                headline: `Ranked highest at ${at}, but received nothing.`,
                why: "The agent that would have sent could give nothing: it is at the capital floor.",
                change: "The lowest-ranked agent in its owner's pool has capital above the floor.",
              };
      }
      break;
    }
    case "retired": {
      const kept = `Its remaining capital, ${usd(agent.capital)}, stayed in its own account. Its owner can withdraw it; the mechanism never moves it.`;
      const when = agent.retirement ? `evaluation ${agent.retirement.evaluation}` : at;
      if (o.rule === "floor")
        return {
          label: "Retired",
          tone: "bad",
          headline: `Retired at ${when}: its capital fell below the ${usd(CAPITAL_FLOOR)} floor.`,
          why: `Below the floor, fixed per-tick costs make further trading uneconomic. ${kept}`,
          change: "Retirement is final. Its trade, fitness and reallocation history stays queryable.",
        };
      if (o.rule === "starvation")
        return {
          label: "Retired",
          tone: "bad",
          headline: `Retired at ${when}: it sat in the bottom tenth of its niche for ${RETIREMENT_WINDOWS} evaluations in a row.`,
          why: kept,
          change: "Retirement is final. Its trade, fitness and reallocation history stays queryable.",
        };
      return {
        label: "Retired",
        tone: "off",
        headline: `Retired by its owner at ${when}.`,
        why: kept,
        change: "Retirement is final. Its trade, fitness and reallocation history stays queryable.",
      };
    }
  }
}

/** A few words for tables and lists. */
export function outcomeShort(o: Outcome): string {
  switch (o.kind) {
    case "off":
      return { "one-agent": "Off: one agent", "not-covered": "Off: not in policy", "no-policy": "Off: no policy", "too-few-covered": "Off: policy too small", "policy-invalid": "Off: policy rejected" }[o.reason];
    case "unranked":
      return o.reason === "paused" ? "Not ranked: paused" : "Not ranked yet";
    case "sent":
      return `Sent ${usd(o.amount)}`;
    case "received":
      return `Received ${usd(o.amount)}`;
    case "held":
      return HELD_SHORT[o.reason];
    case "retired":
      return o.rule === "floor" ? "Retired: floor" : o.rule === "starvation" ? "Retired: starvation" : "Retired by owner";
  }
}

const HELD_SHORT: Record<HeldReason, string> = {
  floor: "Held: at floor",
  ceiling: "Held: at ceiling",
  "zero-downside": "Held: flagged",
  middle: "Held: middle of pool",
  counterpart: "Held: no counterpart",
  alone: "Held: only one ranked",
};

/** How close an agent is to each limit, for the explainer. No genome field and no fitness formula. */
export interface Proximity {
  lowWindows: number;
  starvationWindows: number;
  capital: number;
  principal: number;
  floor: number;
  ceilingMultiple: number;
  ceilingCapital: number;
  /** Most it could send at the next evaluation if it ranks lowest. */
  maxSend: number;
  /** Most it could receive at the next evaluation if it ranks highest. */
  maxReceive: number;
}

export function proximity(agent: Agent, owner: Owner | null): Proximity {
  const b: Bounds = boundsFor(owner);
  return {
    lowWindows: agent.lowWindows,
    starvationWindows: RETIREMENT_WINDOWS,
    capital: agent.capital,
    principal: agent.principal,
    floor: b.floor,
    ceilingMultiple: b.ceiling,
    ceilingCapital: b.ceiling * agent.principal,
    maxSend: offerOf(agent.capital, b),
    maxReceive: agent.zeroDownsideFlag ? 0 : roomOf(agent.capital, agent.principal, b),
  };
}
