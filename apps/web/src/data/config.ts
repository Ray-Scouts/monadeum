/**
 * Where the screens read from. `sample` (the default) is the deterministic sample source, for local development and
 * tests; `api` is `apps/api`, reached from the browser with the signed-in user's credential.
 */
export type DataSourceMode = "sample" | "api";

export interface WebConfig {
  mode: DataSourceMode;
  /** The API's origin, without a trailing slash. Required in `api` mode. */
  apiUrl: string | null;
  /** Privy app ID (public). Without it the social login path is unavailable and the page says so. */
  privyAppId: string | null;
  /** Settlement asset of agent limits and spends, as the API's base units are read. Data, not a hardcoded label. */
  settlement: { symbol: string | null; decimals: number };
  /** Set when the configuration cannot be used; `api` mode then shows this instead of any data. */
  error: string | null;
}

type Env = Record<string, string | undefined>;

/** Validates the public configuration. Never throws: a bad value becomes `error`, which the API screens show. */
export function loadWebConfig(env: Env): WebConfig {
  const rawMode = env.NEXT_PUBLIC_MONADEUM_DATA_SOURCE?.trim() || "sample";
  const errors: string[] = [];
  let mode: DataSourceMode = "sample";
  if (rawMode === "api" || rawMode === "sample") mode = rawMode;
  else errors.push("NEXT_PUBLIC_MONADEUM_DATA_SOURCE must be sample or api");

  let apiUrl: string | null = null;
  const rawUrl = env.NEXT_PUBLIC_MONADEUM_API_URL?.trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) errors.push("NEXT_PUBLIC_MONADEUM_API_URL must be https, or http on localhost");
      else apiUrl = url.origin;
    } catch {
      errors.push("NEXT_PUBLIC_MONADEUM_API_URL is not a URL");
    }
  } else if (mode === "api") errors.push("NEXT_PUBLIC_MONADEUM_API_URL is not set");

  const rawDecimals = env.NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS?.trim();
  let decimals = 6;
  if (rawDecimals) {
    if (/^\d{1,2}$/.test(rawDecimals) && Number(rawDecimals) <= 36) decimals = Number(rawDecimals);
    else errors.push("NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS must be an integer from 0 to 36");
  }

  return {
    mode,
    apiUrl,
    privyAppId: env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null,
    settlement: { symbol: env.NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL?.trim() || null, decimals },
    error: errors.length ? errors.join("; ") : null,
  };
}

// Next.js inlines NEXT_PUBLIC_ variables only where they are written out literally, so they are listed here.
export const WEB_CONFIG: WebConfig = loadWebConfig({
  NEXT_PUBLIC_MONADEUM_DATA_SOURCE: process.env.NEXT_PUBLIC_MONADEUM_DATA_SOURCE,
  NEXT_PUBLIC_MONADEUM_API_URL: process.env.NEXT_PUBLIC_MONADEUM_API_URL,
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL: process.env.NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL,
  NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS: process.env.NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS,
});

/** True when the screens read from the API rather than the sample source. */
export const USES_API = WEB_CONFIG.mode === "api";
