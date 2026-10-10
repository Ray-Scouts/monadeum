import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { EVALUATION_CADENCE } from "@monadeum/reallocation";
import { QUEUE_NAME } from "../src/consumer/bullmq.js";
import { RedisAgentLocks } from "../src/consumer/locks.js";
import { runWorker, type TickRunner } from "../src/main.js";

// Opt-in: runs the consumer on BullMQ against a real Redis when REDIS_URL is set, for example
//   REDIS_URL=redis://127.0.0.1:6379 bun run --filter @monadeum/worker test
// Every key is written under a random prefix, which is removed afterwards; nothing outside it is touched.

const url = process.env.REDIS_URL;

async function until(condition: () => boolean, timeoutMs = 10_000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await sleep(25);
  }
}

if (!url) {
  test("bullmq consumer (skipped: set REDIS_URL to run it)", { skip: true }, () => {});
} else {
  test("on BullMQ: schedules trigger ticks, duplicates are no-ops, one job per agent at a time, and shutdown waits for jobs", async () => {
    const prefix = `monadeum-test-${randomBytes(6).toString("hex")}`;
    const started: string[] = [];
    const finished: string[] = [];
    const evaluations: number[] = [];
    const running = new Map<string, number>();
    let maxPerAgent = 0;
    let slowMs = 0;
    const runner: TickRunner = {
      async tick(agentId, tick) {
        running.set(agentId, (running.get(agentId) ?? 0) + 1);
        maxPerAgent = Math.max(maxPerAgent, running.get(agentId)!);
        started.push(`${agentId}:${tick}`);
        await sleep(slowMs);
        running.set(agentId, running.get(agentId)! - 1);
        finished.push(`${agentId}:${tick}`);
      },
      async evaluate(tick) {
        evaluations.push(tick);
      },
    };
    const env = {
      REDIS_URL: url, WORKER_REDIS_PREFIX: prefix, WORKER_TICK_INTERVAL_MS: "60000", WORKER_CONCURRENCY: "4",
      WORKER_LOCK_RETRY_MS: "50", WORKER_EVALUATION_DELAY_MS: "0",
    };
    // A clock inside an evaluation tick, so a trigger also enqueues the evaluation.
    const clock = () => new Date(EVALUATION_CADENCE * 1_000 * 60_000 + 5);
    const worker = await runWorker({ env, runner: () => runner, clock, log: () => {} });
    assert.ok(worker);
    const admin = new Redis(url, { maxRetriesPerRequest: null });
    const inspect = new Queue(QUEUE_NAME, { connection: admin, prefix });
    try {
      await worker.stores.agents.add({
        agentId: "a", owner: "0x00000000000000000000000000000000000000aa", account: "0x00000000000000000000000000000000000000bb",
        genomeHash: `0x${"11".repeat(32)}`,
        genome: { riskTolerance: 0.1, executionFrequency: 1, informationBudget: 1n, informationSources: [], pair: "MON/USDC", assetUniverse: ["MON/USDC"] },
        principal: 1n, status: "active",
      });
      await worker.handlers.sync();
      assert.deepEqual(await worker.queue.scheduled(), ["a"]);

      // The schedule fires at once: its trigger enqueues this interval's tick and the evaluation, which then run.
      const tick = EVALUATION_CADENCE * 1_000;
      await until(() => finished.includes(`a:${tick}`) && evaluations.includes(tick));
      assert.equal(await worker.queue.enqueue({ kind: "tick", agentId: "a", tick }), false, "a duplicate of a kept job is a no-op");
      await sleep(200);
      assert.equal(started.filter((k) => k === `a:${tick}`).length, 1);

      // Several ticks of one agent, enqueued together on a consumer with concurrency 4, never overlap.
      slowMs = 150;
      for (const t of [1, 2, 3]) assert.equal(await worker.queue.enqueue({ kind: "tick", agentId: "a", tick: t }), true);
      await until(() => [1, 2, 3].every((t) => finished.includes(`a:${t}`)));
      assert.equal(maxPerAgent, 1);

      // Graceful shutdown: a job in progress finishes before close resolves.
      slowMs = 500;
      await worker.queue.enqueue({ kind: "tick", agentId: "a", tick: 4 });
      await until(() => started.includes("a:4"));
      await worker.close();
      assert.ok(finished.includes("a:4"), "close waited for the job in progress");
      assert.equal(await new RedisAgentLocks(admin, `${prefix}:agent-lock:`).acquire(["a"], 1_000).then((r) => r !== null), true, "the lock was released");
    } finally {
      await inspect.obliterate({ force: true });
      await inspect.close();
      for (const key of await admin.keys(`${prefix}:*`)) await admin.del(key);
      await admin.quit();
    }
  });
}
