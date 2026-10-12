import { TradingConfigError, loadTradingConfig, type TradingConfig } from "@monadeum/trading";
import { getAddress, isAddress, type Address } from "viem";
import type { ConsumerSettings } from "./consumer/handlers.js";

export class WorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerConfigError";
  }
}

/** The consumer's configuration. The database variables are read separately, by `@monadeum/db`. */
export interface WorkerConsumerConfig {
  redisUrl: string;
  /** Prefix of every Redis key the consumer writes: the queue's and the agent locks'. */
  prefix: string;
  concurrency: number;
  syncIntervalMs: number;
  settings: ConsumerSettings;
  /**
   * The principal job: the settlement asset whose transfers count, and how often it runs. Null when
   * WORKER_SETTLEMENT_ASSET_ADDRESS is unset, in which case no principal changes and funded agents never start.
   */
  principal: { settlementAsset: Address; intervalMs: number } | null;
}

type Env = Record<string, string | undefined>;

function integer(env: Env, name: string, fallback: number | null, min: number): number {
  const raw = env[name]?.trim();
  if (!raw) {
    if (fallback === null) throw new WorkerConfigError(`${name} is not set`);
    return fallback;
  }
  if (!/^\d+$/.test(raw)) throw new WorkerConfigError(`${name} is not a non-negative integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) throw new WorkerConfigError(`${name} must be an integer of at least ${min}`);
  return value;
}

/**
 * Reads the consumer's configuration, or returns null when REDIS_URL is unset (no consumer). Every variable is
 * documented in ARCHITECTURE.md section 11. WORKER_TICK_INTERVAL_MS has no default even though
 * the tick length is decided, one hour (3600000): the tick number every key is built from depends on it, so a
 * deployment states it explicitly rather than inheriting it.
 */
export function loadConsumerConfig(env: Env): WorkerConsumerConfig | null {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) return null;
  if (!/^rediss?:\/\//.test(redisUrl)) throw new WorkerConfigError("REDIS_URL must be a redis:// or rediss:// URL");
  const tickIntervalMs = integer(env, "WORKER_TICK_INTERVAL_MS", null, 1_000);
  const lockTtlMs = integer(env, "WORKER_AGENT_LOCK_MS", 10 * 60_000, 1_000);
  const evaluationDelayMs = integer(env, "WORKER_EVALUATION_DELAY_MS", Math.floor(tickIntervalMs / 2), 0);
  if (evaluationDelayMs >= tickIntervalMs) throw new WorkerConfigError("WORKER_EVALUATION_DELAY_MS must be shorter than WORKER_TICK_INTERVAL_MS");
  const prefix = env.WORKER_REDIS_PREFIX?.trim() || "monadeum";
  const syncIntervalMs = integer(env, "WORKER_SYNC_INTERVAL_MS", tickIntervalMs, 1_000);
  const asset = env.WORKER_SETTLEMENT_ASSET_ADDRESS?.trim();
  if (asset && !isAddress(asset)) throw new WorkerConfigError("WORKER_SETTLEMENT_ASSET_ADDRESS is not an address");
  if (!/^[a-z0-9_-]+$/i.test(prefix)) throw new WorkerConfigError("WORKER_REDIS_PREFIX may contain only letters, digits, - and _");
  return {
    redisUrl,
    prefix,
    concurrency: integer(env, "WORKER_CONCURRENCY", 1, 1),
    syncIntervalMs,
    settings: { tickIntervalMs, evaluationDelayMs, lockTtlMs, lockRetryMs: integer(env, "WORKER_LOCK_RETRY_MS", 1_000, 10) },
    principal: asset
      ? { settlementAsset: asset.toLowerCase() as Address, intervalMs: integer(env, "WORKER_PRINCIPAL_INTERVAL_MS", syncIntervalMs, 1_000) }
      : null,
  };
}

/**
 * The trading market from `TRADING_*` (`loadTradingConfig` of `@monadeum/trading`), null when unset. A configured
 * market whose quote is not the settlement asset the worker counts (`WORKER_SETTLEMENT_ASSET_ADDRESS`) is refused:
 * every buy approves the quote asset, and the spend policy counts only the settlement asset.
 */
export function loadWorkerTrading(env: Env): TradingConfig | null {
  let trading: TradingConfig | null;
  try {
    trading = loadTradingConfig(env);
  } catch (error) {
    if (error instanceof TradingConfigError) throw new WorkerConfigError(error.message);
    throw error;
  }
  const settlement = env.WORKER_SETTLEMENT_ASSET_ADDRESS?.trim().toLowerCase();
  if (trading && settlement && trading.market.quote.toLowerCase() !== settlement) {
    throw new WorkerConfigError("TRADING_QUOTE is not WORKER_SETTLEMENT_ASSET_ADDRESS: the market must be quoted in the settlement asset");
  }
  return trading;
}

/** Bounds on a market data reading (`KuruMidSignal`): starting values, not measurements (ARCHITECTURE.md section 11). */
export interface MarketDataLimits {
  /** Oldest acceptable block, seconds behind the local clock. A lagging RPC node gives no signal. */
  maxAgeSeconds: number;
  /** Widest acceptable spread, bps of the mid. An empty, one-sided, or thin book gives no signal. */
  maxSpreadBps: number;
}

/**
 * The production tick runner's switch and settings (ARCHITECTURE.md section 11, "Tick runner"). Off unless
 * `WORKER_TICK_RUNNER=enabled`; off, the consumer skips every tick and evaluation, as before the runner existed.
 */
export type TickRunnerConfig =
  | { enabled: false }
  | {
      enabled: true;
      /** JSON-RPC endpoint for every chain read the runner makes: balances, the spend policy, and the Kuru book. */
      rpcUrl: string;
      /** The operator address every risk policy version must be signed by (ARCHITECTURE.md section 16.1). */
      policySigner: Address;
      /** Slippage bound written into every TradeIntent. */
      maxSlippageBps: number;
      marketData: MarketDataLimits;
    };

/**
 * Reads the runner's switch. With `WORKER_TICK_RUNNER=enabled` every dependency is required here, before anything is
 * opened: `WORKER_RPC_URL`, `WORKER_POLICY_SIGNER`, WalletsModule (`WALLETS_CHAIN_ID`), a market (`TRADING_KURU_MARKET`),
 * and `WORKER_SETTLEMENT_ASSET_ADDRESS`. The x402 payer must stay off: the runner's X402Client has no payer and buys
 * nothing (ARCHITECTURE.md section 16.3, open question 1). Optional: `WORKER_MAX_SLIPPAGE_BPS` (default 100),
 * `WORKER_MARKET_MAX_AGE_SECONDS` (default 60), and `WORKER_MARKET_MAX_SPREAD_BPS` (default 200), starting values.
 */
export function loadTickRunnerConfig(env: Env): TickRunnerConfig {
  const flag = env.WORKER_TICK_RUNNER?.trim() || "disabled";
  if (flag !== "enabled" && flag !== "disabled") throw new WorkerConfigError("WORKER_TICK_RUNNER must be enabled or disabled");
  if (flag === "disabled") return { enabled: false };
  const rpcUrl = env.WORKER_RPC_URL?.trim();
  if (!rpcUrl) throw new WorkerConfigError("WORKER_TICK_RUNNER is enabled and WORKER_RPC_URL is not set");
  if (!/^https?:\/\//.test(rpcUrl)) throw new WorkerConfigError("WORKER_RPC_URL must be an http:// or https:// URL");
  const signer = env.WORKER_POLICY_SIGNER?.trim();
  if (!signer) throw new WorkerConfigError("WORKER_TICK_RUNNER is enabled and WORKER_POLICY_SIGNER is not set: no risk policy could be verified");
  if (!isAddress(signer)) throw new WorkerConfigError("WORKER_POLICY_SIGNER is not an address");
  if (!env.WALLETS_CHAIN_ID?.trim()) throw new WorkerConfigError("WORKER_TICK_RUNNER is enabled and WALLETS_CHAIN_ID is not set: no plan could be signed");
  if (!env.TRADING_KURU_MARKET?.trim()) throw new WorkerConfigError("WORKER_TICK_RUNNER is enabled and TRADING_KURU_MARKET is not set: no market is configured");
  if (!env.WORKER_SETTLEMENT_ASSET_ADDRESS?.trim()) {
    throw new WorkerConfigError("WORKER_TICK_RUNNER is enabled and WORKER_SETTLEMENT_ASSET_ADDRESS is not set: no agent becomes funded");
  }
  if (env.WORKER_X402_PAYER_ENABLED?.trim() === "true") {
    throw new WorkerConfigError("WORKER_TICK_RUNNER is enabled with WORKER_X402_PAYER_ENABLED=true: the tick runner buys no information yet");
  }
  const slippage = integer(env, "WORKER_MAX_SLIPPAGE_BPS", 100, 0);
  if (slippage >= 10_000) throw new WorkerConfigError("WORKER_MAX_SLIPPAGE_BPS must be below 10000");
  const maxSpreadBps = integer(env, "WORKER_MARKET_MAX_SPREAD_BPS", 200, 0);
  if (maxSpreadBps > 10_000) throw new WorkerConfigError("WORKER_MARKET_MAX_SPREAD_BPS must be at most 10000");
  return {
    enabled: true,
    rpcUrl,
    policySigner: getAddress(signer),
    maxSlippageBps: slippage,
    marketData: { maxAgeSeconds: integer(env, "WORKER_MARKET_MAX_AGE_SECONDS", 60, 1), maxSpreadBps },
  };
}
