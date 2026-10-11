import { DelayedError, Queue, Worker, type Job, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";
import { jobId, parseJob, scheduleId, type WorkerJob } from "./jobs.js";
import type { WorkerJobHandlers } from "./handlers.js";
import type { JobQueue } from "./queue.js";

/** One queue carries every job type; the job name is the type. */
export const QUEUE_NAME = "monadeum-worker";
const SYNC_SCHEDULE = "sync";
const PRINCIPAL_SCHEDULE = "principal";
const X402_RECONCILE_SCHEDULE = "x402-reconcile";

const DAY = 24 * 60 * 60;
/**
 * Completed and failed tick and evaluation jobs are kept for this long, and their IDs deduplicate enqueues while they
 * are kept. A duplicate enqueued after that adds a job again, which the stores' tick-key claims then make a no-op.
 */
const KEEP: Pick<JobsOptions, "removeOnComplete" | "removeOnFail"> = { removeOnComplete: { age: 7 * DAY }, removeOnFail: { age: 30 * DAY } };
/** A tick or evaluation that throws is retried by key; the tick record and debit claims make the retry safe. */
const RETRY: Pick<JobsOptions, "attempts" | "backoff"> = { attempts: 3, backoff: { type: "exponential", delay: 5_000 } };
/** Triggers carry no state; only the last few are kept, for inspection. */
const TRIGGER_KEEP: Pick<JobsOptions, "removeOnComplete" | "removeOnFail"> = { removeOnComplete: { count: 100 }, removeOnFail: { count: 1_000 } };

/** `JobQueue` on BullMQ. Agent triggers are job schedulers, one per agent; tick and evaluation jobs carry derived IDs. */
export class BullJobQueue implements JobQueue {
  constructor(readonly queue: Queue) {}

  /**
   * BullMQ ignores an add whose ID is already present, atomically. The boolean comes from a read before the add, so
   * under a race it can report true for an add that was in fact ignored; nothing depends on it beyond logging.
   */
  async enqueue(job: Extract<WorkerJob, { kind: "tick" } | { kind: "evaluate" }>, options: { delayMs?: number } = {}): Promise<boolean> {
    const id = jobId(job);
    if (await this.queue.getJob(id)) return false;
    const data = job.kind === "tick" ? { agentId: job.agentId, tick: job.tick } : { tick: job.tick };
    await this.queue.add(job.kind, data, { jobId: id, ...KEEP, ...RETRY, ...(options.delayMs ? { delay: options.delayMs } : {}) });
    return true;
  }

  async schedule(agentId: string, everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(scheduleId(agentId), { every: everyMs }, { name: "trigger", data: { agentId }, opts: TRIGGER_KEEP });
  }

  async unschedule(agentId: string): Promise<void> {
    await this.queue.removeJobScheduler(scheduleId(agentId));
  }

  async scheduled(): Promise<string[]> {
    const out: string[] = [];
    const page = 500;
    for (let start = 0; ; start += page) {
      const schedulers = await this.queue.getJobSchedulers(start, start + page - 1, true);
      for (const s of schedulers) {
        const agentId = (s.template?.data as { agentId?: unknown } | undefined)?.agentId;
        if (s.key !== SYNC_SCHEDULE && s.key !== PRINCIPAL_SCHEDULE && s.key !== X402_RECONCILE_SCHEDULE && typeof agentId === "string" && s.key === scheduleId(agentId)) out.push(agentId);
      }
      if (schedulers.length < page) return out.sort();
    }
  }

  /** The repeatable job that reconciles agent schedules with the registry. */
  async scheduleSync(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(SYNC_SCHEDULE, { every: everyMs }, { name: "sync", data: {}, opts: TRIGGER_KEEP });
  }

  /** The repeatable job that recomputes principals from finalized funding transfers. */
  async schedulePrincipal(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(PRINCIPAL_SCHEDULE, { every: everyMs }, { name: "principal", data: {}, opts: TRIGGER_KEEP });
  }

  /** The repeatable job that reconciles x402 settlements with the payment log. */
  async scheduleX402Reconcile(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(X402_RECONCILE_SCHEDULE, { every: everyMs }, { name: "x402-reconcile", data: {}, opts: TRIGGER_KEEP });
  }
}

export interface ConsumerOptions {
  /** Jobs processed at once by this process. Per-agent exclusion comes from the agent locks, not from this number. */
  concurrency: number;
  /** The queue's Redis key prefix; it must match the prefix the queue was created with. */
  prefix: string;
  log?: (message: string) => void;
}

/**
 * Runs `handlers` on BullMQ. A job whose agent is locked is moved back to the delayed set and retried later, without
 * counting as a failed attempt. A malformed job fails without retry. `close` stops taking jobs, waits for the jobs in
 * progress to finish, and then closes the connections it owns.
 */
export function startConsumer(connection: Redis, handlers: WorkerJobHandlers, options: ConsumerOptions) {
  const log = options.log ?? (() => {});
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job, token?: string) => {
      let parsed: WorkerJob;
      try {
        parsed = parseJob(job.name, job.data);
      } catch (error) {
        await job.discard();
        throw error;
      }
      const outcome = await handlers.handle(parsed);
      if (outcome.kind === "retry") {
        await job.moveToDelayed(Date.now() + outcome.afterMs, token);
        throw new DelayedError();
      }
      return outcome.detail;
    },
    { connection, prefix: options.prefix, concurrency: options.concurrency, autorun: true },
  );
  worker.on("failed", (job, error) => log(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed: ${error.message}`));
  worker.on("error", (error) => log(`consumer error: ${error.message}`));
  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}
