"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createApiClient, isApiError, type ApiClient, type Credential, type SessionClient } from "@/data/api/client";
import { messageHex, sameAddress, type Eip1193 } from "@/data/api/signing";
import type { ApiUser } from "@/data/api/types";
import { WEB_CONFIG } from "@/data/config";

/** Monad testnet, the only chain AuthModule accepts (`AUTH_CHAIN_ID` must be 10143). */
export const CHAIN_ID = 10143;

/**
 * How long the page waits for the API and Privy to confirm or refuse a session before it shows the sign-in options
 * with an error, so an unreachable API or a Privy SDK that never becomes ready cannot leave the page loading forever.
 */
export const SESSION_CHECK_TIMEOUT_MS = 10_000;

export const SESSION_TIMEOUT_ERROR =
  "Your session could not be confirmed in time: the API or the sign-in provider did not answer. You can try signing in again.";

/** What the Privy SDK exposes to this app, so the rest of the code never imports Privy directly. */
export interface PrivyBridge {
  ready: boolean;
  authenticated: boolean;
  identityToken: string | null;
  login(): void;
  logout(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  /** The EIP-1193 provider of the user's wallet at `address`, if Privy holds it (the embedded wallet). */
  providerFor(address: string): Promise<Eip1193 | null>;
}

export type AuthState =
  | { status: "loading" }
  /** `byUser` marks a sign-out the user asked for, which returns to a plain sign-in page. */
  | { status: "signed-out"; error: string | null; byUser?: boolean }
  | { status: "signed-in"; via: "privy" | "wallet"; user: ApiUser; session: SessionClient };

export interface Auth {
  state: AuthState;
  client: ApiClient | null;
  /** Null when no Privy app ID is configured: the social path is then unavailable and the sign-in screen says so. */
  privy: PrivyBridge | null;
  /** Set when an app ID is configured but Privy's SDK failed; `privy` is then null and the social path unavailable. */
  privyError: string | null;
  busy: boolean;
  signInWithPrivy(): void;
  signInWithWallet(): Promise<void>;
  signOut(): Promise<void>;
  /** The owner wallet's provider and address, for signing an owner operation. Never a key. */
  ownerWallet(): Promise<{ provider: Eip1193; address: string }>;
}

/**
 * Stands in for Privy while its SDK is still loading, when an app ID is configured: not ready, not authenticated. The
 * sign-in page renders against it at once and enables the email and Google button when the real bridge arrives.
 */
export const PENDING_PRIVY: PrivyBridge = {
  ready: false,
  authenticated: false,
  identityToken: null,
  login: () => undefined,
  logout: async () => undefined,
  getAccessToken: async () => null,
  providerFor: async () => null,
};

/** Exported for component tests, which render screens against a fixed session state. */
export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth outside AuthProvider");
  return auth;
}

/** The session client of a signed-in user, or null. */
export function useSession(): SessionClient | null {
  const { state } = useAuth();
  return state.status === "signed-in" ? state.session : null;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

function injected(): Eip1193 {
  if (typeof window === "undefined" || !window.ethereum) throw new Error("No browser wallet was found. Install one, or sign in with email or Google.");
  return window.ethereum;
}

const describe = (error: unknown) => {
  if (isApiError(error)) return error.reason === "network-error" ? "The API could not be reached." : `Sign-in failed (${error.reason}).`;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 4001) return "The request was declined in your wallet.";
  return error instanceof Error ? error.message : "Sign-in failed.";
};

export function AuthProvider({ privy, privyError = null, children }: { privy: PrivyBridge | null; privyError?: string | null; children: ReactNode }) {
  const client = useMemo(() => (WEB_CONFIG.apiUrl ? createApiClient(WEB_CONFIG.apiUrl) : null), []);
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  // The Privy bridge object changes on every render; the effect below reads the latest through this ref.
  const privyRef = useRef(privy);
  privyRef.current = privy;
  // While signing out, a session check started by Privy's own logout must not overwrite the final signed-out state.
  const signingOut = useRef(false);

  const privyCredential: Credential = useMemo(
    () => ({ via: "privy", accessToken: async () => (privyRef.current ? privyRef.current.getAccessToken() : null) }),
    [],
  );

  // Restores or establishes the API session whenever Privy's state changes: a Privy session takes precedence, then
  // the wallet session cookie. A 401 from `/auth/me` with a Privy token means the API has not seen this user's
  // identity token yet, so the sign-in endpoint is called with both tokens.
  const privyReady = privy?.ready ?? true;
  const privyAuthenticated = privy?.authenticated ?? false;
  const identityToken = privy?.identityToken ?? null;
  useEffect(() => {
    if (!client) {
      setState({ status: "signed-out", error: WEB_CONFIG.error ?? "No API URL is configured." });
      return;
    }
    let cancelled = false;
    const done = (next: AuthState) => !cancelled && !signingOut.current && setState(next);
    (async () => {
      if (privyAuthenticated) {
        const session = client.as(privyCredential);
        try {
          const me = await session.me();
          // A user first seen before Privy created their embedded wallet has no owner wallet yet. Sending the current
          // identity token again lets the API record the wallet; without this, `/auth/me` succeeding would skip it.
          if (me.user.ownerWallet || !identityToken) return done({ status: "signed-in", via: "privy", user: me.user, session });
        } catch (error) {
          if (!isApiError(error) || error.status !== 401) return done({ status: "signed-out", error: describe(error) });
        }
        if (!identityToken) return; // Privy issues it shortly after login; this effect runs again when it arrives.
        try {
          const token = await privyRef.current!.getAccessToken();
          if (!token) return done({ status: "signed-out", error: "Privy did not return an access token." });
          const signedIn = await client.privySignIn(token, identityToken);
          return done({ status: "signed-in", via: "privy", user: signedIn.user, session });
        } catch (error) {
          return done({ status: "signed-out", error: describe(error) });
        }
      }
      const session = client.as({ via: "wallet" });
      try {
        const me = await session.me();
        return done({ status: "signed-in", via: "wallet", user: me.user, session });
      } catch (error) {
        if (!privyReady) return; // Privy may still restore a session.
        return done({ status: "signed-out", error: isApiError(error) && error.status === 401 ? null : describe(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, privyCredential, privyReady, privyAuthenticated, identityToken]);

  useEffect(() => {
    if (state.status !== "loading") return;
    const timer = setTimeout(
      () => setState((s) => (s.status === "loading" ? { status: "signed-out", error: SESSION_TIMEOUT_ERROR } : s)),
      SESSION_CHECK_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [state.status]);

  const signInWithPrivy = useCallback(() => {
    if (!privyRef.current) return;
    privyRef.current.login();
  }, []);

  const signInWithWallet = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    try {
      const provider = injected();
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("The wallet did not share an account.");
      const challenge = await client.walletChallenge(address);
      // The API keeps the message it issued; the wallet signs exactly that text.
      const signature = (await provider.request({ method: "personal_sign", params: [messageHex(challenge.message), address] })) as string;
      await client.walletVerify(challenge.nonce, signature);
      const session = client.as({ via: "wallet" });
      const me = await session.me();
      setState({ status: "signed-in", via: "wallet", user: me.user, session });
    } catch (error) {
      setState({ status: "signed-out", error: describe(error) });
    } finally {
      setBusy(false);
    }
  }, [client]);

  const signOut = useCallback(async () => {
    setBusy(true);
    signingOut.current = true;
    try {
      // Both are ended: a Privy session can outlive a failed API sign-in, and a wallet cookie can outlive a Privy one.
      if (privyRef.current?.authenticated) await privyRef.current.logout();
      await client?.signOut();
    } catch {
      // Signing out locally still proceeds; the wallet session expires on its own.
    } finally {
      signingOut.current = false;
      setState({ status: "signed-out", error: null, byUser: true });
      setBusy(false);
    }
  }, [client]);

  const ownerWallet = useCallback(async () => {
    if (state.status !== "signed-in") throw new Error("Sign in first.");
    const owner = state.user.ownerWallet;
    if (!owner) throw new Error("Your account has no owner wallet yet.");
    if (state.via === "privy") {
      const provider = await privyRef.current?.providerFor(owner);
      if (!provider) throw new Error(`Your owner wallet ${owner} is not available in this session.`);
      return { provider, address: owner };
    }
    const provider = injected();
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts.find((a) => sameAddress(a, owner));
    if (!address) throw new Error(`Switch your wallet to your owner account ${owner}, then try again.`);
    // Typed data names its chain; wallets refuse to sign it for a chain other than the active one.
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }] }).catch(() => undefined);
    return { provider, address };
  }, [state]);

  const value: Auth = { state, client, privy, privyError, busy, signInWithPrivy, signInWithWallet, signOut, ownerWallet };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
