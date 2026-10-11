import { verifyAccessToken, verifyIdentityToken } from "@privy-io/node";
import type { JWTVerifyGetKey } from "jose";
import { getAddress, isAddress, type Address } from "viem";
import { CachedJwks, privyJwksUrl, type JwksCacheOptions } from "./jwks.js";

/** A verified Privy access token: who the user is, for this session. It says nothing about wallets. */
export interface PrivySession {
  privyUserId: string;
  sessionId: string;
  /** Unix seconds. */
  expiresAt: number;
}

/** A verified Privy identity token, reduced to what this module uses. */
export interface PrivyIdentity {
  privyUserId: string;
  isGuest: boolean;
  /** Privy embedded wallets on Ethereum-compatible chains, checksummed. Wallets of other chains are dropped. */
  embeddedWallets: Address[];
}

export class PrivyTokenError extends Error {}

/** Port for Privy token verification, so the service is testable without Privy. */
export interface PrivyVerifier {
  verifyAccessToken(token: string): Promise<PrivySession>;
  verifyIdentityToken(token: string): Promise<PrivyIdentity>;
}

/**
 * Verifies Privy-issued tokens with `@privy-io/node` 0.35.0: an ES256 signature, issuer `privy.io`, audience the app
 * ID, and expiry, read from the installed SDK's `lib/auth.js`. The Privy app secret is not used.
 *
 * The key comes from one of two sources. By default, Privy's published key set for the app
 * (`https://auth.privy.io/api/v1/apps/<appId>/jwks.json`), cached and selected by `kid` (see `CachedJwks`); this is
 * what keeps a key rotation at Privy from needing a configuration change. If a static PEM verification key is given,
 * only that key is used and nothing is fetched.
 */
export class PrivyTokenVerifier implements PrivyVerifier {
  readonly keySource: "static" | "jwks";
  /** A PEM string, which the SDK imports as ES256 on each call, or the cached JWKS resolver. */
  private readonly key: string | JWTVerifyGetKey;

  constructor(private readonly appId: string, verificationKey?: string | null, jwks: JwksCacheOptions = {}) {
    if (verificationKey) {
      this.keySource = "static";
      this.key = verificationKey;
    } else {
      this.keySource = "jwks";
      this.key = new CachedJwks(privyJwksUrl(appId), jwks).getKey;
    }
  }

  async verifyAccessToken(token: string): Promise<PrivySession> {
    try {
      const claims = await verifyAccessToken({ access_token: token, app_id: this.appId, verification_key: this.key });
      return { privyUserId: claims.user_id, sessionId: claims.session_id, expiresAt: claims.expiration };
    } catch (error) {
      throw new PrivyTokenError(`access token rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async verifyIdentityToken(token: string): Promise<PrivyIdentity> {
    let user;
    try {
      user = await verifyIdentityToken({ identity_token: token, app_id: this.appId, verification_key: this.key });
    } catch (error) {
      throw new PrivyTokenError(`identity token rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof user.id !== "string" || !user.id) throw new PrivyTokenError("identity token has no subject");
    const embeddedWallets: Address[] = [];
    for (const account of user.linked_accounts) {
      if (account.type !== "wallet" || !("wallet_client_type" in account) || account.wallet_client_type !== "privy") continue;
      if (account.chain_type !== "ethereum" || !isAddress(account.address, { strict: false })) continue;
      embeddedWallets.push(getAddress(account.address));
    }
    return { privyUserId: user.id, isGuest: user.is_guest, embeddedWallets };
  }
}
