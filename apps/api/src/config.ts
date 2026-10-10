import { loadAuthConfig, type AuthConfig } from "@monadeum/auth";
import { loadDatabaseSettings, type DatabaseSettings } from "@monadeum/db";

// Environment variables of the API process, documented in apps/api/README.md. None of them is a private key: the API
// never holds an owner key or a session key, and the Privy verification key AuthModule reads is a public key.

export class ApiConfigError extends Error {}

/** Settings the request handlers read. Built by `loadApiConfig`, or directly in tests. */
export interface ApiSettings {
  /**
   * The web app's origin. CORS allows only it, and a request that authenticates with the session cookie and changes
   * state must carry it as its `Origin` header (cross-site request forgery defence on top of `SameSite=Strict`).
   */
  allowedOrigin: string;
  /** Chain ID written into the owner-signed reallocation policy's typed data. Monad testnet only, matching AuthModule. */
  chainId: number;
  /** Requests per window per client IP on the sign-in, challenge, and link endpoints. */
  authRateLimit: number;
  authRateWindowMs: number;
  /** How long an owner signature request stays open before the operation fails closed. */
  signatureTimeoutMs: number;
  /** How long one HTTP request waits for an operation to reach its next signature request or its end. */
  operationWaitMs: number;
  /** Lifetime of the session cookie on the external wallet path; equals AuthModule's wallet session lifetime. */
  sessionCookieMaxAgeMs: number;
  /** Highest per-transaction and daily caps an owner may request for a new agent, settlement-asset base units. */
  maxPerTxCap: bigint;
  maxDailyCap: bigint;
  /** Settlement-asset decimals, used to express the protocol capital floor in base units. */
  settlementDecimals: number;
}

export interface ApiConfig {
  port: number;
  host: string;
  /** Fastify `trustProxy`: true only behind a proxy that sets X-Forwarded-For, or every client shares one rate limit. */
  trustProxy: boolean;
  /** `DATABASE_URL`, `DATABASE_MIGRATIONS`, and `MONADEUM_ENV`, read by `loadDatabaseSettings` as for every process. */
  database: DatabaseSettings;
  auth: AuthConfig;
  settings: ApiSettings;
}

/** Proposed defaults, not derived from any measurement. */
export const DEFAULT_AUTH_RATE_LIMIT = 10;
export const DEFAULT_AUTH_RATE_WINDOW_SECONDS = 60;
export const DEFAULT_SIGNATURE_TIMEOUT_SECONDS = 300;
export const DEFAULT_OPERATION_WAIT_SECONDS = 20;

type Env = Record<string, string | undefined>;

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new ApiConfigError(`${name} must be an integer from ${min} to ${max}`);
  return Number(raw);
}

function baseUnits(env: Env, name: string): bigint {
  const raw = env[name]?.trim();
  if (!raw) throw new ApiConfigError(`${name} is not set`);
  if (!/^[1-9]\d*$/.test(raw)) throw new ApiConfigError(`${name} must be a positive integer in base units`);
  const value = BigInt(raw);
  if (value >= 2n ** 128n) throw new ApiConfigError(`${name} must fit uint128`);
  return value;
}

/** Reads and validates the configuration, including AuthModule's (`loadAuthConfig`). */
export function loadApiConfig(env: Env = process.env): ApiConfig {
  const auth = loadAuthConfig(env);
  const allowedOrigin = new URL(auth.settings.uri).origin;
  const maxPerTxCap = baseUnits(env, "API_MAX_PER_TX_CAP");
  const maxDailyCap = baseUnits(env, "API_MAX_DAILY_CAP");
  if (maxPerTxCap > maxDailyCap) throw new ApiConfigError("API_MAX_PER_TX_CAP must not exceed API_MAX_DAILY_CAP");
  const trust = env.API_TRUST_PROXY?.trim() || "false";
  if (trust !== "true" && trust !== "false") throw new ApiConfigError("API_TRUST_PROXY must be true or false");
  return {
    port: integer(env, "API_PORT", 3001, 1, 65_535),
    host: env.API_HOST?.trim() || "127.0.0.1",
    trustProxy: trust === "true",
    database: loadDatabaseSettings(env),
    auth,
    settings: {
      allowedOrigin,
      chainId: auth.settings.chainId,
      authRateLimit: integer(env, "API_AUTH_RATE_LIMIT", DEFAULT_AUTH_RATE_LIMIT, 1, 10_000),
      authRateWindowMs: integer(env, "API_AUTH_RATE_WINDOW_SECONDS", DEFAULT_AUTH_RATE_WINDOW_SECONDS, 1, 86_400) * 1000,
      signatureTimeoutMs: integer(env, "API_SIGNATURE_TIMEOUT_SECONDS", DEFAULT_SIGNATURE_TIMEOUT_SECONDS, 10, 3_600) * 1000,
      operationWaitMs: integer(env, "API_OPERATION_WAIT_SECONDS", DEFAULT_OPERATION_WAIT_SECONDS, 1, 60) * 1000,
      sessionCookieMaxAgeMs: auth.settings.walletSessionTtlMs,
      maxPerTxCap,
      maxDailyCap,
      settlementDecimals: integer(env, "API_SETTLEMENT_DECIMALS", 6, 0, 36),
    },
  };
}
