import { createLocalJWKSet, errors, type FlattenedJWSInput, type JWTHeaderParameters, type JWTVerifyGetKey } from "jose";

/** Privy's published key set for an app, as `@privy-io/node` 0.35.0 builds it in `lib/auth.js` (`createPrivyAppJWKS`). */
export function privyJwksUrl(appId: string): string {
  return `https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`;
}

/** The only signature algorithm Privy tokens are accepted under, matching the SDK's `JWT_ALGORITHM`. */
export const PRIVY_JWT_ALGORITHM = "ES256";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface JwksCacheOptions {
  /** HTTP client, injectable so tests run offline. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
  /** Age after which the next verification refetches the set. */
  refreshAfterMs?: number;
  /** Age after which a fetched set is never used, whether or not a refetch succeeds. */
  maxAgeMs?: number;
  /** Minimum time between two fetch attempts, successful or not. Bounds the refetches an unknown `kid` can cause. */
  minFetchIntervalMs?: number;
  /** Per-request timeout for the fetch. */
  timeoutMs?: number;
}

// Proposed defaults, not derived from a measurement or from a documented Privy rotation schedule. A rotated-in key is
// picked up within minFetchIntervalMs of the first token that carries it; a key Privy withdraws stops verifying at the
// next successful refetch, and at the latest after maxAgeMs.
export const DEFAULT_JWKS_REFRESH_AFTER_MS = 10 * 60 * 1000;
export const DEFAULT_JWKS_MAX_AGE_MS = 60 * 60 * 1000;
export const DEFAULT_JWKS_MIN_FETCH_INTERVAL_MS = 60 * 1000;
export const DEFAULT_JWKS_TIMEOUT_MS = 5 * 1000;

export class JwksUnavailableError extends Error {}

/**
 * A remote JSON Web Key Set with a bounded cache. Keys are selected by `kid` among the set's members (jose's
 * `createLocalJWKSet` does the matching on `kid`, key type, curve and any `alg` the member declares), and only ES256 is
 * accepted. An unknown `kid` triggers a refetch, at most once per `minFetchIntervalMs`. If no set younger than
 * `maxAgeMs` is held, verification fails: there is no fallback key.
 */
export class CachedJwks {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly refreshAfterMs: number;
  private readonly maxAgeMs: number;
  private readonly minFetchIntervalMs: number;
  private readonly timeoutMs: number;
  private current: { set: JWTVerifyGetKey; fetchedAt: number } | null = null;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<void> | null = null;

  /** The resolver to hand to `jwtVerify` or to `@privy-io/node`'s `verification_key`. */
  readonly getKey: JWTVerifyGetKey;

  constructor(private readonly url: string, options: JwksCacheOptions = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new TypeError("the JWKS URL must be https");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.refreshAfterMs = options.refreshAfterMs ?? DEFAULT_JWKS_REFRESH_AFTER_MS;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_JWKS_MAX_AGE_MS;
    this.minFetchIntervalMs = options.minFetchIntervalMs ?? DEFAULT_JWKS_MIN_FETCH_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS;
    if (!(this.refreshAfterMs > 0 && this.maxAgeMs >= this.refreshAfterMs && this.minFetchIntervalMs >= 0 && this.timeoutMs > 0)) {
      throw new TypeError("JWKS cache durations are inconsistent");
    }
    this.getKey = (header, token) => this.resolve(header, token);
  }

  private async resolve(header: JWTHeaderParameters, token: FlattenedJWSInput) {
    if (header.alg !== PRIVY_JWT_ALGORITHM) throw new JwksUnavailableError(`algorithm ${String(header.alg)} is not accepted`);
    if (typeof header.kid !== "string" || !header.kid) throw new JwksUnavailableError("token header has no kid");
    if (!this.current || this.now() - this.current.fetchedAt >= this.refreshAfterMs) await this.refresh();
    try {
      return await this.usable()(header, token);
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
      // Possibly a key Privy rotated in since the last fetch. Refetch once, within the rate limit, and try again.
      await this.refresh();
      return this.usable()(header, token);
    }
  }

  private usable(): JWTVerifyGetKey {
    if (!this.current || this.now() - this.current.fetchedAt >= this.maxAgeMs) throw new JwksUnavailableError("no current JWKS: fetch failed or not attempted");
    return this.current.set;
  }

  /** Fetches the set unless a fetch is in flight or one was attempted within the minimum interval. Never throws. */
  private refresh(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.now() - this.lastAttemptAt < this.minFetchIntervalMs) return Promise.resolve();
    this.lastAttemptAt = this.now();
    this.pending = this.load()
      .catch(() => undefined)
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private async load(): Promise<void> {
    const response = await this.fetchImpl(this.url, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status !== 200) throw new JwksUnavailableError(`JWKS fetch returned ${response.status}`);
    const set = createLocalJWKSet(await response.json());
    this.current = { set, fetchedAt: this.now() };
  }
}
