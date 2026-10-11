import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadDatabaseSettings, openDatabase, type Connect } from "@monadeum/db";
import { FitnessModule } from "@monadeum/fitness";
import { ReallocationModule } from "@monadeum/reallocation";
import { RiskModule } from "@monadeum/risk";
import { TickModule } from "@monadeum/tick";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadConsumerConfig, WorkerConfigError } from "./config.js";
import { BullJobQueue, QUEUE_NAME, startConsumer } from "./consumer/bullmq.js";
import { UnconfiguredTickRunner, WorkerJobHandlers, type TickRunner } from "./consumer/handlers.js";
import { RedisAgentLocks } from "./consumer/locks.js";
import { PrincipalSync } from "./principal.js";
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
export { PrincipalSync } from "./principal.js";
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
  /** The process environment: the database variables of `@monadeum/db`. */
  env: Record<string, string | undefined>;
  /** Overrides how DATABASE_URL is opened, for tests. */
  connect?: Connect;
  log?: (message: string) => void;
}

/**
 * Builds the worker process from its environment. With DATABASE_URL set it applies or verifies the migrations and
 * provides the Postgres stores; it should connect through a role that is a member of `monadeum_worker`. Without it,
 * it provides the in-memory stores and says that state is not durable, which it refuses to do with
 * MONADEUM_ENV=production.
 */
export async function bootWorker(options: WorkerBootOptions) {
  const database = await openDatabase(loadDatabaseSettings(options.env), { connect: options.connect, log: options.log });
  const stores = database ? postgresWorkerStores(database.db) : memoryWorkerStores();
  let app;
  try {
    app = await createWorker(stores);
  } catch (error) {
    await database?.close();
    throw error;
  }
  return {
    app,
    stores,
    close: async () => {
      await app.close();
      await database?.close();
    },
  };
}

export interface WorkerRunOptions extends WorkerBootOptions {
  /**
   * Builds what runs ticks and evaluations over the booted stores: an `AgentWorker` once TradingService, X402Client,
   * WalletsService, and a market source are configured. Without it the consumer runs `UnconfiguredTickRunner`, which
   * fails every job closed, and MONADEUM_ENV=production refuses to start.
   */
  runner?: (stores: WorkerStores) => TickRunner;
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
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new BullJobQueue(new Queue(QUEUE_NAME, { connection, prefix: config.prefix }));
  try {
    const runner = options.runner ? options.runner(booted.stores) : new UnconfiguredTickRunner(log);
    if (!options.runner) log("no tick runner is configured: every tick and evaluation job is skipped, nothing is sent");
    const locks = new RedisAgentLocks(connection, `${config.prefix}:agent-lock:`);
    const principal = config.principal
      ? new PrincipalSync({ agents: booted.stores.agents, readModel: booted.stores.readModel, settlementAsset: config.principal.settlementAsset, locks, lockTtlMs: config.settings.lockTtlMs })
      : undefined;
    if (!principal) log("WORKER_SETTLEMENT_ASSET_ADDRESS is not set: principals are not recomputed, so no agent becomes funded");
    const handlers = new WorkerJobHandlers({
      agents: booted.stores.agents,
      runner,
      queue,
      locks,
      settings: config.settings,
      clock: options.clock ?? (() => new Date()),
      principal,
      log,
    });
    log((await handlers.sync()).detail);
    await queue.scheduleSync(config.syncIntervalMs);
    if (config.principal) await queue.schedulePrincipal(config.principal.intervalMs);
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
