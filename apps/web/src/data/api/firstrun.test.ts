import { describe, expect, test } from "bun:test";
import { loadWebConfig } from "../config";
import { firstRunSteps, nextStep, ownerNextStep } from "./firstrun";
import { apiAgent } from "./fixtures";
import { detailSuffix, plainThrown, safeDetail } from "./plain";

const settlement = loadWebConfig({ NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL: "USDC" }).settlement;
const states = (a: Parameters<typeof firstRunSteps>[0]) => firstRunSteps(a, settlement).map((s) => `${s.id}:${s.state}`);

describe("first-run checklist", () => {
  test("an undeployed agent: deploy is next, and funding, activation, and trading wait with their reasons", () => {
    const steps = firstRunSteps(apiAgent({ deployment: "not-started", address: null, session: null, principal: "0" }), settlement);
    expect(steps.map((s) => `${s.id}:${s.state}`)).toEqual(["deploy:current", "fund:blocked", "activate:blocked", "watch:blocked"]);
    expect(steps[0]!.action?.href).toBe("/agents/ag1#account");
    expect(steps[1]!.detail).toMatch(/Needs the account deployed first/);
    expect(steps[2]!.detail).toMatch(/Needs the account deployed first/);
  });

  test("a pending deployment is described as unfinished, not as not started", () => {
    expect(firstRunSteps(apiAgent({ deployment: "pending", session: null }), settlement)[0]!.detail).toMatch(/not finished/);
  });

  test("a deployed, unfunded, keyless agent: fund and activate are both available, trading is blocked", () => {
    const steps = firstRunSteps(apiAgent({ session: null, principal: "0" }), settlement);
    expect(steps.map((s) => `${s.id}:${s.state}`)).toEqual(["deploy:done", "fund:current", "activate:current", "watch:blocked"]);
    expect(steps[1]!.action?.href).toBe("/agents/ag1#fund");
    expect(steps[2]!.detail).toMatch(/both funded and active/);
    expect(steps[3]!.detail).toMatch(/funding and activation/);
  });

  test("funded and active with no trade: waiting, and it says trading also depends on the operator, off by default", () => {
    const steps = firstRunSteps(apiAgent({ principal: "5000000", tradeCount: 0 }), settlement);
    expect(steps.map((s) => `${s.id}:${s.state}`)).toEqual(["deploy:done", "fund:done", "activate:done", "watch:waiting"]);
    expect(steps[1]!.detail).toContain("5 USDC");
    expect(steps[3]!.detail).toMatch(/No trade is recorded yet.*off by default/);
    expect(nextStep(steps)?.id).toBe("watch");
  });

  test("done only when the API reports a trade", () => {
    const steps = firstRunSteps(apiAgent({ principal: "5000000", tradeCount: 3 }), settlement);
    expect(steps[3]!.state).toBe("done");
    expect(steps[3]!.detail).toBe("3 trades recorded. Capital and spends update on this page.");
    expect(nextStep(steps)).toBeNull();
  });

  test("a stopped agent can be activated again; a stop in progress waits", () => {
    const revoked = apiAgent({ principal: "1", session: { status: "revoked", keyAddress: "0xcc", issuedAt: 0, revokedAt: 1 } });
    expect(firstRunSteps(revoked, settlement)[2]!.action?.label).toBe("Activate again");
    const revoking = apiAgent({ principal: "1", session: { status: "revoking", keyAddress: "0xcc", issuedAt: 0, revokedAt: null } });
    expect(states(revoking)[2]).toBe("activate:waiting");
  });

  test("a retired agent has no actions", () => {
    const steps = firstRunSteps(apiAgent({ status: "retired", session: null, principal: "0" }), settlement);
    expect(steps.every((s) => s.action === null)).toBe(true);
  });

  test("the dashboard points at the newest unfinished live agent, and at nothing once setup is done", () => {
    const old = apiAgent({ id: "old", createdAt: 1, session: null });
    const fresh = apiAgent({ id: "new", createdAt: 2, deployment: "not-started", address: null, session: null });
    expect(ownerNextStep([old, fresh], settlement)?.agent.id).toBe("new");
    expect(ownerNextStep([apiAgent({ principal: "1" })], settlement)).toBeNull();
    expect(ownerNextStep([], settlement)).toBeNull();
  });
});

describe("plain failure text", () => {
  test("keeps a short readable detail and drops hex dumps, long text, and multiple lines", () => {
    expect(safeDetail("perTxCap exceeds 1000000")).toBe("perTxCap exceeds 1000000");
    expect(safeDetail(`reverted 0x${"ab".repeat(40)}`)).toBeNull();
    expect(safeDetail("x".repeat(200))).toBeNull();
    expect(safeDetail("a\nb")).toBeNull();
    expect(detailSuffix(null)).toBe("");
    expect(detailSuffix("too high")).toBe(" (too high)");
  });

  test("a thrown value falls back when its message is unreadable", () => {
    expect(plainThrown(new Error("User rejected"), "fallback")).toBe("User rejected");
    expect(plainThrown(new Error(`0x${"cd".repeat(60)}`), "fallback")).toBe("fallback");
    expect(plainThrown(42, "fallback")).toBe("fallback");
  });
});
