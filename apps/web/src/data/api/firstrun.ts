import type { WebConfig } from "../config";
import { amount, isRetired } from "./present";
import type { ApiAgent } from "./types";

/**
 * The first-run checklist: create, fund, activate, watch. Every state is read from the agent record the API served
 * (`deployment`, `principal`, `session`, `tradeCount`); nothing is inferred or invented. A step that cannot be done yet
 * says what it is waiting for.
 */

export type StepState = "done" | "current" | "blocked" | "waiting";

export interface FirstRunStep {
  id: "deploy" | "fund" | "activate" | "watch";
  title: string;
  state: StepState;
  detail: string;
  /** The exact next action, as a link to the card on the agent page that does it. */
  action: { label: string; href: string } | null;
}

type Settlement = WebConfig["settlement"];

const funded = (a: ApiAgent) => a.principal !== null && a.principal !== "0" && /^\d+$/.test(a.principal);

export function firstRunSteps(agent: ApiAgent, settlement: Settlement): FirstRunStep[] {
  const deployed = agent.deployment === "deployed";
  const retired = isRetired(agent);
  const sessionStatus = agent.session?.status ?? null;
  const active = sessionStatus === "active";
  const isFunded = funded(agent);
  const base = `/agents/${encodeURIComponent(agent.id)}`;
  const retiredText = "This agent is retired, so this step is closed.";

  const deploy: FirstRunStep = deployed
    ? { id: "deploy", title: "Create the agent and deploy its account", state: "done", detail: "The agent exists and its account is deployed.", action: null }
    : {
        id: "deploy",
        title: "Create the agent and deploy its account",
        state: retired ? "blocked" : "current",
        detail: retired
          ? retiredText
          : agent.deployment === "pending"
            ? "The deployment was started but has not finished. Your owner wallet signs it; the platform pays the network fee."
            : "The agent exists, but its account is not deployed yet. Your owner wallet signs one approval; the platform pays the network fee.",
        action: retired ? null : { label: "Deploy the account", href: `${base}#account` },
      };

  const fund: FirstRunStep = isFunded
    ? { id: "fund", title: "Fund the agent", state: "done", detail: `Principal ${amount(agent.principal ?? "0", settlement)}, as the API recorded it from finalized transfers.`, action: null }
    : !deployed || retired
      ? { id: "fund", title: "Fund the agent", state: "blocked", detail: retired ? retiredText : "Needs the account deployed first: USDC sent before deployment does not count as funding.", action: null }
      : { id: "fund", title: "Fund the agent", state: "current", detail: "Send USDC from your owner wallet to the agent's account. An unfunded agent does not trade.", action: { label: "Fund this agent", href: `${base}#fund` } };

  const activate: FirstRunStep = active
    ? { id: "activate", title: "Activate the agent", state: "done", detail: "The session key is issued.", action: null }
    : sessionStatus === "revoking"
      ? { id: "activate", title: "Activate the agent", state: "waiting", detail: "A stop is in progress. Finish its on-chain revocation first; then you can activate again.", action: null }
      : !deployed || retired
        ? { id: "activate", title: "Activate the agent", state: "blocked", detail: retired ? retiredText : "Needs the account deployed first, because the key is approved on that account.", action: null }
        : {
            id: "activate",
            title: "Activate the agent",
            state: "current",
            detail:
              (sessionStatus === "revoked" ? "This agent was stopped. Your wallet signs one approval for a new key." : "Your wallet signs one approval for the agent's session key. It sends no transaction.") +
              (isFunded ? "" : " Available now; the agent trades only when it is both funded and active."),
            action: { label: sessionStatus === "revoked" ? "Activate again" : "Activate agent", href: `${base}#activate` },
          };

  const trades = agent.tradeCount ?? null;
  const watch: FirstRunStep =
    trades !== null && trades > 0
      ? { id: "watch", title: "Watch it work", state: "done", detail: `${trades} ${trades === 1 ? "trade" : "trades"} recorded. Capital and spends update on this page.`, action: null }
      : retired
        ? { id: "watch", title: "Watch it work", state: "blocked", detail: retiredText, action: null }
        : isFunded && active
          ? {
              id: "watch",
              title: "Watch it work",
              state: "waiting",
              detail: "Funded and active. No trade is recorded yet. Trading also needs the operator to have enabled it for this deployment, which is off by default, so the agent can stay idle.",
              action: null,
            }
          : { id: "watch", title: "Watch it work", state: "blocked", detail: `Needs ${isFunded ? "activation" : active ? "funding" : "funding and activation"} first. Nothing is traded until then.`, action: null };

  return [deploy, fund, activate, watch];
}

/** The first step that is not done, or null when all four are. */
export const nextStep = (steps: FirstRunStep[]): FirstRunStep | null => steps.find((s) => s.state !== "done") ?? null;

/** The owner's newest live agent that has setup left, with its next step; null when there is none. */
export function ownerNextStep(agents: ApiAgent[], settlement: Settlement): { agent: ApiAgent; step: FirstRunStep } | null {
  const live = [...agents].filter((a) => !isRetired(a)).sort((a, b) => b.createdAt - a.createdAt);
  for (const agent of live) {
    const step = nextStep(firstRunSteps(agent, settlement));
    if (step && step.id !== "watch") return { agent, step };
  }
  return null;
}
