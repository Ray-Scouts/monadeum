import { monadTestnet } from "viem/chains";

// Environment variables, documented in libs/auth/README.md. None of them is a secret: the optional Privy
// verification key is a public key, and this module never uses the Privy app secret.

export class AuthConfigError extends Error {}

export interface AuthSettings {
  /** Chain ID written into wallet sign-in messages. */
  chainId: number;
  /** EIP-4361 `domain`: the host, with port if any, that serves the app. */
  domain: string;
  /** EIP-4361 `uri`. */
  uri: string;
  /** Lifetime of a wallet sign-in challenge, milliseconds. */
  challengeTtlMs: number;
  /** Lifetime of a platform session on the external wallet path, milliseconds. */
  walletSessionTtlMs: number;
}

export interface AuthConfig {
  /** `verificationKey` null: verify against Privy's published key set for `appId`. A PEM: use only that key. */
  privy: { appId: string; verificationKey: string | null };
  settings: AuthSettings;
}

/** Proposed defaults, not derived from any measurement: five minutes to sign, one hour per wallet session. */
export const DEFAULT_CHALLENGE_TTL_SECONDS = 300;
export const DEFAULT_WALLET_SESSION_TTL_SECONDS = 3600;

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new AuthConfigError(`${name} is not set`);
  return value;
}

function seconds(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback * 1000;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 86_400) throw new AuthConfigError(`${name} must be an integer from 1 to 86400`);
  return Number(raw) * 1000;
}

/** Reads and validates the configuration. Monad testnet only, matching WalletsModule. */
export function loadAuthConfig(env: Env = process.env): AuthConfig {
  const chainId = Number(required(env, "AUTH_CHAIN_ID"));
  if (chainId !== monadTestnet.id) throw new AuthConfigError(`AUTH_CHAIN_ID ${chainId} is not supported; only Monad testnet (${monadTestnet.id})`);
  const appId = required(env, "AUTH_PRIVY_APP_ID");
  // The app ID becomes a path segment of the JWKS URL, so it is held to the characters Privy app IDs use.
  if (!/^[A-Za-z0-9_-]+$/.test(appId)) throw new AuthConfigError("AUTH_PRIVY_APP_ID must contain only letters, digits, '_' and '-'");
  // Optional static override; unset means Privy's published key set for the app. A PEM in a single-line environment
  // variable usually arrives with literal "\n" sequences.
  const rawKey = env.AUTH_PRIVY_VERIFICATION_KEY?.trim();
  const verificationKey = rawKey ? rawKey.replaceAll("\\n", "\n") : null;
  if (verificationKey !== null && !verificationKey.startsWith("-----BEGIN PUBLIC KEY-----")) throw new AuthConfigError("AUTH_PRIVY_VERIFICATION_KEY must be a PEM public key");
  const domain = required(env, "AUTH_SIWE_DOMAIN");
  if (/[/\s]/.test(domain)) throw new AuthConfigError("AUTH_SIWE_DOMAIN must be a host, with an optional port");
  const uri = required(env, "AUTH_SIWE_URI");
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new AuthConfigError("AUTH_SIWE_URI is not a URL");
  }
  const local = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !local) throw new AuthConfigError("AUTH_SIWE_URI must be https, or http on localhost");
  if (parsed.host !== domain) throw new AuthConfigError("AUTH_SIWE_URI must be served from AUTH_SIWE_DOMAIN");
  return {
    privy: { appId, verificationKey },
    settings: {
      chainId,
      domain,
      uri,
      challengeTtlMs: seconds(env, "AUTH_CHALLENGE_TTL_SECONDS", DEFAULT_CHALLENGE_TTL_SECONDS),
      walletSessionTtlMs: seconds(env, "AUTH_WALLET_SESSION_TTL_SECONDS", DEFAULT_WALLET_SESSION_TTL_SECONDS),
    },
  };
}
