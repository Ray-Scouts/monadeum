"use client";

import dynamic from "next/dynamic";
import { Component, useState, type ReactNode } from "react";
import { WEB_CONFIG } from "@/data/config";
import { AuthProvider, PENDING_PRIVY, type PrivyBridge } from "./auth";

// Client only: the credential (Privy's access token, or the API's HttpOnly cookie) exists only in the browser, and
// loading Privy here keeps it out of the sample build's runtime. Nothing waits for it: until it reports, the session
// check and the sign-in page run against `PENDING_PRIVY`.
const PrivyLoader = dynamic(() => import("./Providers"), { ssr: false, loading: () => null });

export const PRIVY_FAILED_ERROR = "Email and Google sign-in could not be loaded on this deployment. The external wallet path still works.";

/** Keeps a Privy SDK failure (for example a rejected app ID) from taking the sign-in page and the wallet path down. */
class PrivyBoundary extends Component<{ onError(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The session for every route in `api` mode, mounted once in the root layout so it survives navigation. */
export function ApiRoot({ children }: { children: ReactNode }) {
  const [bridge, setBridge] = useState<PrivyBridge | null>(null);
  const [failed, setFailed] = useState(false);
  const configured = WEB_CONFIG.privyAppId !== null;
  const privy = configured && !failed ? (bridge ?? PENDING_PRIVY) : null;
  return (
    <>
      {configured && (
        <PrivyBoundary onError={() => setFailed(true)}>
          <PrivyLoader onBridge={setBridge} />
        </PrivyBoundary>
      )}
      <AuthProvider privy={privy} privyError={failed ? PRIVY_FAILED_ERROR : null}>
        {children}
      </AuthProvider>
    </>
  );
}
