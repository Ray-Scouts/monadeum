import { parseUnits } from "viem";
import type { WebConfig } from "../config";
import { FUNDING_RULE } from "../funding";
import { ApiError } from "./client";
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

export const PRESET_CAVEAT = "A preset is a starting configuration, not a tested edge: no strategy is known to be profitable.";

/** Converts the form's caps from display units to base units and checks them. Returns the input or the error to show. */
export function createInput(
  form: { name: string; perTxCap: string; dailyCap: string; preset: string },
  settlement: Settlement,
): { ok: true; input: CreateAgentInput } | { ok: false; error: string } {
  const name = form.name.trim();
  if (!/^[\p{L}\p{N} ._-]{1,64}$/u.test(name)) return { ok: false, error: "Name: 1 to 64 letters, digits, spaces, dots, underscores, or hyphens." };
  const units = (raw: string, label: string): bigint | string => {
    const v = raw.trim();
    if (!/^\d+(\.\d+)?$/.test(v)) return `${label}: enter a positive number.`;
    let parsed: bigint;
    try {
      parsed = parseUnits(v, settlement.decimals);
    } catch {
      return `${label}: not a valid amount.`;
    }
    if (parsed <= 0n) return `${label}: must be more than 0.`;
    if ((v.split(".")[1]?.length ?? 0) > settlement.decimals) return `${label}: at most ${settlement.decimals} decimal places.`;
    return parsed;
  };
  const perTx = units(form.perTxCap, "Per-transaction cap");
  if (typeof perTx === "string") return { ok: false, error: perTx };
  const daily = units(form.dailyCap, "Daily cap");
  if (typeof daily === "string") return { ok: false, error: daily };
  if (perTx > daily) return { ok: false, error: "The per-transaction cap cannot be larger than the daily cap." };
  return { ok: true, input: { name, perTxCap: perTx.toString(), dailyCap: daily.toString(), preset: form.preset } };
}

/** The API's refusal of a creation, in plain language. Nothing was created in any of these cases. */
export function createErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.detail ? ` (${error.detail})` : "";
    switch (error.reason) {
      case "population-cap":
        return "The platform is at its population cap, so no new agent can be created now. No agent is retired to make room. Nothing was created.";
      case "limit-too-high":
        return `A cap is above the highest this server allows${detail}. Nothing was created.`;
      case "unknown-preset":
        return `That preset is not offered by the API${detail}. Nothing was created.`;
      case "unknown-field":
      case "invalid-body":
        return `The API refused the request${detail}. Nothing was created.`;
      case "no-owner-wallet":
        return "Your account has no owner wallet yet, so it cannot own an agent. Nothing was created.";
      case "conflict":
        return "Another creation took the same account index at the same moment. Nothing was created; try again.";
      case "wallets-unavailable":
        return "This server cannot create agents yet: it has no chain, bundler, or session key vault configured. Nothing was created.";
      case "network-error":
        return "The API could not be reached. It is unknown whether the agent was created; check Population before trying again.";
    }
    return `The API refused the request (${error.reason}${error.detail ? `: ${error.detail}` : ""}).`;
  }
  return error instanceof Error ? error.message : "Creation failed.";
}
