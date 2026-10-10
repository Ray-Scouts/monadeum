import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FitnessModule } from "@monadeum/fitness";
import { ReallocationModule } from "@monadeum/reallocation";
import { RiskModule } from "@monadeum/risk";
import { TickModule } from "@monadeum/tick";

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

/**
 * The worker's Nest context. The modules that need no deployment configuration are provided here. TradingService,
 * X402Client, and WalletsService need the market, provider endpoints, chain, bundler, and paymaster configuration, so
 * an `AgentWorker` is assembled from them explicitly (see `WorkerDependencies`); that configuration and the BullMQ
 * consumer are not wired in this process yet.
 */
@Module({
  imports: [TickModule, ReallocationModule, RiskModule, FitnessModule],
})
export class WorkerModule {}

export async function createWorker() {
  return NestFactory.createApplicationContext(WorkerModule, { logger: false });
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.js")) {
  createWorker().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
