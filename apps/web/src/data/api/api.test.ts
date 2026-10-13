import { describe, expect, test } from "bun:test";
import { verifyMessage, verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadWebConfig } from "../config";
import { ApiError, createApiClient } from "./client";
import { REALLOCATION_OFF_REASON } from "@monadeum/reallocation/switch";
import { agentNotServed, amount, explainAgent, feedEvents, outcomeExplained, REALLOCATION_OFF, REALLOCATION_ON, reallocationEnabled, reallocationNote, signedAmount } from "./present";
import { explain, messageHex, rawPayload, signWith, walletCall, withDomainType } from "./signing";
import { revocationFacts, stopViewFromError, stopViewFromResponse } from "./stop";
import { apiAgent } from "./fixtures";
import type { Operation, OwnerResponse, TypedDataPayload } from "./types";

// The data layer against a mocked API: every request is captured and answered from a table.

interface Captured {
  url: string;
  init: RequestInit;
}

function mockFetch(answer: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  const calls: Captured[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = answer(url, init);
    return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetch };
}

const headers = (c: Captured) => c.init.headers as Record<string, string>;

describe("configuration", () => {
  test("defaults to the sample source", () => {
    const c = loadWebConfig({});
    expect(c.mode).toBe("sample");
    expect(c.error).toBeNull();
  });

  test("api mode needs an https URL, or http on localhost", () => {
    expect(loadWebConfig({ NEXT_PUBLIC_MONADEUM_DATA_SOURCE: "api" }).error).toMatch(/API_URL is not set/);
    expect(loadWebConfig({ NEXT_PUBLIC_MONADEUM_DATA_SOURCE: "api", NEXT_PUBLIC_MONADEUM_API_URL: "http://api.example.test" }).error).toMatch(/https/);
    const ok = loadWebConfig({ NEXT_PUBLIC_MONADEUM_DATA_SOURCE: "api", NEXT_PUBLIC_MONADEUM_API_URL: "http://localhost:3001/" });
    expect(ok.error).toBeNull();
    expect(ok.apiUrl).toBe("http://localhost:3001");
  });

  test("the settlement asset label comes from configuration", () => {
    const c = loadWebConfig({ NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL: "WETH", NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS: "18" });
    expect(amount("1500000000000000000", c.settlement)).toBe("1.5 WETH");
    expect(amount("1500000", loadWebConfig({}).settlement)).toBe("1.5 (settlement asset units)");
    expect(loadWebConfig({ NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS: "x" }).error).toMatch(/DECIMALS/);
  });
});

describe("API client credentials", () => {
  test("a Privy session sends a bearer token and never cookies", async () => {
    const { calls, fetch } = mockFetch(() => ({ status: 200, body: { agents: [] } }));
    const api = createApiClient("http://localhost:3001/", fetch);
    await api.as({ via: "privy", accessToken: async () => "tok.en" }).agents();
    expect(calls[0]!.url).toBe("http://localhost:3001/agents");
    expect(headers(calls[0]!).authorization).toBe("Bearer tok.en");
    expect(calls[0]!.init.credentials).toBe("omit");
  });

  test("a wallet session sends the cookie and no authorization header", async () => {
    const { calls, fetch } = mockFetch(() => ({ status: 200, body: {} }));
    await createApiClient("http://localhost:3001", fetch).as({ via: "wallet" }).stop("a/b");
    expect(calls[0]!.url).toBe("http://localhost:3001/agents/a%2Fb/stop");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.credentials).toBe("include");
    expect(headers(calls[0]!).authorization).toBeUndefined();
    expect(calls[0]!.init.body).toBe("{}");
  });

  test("wallet verify accepts the session cookie; challenge and Privy sign-in do not send cookies", async () => {
    const { calls, fetch } = mockFetch(() => ({ status: 200, body: {} }));
    const api = createApiClient("http://localhost:3001", fetch);
    await api.walletChallenge("0x1");
    await api.walletVerify("n", "0xsig");
    await api.privySignIn("a", "i");
    expect(calls.map((c) => c.init.credentials)).toEqual(["omit", "include", "omit"]);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ nonce: "n", signature: "0xsig" });
  });

  test("errors carry the API's stable reason", async () => {
    const { fetch } = mockFetch(() => ({ status: 503, body: { error: "wallets-unavailable", detail: "no vault" } }));
    const error = await createApiClient("http://x.test", fetch).as({ via: "wallet" }).stop("a").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(503);
    expect(error.reason).toBe("wallets-unavailable");
  });

  test("a missing Privy token fails before any request", async () => {
    const { calls, fetch } = mockFetch(() => ({ status: 200 }));
    const error = await createApiClient("http://x.test", fetch).as({ via: "privy", accessToken: async () => null }).me().catch((e) => e);
    expect(error.status).toBe(401);
    expect(calls.length).toBe(0);
  });

  test("an unreachable API is a network-error", async () => {
    const api = createApiClient("http://x.test", async () => {
      throw new TypeError("failed to fetch");
    });
    const error = await api.as({ via: "wallet" }).me().catch((e) => e);
    expect(error.reason).toBe("network-error");
  });
});

describe("owner-signed operations", () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const policyTypedData: TypedDataPayload = {
    domain: { name: "Monadeum Reallocation Policy", version: "1", chainId: 10143 },
    types: {
      ReallocationPolicy: [
        { name: "owner", type: "address" },
        { name: "sequence", type: "uint256" },
        { name: "policyHash", type: "bytes32" },
      ],
    },
    primaryType: "ReallocationPolicy",
    message: { owner: owner.address, sequence: "0", policyHash: `0x${"11".repeat(32)}` },
  };
  const op = (request: Operation["signatureRequest"], kind: Operation["kind"] = "revoke"): Operation => ({
    id: "op1",
    kind,
    agentIds: ["ag1"],
    owner: owner.address,
    status: "awaiting-signature",
    signatureRequest: request,
    result: null,
    error: null,
  });

  /** A wallet stand-in that answers EIP-1193 signing calls with a local key, as a browser wallet would. */
  const wallet = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "personal_sign") return owner.signMessage({ message: { raw: (params as [`0x${string}`])[0] } });
      if (method === "eth_signTypedData_v4") {
        const td = JSON.parse((params as [string, string])[1]);
        const { EIP712Domain: _, ...types } = td.types;
        return owner.signTypedData({ ...td, types });
      }
      throw new Error(method);
    },
  };

  test("typed data gains the EIP712Domain type in EIP-712 field order", () => {
    expect(withDomainType(policyTypedData).types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
    ]);
  });

  test("a typed-data signature from the wallet call verifies against the API's definition", async () => {
    const operation = op({ id: "r1", expiresAt: Date.now() + 60_000, kind: "typed-data", typedData: policyTypedData }, "policy");
    const signature = await signWith(wallet, owner.address, operation);
    const ok = await verifyTypedData({ ...policyTypedData, address: owner.address, signature: signature as `0x${string}` } as unknown as Parameters<typeof verifyTypedData>[0]);
    expect(ok).toBe(true);
  });

  test("a raw message is signed as bytes, a string as UTF-8", async () => {
    const hash = `0x${"ab".repeat(32)}` as const;
    const operation = op({ id: "r1", expiresAt: Date.now() + 60_000, kind: "message", message: { raw: hash } });
    expect(walletCall(operation.signatureRequest!, owner.address).method).toBe("personal_sign");
    const signature = await signWith(wallet, owner.address, operation);
    expect(await verifyMessage({ address: owner.address, message: { raw: hash }, signature: signature as `0x${string}` })).toBe(true);
    expect(messageHex("hi")).toBe("0x6869");
  });

  test("the wrong wallet is refused before anything is signed", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const operation = op({ id: "r1", expiresAt: 0, kind: "message", message: "x" });
    await expect(signWith(wallet, other.address, operation)).rejects.toThrow(/not this account's owner wallet/);
  });

  test("the explanation names the action, and warns that a 32-byte hash cannot be checked here", () => {
    const e = explain(op({ id: "r1", expiresAt: 0, kind: "message", message: { raw: `0x${"ab".repeat(32)}` } }), () => "alpha");
    expect(e.summary).toMatch(/Revoke alpha's session key/);
    expect(e.caution).toMatch(/cannot recompute/);
    const p = explain(op({ id: "r1", expiresAt: 0, kind: "typed-data", typedData: policyTypedData }, "policy"));
    expect(p.caution).toBeNull();
    expect(p.details.join(" ")).toMatch(/not committed on chain/);
    expect(rawPayload({ id: "r1", expiresAt: 0, kind: "typed-data", typedData: policyTypedData })).toContain("EIP712Domain");
  });
});

describe("stop this agent", () => {
  const operation: Operation = { id: "op", kind: "revoke", agentIds: ["ag1"], owner: "0x1", status: "awaiting-signature", signatureRequest: null, result: null, error: null };

  test("503 without a vault is reported honestly, as nothing changed", () => {
    const v = stopViewFromError(new ApiError(503, "wallets-unavailable"));
    expect(v.state).toBe("unavailable");
    expect("message" in v && v.message).toMatch(/Nothing was changed/);
  });

  test("the off-chain revocation is shown at once; stopped only when the chain step is verified", () => {
    const local = [{ agentId: "ag1", session: "revoking" as const, revokedAt: 1 }];
    const stopping = stopViewFromResponse({ status: "stopping", local, operation });
    expect(stopping.state).toBe("stopping");
    expect("message" in stopping && stopping.message).toMatch(/destroyed on the platform/);
    const done = stopViewFromResponse({
      status: "stopped",
      local,
      operation: { ...operation, status: "succeeded", result: [{ agentId: "ag1", result: { ok: true } }] },
    });
    expect(done.state).toBe("stopped");
    const failed = stopViewFromResponse({ status: "failed", local, operation: { ...operation, status: "failed", error: "the owner did not sign in time" } });
    expect(failed.state).toBe("failed");
  });

  test("a held stop states the bulk recovery rule", () => {
    const v = stopViewFromResponse({ status: "held", hold: { id: "h", agentIds: ["ag1"], kind: "revoke", requestedAt: 0, confirmedAt: null, released: false } });
    expect(v.state).toBe("held");
    expect("message" in v && v.message).toMatch(/more than 3 agents.*60 minutes.*15 minutes/);
  });

  test("409 no-session means there is nothing to stop", () => {
    expect(stopViewFromError(new ApiError(409, "no-session")).state).toBe("no-session");
  });

  test("revocation facts restate the chain fields", () => {
    const f = revocationFacts({ agentId: "a", revoked: true, keyDestroyed: true, state: { installed: false, validatorNonce: 1, currentNonce: 3, validNonceFrom: 2 }, enableNonce: 1 });
    expect(f.verdict).toBe("Revoked on chain");
    expect(f.facts.join(" ")).toContain("Account nonce 3");
  });
});

describe("explainer states from the API", () => {
  const ON = { enabled: true, reason: null };
  const owner = (policy: OwnerResponse["policy"], reallocation: OwnerResponse["reallocation"] = ON): OwnerResponse => ({ id: "u1", name: null, rootWallet: "0x1", reallocation, policy });
  const policy = { agentIds: ["ag1", "ag2"], reallocationCap: null, slotCeiling: null, signedAtEvaluation: null, sequence: 2, policyHash: "0x" };
  const OFF = { enabled: false, reason: REALLOCATION_OFF_REASON };

  test("switch off: every agent reads as off with the study reason, and no policy step is suggested", () => {
    for (const o of [owner(null, OFF), owner(policy, OFF), { id: "u1", name: null, rootWallet: "0x1", policy }, null]) {
      const e = explainAgent(apiAgent({ id: "ag1" }), o);
      expect(e.headline).toBe("Reallocation is off");
      const text = e.lines.join(" ");
      expect(text).toMatch(/off for every agent on this deployment/);
      expect(text).not.toMatch(/Covered by your policy|signs a policy|sign a policy/);
      expect(reallocationEnabled(o)).toBe(false);
      expect(reallocationNote(o)).toContain("adds nothing measurable");
    }
    expect(explainAgent(apiAgent(), owner(policy, OFF)).lines.join(" ")).toMatch(/sequence 2\) has no effect while reallocation is off/);
  });

  test("switch off: the note carries the API's reason; switch on: the note says so and promises no returns", () => {
    expect(reallocationNote(owner(null, { enabled: false, reason: "Off for maintenance." }))).toMatch(/^Off for maintenance\./);
    expect(reallocationNote(owner(null))).toBe(REALLOCATION_ON);
    expect(REALLOCATION_ON).not.toMatch(/outperform|higher returns|earn more/i);
    expect(REALLOCATION_OFF.startsWith(REALLOCATION_OFF_REASON)).toBe(true);
  });

  test("a retired agent reads as retired whatever the switch", () => {
    expect(explainAgent(apiAgent({ retirement: { evaluation: 4, rule: "starvation" } }), owner(null, OFF)).headline).toBe("Retired");
  });

  test("no policy: reallocation is off for this owner, and no rank is invented", () => {
    const e = explainAgent(apiAgent(), owner(null));
    expect(e.headline).toBe("Reallocation is off for you");
    expect(e.lines.join(" ")).toMatch(/no evaluation result for this agent/);
  });

  test("a policy names agents by agent ID, as the API records them, not by registry ID", () => {
    expect(explainAgent(apiAgent({ id: "ag9" }), owner(policy)).headline).toBe("Not covered by your policy");
    // Regression: an agent whose registry ID happens to equal a listed agent ID is still not covered.
    expect(explainAgent(apiAgent({ id: "ag9", registryId: "ag1" }), owner(policy)).headline).toBe("Not covered by your policy");
    // Covered by its agent ID, with or without a registry ID.
    expect(explainAgent(apiAgent({ id: "ag1", registryId: null }), owner(policy)).headline).toBe("Covered by your policy");
    const covered = explainAgent(apiAgent({ id: "ag1", registryId: "7" }), owner(policy));
    expect(covered.headline).toBe("Covered by your policy");
    expect(covered.lines.join(" ")).toMatch(/not indexed on this deployment/);
    expect(covered.lines.join(" ")).toMatch(/below its own principal/);
  });

  const settlement = { symbol: "USDC", decimals: 6 };
  const move = (over: Record<string, unknown>) => ({ evaluation: 3, source: "0xaa", sink: "0xbb", sourceAgentId: "ag1", sinkAgentId: "ag2", amount: "2000000", transactionHash: "0x01", blockNumber: "9", ...over });
  const flow = (reallocations: ReturnType<typeof move>[], reallocationsIndexed = true) => ({ ownerId: "u1", reallocations, reallocationsIndexed, spends: [] });

  test("covered: states what the last indexed move sent or received, or that nothing moved", () => {
    const sent = explainAgent(apiAgent({ id: "ag1" }), owner(policy), { flow: flow([move({ evaluation: 2, amount: "1" }), move({})]), settlement }).lines.join(" ");
    expect(sent).toMatch(/At evaluation 3, its most recent move, it sent 2 USDC to another of your agents, because it ranked lowest/);
    const received = explainAgent(apiAgent({ id: "ag2" }), owner({ ...policy, agentIds: ["ag1", "ag2"] }), { flow: flow([move({})]), settlement }).lines.join(" ");
    expect(received).toMatch(/it received 2 USDC from another of your agents, because it ranked highest/);
    expect(explainAgent(apiAgent({ id: "ag1" }), owner(policy), { flow: flow([]), settlement }).lines.join(" ")).toMatch(/No reallocation has moved capital/);
    expect(explainAgent(apiAgent({ id: "ag1" }), owner(policy), { flow: flow([], false), settlement }).lines.join(" ")).toMatch(/not indexed on this deployment/);
  });

  test("shows how close the agent is to the starvation rule, the floor, and its ceiling, without genome or formula", () => {
    const agent = apiAgent({ id: "ag1", fitnessPercentile: 8.4, lowWindows: 2, capital: "5000000", principal: "2000000", zeroDownsideFlag: true });
    const text = explainAgent(agent, owner(policy), { flow: flow([]), settlement }).lines.join(" ");
    expect(text).toMatch(/2 of 3 low windows/);
    expect(text).toMatch(/bottom 10 percent of its niche/);
    expect(text).toMatch(/Capital 5 USDC, 4\.94 USDC above the 0\.06 USDC capital floor/);
    expect(text).toMatch(/never rises above 4 times its principal, 8 USDC; it can receive up to 3 USDC more/);
    expect(text).toMatch(/flagged for zero downside/);
    expect(text).not.toMatch(/sortino|riskTolerance|entryThreshold/i);
    const low = explainAgent(apiAgent({ capital: "50000", lowWindows: 0 }), owner(null, OFF), { flow: null, settlement }).lines.join(" ");
    expect(low).toMatch(/below the 0\.06 USDC capital floor, so it retires at its next evaluation/);
    expect(low).not.toMatch(/times its principal/);
  });

  test("the product-state note says reallocation is off and promises no returns", () => {
    expect(REALLOCATION_OFF).toMatch(/off by default/);
    expect(REALLOCATION_OFF).toMatch(/adds nothing measurable/);
    expect(REALLOCATION_OFF).not.toMatch(/outperform|higher returns|earn more/i);
  });
});

describe("recorded reallocation outcomes, earnings, and events", () => {
  const settlement = { symbol: "USDC", decimals: 6 };
  const owner: OwnerResponse = {
    id: "u1", name: null, rootWallet: "0x1", reallocation: { enabled: true, reason: null },
    policy: { agentIds: ["ag1", "ag2", "ag3"], reallocationCap: null, slotCeiling: null, signedAtEvaluation: null, sequence: 2, policyHash: "0x" },
  };
  const rank = (position: number) => ({ position, of: 3, quota: 1 });

  test("a ranked agent that moved nothing names the binding reason, never the ranking formula", () => {
    const held = (reason: string, position: number) => explainAgent(apiAgent({ id: "ag1", reallocationOutcome: { evaluation: 9, kind: "held", reason, amount: null, rank: rank(position) } }), owner, { flow: null, settlement });
    expect(held("ceiling", 3).headline).toBe("Ranked, nothing moved");
    expect(held("ceiling", 3).lines.join(" ")).toMatch(/At evaluation 9 it ranked highest among the 3 agents your policy covers, but received nothing: it is at its slot ceiling/);
    expect(held("floor", 1).lines.join(" ")).toMatch(/ranked lowest .* but sent nothing: its capital is at the capital floor/);
    expect(held("zero-downside", 3).lines.join(" ")).toMatch(/flagged for zero downside/);
    expect(held("middle", 2).lines.join(" ")).toMatch(/ranked 2 of 3, counting from the lowest/);
    expect(held("counterpart", 1).lines.join(" ")).toMatch(/the agent that would have received was at its slot ceiling or flagged/);
    expect(held("counterpart", 3).lines.join(" ")).toMatch(/the agent that would have sent was at the capital floor/);
    expect(held("middle", 2).lines.join(" ")).not.toMatch(/sortino|adjusted fitness of|formula/i);
  });

  test("a sent or received outcome states the amount and why", () => {
    expect(outcomeExplained({ evaluation: 4, kind: "sent", reason: null, amount: "2000000", rank: rank(1) }, { flow: null, settlement })).toEqual({
      headline: "Sent capital",
      line: "At evaluation 4 it sent 2 USDC, because it ranked lowest among the 3 agents your policy covers.",
    });
    expect(outcomeExplained({ evaluation: 4, kind: "received", reason: null, amount: "2000000", rank: { position: 20, of: 20, quota: 2 } }, { flow: null, settlement })?.line).toMatch(/received 2 USDC, because it ranked in the top 2 among the 20/);
    expect(outcomeExplained({ evaluation: 4, kind: "off", reason: "one-agent", amount: null, rank: null })?.line).toMatch(/your only live agent/);
  });

  test("net earnings are served per agent and shown signed; without them they are named as not served", () => {
    expect(signedAmount("-36000", settlement)).toBe("-0.036 USDC");
    expect(signedAmount("36000", settlement)).toBe("0.036 USDC");
    expect(agentNotServed(apiAgent())).toContain("net earnings after costs");
    const earnings = { realizedPnl: "1", x402: "0", gas: "0", gasWei: "0", fees: "0", slippage: "0", net: "1" };
    expect(agentNotServed(apiAgent({ earnings }))).not.toContain("net earnings after costs");
  });

  test("the event feed reads retirements and reallocations as events, dated by the worker's clock", () => {
    const names = new Map([["ag1", "alpha"], ["ag2", "beta"]]);
    const feed = feedEvents(
      [
        { kind: "retirement", evaluation: 5, at: Date.UTC(2026, 9, 12, 10, 0), agentId: "ag1", rule: "capital_floor" },
        { kind: "reallocation", evaluation: 4, at: Date.UTC(2026, 9, 12, 9, 0), sources: [{ agentId: "ag1", amount: "2000000" }], sinks: [{ agentId: "ag2", amount: "2000000" }] },
      ],
      names,
      settlement,
    );
    expect(feed.map((e) => [e.kind, e.title, e.when])).toEqual([
      ["retirement", "alpha retired at evaluation 5", "2026-10-12 10:00 UTC"],
      ["reallocation", "Evaluation 4 moved 2 USDC between your agents", "2026-10-12 09:00 UTC"],
    ]);
    expect(feed[0]!.body).toMatch(/capital fell below the capital floor\. Its capital stayed in its own account/);
    expect(feed[1]!.body).toMatch(/From alpha \(2 USDC\) to beta \(2 USDC\)/);
    expect(feed[1]!.agentIds).toEqual(["ag1", "ag2"]);
  });
});
