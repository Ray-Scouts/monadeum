import type { Accepted } from "./accept.js";

/**
 * Nansen Smart Money signal (ARCHITECTURE.md section 8, "Nansen Smart Money signal"). Everything Nansen returns is
 * untrusted external input: the body is size-limited, validated field by field, and reduced to one bounded number.
 * No string from the response survives into the result, so it cannot carry an instruction.
 *
 * Endpoint, authentication, request and response shapes are those of Nansen's documentation as read on 2026-10-12:
 * POST https://api.nansen.ai/api/v1/smart-money/netflow with the key in the `apikey` header
 * (https://docs.nansen.ai/api/smart-money/netflows.md, https://docs.nansen.ai/getting-started/authentication.md).
 * Only the API key path is implemented. Nansen's x402 payment path is not.
 */

export const NANSEN_BASE_URL = "https://api.nansen.ai/api/v1";
export const NANSEN_NETFLOW_PATH = "/smart-money/netflow";
export const NANSEN_NETFLOW_ENDPOINT = `${NANSEN_BASE_URL}${NANSEN_NETFLOW_PATH}`;
/** Documented cost of a Smart Money call (https://docs.nansen.ai/getting-started/credits.md, 2026-10-12). Used only as an estimate. */
export const NANSEN_SMART_MONEY_CREDITS = 5;
/** A response larger than this is rejected before it is parsed. A one-row netflow answer is well under 4 KiB. */
export const NANSEN_MAX_BODY_BYTES = 262_144;
export const NANSEN_MAX_ROWS = 1000;
/** STARTING value (hypothesis): the daily net flow, in USD, that maps to a signal of magnitude 1. */
export const DEFAULT_NORMALIZER_USD = 100_000;
/** STARTING value (hypothesis): matches the free plan's 10-credit daily balance, so two calls a day. */
export const DEFAULT_MAX_CREDITS_PER_DAY = 10;
export const DEFAULT_CACHE_SECONDS = 3600;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface NetflowRow {
  tokenAddress: string;
  netFlow1hUsd: number;
  netFlow24hUsd: number;
  netFlow7dUsd: number;
  traderCount: number;
}

function reject(anomaly: string): Accepted<never> {
  return { ok: false, anomaly };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Validates a netflow response body and returns the row for `tokenAddress`. Fails closed: a missing row, a wrong
 * shape, a non-finite number, or too many rows is an anomaly, never a default.
 */
export function acceptNetflow(payload: unknown, tokenAddress: string): Accepted<NetflowRow> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return reject("netflow shape");
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) return reject("netflow data");
  if (data.length > NANSEN_MAX_ROWS) return reject("netflow rows");
  const wanted = tokenAddress.toLowerCase();
  for (const raw of data) {
    if (raw === null || typeof raw !== "object") return reject("netflow row");
    const row = raw as Record<string, unknown>;
    if (typeof row.token_address !== "string" || row.token_address.toLowerCase() !== wanted) continue;
    if (row.chain !== undefined && row.chain !== "monad") return reject("netflow chain");
    if (!finite(row.net_flow_1h_usd) || !finite(row.net_flow_24h_usd) || !finite(row.net_flow_7d_usd)) return reject("netflow values");
    if (!finite(row.trader_count) || !Number.isInteger(row.trader_count) || row.trader_count < 0) return reject("netflow trader count");
    return {
      ok: true,
      value: {
        tokenAddress: wanted,
        netFlow1hUsd: row.net_flow_1h_usd,
        netFlow24hUsd: row.net_flow_24h_usd,
        netFlow7dUsd: row.net_flow_7d_usd,
        traderCount: row.trader_count,
      },
    };
  }
  return reject("token not in response");
}

/** The signal: 24-hour smart money net flow over `normalizerUsd`, clamped to [-1, 1]. */
export function signalFromNetflow(row: NetflowRow, normalizerUsd: number): number {
  if (!finite(normalizerUsd) || normalizerUsd <= 0) throw new Error("normalizerUsd must be positive");
  return Math.max(-1, Math.min(1, row.netFlow24hUsd / normalizerUsd));
}

export interface NansenUsageEntry {
  at: string;
  endpoint: string;
  /** null when no HTTP response was received (network error, timeout) or no call was made (budget). */
  status: number | null;
  /** From `X-Nansen-Credits-Cost` when reported; otherwise the documented estimate, flagged by `estimated`. */
  credits: number;
  estimated: boolean;
  creditsRemaining: number | null;
  outcome: "signal" | "rejected" | "unreachable" | "http-error" | "budget";
}

/** Per-day credit accounting. In memory: a restart resets the day's count, and Nansen's own plan limit still applies. */
export class NansenUsageLedger {
  private readonly rows: NansenUsageEntry[] = [];

  record(entry: NansenUsageEntry): void {
    this.rows.push(entry);
  }

  entries(): readonly NansenUsageEntry[] {
    return this.rows;
  }

  creditsOnDay(day: string): number {
    return this.rows.filter((r) => r.at.slice(0, 10) === day).reduce((sum, r) => sum + r.credits, 0);
  }
}

export type NansenResult =
  | { ok: true; signal: number; row: NetflowRow; usage: NansenUsageEntry }
  | { ok: false; reason: string; usage: NansenUsageEntry | null };

export interface NansenClientOptions {
  apiKey: string;
  tokenAddress: string;
  ledger?: NansenUsageLedger;
  normalizerUsd?: number;
  maxCreditsPerDay?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  clock?: () => Date;
}

export class NansenClient {
  readonly ledger: NansenUsageLedger;
  private readonly apiKey: string;
  private readonly tokenAddress: string;
  private readonly normalizerUsd: number;
  private readonly maxCreditsPerDay: number;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;
  private readonly clock: () => Date;

  constructor(options: NansenClientOptions) {
    if (!options.apiKey.trim()) throw new Error("NANSEN_API_KEY is empty");
    if (!ADDRESS.test(options.tokenAddress)) throw new Error("the Nansen token address is not a 20-byte hex address");
    this.apiKey = options.apiKey.trim();
    this.tokenAddress = options.tokenAddress;
    this.ledger = options.ledger ?? new NansenUsageLedger();
    this.normalizerUsd = options.normalizerUsd ?? DEFAULT_NORMALIZER_USD;
    this.maxCreditsPerDay = options.maxCreditsPerDay ?? DEFAULT_MAX_CREDITS_PER_DAY;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.doFetch = options.fetch ?? fetch;
    this.clock = options.clock ?? (() => new Date());
  }

  /** One call, one bounded signal or a refusal. Never throws on a network or data failure, and never invents a signal. */
  async smartMoneySignal(): Promise<NansenResult> {
    const at = this.clock().toISOString();
    const entry = (partial: Pick<NansenUsageEntry, "status" | "outcome"> & Partial<NansenUsageEntry>): NansenUsageEntry => ({
      at,
      endpoint: NANSEN_NETFLOW_PATH,
      credits: 0,
      estimated: false,
      creditsRemaining: null,
      ...partial,
    });
    const refuse = (usage: NansenUsageEntry, reason: string): NansenResult => {
      this.ledger.record(usage);
      return { ok: false, reason, usage };
    };
    if (this.ledger.creditsOnDay(at.slice(0, 10)) + NANSEN_SMART_MONEY_CREDITS > this.maxCreditsPerDay) {
      return refuse(entry({ status: null, outcome: "budget" }), "daily credit budget");
    }
    const body = {
      chains: ["monad"],
      filters: { token_address: [this.tokenAddress], include_stablecoins: true },
      pagination: { page: 1, per_page: 10 },
      order_by: [{ field: "net_flow_24h_usd", direction: "DESC" }],
    };
    let response: Response;
    let text: string;
    try {
      response = await this.doFetch(NANSEN_NETFLOW_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await readLimited(response);
    } catch {
      // The error text is dropped on purpose: it could echo request headers. The call may have been billed, so the
      // estimate is counted against the budget.
      return refuse(entry({ status: null, outcome: "unreachable", credits: NANSEN_SMART_MONEY_CREDITS, estimated: true }), "unreachable");
    }
    const costHeader = response.headers.get("x-nansen-credits-cost");
    const hasCost = costHeader !== null && Number.isFinite(Number(costHeader)) && Number(costHeader) >= 0;
    const remainingHeader = response.headers.get("x-nansen-credits-remaining");
    const creditsRemaining = remainingHeader !== null && Number.isFinite(Number(remainingHeader)) ? Number(remainingHeader) : null;
    if (!response.ok) {
      // Nansen documents X-Nansen-Credits-Used as 0 on an unsuccessful response.
      return refuse(entry({ status: response.status, outcome: "http-error", creditsRemaining }), `http ${response.status}`);
    }
    const paid = { credits: hasCost ? Number(costHeader) : NANSEN_SMART_MONEY_CREDITS, estimated: !hasCost, creditsRemaining };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return refuse(entry({ status: response.status, outcome: "rejected", ...paid }), "not json");
    }
    const accepted = acceptNetflow(parsed, this.tokenAddress);
    if (!accepted.ok) return refuse(entry({ status: response.status, outcome: "rejected", ...paid }), accepted.anomaly);
    const usage = entry({ status: response.status, outcome: "signal", ...paid });
    this.ledger.record(usage);
    return { ok: true, signal: signalFromNetflow(accepted.value, this.normalizerUsd), row: accepted.value, usage };
  }
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > NANSEN_MAX_BODY_BYTES) throw new Error("body too large");
  const text = await response.text();
  if (Buffer.byteLength(text) > NANSEN_MAX_BODY_BYTES) throw new Error("body too large");
  return text;
}

/**
 * Serves the signal to the worker: at most one live call per `cacheSeconds`, shared by every agent, so many agents do
 * not multiply the credit spend. A failed call is also held for the window and returns null (no signal).
 */
export class NansenSignalFeed {
  private cached: { at: number; signal: number | null } | null = null;

  constructor(
    private readonly client: Pick<NansenClient, "smartMoneySignal">,
    private readonly cacheSeconds: number,
    private readonly clock: () => Date = () => new Date(),
    private readonly log: (message: string) => void = () => {},
  ) {}

  async read(): Promise<number | null> {
    const now = this.clock().getTime();
    if (this.cached && now - this.cached.at < this.cacheSeconds * 1000) return this.cached.signal;
    let result: NansenResult;
    try {
      result = await this.client.smartMoneySignal();
    } catch {
      result = { ok: false, reason: "client error", usage: null };
    }
    const signal = result.ok ? result.signal : null;
    this.cached = { at: now, signal };
    const credits = result.usage ? `, credits ${result.usage.credits}${result.usage.estimated ? " (estimated)" : ""}` : "";
    this.log(`nansen smart money: ${result.ok ? `signal ${signal}` : `no signal (${result.reason})`}${credits}`);
    return signal;
  }
}

export type NansenConfig =
  | { enabled: false }
  | { enabled: true; apiKey: string; tokenAddress: string; normalizerUsd: number; maxCreditsPerDay: number; cacheSeconds: number };

type Env = Record<string, string | undefined>;

function positive(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

/** `NANSEN_SIGNAL` is `disabled` unless set to `enabled`. Enabled requires `NANSEN_API_KEY` and `NANSEN_TOKEN_ADDRESS`. */
export function loadNansenConfig(env: Env): NansenConfig {
  const flag = env.NANSEN_SIGNAL?.trim() || "disabled";
  if (flag !== "enabled" && flag !== "disabled") throw new Error("NANSEN_SIGNAL must be enabled or disabled");
  if (flag === "disabled") return { enabled: false };
  const apiKey = env.NANSEN_API_KEY?.trim();
  if (!apiKey) throw new Error("NANSEN_SIGNAL is enabled and NANSEN_API_KEY is not set");
  const tokenAddress = env.NANSEN_TOKEN_ADDRESS?.trim();
  if (!tokenAddress || !ADDRESS.test(tokenAddress)) throw new Error("NANSEN_SIGNAL is enabled and NANSEN_TOKEN_ADDRESS is not a 20-byte hex address");
  return {
    enabled: true,
    apiKey,
    tokenAddress,
    normalizerUsd: positive(env, "NANSEN_NORMALIZER_USD", DEFAULT_NORMALIZER_USD),
    maxCreditsPerDay: positive(env, "NANSEN_MAX_CREDITS_PER_DAY", DEFAULT_MAX_CREDITS_PER_DAY),
    cacheSeconds: positive(env, "NANSEN_CACHE_SECONDS", DEFAULT_CACHE_SECONDS),
  };
}
