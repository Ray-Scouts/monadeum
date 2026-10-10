"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Card } from "@/components/ui";
import { shortAddress } from "@/lib/format";
import { useAuth } from "./auth";

export interface SignInPanelProps {
  /** False when no Privy app ID is configured. */
  privyAvailable: boolean;
  privyReady: boolean;
  busy: boolean;
  error: string | null;
  onPrivy(): void;
  onWallet(): void;
}

/**
 * Social login first, the external wallet below an "advanced" divider (BRIEF.md product principle, issue #27). Both
 * paths end at the same account on the API; this screen only captures intent, it decides nothing.
 */
export function SignInPanel({ privyAvailable, privyReady, busy, error, onPrivy, onWallet }: SignInPanelProps) {
  return (
    <Card className="max-w-[520px]">
      <span className="eyebrow">Sign in</span>
      <h1 className="mt-2 text-[26px] font-bold">Sign in to see your agents</h1>
      <p className="mt-2 text-muted">
        Email or Google creates a wallet for you. It owns your agents and is the only wallet that can sign for them. No MON is needed to sign in.
      </p>
      <div className="mt-6 grid gap-2.5">
        <button type="button" className="btn btn-primary w-full justify-start rounded-[14px] px-[18px] py-3.5" disabled={!privyAvailable || !privyReady || busy} onClick={onPrivy}>
          <Icon name="mail" />
          Continue with email or Google
        </button>
        {!privyAvailable && <p className="text-[13px] text-warn">Email and Google sign-in is not configured on this deployment (no Privy app ID).</p>}
        <div className="my-1.5 flex items-center gap-3 text-xs text-faint before:h-px before:flex-1 before:bg-line-soft after:h-px after:flex-1 after:bg-line-soft">advanced</div>
        <button type="button" className="btn btn-ghost w-full justify-start rounded-[14px] px-[18px] py-3.5" disabled={busy} onClick={onWallet}>
          <Icon name="wallet" />
          Sign in with an external wallet
        </button>
        <p className="text-[13px] text-muted">
          Your wallet signs a one-time sign-in message issued by the API. The first wallet you sign in with becomes the owner of the agents you create.
        </p>
      </div>
      <p role="alert" className="mt-4 text-[13px] text-bad empty:hidden">
        {error}
      </p>
    </Card>
  );
}

/** Shows the sign-in panel until the API confirms a session, then the screen. */
export function SignInGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.state.status === "loading") {
    return (
      <p role="status" className="text-muted">
        Checking your session…
      </p>
    );
  }
  if (auth.state.status === "signed-out") {
    return (
      <SignInPanel
        privyAvailable={auth.privy !== null}
        privyReady={auth.privy?.ready ?? false}
        busy={auth.busy}
        error={auth.state.error}
        onPrivy={auth.signInWithPrivy}
        onWallet={() => void auth.signInWithWallet()}
      />
    );
  }
  return <>{children}</>;
}

/** Header chip: who is signed in, through which path, and sign out. */
export function AccountChip() {
  const auth = useAuth();
  if (auth.state.status !== "signed-in") return null;
  const { user, via } = auth.state;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line-soft bg-surface-2 py-1 pr-1 pl-3 text-[13px]">
      <span title={via === "privy" ? "Signed in with email or Google" : "Signed in with an external wallet"} className="text-muted">
        {via === "privy" ? "Email or Google" : "Wallet"}
      </span>
      {user.ownerWallet && (
        <span title={`Owner wallet ${user.ownerWallet}`} className="hidden font-mono sm:inline">
          {shortAddress(user.ownerWallet)}
        </span>
      )}
      <button type="button" className="btn btn-ghost px-2.5 py-1 text-[13px]" disabled={auth.busy} onClick={() => void auth.signOut()}>
        Sign out
      </button>
    </span>
  );
}
