import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ReallocationModule } from "@monadeum/reallocation";
import { TickModule } from "@monadeum/tick";

@Module({
  imports: [TickModule, ReallocationModule],
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
