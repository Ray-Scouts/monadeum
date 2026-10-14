"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, Logo } from "@/components/Icon";
import { Card } from "@/components/ui";
import { passkeysSupported, readCredential } from "@/data/api/mera";
import { shortAddress } from "@/lib/format";
import { useAuth } from "./auth";
import { SessionPending } from "./gate";
import { loginDecision } from "./navigation";

export interface SignInPanelProps {
  /** False when no Privy app ID is configured. */
  privyAvailable: boolean;
  privyReady: boolean;
  /** Why the social path is unavailable when an app ID is configured but Privy failed to load. */
  privyError?: string | null;
  busy: boolean;
  error: string | null;
  onPrivy(): void;
  onWallet(): void;
  /** Passkey accounts through Mera. Optional so a screen that does not offer them still renders. */
  onPasskey?(mode: "create" | "existing"): void;
  /** False when the browser cannot run WebAuthn (or the page is not a secure context). */
  passkeyAvailable?: boolean;
  /** True when this browser already holds a passkey handle from an earlier sign-in, which makes signing in the main action. */
  passkeyKnown?: boolean;
}

/**
 * Social login first, the external wallet below an "advanced" divider (BRIEF.md product principle, issue #27). Both
 * paths end at the same account on the API; this screen only captures intent, it decides nothing.
 */
export function SignInPanel({
  privyAvailable,
  privyReady,
  privyError = null,
  busy,
  error,
  onPrivy,
  onWallet,
  onPasskey,
  passkeyAvailable = false,
  passkeyKnown = false,
}: SignInPanelProps) {
  return (
    <Card className="w-full max-w-[460px]">
      <h1 className="flex items-center gap-2.5 text-[26px] font-bold">
        <Logo />
        Monadeum
      </h1>
      <p className="mt-3">AI agents that trade on Monad with their own capital, each in its own smart account under spending limits you set.</p>
      <p className="mt-2 text-[13px] text-muted">This is a Monad testnet preview: agents use test assets, not real funds.</p>
      <div className="mt-6 grid gap-2.5">
        <button type="button" className="btn btn-primary w-full justify-start! rounded-[14px] px-[18px] py-3.5" disabled={!privyAvailable || !privyReady || busy} onClick={onPrivy}>
          <Icon name="mail" />
          Continue with email or Google
        </button>
        {privyAvailable && !privyReady && (
          <p role="status" className="text-[13px] text-muted">
            Email and Google sign-in is loading.
          </p>
        )}
        {!privyAvailable && (
          <p className="text-[13px] text-warn">{privyError ?? "Email and Google sign-in is not configured on this deployment (no Privy app ID)."}</p>
        )}
        <p className="text-[13px] text-muted">Email or Google creates a wallet for you. It owns your agents and is the only wallet that can sign for them. No MON is needed to sign in.</p>
        {onPasskey && (
          <>
            <button
              type="button"
              className="btn btn-ghost w-full justify-start! rounded-[14px] px-[18px] py-3.5"
              disabled={!passkeyAvailable || busy}
              onClick={() => onPasskey(passkeyKnown ? "existing" : "create")}
            >
              <Icon name="wallet" />
              {passkeyKnown ? "Sign in with your passkey" : "Continue with a passkey"}
            </button>
            {passkeyKnown && (
              <button type="button" className="text-left text-[13px] text-muted underline" disabled={!passkeyAvailable || busy} onClick={() => onPasskey("create")}>
                Create a new passkey account instead
              </button>
            )}
            <p className="text-[13px] text-muted">
              {passkeyAvailable
                ? "A passkey (Face ID, Touch ID, or a security key) creates a wallet through Mera, a preview library. There is no password and no seed phrase, and the same passkey opens the same wallet on any device it syncs to. If you lose the passkey you lose the wallet, so keep it backed up in your password manager."
                : "Passkey accounts need a secure browser context with WebAuthn support, which this one does not offer."}
            </p>
          </>
        )}
        <div className="my-1.5 flex items-center gap-3 text-xs text-faint before:h-px before:flex-1 before:bg-line-soft after:h-px after:flex-1 after:bg-line-soft">advanced</div>
        <button type="button" className="btn btn-ghost w-full justify-start! rounded-[14px] px-[18px] py-3.5" disabled={busy} onClick={onWallet}>
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

/**
 * The full-screen sign-in page of `api` mode, with no navigation and no data. It renders at once, while the session
 * is still being checked and before Privy's SDK has loaded; a confirmed session moves on to `next` or the population.
 */
export function LoginScreen() {
  const auth = useAuth();
  const router = useRouter();
  const decision = loginDecision(auth.state, "");
  useEffect(() => {
    const target = loginDecision(auth.state, window.location.search);
    if (target.kind === "redirect") router.replace(target.to);
  }, [auth.state, router]);
  // Browser capabilities and storage are read after mount, so the server render and the first client render agree.
  const [passkeyReady, setPasskeyReady] = useState(false);
  const [passkeyKnown, setPasskeyKnown] = useState(false);
  useEffect(() => {
    setPasskeyReady(passkeysSupported());
    setPasskeyKnown(readCredential() !== null);
  }, []);
  if (decision.kind !== "render") return <SessionPending />;
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <SignInPanel
        privyAvailable={auth.privy !== null}
        privyReady={auth.privy?.ready ?? false}
        privyError={auth.privyError}
        busy={auth.busy}
        error={auth.state.status === "signed-out" ? auth.state.error : null}
        onPrivy={auth.signInWithPrivy}
        onWallet={() => void auth.signInWithWallet()}
        onPasskey={(mode) => void auth.signInWithPasskey(mode)}
        passkeyAvailable={passkeyReady}
        passkeyKnown={passkeyKnown}
      />
    </main>
  );
}

/** Header chip: who is signed in, through which path, and sign out. Signing out returns to the sign-in page. */
export function AccountChip() {
  const auth = useAuth();
  if (auth.state.status !== "signed-in") return null;
  const { user, via, method } = auth.state;
  const label = via === "privy" ? "Email or Google" : method === "passkey" ? "Passkey" : "Wallet";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line-soft bg-surface-2 py-1 pr-1 pl-3 text-[13px]">
      <span title={via === "privy" ? "Signed in with email or Google" : method === "passkey" ? "Signed in with a passkey" : "Signed in with an external wallet"} className="text-muted">
        {label}
      </span>
      {user.ownerWallet && (
        <span title={`Owner wallet ${user.ownerWallet}`} className="hidden font-mono sm:inline">
          {shortAddress(user.ownerWallet)}
        </span>
      )}
      <button type="button" className="btn btn-ghost tap-y whitespace-nowrap px-2.5 py-1 text-[13px]" disabled={auth.busy} onClick={() => void auth.signOut()}>
        Sign out
      </button>
    </span>
  );
}
