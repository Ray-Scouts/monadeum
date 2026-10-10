import { jobId, scheduleId, type WorkerJob } from "./jobs.js";

type Concrete = Extract<WorkerJob, { kind: "tick" } | { kind: "evaluate" }>;

/**
 * What the job handlers need from the queue. `BullJobQueue` implements it on BullMQ; `MemoryJobQueue` implements it
 * in process, so the handlers and the idempotency rules are tested without Redis.
 */
export interface JobQueue {
  /** Adds a tick or evaluation job under its derived ID. Returns false, and adds nothing, when that ID is present. */
  enqueue(job: Concrete, options?: { delayMs?: number }): Promise<boolean>;
  /** Creates or replaces the repeatable trigger for one agent. */
  schedule(agentId: string, everyMs: number): Promise<void>;
  unschedule(agentId: string): Promise<void>;
  /** Agent IDs that have a trigger schedule. */
  scheduled(): Promise<string[]>;
}

/** In-process queue for tests and the offline harness. Jobs are kept, never removed, so every ID stays deduplicated. */
export class MemoryJobQueue implements JobQueue {
  readonly jobs = new Map<string, { job: Concrete; delayMs: number; taken: boolean }>();
  readonly schedules = new Map<string, number>();

  async enqueue(job: Concrete, options: { delayMs?: number } = {}): Promise<boolean> {
    const id = jobId(job);
    if (this.jobs.has(id)) return false;
    this.jobs.set(id, { job, delayMs: options.delayMs ?? 0, taken: false });
    return true;
  }
  async schedule(agentId: string, everyMs: number) {
    this.schedules.set(agentId, everyMs);
  }
  async unschedule(agentId: string) {
    this.schedules.delete(agentId);
  }
  async scheduled() {
    return [...this.schedules.keys()].sort();
  }

  /** Takes every job not yet taken, in insertion order, for a test to run. */
  take(): Concrete[] {
    const out: Concrete[] = [];
    for (const entry of this.jobs.values()) {
      if (entry.taken) continue;
      entry.taken = true;
      out.push(entry.job);
    }
    return out;
  }

  /** Schedule IDs, as the BullMQ implementation names them. */
  scheduleIds(): string[] {
    return [...this.schedules.keys()].map(scheduleId).sort();
  }
}
