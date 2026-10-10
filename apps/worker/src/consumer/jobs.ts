import { tickKey } from "@monadeum/tick";

/**
 * The worker's job types (ARCHITECTURE.md section 11).
 *
 * - `sync`: reconciles the per-agent schedules with the registry: one schedule per active agent, none for others.
 * - `trigger`: fired by an agent's schedule every tick interval. It derives the current tick number from the clock
 *   and enqueues that tick's `tick` job, and, on the evaluation cadence, the `evaluate` job.
 * - `tick`: runs one tick for one agent.
 * - `evaluate`: runs one evaluation for the population.
 */
export type WorkerJob =
  | { kind: "sync" }
  | { kind: "trigger"; agentId: string }
  | { kind: "tick"; agentId: string; tick: number }
  | { kind: "evaluate"; tick: number };

/** BullMQ rejects a custom job ID containing ":" or one that parses as an integer; encoding and a prefix avoid both. */
const part = (value: string) => encodeURIComponent(value).replace(/\./g, "%2E");

/**
 * The job ID of a `tick` or `evaluate` job, derived from its tick key, so enqueueing the same tick twice is a no-op.
 * Trigger and sync jobs come from schedules and carry the schedule's own IDs.
 */
export function jobId(job: Extract<WorkerJob, { kind: "tick" } | { kind: "evaluate" }>): string {
  return job.kind === "tick" ? `tick-${part(tickKey(job.agentId, job.tick))}` : `evaluate-${job.tick}`;
}

/** The schedule ID of one agent's repeatable trigger. */
export function scheduleId(agentId: string): string {
  return `agent-${part(agentId)}`;
}

/**
 * The tick sequence number at `now`: whole tick intervals since the Unix epoch. Every worker process derives the same
 * number for the same interval, so the tick key, and the job ID derived from it, identify one tick across processes
 * and restarts. Changing the interval renumbers ticks; see ARCHITECTURE.md section 11.
 */
export function tickAt(now: Date, intervalMs: number): number {
  return Math.floor(now.getTime() / intervalMs);
}

/** Validates a job's data as read back from the queue. Anything else is rejected, never guessed at. */
export function parseJob(name: string, data: unknown): WorkerJob {
  const d = (data ?? {}) as Record<string, unknown>;
  const agentId = typeof d.agentId === "string" && d.agentId.length > 0 ? d.agentId : null;
  const tick = typeof d.tick === "number" && Number.isSafeInteger(d.tick) && d.tick > 0 ? d.tick : null;
  if (name === "sync") return { kind: "sync" };
  if (name === "trigger" && agentId) return { kind: "trigger", agentId };
  if (name === "tick" && agentId && tick !== null) return { kind: "tick", agentId, tick };
  if (name === "evaluate" && tick !== null) return { kind: "evaluate", tick };
  throw new Error(`malformed ${name} job`);
}
