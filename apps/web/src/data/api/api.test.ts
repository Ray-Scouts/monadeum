import { describe, expect, test } from "bun:test";
import { verifyMessage, verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadWebConfig } from "../config";
import { ApiError, createApiClient } from "./client";
import { REALLOCATION_OFF_REASON } from "@monadeum/reallocation/switch";
import { amount, explainAgent, REALLOCATION_OFF, REALLOCATION_ON, reallocationEnabled, reallocationNote } from "./present";
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
    expect(e.lines.join(" ")).toMatch(/does not serve evaluation results/);
  });

  test("a policy names agents by agent ID, as the API records them, not by registry ID", () => {
    expect(explainAgent(apiAgent({ id: "ag9" }), owner(policy)).headline).toBe("Not covered by your policy");
    // Regression: an agent whose registry ID happens to equal a listed agent ID is still not covered.
    expect(explainAgent(apiAgent({ id: "ag9", registryId: "ag1" }), owner(policy)).headline).toBe("Not covered by your policy");
    // Covered by its agent ID, with or without a registry ID.
    expect(explainAgent(apiAgent({ id: "ag1", registryId: null }), owner(policy)).headline).toBe("Covered by your policy");
    const covered = explainAgent(apiAgent({ id: "ag1", registryId: "7" }), owner(policy));
    expect(covered.headline).toBe("Covered by your policy");
    expect(covered.lines.join(" ")).toMatch(/not indexed yet/);
    expect(covered.lines.join(" ")).toMatch(/below its own principal/);
  });

  test("the product-state note says reallocation is off and promises no returns", () => {
    expect(REALLOCATION_OFF).toMatch(/off by default/);
    expect(REALLOCATION_OFF).toMatch(/adds nothing measurable/);
    expect(REALLOCATION_OFF).not.toMatch(/outperform|higher returns|earn more/i);
  });
});
