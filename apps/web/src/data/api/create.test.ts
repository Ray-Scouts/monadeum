import { describe, expect, test } from "bun:test";
import { loadWebConfig } from "../config";
import { ApiError, createApiClient } from "./client";
import { agentSummary, createErrorText, createInput, FUNDING_NOTE, isRecommended, RECOMMENDED, strategySummary } from "./create";

// Agent creation against a mocked API.

const usdc = loadWebConfig({ NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL: "USDC" }).settlement;
const preset = {
  name: "conservative",
  riskTolerance: 0.1,
  executionFrequency: 24,
  timeHorizon: 24,
  entryThreshold: 0.0002,
  exitThreshold: 0,
  informationSources: [],
  informationBudget: "0",
  modelConfiguration: "low",
  genomeHash: "0xabc",
};

describe("agent creation", () => {
  test("sends only name, caps in base units, and the preset", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ agent: {}, operation: {} }), { status: 202 });
    };
    const checked = createInput({ name: " alpha ", perTxCap: "1.5", dailyCap: "10", preset: "conservative" }, usdc);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    await createApiClient("http://x.test", fetch).as({ via: "wallet" }).createAgent(checked.input);
    expect(calls[0]!.url).toBe("http://x.test/agents");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ name: "alpha", perTxCap: "1500000", dailyCap: "10000000", preset: "conservative" });
  });

  test("the form refuses what the API would refuse, before sending", () => {
    const f = { name: "a", perTxCap: "2", dailyCap: "1", preset: "conservative" };
    expect(createInput(f, usdc)).toEqual({ ok: false, error: "The per-transaction cap cannot be larger than the daily cap. Lower the per-transaction cap or raise the daily cap." });
    expect(createInput({ ...f, name: "" }, usdc).ok).toBe(false);
    expect(createInput({ ...f, perTxCap: "0" }, usdc).ok).toBe(false);
    expect(createInput({ ...f, perTxCap: "0.0000001" }, usdc).ok).toBe(false);
  });

  test("every validation message says what is wrong and what to enter", () => {
    const f = { name: "a", perTxCap: "1", dailyCap: "5", preset: "conservative" };
    const err = (over: object) => {
      const r = createInput({ ...f, ...over }, usdc);
      return r.ok ? "" : r.error;
    };
    expect(err({ name: "" })).toMatch(/^The name must be 1 to 64 characters/);
    expect(err({ perTxCap: "abc" })).toMatch(/Per-transaction cap: enter a number such as 1 or 2.5/);
    expect(err({ dailyCap: "0" })).toMatch(/Daily cap: must be more than 0/);
    expect(err({ dailyCap: "1.1234567" })).toMatch(/use at most 6 decimal places/);
  });

  test("the recommended settings are the API default preset with 1 and 5, and they pass validation unchanged", () => {
    expect(RECOMMENDED).toEqual({ name: "My first agent", perTxCap: "1", dailyCap: "5" });
    const form = { ...RECOMMENDED, preset: "conservative" };
    expect(createInput(form, usdc)).toEqual({ ok: true, input: { name: "My first agent", perTxCap: "1000000", dailyCap: "5000000", preset: "conservative" } });
    expect(isRecommended(form, "conservative")).toBe(true);
    expect(isRecommended({ ...form, dailyCap: "6" }, "conservative")).toBe(false);
    expect(isRecommended({ ...form, preset: "balanced" }, "conservative")).toBe(false);
  });

  test("the summary states the caps being created, and falls back to words while a cap is not a number", () => {
    const p = { riskTolerance: 0.1, executionFrequency: 24, timeHorizon: 24, informationSources: [], informationBudget: "0" };
    expect(agentSummary("USDC", { perTxCap: "1", dailyCap: "5" }, p, "WETH/USDC").never[0]).toContain("more than 1 USDC in one transaction, or more than 5 USDC in any rolling day");
    expect(agentSummary("USDC", { perTxCap: "", dailyCap: "x" }, p, "WETH/USDC").never[0]).toContain("the per-transaction cap");
  });

  test("an error never prints a hex dump", () => {
    expect(createErrorText(new ApiError(400, "invalid-body", `bad ${"0x" + "ab".repeat(40)}`))).not.toContain("0xab");
    expect(createErrorText(new ApiError(401, "unauthenticated"))).toMatch(/session has ended.*Nothing was created/);
  });

  test("the population cap and 400s are explained, and say nothing was created", () => {
    expect(createErrorText(new ApiError(409, "population-cap"))).toMatch(/population cap.*Nothing was created/);
    expect(createErrorText(new ApiError(400, "limit-too-high", "perTxCap exceeds 1000000"))).toMatch(/exceeds 1000000.*Nothing was created/);
    expect(createErrorText(new ApiError(400, "unknown-field", "riskTolerance is not a field"))).toMatch(/Nothing was created/);
    expect(createErrorText(new ApiError(0, "network-error"))).toMatch(/unknown whether/);
  });

  test("a preset is described in plain language, with the pair from the API", () => {
    const lines = strategySummary(preset, "WETH/USDC").join(" ");
    expect(lines).toContain("Trades WETH/USDC");
    expect(lines).toContain("at most 10% of its capital");
    expect(lines).toContain("once every 24 ticks");
    expect(lines).toContain("Buys no paid information");
    expect(lines).not.toMatch(/riskTolerance|executionFrequency|entryThreshold/);
    expect(FUNDING_NOTE).toMatch(/will not trade until it is funded/);
    expect(FUNDING_NOTE).toContain("Only USDC sent from your owner wallet");
    expect(FUNDING_NOTE).toContain("only once that account is deployed");
  });
});
