import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadDatabaseSettings, openDatabase, type Connect } from "@monadeum/db";
import { FitnessModule } from "@monadeum/fitness";
import { ReallocationModule, loadReallocationSwitch, type ReallocationSwitch } from "@monadeum/reallocation";
import { RiskModule } from "@monadeum/risk";
import { TickModule } from "@monadeum/tick";
import { TradingConfigError, loadTradingConfig, type TradingConfig } from "@monadeum/trading";
import { loadWalletsRuntime, type WalletsRuntimeOptions, type WalletsService } from "@monadeum/wallets";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadConsumerConfig, WorkerConfigError } from "./config.js";
import { BullJobQueue, QUEUE_NAME, startConsumer } from "./consumer/bullmq.js";
import { UnconfiguredTickRunner, WorkerJobHandlers, type TickRunner } from "./consumer/handlers.js";
import { RedisAgentLocks } from "./consumer/locks.js";
import { PrincipalSync, checkSettlementAsset } from "./principal.js";
import { WORKER_STORES, memoryWorkerStores, postgresWorkerStores, type WorkerStores } from "./stores.js";

export { AgentWorker } from "./worker.js";
export type { EvaluationResult, FitnessRow, WorkerDependencies, WorkerSettings } from "./worker.js";
export { MemoryAgentStore } from "./agents.js";
export type { AgentRecord, AgentState, AgentStore } from "./agents.js";
export {
  MemoryDebitStore,
  OwnerPolicies,
  RiskGatedSettlement,
  UnconfiguredReallocationExecutor,
  buildReallocationPlan,
} from "./reallocation.js";
export type { DebitRecord, DebitStore, ReallocationExecutor } from "./reallocation.js";
export type { ChainReader, MarketReading, MarketSource } from "./ports.js";
export { WORKER_STORES, memoryWorkerStores, postgresWorkerStores } from "./stores.js";
export type { WorkerStores } from "./stores.js";
export { WorkerConfigError, loadConsumerConfig } from "./config.js";
export { DisabledX402Payer, RpcSettlementLogSource, X402Reconciler, agentOfTickKey, buildX402Payer, loadX402PayerConfig } from "./x402.js";
export type { LogReader, ReconcileReport, SettlementLogSource, WorkerX402PayerConfig } from "./x402.js";
import { X402Reconciler, loadX402PayerConfig, type SettlementLogSource } from "./x402.js";
export type { WorkerConsumerConfig } from "./config.js";
export { UnconfiguredTickRunner, WorkerJobHandlers } from "./consumer/handlers.js";
export type { ConsumerSettings, JobOutcome, TickRunner } from "./consumer/handlers.js";
export { jobId, parseJob, scheduleId, tickAt } from "./consumer/jobs.js";
export type { WorkerJob } from "./consumer/jobs.js";
export { MemoryJobQueue } from "./consumer/queue.js";
export type { JobQueue } from "./consumer/queue.js";
export { MemoryAgentLocks, RedisAgentLocks } from "./consumer/locks.js";
export type { AgentLocks } from "./consumer/locks.js";
export { BullJobQueue, QUEUE_NAME, startConsumer } from "./consumer/bullmq.js";
export { PrincipalSync, checkSettlementAsset } from "./principal.js";
export type { PrincipalSyncResult } from "./principal.js";

/**
 * The worker's Nest context. The modules that need no deployment configuration are provided here, and the module
 * stores under `WORKER_STORES`. TradingService, X402Client, and WalletsService need the market, provider endpoints,
 * chain, bundler, and paymaster configuration, so an `AgentWorker` is assembled from them and the stores explicitly
 * (see `WorkerDependencies`); that configuration is not wired in this process yet. `runWorker` adds the BullMQ consumer.
 */
@Module({
  imports: [TickModule, ReallocationModule, RiskModule, FitnessModule],
})
export class WorkerModule {
  static withStores(stores: WorkerStores): DynamicModule {
    return { module: WorkerModule, providers: [{ provide: WORKER_STORES, useValue: stores }], exports: [WORKER_STORES] };
  }
}

/** The worker context over the given stores, in memory by default. `bootWorker` picks them from the environment. */
export async function createWorker(stores: WorkerStores = memoryWorkerStores()) {
  return NestFactory.createApplicationContext(WorkerModule.withStores(stores), { logger: false });
}

export interface WorkerBootOptions {
  /** The process environment: the database variables of `@monadeum/db` and the reallocation switch of `@monadeum/reallocation`. */
  env: Record<string, string | undefined>;
  /** Overrides how DATABASE_URL is opened, for tests. */
  connect?: Connect;
  /** Overrides WalletsModule's chain adapter and the vaults' scrypt parameters, for tests. */
  wallets?: WalletsRuntimeOptions;
  log?: (message: string) => void;
}

/**
 * Builds the worker process from its environment. With DATABASE_URL set it applies or verifies the migrations and
 * provides the Postgres stores; it should connect through a role that is a member of `monadeum_worker`. Without it,
 * it provides the in-memory stores and says that state is not durable, which it refuses to do with
 * MONADEUM_ENV=production.
 *
 * It reads the reallocation switch (`loadReallocationSwitch`) before opening anything, so an invalid value, or
 * MONADEUM_REALLOCATION_ENABLED=true in production without the study acknowledgement, refuses to start.
 *
 * With `WALLETS_CHAIN_ID` set it also builds WalletsModule (`loadWalletsRuntime`) over the worker's wallet store and
 * sponsorship ledger and the session key vault it shares with the API, and returns it as `wallets` for the tick runner.
 * The only vault implemented is the local encrypted file vault, which refuses MONADEUM_ENV=production.
 */
export async function bootWorker(options: WorkerBootOptions) {
  const reallocation = loadReallocationSwitch(options.env);
  const trading = loadWorkerTrading(options.env);
  options.log?.(
    trading
      ? `trading: ${trading.market.pair} on Kuru market ${trading.market.market}, MON price for gas from ${trading.monPrice ? `${trading.monPrice.source} (${trading.monPrice.market})` : "the market itself"}`
      : "trading: TRADING_KURU_MARKET is not set, no market is configured",
  );
  options.log?.(reallocation.enabled ? "reallocation is on: evaluations plan and settle owner-scoped reallocation" : "reallocation is off: evaluations compute fitness and apply retirement, and plan and settle nothing");
  const runtime = await loadWalletsRuntime(options.env, options.wallets);
  let database;
  try {
    database = await openDatabase(loadDatabaseSettings(options.env), { connect: options.connect, log: options.log });
  } catch (error) {
    runtime?.close();
    throw error;
  }
  const stores = database ? postgresWorkerStores(database.db) : memoryWorkerStores();
  const wallets: WalletsService | null = runtime ? runtime.build(stores.wallets, stores.sponsorship) : null;
  options.log?.(wallets ? "wallets: WalletsModule configured on the local file vault" : "wallets: WALLETS_CHAIN_ID is not set, WalletsModule is not configured");
  let app;
  try {
    app = await createWorker(stores);
  } catch (error) {
    await database?.close();
    runtime?.close();
    throw error;
  }
  return {
    app,
    stores,
    reallocation,
    wallets,
    trading,
    close: async () => {
      await app.close();
      await database?.close();
      runtime?.close();
    },
  };
}

export interface WorkerRunOptions extends WorkerBootOptions {
  /**
   * Recent settlement-asset logs for the `x402-reconcile` job, e.g. `RpcSettlementLogSource` over a viem public
   * client. Without it the job runs and checks nothing; while the x402 payer is disabled it checks nothing anyway.
   */
  x402Settlements?: SettlementLogSource;
  /**
   * Builds what runs ticks and evaluations over the booted stores: an `AgentWorker` once TradingService, X402Client,
   * WalletsService, and a market source are configured. Without it the consumer runs `UnconfiguredTickRunner`, which
   * fails every job closed, and MONADEUM_ENV=production refuses to start. It receives the reallocation switch read from
   * the environment, which it passes to `AgentWorker` as `settings.reallocation`, WalletsModule when
   * `WALLETS_CHAIN_ID` is set (null otherwise), and the trading market from `TRADING_*` (null when unset), from which
   * `buildKuruTrading` of `@monadeum/trading` builds TradingService.
   */
  runner?: (stores: WorkerStores, reallocation: ReallocationSwitch, wallets: WalletsService | null, trading: TradingConfig | null) => TickRunner;
  clock?: () => Date;
}

/**
 * Boots the worker and runs the BullMQ consumer (ARCHITECTURE.md section 11): it reconciles one repeatable trigger per
 * active agent, runs the tick and evaluation jobs those triggers enqueue, and returns once the consumer is taking
 * jobs. Returns null, after closing everything, when REDIS_URL is unset outside production. `close` stops taking
 * jobs, waits for the ones in progress, and closes Redis, the context, and the database, in that order.
 */
export async function runWorker(options: WorkerRunOptions) {
  const log = options.log ?? (() => {});
  const production = loadDatabaseSettings(options.env).production;
  const config = loadConsumerConfig(options.env);
  const x402 = loadX402PayerConfig(options.env);
  if (!config && production) throw new WorkerConfigError("MONADEUM_ENV is production and REDIS_URL is not set: refusing to start without a consumer");
  if (production && !options.runner) {
    throw new WorkerConfigError("MONADEUM_ENV is production and no tick runner is configured: trading, x402, and wallets are not wired in this process");
  }
  if (production && config && !config.principal) {
    throw new WorkerConfigError("MONADEUM_ENV is production and WORKER_SETTLEMENT_ASSET_ADDRESS is not set: no agent principal could ever be recomputed");
  }
  const booted = await bootWorker(options);
  if (!config) {
    log("REDIS_URL is not set: no consumer runs; set it to run ticks");
    await booted.close();
    return null;
  }
  if (config.principal) {
    try {
      log(await checkSettlementAsset(booted.stores.readModel, config.principal.settlementAsset));
    } catch (error) {
      await booted.close();
      throw error;
    }
  }
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new BullJobQueue(new Queue(QUEUE_NAME, { connection, prefix: config.prefix }));
  try {
    const runner = options.runner ? options.runner(booted.stores, booted.reallocation, booted.wallets, booted.trading) : new UnconfiguredTickRunner(log);
    if (!options.runner) log("no tick runner is configured: every tick and evaluation job is skipped, nothing is sent");
    const locks = new RedisAgentLocks(connection, `${config.prefix}:agent-lock:`);
    const principal = config.principal
      ? new PrincipalSync({ agents: booted.stores.agents, readModel: booted.stores.readModel, settlementAsset: config.principal.settlementAsset, locks, lockTtlMs: config.settings.lockTtlMs })
      : undefined;
    if (!principal) log("WORKER_SETTLEMENT_ASSET_ADDRESS is not set: principals are not recomputed, so no agent becomes funded");
    const x402Reconciler = new X402Reconciler({
      payerEnabled: x402.enabled,
      source: options.x402Settlements ?? null,
      asset: config.principal?.settlementAsset ?? null,
      agents: booted.stores.agents,
      slots: booted.stores.x402Slots,
      payments: booted.stores.payments,
    });
    const handlers = new WorkerJobHandlers({
      agents: booted.stores.agents,
      runner,
      queue,
      locks,
      settings: config.settings,
      clock: options.clock ?? (() => new Date()),
      principal,
      x402Reconciler,
      log,
    });
    log((await handlers.sync()).detail);
    await queue.scheduleSync(config.syncIntervalMs);
    if (config.principal) await queue.schedulePrincipal(config.principal.intervalMs);
    // Scheduled whether or not the payer is on: while it is off, each run checks nothing and says so.
    await queue.scheduleX402Reconcile(x402.reconcileIntervalMs);
    const consumer = startConsumer(connection, handlers, { concurrency: config.concurrency, prefix: config.prefix, log });
    log(`consumer running on ${booted.stores.durable ? "Postgres" : "in-memory"} stores, concurrency ${config.concurrency}`);
    return {
      ...booted,
      queue,
      handlers,
      close: async () => {
        await consumer.close();
        await queue.queue.close();
        await connection.quit();
        await booted.close();
      },
    };
  } catch (error) {
    await queue.queue.close();
    connection.disconnect();
    await booted.close();
    throw error;
  }
}

/**
 * The trading market from `TRADING_*` (`loadTradingConfig` of `@monadeum/trading`), null when unset. A configured
 * market whose quote is not the settlement asset the worker counts (`WORKER_SETTLEMENT_ASSET_ADDRESS`) is refused:
 * every buy approves the quote asset, and the spend policy counts only the settlement asset.
 */
export function loadWorkerTrading(env: Record<string, string | undefined>): TradingConfig | null {
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

/** Runs the consumer until SIGINT or SIGTERM, then shuts down gracefully. */
async function main() {
  const log = (message: string) => console.log(message);
  const running = await runWorker({ env: process.env, log });
  if (!running) return;
  await new Promise<void>((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => resolve());
  });
  log("shutting down: waiting for jobs in progress");
  await running.close();
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.js")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
