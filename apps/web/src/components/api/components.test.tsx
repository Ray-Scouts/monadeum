import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { apiAgent } from "@/data/api/fixtures";
import { stopViewFromError, stopViewFromResponse } from "@/data/api/stop";
import { ApiError } from "@/data/api/client";
import { loadWebConfig } from "@/data/config";
import type { Operation } from "@/data/api/types";
import { SignatureRequestView } from "./OperationSigner";
import { SignInPanel } from "./SignIn";
import { StopPanel, type StopPanelProps } from "./StopAgent";
import { CapitalFlowView, PopulationView } from "./views";

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
  });

  test("capital flow says reallocations are not indexed rather than showing an empty list as fact", () => {
    const html = text(
      renderToStaticMarkup(
        <CapitalFlowView flow={{ ownerId: "u1", reallocations: [], reallocationsIndexed: false, spends: [] }} agents={[]} owner={null} settlement={settlement} />,
      ),
    );
    expect(html).toContain("Reallocations are not indexed yet");
    expect(html).toContain("does not mean nothing moved");
  });
});
