import { parseUnits } from "viem";
import type { WebConfig } from "../config";
import { FUNDING_RULE } from "../funding";
import { ApiError } from "./client";
import { detailSuffix, plainThrown } from "./plain";
import type { ApiGenome, CreateAgentInput, GenomePresetView } from "./types";

/**
 * Agent creation in `api` mode. The owner picks a preset by name; the API builds the genome, so the page sends only
 * `name`, `perTxCap`, `dailyCap`, and `preset`. A preset is described in plain language, never as its raw parameters.
 */

type Settlement = WebConfig["settlement"];
type Strategy = Pick<GenomePresetView, "riskTolerance" | "executionFrequency" | "timeHorizon" | "informationSources" | "informationBudget">;

const ticks = (n: number) => (n === 1 ? "every tick" : `once every ${n} ticks`);

/** What an agent built from this preset or genome does, in plain sentences. */
export function strategySummary(s: Strategy, pair: string): string[] {
  const percent = Math.round(s.riskTolerance * 1000) / 10;
  return [
    `Trades ${pair}, long or flat: it holds a position or stays out of the market, and never sells short.`,
    `Puts at most ${percent}% of its capital into a position.`,
    `Decides ${ticks(s.executionFrequency)}, looking back over the last ${s.timeHorizon} ${s.timeHorizon === 1 ? "tick" : "ticks"} of prices.`,
    s.informationSources.length === 0 || s.informationBudget === "0"
      ? "Buys no paid information."
      : `May buy information from ${s.informationSources.join(" and ")}, within a per-tick budget.`,
  ];
}

export function genomeSummary(genome: ApiGenome): string[] {
  return strategySummary(genome, genome.assetUniverse.join(", "));
}

export const FUNDING_NOTE = `The agent will not trade until it is funded: a new agent starts with a principal of 0, and the worker does not tick or evaluate an unfunded agent. ${FUNDING_RULE} Use "Fund this agent" on the agent page once its account is deployed.`;

/** The starting values the create screen selects, so a newcomer can create an agent without opening an advanced field. */
export const RECOMMENDED = { name: "My first agent", perTxCap: "1", dailyCap: "5" } as const;

export const NAME_RULE = "1 to 64 characters: letters, digits, spaces, dots, underscores, or hyphens.";

/** Whether the form still holds the recommended caps and the API's default preset. The name is the owner's own choice. */
export function isRecommended(form: { perTxCap: string; dailyCap: string; preset: string }, defaultPreset: string): boolean {
  return form.preset === defaultPreset && form.perTxCap.trim() === RECOMMENDED.perTxCap && form.dailyCap.trim() === RECOMMENDED.dailyCap;
}

/** The plain-language summary of the agent about to be created: what it does, what it can never do, what it costs, what happens next. */
export function agentSummary(unit: string, caps: { perTxCap: string; dailyCap: string }, preset: Strategy, pair: string) {
  const cap = (raw: string, fallback: string) => (/^\d+(\.\d+)?$/.test(raw.trim()) ? `${raw.trim()} ${unit}` : fallback);
  return {
    does: strategySummary(preset, pair),
    never: [
      `Spend more than ${cap(caps.perTxCap, "the per-transaction cap")} in one transaction, or more than ${cap(caps.dailyCap, "the daily cap")} in any rolling day. The agent's account enforces this on chain, not the platform.`,
      "Send funds to an address of its choosing, or change its own limits. Only your owner wallet can.",
    ],
    costs: "This is the Monad testnet, so no real money is involved. The platform pays the network fee for the account deployment and for funding, so your wallet needs no MON.",
    next: [
      "Your owner wallet signs one approval to deploy the agent's account.",
      "You fund the agent from your owner wallet, then activate it.",
      "It trades only once it is funded and the operator has enabled trading for this deployment, which is off by default.",
    ],
  };
}

export const PRESET_CAVEAT = "A preset is a starting configuration, not a tested edge: no strategy is known to be profitable.";

/** Converts the form's caps from display units to base units and checks them. Returns the input or the error to show. */
export function createInput(
  form: { name: string; perTxCap: string; dailyCap: string; preset: string },
  settlement: Settlement,
): { ok: true; input: CreateAgentInput } | { ok: false; error: string } {
  const name = form.name.trim();
  if (!/^[\p{L}\p{N} ._-]{1,64}$/u.test(name)) return { ok: false, error: `The name must be ${NAME_RULE}` };
  const units = (raw: string, label: string): bigint | string => {
    const v = raw.trim();
    if (!/^\d+(\.\d+)?$/.test(v)) return `${label}: enter a number such as 1 or 2.5.`;
    let parsed: bigint;
    try {
      parsed = parseUnits(v, settlement.decimals);
    } catch {
      return `${label}: that amount is not valid. Enter a number such as 1 or 2.5.`;
    }
    if (parsed <= 0n) return `${label}: must be more than 0, because an agent with a cap of 0 could never spend.`;
    if ((v.split(".")[1]?.length ?? 0) > settlement.decimals) return `${label}: use at most ${settlement.decimals} decimal places.`;
    return parsed;
  };
  const perTx = units(form.perTxCap, "Per-transaction cap");
  if (typeof perTx === "string") return { ok: false, error: perTx };
  const daily = units(form.dailyCap, "Daily cap");
  if (typeof daily === "string") return { ok: false, error: daily };
  if (perTx > daily) return { ok: false, error: "The per-transaction cap cannot be larger than the daily cap. Lower the per-transaction cap or raise the daily cap." };
  return { ok: true, input: { name, perTxCap: perTx.toString(), dailyCap: daily.toString(), preset: form.preset } };
}

/** The API's refusal of a creation, in plain language. Nothing was created in any of these cases. */
export function createErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = detailSuffix(error.detail);
    switch (error.reason) {
      case "population-cap":
        return "The platform is at its population cap, so no new agent can be created now. No agent is retired to make room. Nothing was created.";
      case "limit-too-high":
        return `A cap is above the highest this server allows${detail}. Lower the caps, or restore the recommended 1 and 5. Nothing was created.`;
      case "unknown-preset":
        return `That preset is not offered by the API${detail}. Choose another preset or reload the page. Nothing was created.`;
      case "unknown-field":
      case "invalid-body":
        return `The API refused the request${detail}. Check the fields and try again. Nothing was created.`;
      case "no-owner-wallet":
        return "Your account has no owner wallet yet, so it cannot own an agent. Sign in with a wallet, or link one, then try again. Nothing was created.";
      case "conflict":
        return "Another creation took the same account index at the same moment. Nothing was created; try again.";
      case "wallets-unavailable":
        return "This server cannot create agents yet: it has no chain, bundler, or session key vault configured. Nothing was created. Try again later.";
      case "network-error":
        return "The API could not be reached. It is unknown whether the agent was created; open Population and look for the agent before trying again.";
    }
    if (error.status === 401) return "Your session has ended. Sign in again, then retry. Nothing was created.";
    return `The API refused the request (${error.reason})${detailSuffix(error.detail)}. Nothing was created. Try again, or reload the page.`;
  }
  return plainThrown(error, "Creation failed. It is unknown whether the agent was created; open Population and look for it before trying again.");
}
