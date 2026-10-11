import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import AppLayout from "@/app/(app)/layout";
import LoginPage from "@/app/login/page";
import { AppFrame } from "@/components/AppFrame";
import { USES_API } from "@/data/config";
import { AuthContext, PENDING_PRIVY, type Auth, type AuthState, type PrivyBridge } from "./auth";
import { AppGate } from "./gate";
import { HOME_PATH, LOGIN_PATH, gateDecision, homeDecision, loginDecision, loginHref, safeNext } from "./navigation";
import { PRIVY_FAILED_ERROR } from "./ApiRoot";
import { LoginScreen, SignInPanel } from "./SignIn";

// The landing's CSS module is a build artifact Bun does not produce; class names stand in for it.
mock.module("@/app/_landing/landing.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));
const { Home } = await import("@/app/_landing/Home");

// Session gating of `api` mode. Effects (the redirects themselves) do not run in a static render, so the redirect
// targets are tested on the decision functions the components call, and the components on what they render.

const loading: AuthState = { status: "loading" };
const signedOut: AuthState = { status: "signed-out", error: null };
const signedIn = { status: "signed-in", via: "wallet", user: { ownerWallet: null }, session: {} } as unknown as AuthState;

const noop = () => undefined;
function auth(state: AuthState, privy: PrivyBridge | null = PENDING_PRIVY): Auth {
  return {
    state,
    client: null,
    privy,
    privyError: null,
    busy: false,
    signInWithPrivy: noop,
    signInWithWallet: async () => undefined,
    signOut: async () => undefined,
    ownerWallet: async () => {
      throw new Error("unused");
    },
  };
}

const router = { back: noop, forward: noop, refresh: noop, hmrRefresh: noop, push: noop, replace: noop, prefetch: noop };
function render(node: ReactNode, state: AuthState = loading, privy?: PrivyBridge | null) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router as never}>
      <PathnameContext.Provider value="/population">
        <AuthContext.Provider value={auth(state, privy)}>{node}</AuthContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
/** Whether the button labeled `label` carries the disabled attribute. */
function disabled(html: string, label: string): boolean {
  const button = html.split("<button").find((part) => part.split("</button>")[0]!.includes(label));
  if (!button) throw new Error(`no button ${label}`);
  return button.slice(0, button.indexOf(">")).includes("disabled");
}

const frame = (
  <AppFrame live={null} account={null}>
    <p>agent table</p>
  </AppFrame>
);

describe("next parameter", () => {
  test("accepts a same-origin relative path, with its query", () => {
    expect(safeNext("/agents/ag1?tab=trades")).toBe("/agents/ag1?tab=trades");
    expect(safeNext("/capital-flow")).toBe("/capital-flow");
  });

  test("rejects anything that could leave the origin", () => {
    for (const raw of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/..//evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
      null,
      undefined,
    ]) {
      expect(safeNext(raw)).toBe(HOME_PATH);
    }
  });

  test("never sends a signed-in user back to the sign-in page", () => {
    expect(safeNext("/login")).toBe(HOME_PATH);
    expect(safeNext("/login?next=/x")).toBe(HOME_PATH);
  });

  test("the sign-in link keeps the intended path, encoded", () => {
    expect(loginHref("/agents/ag1", "?tab=trades")).toBe(`${LOGIN_PATH}?next=${encodeURIComponent("/agents/ag1?tab=trades")}`);
    expect(loginHref(HOME_PATH, "")).toBe(LOGIN_PATH);
  });
});

describe("redirects", () => {
  test("an unauthenticated app route goes to the sign-in page with next", () => {
    expect(gateDecision(signedOut, "/capital-flow", "")).toEqual({ kind: "redirect", to: "/login?next=%2Fcapital-flow" });
  });

  test("an app route waits while the session is unknown and renders only for a confirmed session", () => {
    expect(gateDecision(loading, "/capital-flow", "")).toEqual({ kind: "pending" });
    expect(gateDecision(signedIn, "/capital-flow", "")).toEqual({ kind: "render" });
  });

  test("signing out returns to a plain sign-in page", () => {
    expect(gateDecision({ status: "signed-out", error: null, byUser: true }, "/capital-flow", "")).toEqual({ kind: "redirect", to: LOGIN_PATH });
  });

  test("/ goes to the population when signed in, to the sign-in page otherwise", () => {
    expect(homeDecision(signedIn)).toEqual({ kind: "redirect", to: HOME_PATH });
    expect(homeDecision(signedOut)).toEqual({ kind: "redirect", to: LOGIN_PATH });
    expect(homeDecision(loading)).toEqual({ kind: "pending" });
  });

  test("after sign-in, the page goes to next, or the population, and refuses an open redirect", () => {
    expect(loginDecision(signedIn, "?next=%2Fagents%2Fag1")).toEqual({ kind: "redirect", to: "/agents/ag1" });
    expect(loginDecision(signedIn, "")).toEqual({ kind: "redirect", to: HOME_PATH });
    expect(loginDecision(signedIn, "?next=https%3A%2F%2Fevil.example")).toEqual({ kind: "redirect", to: HOME_PATH });
    expect(loginDecision(signedIn, "?next=%2F%2Fevil.example")).toEqual({ kind: "redirect", to: HOME_PATH });
  });

  test("the sign-in page shows while the session is unknown or signed out", () => {
    expect(loginDecision(loading, "")).toEqual({ kind: "render" });
    expect(loginDecision(signedOut, "")).toEqual({ kind: "render" });
  });
});

describe("app gate", () => {
  test("renders no navigation rail and no screen before the session is confirmed", () => {
    for (const state of [loading, signedOut]) {
      const html = render(<AppGate>{frame}</AppGate>, state);
      expect(html).not.toContain('aria-label="Navigation"');
      expect(html).not.toContain("agent table");
      expect(html).not.toContain("Population cap");
      expect(text(html)).toContain("Checking your session");
    }
  });

  test("renders the navigation rail and the screen for a confirmed session", () => {
    const html = render(<AppGate>{frame}</AppGate>, signedIn);
    expect(html).toContain('aria-label="Navigation"');
    expect(html).toContain("agent table");
  });
});

describe("sign-in page", () => {
  test("shows the sign-in options at once while the session is being checked, Privy disabled until ready", () => {
    const html = render(<LoginScreen />, loading, PENDING_PRIVY);
    expect(html).not.toContain('aria-label="Navigation"');
    expect(text(html)).toContain("Monadeum");
    expect(text(html)).toContain("testnet");
    expect(disabled(html, "Continue with email or Google")).toBe(true);
    expect(disabled(html, "Sign in with an external wallet")).toBe(false);
    expect(text(html)).toContain("Email and Google sign-in is loading");
  });

  test("enables the Privy button once Privy is ready", () => {
    const html = render(<LoginScreen />, signedOut, { ...PENDING_PRIVY, ready: true });
    expect(disabled(html, "Continue with email or Google")).toBe(false);
  });

  test("a Privy SDK that failed to load leaves the wallet path usable and says why", () => {
    const html = render(<SignInPanel privyAvailable={false} privyReady={false} privyError={PRIVY_FAILED_ERROR} busy={false} error={null} onPrivy={noop} onWallet={noop} />);
    expect(text(html)).toContain("could not be loaded");
    expect(disabled(html, "Continue with email or Google")).toBe(true);
    expect(disabled(html, "Sign in with an external wallet")).toBe(false);
  });

  test("shows the session error, such as the timeout", () => {
    const html = render(<LoginScreen />, { status: "signed-out", error: "Your session could not be confirmed in time" });
    expect(html).toContain("Your session could not be confirmed in time");
  });

  test("shows no sample data", () => {
    const html = text(render(<LoginScreen />, signedOut));
    expect(html).not.toContain("sample");
    expect(html).not.toContain("Nimbus");
  });
});

describe("landing", () => {
  test("does not render in api mode", () => {
    const html = text(render(<Home api />, signedOut));
    expect(html).not.toContain("Before you create your agent");
    expect(html).not.toContain("illustrative samples");
    expect(html).toContain("Checking your session");
  });

  test("renders in sample mode, unchanged", () => {
    const html = text(render(<Home api={false} />));
    expect(html).toContain("Before you create your agent");
    expect(html).toContain("illustrative samples");
  });
});

describe("sample mode", () => {
  test("the test suite runs in sample mode", () => {
    expect(USES_API).toBe(false);
  });

  test("app routes render the navigation and the sample wallet without a session", async () => {
    const html = render(await AppLayout({ children: <p>agent table</p> }));
    expect(html).toContain('aria-label="Navigation"');
    expect(html).toContain("agent table");
    expect(html).toContain("0x4f2a");
  });

  test("/login is not part of the sample build and goes to the population", () => {
    let digest = "";
    try {
      LoginPage();
    } catch (error) {
      digest = String((error as { digest?: unknown }).digest);
    }
    expect(digest).toContain("/population");
  });
});
