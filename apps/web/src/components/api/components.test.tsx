import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { apiAgent } from "@/data/api/fixtures";
import { stopViewFromError, stopViewFromResponse } from "@/data/api/stop";
import { ApiError } from "@/data/api/client";
import { loadWebConfig } from "@/data/config";
import type { FundingPrepared, Operation, SessionView } from "@/data/api/types";
import { activateViewFromError, activateViewFromOperation } from "@/data/api/activate";
import { ActivatePanel, type ActivatePanelProps } from "./ActivateAgent";
import { explainFunding, fundingOperation } from "@/data/api/funding";
import { CardFundingNotice, CARD_FUNDING_COPY } from "./CardFundingNotice";
import { CreateFormView } from "./CreateAgent";
import { SignatureRequestView } from "./OperationSigner";
import { SignInPanel } from "./SignIn";
import { StopPanel, type StopPanelProps } from "./StopAgent";
import { agentNotServed } from "@/data/api/present";
import { AgentFacts, CapitalFlowView, CapitalHistoryCard, EarningsCard, PopulationView, averageFitness, roi } from "./views";
import { SampleReallocationNote } from "@/components/SampleReallocationNote";
import { REALLOCATION_OFF_REASON } from "@monadeum/reallocation/switch";

// Component states rendered to markup from the props an API answer produces.

const settlement = loadWebConfig({ NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL: "USDC" }).settlement;
const noop = () => undefined;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

describe("sign-in", () => {
  test("social login comes first, the external wallet below the advanced divider", () => {
    const html = text(renderToStaticMarkup(<SignInPanel privyAvailable privyReady busy={false} error={null} onPrivy={noop} onWallet={noop} />));
    const social = html.indexOf("Continue with email or Google");
    const divider = html.indexOf("advanced");
    const wallet = html.indexOf("Sign in with an external wallet");
    expect(social).toBeGreaterThan(-1);
    expect(social).toBeLessThan(divider);
    expect(divider).toBeLessThan(wallet);
  });

  test("without a Privy app ID the social path says it is not configured", () => {
    const html = renderToStaticMarkup(<SignInPanel privyAvailable={false} privyReady={false} busy={false} error="x" onPrivy={noop} onWallet={noop} />);
    expect(html).toContain("not configured on this deployment");
  });
});

describe("fund this agent", () => {
  test("the authorization is summarized in plain words first, with the raw typed data expandable", () => {
    const owner = "0x00000000000000000000000000000000000000a0";
    const prepared: FundingPrepared = {
      funding: { nonce: `0x${"ab".repeat(32)}`, agentId: "a1", status: "prepared", from: owner, to: "0x00000000000000000000000000000000000000ac", value: "5000000", validAfter: "1", validBefore: "601", txHash: null, blockNumber: null, submittedAt: null, error: null },
      agent: { id: "a1", name: "alpha" },
      decimals: 6,
      expiresAt: 601_000,
      typedData: {
        domain: { name: "USDC", version: "2", chainId: 10143, verifyingContract: "0x534b2f3A21130d7a60830c2Df862319e593943A3" },
        types: { TransferWithAuthorization: [{ name: "to", type: "address" }] },
        primaryType: "TransferWithAuthorization",
        message: { from: owner, to: "0x00000000000000000000000000000000000000ac", value: "5000000", validAfter: "1", validBefore: "601", nonce: `0x${"ab".repeat(32)}` },
      },
    };
    const html = text(
      renderToStaticMarkup(
        <SignatureRequestView operation={fundingOperation(prepared, owner)} explanation={explainFunding(prepared, owner)} busy={false} error={null} onSign={noop} />,
      ),
    );
    const summary = html.indexOf("Move 5 USDC from your owner wallet to alpha's account.");
    const raw = html.indexOf("Raw data your wallet will sign (EIP-712 typed data)");
    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(raw);
    expect(html).toContain("pays the network fee");
    expect(html).not.toContain("Do not sign");
  });
});

describe("card funding notice", () => {
  const html = renderToStaticMarkup(<CardFundingNotice />);

  test("says card payment is coming soon and that today the owner wallet funds the agent", () => {
    const words = text(html);
    expect(words).toContain("Coming soon");
    expect(words).toContain("not available yet");
    expect(words).toContain("sending USDC from your own owner wallet");
  });

  test("the card option is a disabled, non-focusable button, not a link or a form", () => {
    const button = html.match(/<button[^>]*>/)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toContain("disabled");
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toContain("tabindex");
    expect(html).not.toMatch(/<(a|form|input|select|textarea|iframe)[\s>]/);
    expect(html).not.toContain("href=");
  });

  test("names no vendor, date, or price, and asks for no personal data", () => {
    const words = text(html).toLowerCase();
    for (const vendor of ["ramp", "coinbase", "moonpay", "transak", "stripe", "privy", "visa", "mastercard"]) expect(words).not.toContain(vendor);
    expect(words).not.toMatch(/\b(20\d\d|q[1-4]|january|february|march|april|june|july|august|september|october|november|december|fee)\b/);
    expect(words).toContain("no card or personal details are collected");
    expect([...JSON.stringify(CARD_FUNDING_COPY)].some((c) => c.charCodeAt(0) === 0x2013 || c.charCodeAt(0) === 0x2014)).toBe(false);
  });
});

describe("stop this agent", () => {
  const base: StopPanelProps = {
    agentName: "alpha",
    session: apiAgent().session,
    view: { state: "idle" },
    confirming: false,
    revocation: null,
    holdReadyAt: null,
    now: 0,
    onOpen: noop,
    onCancel: noop,
    onConfirm: noop,
    onConfirmHold: noop,
    onReleaseHold: noop,
  };

  test("is an explicitly labeled emergency stop, distinct from retirement, one click from the page", () => {
    const html = text(renderToStaticMarkup(<StopPanel {...base} />));
    expect(html).toContain("Stop this agent");
    expect(html).toContain("Emergency stop");
    expect(html).toContain("This is not retirement");
    expect(html).not.toContain("Yes, stop now");
  });

  test("the second interaction is the confirmation", () => {
    const html = text(renderToStaticMarkup(<StopPanel {...base} confirming />));
    expect(html).toContain("Yes, stop now");
    expect(html).toContain("alpha");
  });

  test("a 503 shows the honest unavailable message", () => {
    const html = text(renderToStaticMarkup(<StopPanel {...base} view={stopViewFromError(new ApiError(503, "wallets-unavailable"))} revocation={{ unavailable: "Not available on this server" }} />));
    expect(html).toContain("no session key vault configured");
    expect(html).toContain("Not available on this server");
  });

  test("the verifiable status from chain is shown", () => {
    const html = text(
      renderToStaticMarkup(
        <StopPanel
          {...base}
          session={{ ...base.session!, status: "revoked" }}
          revocation={{ status: { agentId: "ag1", revoked: true, keyDestroyed: true, state: { installed: false, validatorNonce: 1, currentNonce: 3, validNonceFrom: 2 }, enableNonce: 1 } }}
        />,
      ),
    );
    expect(html).toContain("Revoked on chain");
    expect(html).toContain("Permission validator installed: no");
  });

  test("a held stop offers the confirmation with the agent count", () => {
    const view = stopViewFromResponse({ status: "held", hold: { id: "h", agentIds: ["ag1"], kind: "revoke", requestedAt: 0, confirmedAt: null, released: false } });
    expect(text(renderToStaticMarkup(<StopPanel {...base} view={view} />))).toContain("Confirm: this affects 1 agent");
  });
});

describe("owner signature request", () => {
  test("plain language first, the raw typed data in an expandable section", () => {
    const operation: Operation = {
      id: "op",
      kind: "policy",
      agentIds: ["ag1", "ag2"],
      owner: "0x00000000000000000000000000000000000000bb",
      status: "awaiting-signature",
      signatureRequest: {
        id: "r",
        expiresAt: 0,
        kind: "typed-data",
        typedData: { domain: { name: "Monadeum Reallocation Policy", version: "1", chainId: 10143 }, types: { P: [{ name: "sequence", type: "uint256" }] }, primaryType: "P", message: { sequence: "0" } },
      },
      result: null,
      error: null,
    };
    const html = renderToStaticMarkup(<SignatureRequestView operation={operation} name={(id) => (id === "ag1" ? "alpha" : "beta")} busy={false} error={null} onSign={noop} />);
    expect(text(html)).toContain("Sign a reallocation policy covering alpha and beta");
    expect(html).toContain("<details>");
    expect(html).toContain("EIP712Domain");
    expect(text(html)).toContain("No key leaves your wallet");
  });
});

describe("read views", () => {
  test("population shows platform totals, the caller's agents, and states what is not served", () => {
    const html = text(
      renderToStaticMarkup(
        <PopulationView
          population={{ agents: 4, accounts: { tracked: 2, deployed: 1 }, liveSessionKeys: 1, totalSpent: "2500000", cursor: { blockNumber: "99", blockHash: "0x" } }}
          agents={[apiAgent()]}
          settlement={settlement}
        />,
      ),
    );
    expect(html).toContain("2.5 USDC");
    expect(html).toContain("alpha");
    expect(html).toContain("Not served by the API yet");
    expect(html).toContain("Reallocation is off by default");
    expect(html).toContain("adds nothing measurable");
  });
});

describe("population dashboard", () => {
  const today = { agents: 4, accounts: { tracked: 2, deployed: 1 }, liveSessionKeys: 1, totalSpent: "2500000", cursor: { blockNumber: "99", blockHash: "0x" } };
  const genome = {
    strategyType: "momentum",
    assetUniverse: ["WETH", "USDC"],
    riskTolerance: 0.12,
    executionFrequency: 24,
    timeHorizon: 24,
    entryThreshold: 0.0002,
    exitThreshold: 0,
    informationSources: [],
    informationBudget: "0",
    modelConfiguration: "low",
    hash: "0xabcdef0123",
    preset: "balanced",
  };

  test("against today's API shape, the dashboard layout renders with every missing figure as pending", () => {
    // An agent exactly as the API serves it before the new fields exist: the optional keys are absent, not null.
    const { capital, tradeCount, fitnessPercentile, lowWindows, zeroDownsideFlag, retirement, capitalHistory, ...bare } = apiAgent();
    void [capital, tradeCount, fitnessPercentile, lowWindows, zeroDownsideFlag, retirement, capitalHistory];
    const html = text(renderToStaticMarkup(<PopulationView population={today} agents={[bare]} settlement={settlement} />));
    expect(html).toContain("Your agents by niche");
    expect(html).toContain("None of your live agents has a committed genome yet");
    expect(html).toContain("x402 spend");
    expect(html).toContain("Pending");
    expect(html).toContain("Not ranked yet");
    expect(html).toContain("Not served by the API yet, so not shown: capital, capital history, net earnings after costs, fitness, trades, x402 purchases, evaluation outcomes.");
    expect(html).toContain("Indexed spends, all owners, to block 99");
    expect(html).not.toMatch(/\$\d/);
  });

  test("with the new fields served, the figures fill in and the not-served list shrinks to what is still missing", () => {
    const x402 = { purchases: 7, spent: "3000000", byProvider: [{ provider: "nansen", spent: "2000000" }, { provider: "defillama", spent: "1000000" }] };
    const agent = apiAgent({
      genome,
      principal: "10000000",
      capital: "12500000",
      tradeCount: 31,
      fitnessPercentile: 72,
      lowWindows: 0,
      capitalHistory: [
        { evaluation: 1, capital: "10000000" },
        { evaluation: 2, capital: "12500000" },
      ],
      x402: { purchases: 2, spent: "500000", byProvider: [{ provider: "nansen", spent: "500000" }] },
    });
    const population = { ...today, capital: "40000000", trades: 120, x402, lastEvaluation: { sequence: 9, at: Date.UTC(2026, 9, 1, 12, 0) } };
    const raw = renderToStaticMarkup(<PopulationView population={population} agents={[agent]} settlement={settlement} />);
    const html = text(raw);
    expect(html).toContain("40 USDC");
    expect(html).toContain("12.5 USDC");
    expect(html).toContain("120");
    expect(html).toContain("31");
    expect(html).toContain("72");
    expect(html).toContain("#9");
    expect(html).toContain("2026-10-01 12:00 UTC");
    expect(html).toContain("Nansen");
    expect(html).toContain("DeFiLlama");
    expect(html).toContain("7 purchases, 3 USDC in total");
    expect(html).toContain("1 distinct niche across 1 live agent");
    expect(raw).toContain("Capital after evaluations 1 to 2");
    expect(html).not.toContain("Pending");
    expect(html).toContain("Not served by the API yet, so not shown: net earnings after costs.");
  });

  test("the per-agent view shows the hero, the figures it has, and pending cards for the rest", () => {
    const bare = text(renderToStaticMarkup(<><AgentFacts agent={apiAgent()} settlement={settlement} /><CapitalHistoryCard agent={apiAgent()} settlement={settlement} /></>));
    expect(bare).toContain("alpha");
    expect(bare).toContain("Session key active");
    expect(bare).toContain("Not funded, not trading");
    expect(bare).toContain("Pending");
    expect(bare).toContain("Capital history");
    expect(bare).toContain("Not served by the API yet.");

    const served = apiAgent({
      genome,
      principal: "10000000",
      capital: "9000000",
      tradeCount: 4,
      fitnessPercentile: 100 / 12,
      lowWindows: 2,
      zeroDownsideFlag: true,
      capitalHistory: [
        { evaluation: 3, capital: "10000000" },
        { evaluation: 4, capital: "9000000" },
      ],
    });
    const raw = renderToStaticMarkup(<><AgentFacts agent={served} settlement={settlement} /><CapitalHistoryCard agent={served} settlement={settlement} /></>);
    const html = text(raw);
    expect(html).toContain("9 USDC");
    expect(html).toContain("Principal 10 USDC");
    expect(html).toContain("P8");
    expect(html).not.toContain("8.33");
    expect(html).toContain("2 low windows in a row");
    expect(html).toContain("Flagged");
    expect(raw).toContain("Capital after evaluations 3 to 4, now 9 USDC");
    expect(agentNotServed(served)).toEqual(["net earnings after costs", "x402 purchases"]);
  });
});

describe("read views, continued", () => {

  test("capital flow with reallocation off shows it off for every agent and no policy state", () => {
    const owner = { id: "u1", name: null, rootWallet: "0x1", reallocation: { enabled: false, reason: REALLOCATION_OFF_REASON }, policy: { agentIds: ["a"], reallocationCap: null, slotCeiling: null, signedAtEvaluation: null, sequence: 3, policyHash: "0x" } };
    const html = text(renderToStaticMarkup(<CapitalFlowView flow={{ ownerId: "u1", reallocations: [], reallocationsIndexed: false, spends: [] }} agents={[]} owner={owner} settlement={settlement} />));
    expect(html).toContain("Off for every agent on this deployment");
    expect(html).toContain("adds nothing measurable");
    expect(html).not.toContain("Signed, sequence 3");
  });

  test("capital flow with reallocation on shows the recorded policy, as before", () => {
    const owner = { id: "u1", name: null, rootWallet: "0x1", reallocation: { enabled: true, reason: null }, policy: { agentIds: ["a"], reallocationCap: null, slotCeiling: null, signedAtEvaluation: null, sequence: 3, policyHash: "0x" } };
    const html = text(renderToStaticMarkup(<CapitalFlowView flow={{ ownerId: "u1", reallocations: [], reallocationsIndexed: false, spends: [] }} agents={[]} owner={owner} settlement={settlement} />));
    expect(html).toContain("Signed, sequence 3");
    expect(html).toContain("Reallocation is on for this deployment");
    expect(html).not.toContain("Off for every agent");
  });

  test("the sample screens say the sample shows the design and that a deployment runs with reallocation off", () => {
    const html = text(renderToStaticMarkup(<SampleReallocationNote />));
    expect(html).toContain("does not describe a running deployment");
    expect(html).toContain("Reallocation is off by default");
  });

  test("capital flow says reallocations are not indexed rather than showing an empty list as fact", () => {
    const html = text(
      renderToStaticMarkup(
        <CapitalFlowView flow={{ ownerId: "u1", reallocations: [], reallocationsIndexed: false, spends: [] }} agents={[]} owner={null} settlement={settlement} />,
      ),
    );
    expect(html).toContain("Reallocations are not indexed on this deployment");
    expect(html).toContain("does not mean nothing moved");
  });
});

describe("net earnings", () => {
  test("shows the net figure and each cost, or pending when the API does not serve them", () => {
    const earnings = { realizedPnl: "100000", x402: "55000", gas: "6000", gasWei: "2000000000000000", fees: "2000", slippage: "1000", net: "36000" };
    const html = text(renderToStaticMarkup(<EarningsCard agent={apiAgent({ earnings, principal: "10000000" })} settlement={settlement} />));
    expect(html).toContain("Return on principal: 0.36%");
    expect(roi("-36000", "10000000")).toBe("-0.36%");
    expect(roi("1", null)).toBeNull();
    expect(averageFitness([apiAgent({ fitnessPercentile: 40 }), apiAgent({ fitnessPercentile: 61 }), apiAgent()])).toBe(51);
    expect(averageFitness([apiAgent()])).toBeNull();
    expect(html).toContain("0.036 USDC");
    expect(html).toContain("Realized P&amp;L");
    expect(html).toContain("-0.055 USDC");
    expect(html).toContain("0.002 MON");
    expect(text(renderToStaticMarkup(<EarningsCard agent={apiAgent()} settlement={settlement} />))).toContain("Not served by the API yet");
  });
});

describe("indexed reallocations", () => {
  test("capital flow lists each indexed move with both agents, the amount, and the evaluation", () => {
    const owner = { id: "u1", name: null, rootWallet: "0x1", reallocation: { enabled: true, reason: null }, policy: null };
    const flow = {
      ownerId: "u1",
      reallocationsIndexed: true,
      spends: [],
      reallocations: [
        { evaluation: 3, source: "0xaa", sink: "0xbb", sourceAgentId: "a", sinkAgentId: "b", amount: "2000000", transactionHash: `0x${"0a".repeat(32)}`, blockNumber: "900" },
      ],
    };
    const html = text(renderToStaticMarkup(<CapitalFlowView flow={flow} agents={[apiAgent({ id: "a", name: "alpha" }), apiAgent({ id: "b", name: "beta" })]} owner={owner} settlement={settlement} />));
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("2 USDC");
    expect(html).not.toContain("not indexed");
  });
});

describe("create in api mode", () => {
  test("shows the preset in plain language, its genome hash, and that the agent will not trade until funded", () => {
    const html = text(
      renderToStaticMarkup(
        <CreateFormView
          presets={{
            default: "conservative",
            pair: "WETH/USDC",
            presets: [
              {
                name: "conservative",
                riskTolerance: 0.1,
                executionFrequency: 24,
                timeHorizon: 24,
                entryThreshold: 0.0002,
                exitThreshold: 0,
                informationSources: [],
                informationBudget: "0",
                modelConfiguration: "low",
                genomeHash: "0xfeed",
              },
            ],
          }}
          form={{ name: "", perTxCap: "", dailyCap: "", preset: "conservative" }}
          settlement={settlement}
          busy={false}
          error="The platform is at its population cap"
          onChange={noop}
          onSubmit={noop}
        />,
      ),
    );
    expect(html).toContain("Trades WETH/USDC");
    expect(html).toContain("Genome hash 0xfeed");
    expect(html).toContain("will not trade until it is funded");
    expect(html).toContain("Only USDC sent from your owner wallet");
    expect(html).toContain("only once that account is deployed");
    expect(html).toContain("Per-transaction cap (USDC)");
    expect(html).toContain("population cap");
    expect(html).not.toMatch(/riskTolerance|entryThreshold/);
  });
});

describe("activate this agent", () => {
  const keyless = apiAgent({ session: null });
  const chainSession: SessionView = {
    status: "active",
    keyAddress: "0x00000000000000000000000000000000000000cc",
    permissionId: "0x12345678",
    issuedAt: 0,
    keyHeld: true,
    state: { installed: false, validatorNonce: 0, currentNonce: 1, validNonceFrom: 0 },
    enableNonce: 1,
    acceptedOnChain: true,
  };
  const base: ActivatePanelProps = { agent: keyless, view: { state: "idle" }, session: null, settlement, onActivate: noop };

  test("states what the key can and cannot do, and that activation does not start trading", () => {
    const html = text(renderToStaticMarkup(<ActivatePanel {...base} />));
    expect(html).toContain("Activate this agent");
    expect(html).toContain("Activate agent");
    expect(html).toContain("The key can");
    expect(html).toContain("Spend at most 1.5 USDC per transaction and 5 USDC per rolling day");
    expect(html).toContain("The key cannot");
    expect(html).toContain("Send funds to an address of its choosing");
    expect(html).toContain("has not been checked yet");
    expect(html).toContain("Activating does not make the agent trade yet");
  });

  test("a stopped agent is offered a new key, and the old one is said to stay revoked", () => {
    const html = text(renderToStaticMarkup(<ActivatePanel {...base} agent={apiAgent({ session: { status: "revoked", keyAddress: "0x00000000000000000000000000000000000000cc", issuedAt: 0, revokedAt: 1 } })} />));
    expect(html).toContain("Activate this agent again");
    expect(html).toContain("revoked for good");
  });

  test("the active state shows the key as read from chain and no activation button", () => {
    const html = text(renderToStaticMarkup(<ActivatePanel {...base} agent={apiAgent()} session={chainSession} />));
    expect(html).toContain("Active");
    expect(html).not.toContain("Activate agent");
    expect(html).toContain("Accepted on chain: the account will install the permission with the agent's first operation.");
    expect(html).toContain("approval bound to nonce 1");
  });

  test("activation is signed through the plain-language summary with the raw Kernel typed data expandable", () => {
    const operation: Operation = {
      id: "op",
      kind: "activate",
      agentIds: ["ag1"],
      owner: "0x00000000000000000000000000000000000000bb",
      status: "awaiting-signature",
      signatureRequest: {
        id: "r",
        expiresAt: 0,
        kind: "typed-data",
        typedData: { domain: { name: "Kernel", version: "0.3.1", chainId: 10143, verifyingContract: "0x00000000000000000000000000000000000000aa" }, types: { Enable: [{ name: "nonce", type: "uint32" }] }, primaryType: "Enable", message: { nonce: 1 } },
      },
      result: null,
      error: null,
    };
    expect(activateViewFromOperation(operation).state).toBe("signing");
    const html = renderToStaticMarkup(<SignatureRequestView operation={operation} name={() => "alpha"} busy={false} error={null} onSign={noop} />);
    expect(text(html)).toContain("Activate alpha: approve a session key that can make only the allowlisted calls");
    expect(text(html)).toContain("sends no transaction and costs no gas");
    expect(html).toContain("<details>");
    expect(html).toContain("&quot;primaryType&quot;: &quot;Enable&quot;");
  });

  test("the outcome is taken from the API: issued and accepted on chain, refused, or failed", () => {
    const finished = (status: Operation["status"], result: unknown, error: string | null = null): Operation => ({
      id: "op", kind: "activate", agentIds: ["ag1"], owner: "0xbb", status, signatureRequest: null, result, error,
    });
    const ok = activateViewFromOperation(finished("succeeded", { result: { ok: true, keyAddress: "0xcc", permissionId: "0x12", issued: true }, session: chainSession }));
    expect(ok.state).toBe("active");
    const notAccepted = activateViewFromOperation(finished("succeeded", { result: { ok: true, keyAddress: "0xcc", permissionId: "0x12", issued: true }, session: { ...chainSession, acceptedOnChain: false } }));
    expect(notAccepted.state).toBe("failed");
    const refused = activateViewFromOperation(finished("succeeded", { result: { ok: false, reason: "rejected", detail: "nonce moved" }, session: null }));
    expect(refused.state === "failed" && refused.message).toContain("rejected: nonce moved");
    expect(activateViewFromOperation(finished("failed", null, "the owner did not sign in time")).state).toBe("failed");
    expect(activateViewFromError(new ApiError(409, "already-active")).state).toBe("active");
    expect(activateViewFromError(new ApiError(503, "wallets-unavailable")).state).toBe("unavailable");
    const html = text(renderToStaticMarkup(<ActivatePanel {...base} view={activateViewFromError(new ApiError(409, "not-deployed"))} />));
    expect(html).toContain("not deployed yet");
  });
});
