import { isAddress, type Address } from "viem";
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
