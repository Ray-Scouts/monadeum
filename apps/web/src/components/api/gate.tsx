"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "./auth";
import { gateDecision } from "./navigation";

// Session gating for `api` mode. This is a user experience, not a control: every read and write is authenticated and
// authorized by the API itself (THREAT-MODEL.md trust boundary 10), which answers 401 without a session.

/** Neutral full-screen state while the session is unknown or a redirect is under way: no navigation, no data. */
export function SessionPending() {
  return (
    <div role="status" className="grid min-h-screen place-items-center px-4 text-muted">
      Checking your session…
    </div>
  );
}

/** Renders the app (navigation and screen) only for a confirmed session; otherwise sends the visitor to sign in. */
export function AppGate({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  useEffect(() => {
    const decision = gateDecision(state, pathname, window.location.search);
    if (decision.kind === "redirect") router.replace(decision.to);
  }, [state, pathname, router]);
  if (gateDecision(state, pathname, "").kind !== "render") return <SessionPending />;
  return <>{children}</>;
}

