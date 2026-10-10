import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadDatabaseSettings, openDatabase, type Connect } from "@monadeum/db";
import { FitnessModule } from "@monadeum/fitness";
import { ReallocationModule } from "@monadeum/reallocation";
import { RiskModule } from "@monadeum/risk";
import { TickModule } from "@monadeum/tick";
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

/**
 * The worker's Nest context. The modules that need no deployment configuration are provided here, and the module
 * stores under `WORKER_STORES`. TradingService, X402Client, and WalletsService need the market, provider endpoints,
 * chain, bundler, and paymaster configuration, so an `AgentWorker` is assembled from them and the stores explicitly
 * (see `WorkerDependencies`); that configuration and the BullMQ consumer are not wired in this process yet.
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

/**
 * Boots the context and its stores, which checks the configuration and the schema, then exits: no tick runs in this
 * process until the BullMQ consumer is wired (ARCHITECTURE.md section 11).
 */
async function main() {
  const log = (message: string) => console.log(message);
  const { stores, close } = await bootWorker({ env: process.env, log });
  log(`worker context ready on ${stores.durable ? "Postgres" : "in-memory"} stores; no tick consumer is wired yet, exiting`);
  await close();
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.js")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
