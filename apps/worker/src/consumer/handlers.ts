import type { AgentStore } from "@monadeum/agent-registry";
import { EVALUATION_CADENCE } from "@monadeum/reallocation";
import type { PrincipalSync } from "../principal.js";
import { tickAt, type WorkerJob } from "./jobs.js";
import type { AgentLocks } from "./locks.js";
import type { JobQueue } from "./queue.js";

/** What runs a tick and an evaluation. `AgentWorker` implements it. */
export interface TickRunner {
  tick(agentId: string, tick: number): Promise<unknown>;
  evaluate(tick: number): Promise<unknown>;
}

export interface ConsumerSettings {
  /** Wall-clock length of one tick. Fixed for a deployment: the tick number is derived from it. */
  tickIntervalMs: number;
  /** How long after its trigger the evaluation job waits, so the tick jobs of the same tick run first. */
  evaluationDelayMs: number;
  /** Per-agent lock lifetime: an upper bound on one tick or evaluation. */
  lockTtlMs: number;
  /** Wait before a job that found its agent locked is tried again. */
  lockRetryMs: number;
}

/** `done` completes the job. `retry` asks the consumer to delay it and try again, without counting a failure. */
export type JobOutcome = { kind: "done"; detail: string } | { kind: "retry"; afterMs: number; detail: string };

/**
 * The job handlers, independent of BullMQ: the consumer parses a job and calls `handle`. Idempotency rests on two
 * layers. A tick or evaluation job's ID is derived from its tick key, so a duplicate enqueue adds nothing; and the
 * tick loop and the reallocation settlement each claim their key in a store before acting, so a job run twice (after
 * its ID was pruned, or after a crash mid-job) resumes or is refused rather than acting twice.
 */
export class WorkerJobHandlers {
  constructor(
    private readonly deps: {
      agents: AgentStore;
      runner: TickRunner;
      queue: JobQueue;
      locks: AgentLocks;
      settings: ConsumerSettings;
      clock: () => Date;
      /** Recomputes principals from funding transfers. Without it the `principal` job does nothing and says so. */
      principal?: PrincipalSync;
      log?: (message: string) => void;
    },
  ) {}

  async handle(job: WorkerJob): Promise<JobOutcome> {
    switch (job.kind) {
      case "sync":
        return this.sync();
      case "principal":
        return this.principal();
      case "trigger":
        return this.trigger(job.agentId);
      case "tick":
        return this.tick(job.agentId, job.tick);
      case "evaluate":
        return this.evaluate(job.tick);
    }
  }

  /** One schedule per active agent; schedules of retired or unknown agents are removed. */
  async sync(): Promise<JobOutcome> {
    const { agents, queue, settings } = this.deps;
    const active = new Set((await agents.list()).filter((a) => a.status === "active").map((a) => a.agentId));
    const scheduled = new Set(await queue.scheduled());
    let added = 0;
    let removed = 0;
    for (const id of active) {
      if (scheduled.has(id)) continue;
      await queue.schedule(id, settings.tickIntervalMs);
      added++;
    }
    for (const id of scheduled) {
      if (active.has(id)) continue;
      await queue.unschedule(id);
      removed++;
    }
    return { kind: "done", detail: `schedules: ${active.size} active, ${added} added, ${removed} removed` };
  }

  /** Recomputes principals; an agent whose lock is held is left for the next run, not waited on. */
  async principal(): Promise<JobOutcome> {
    if (!this.deps.principal) return { kind: "done", detail: "principal sync is not configured: no principal changes" };
    const r = await this.deps.principal.run();
    if (r.reason === "settlement-asset-mismatch") return { kind: "done", detail: "principal: the indexer records another settlement asset; nothing written" };
    if (r.reason === "settlement-asset-unrecorded") return { kind: "done", detail: "principal: the indexer has not recorded its settlement asset yet; nothing written" };
    if (r.asOf === null) return { kind: "done", detail: "principal: the read-model has no finalized bound yet; nothing written" };
    const changed = r.updated.map((u) => `${u.agentId}=${u.principal}`).join(", ") || "none";
    return { kind: "done", detail: `principal through block ${r.asOf}: changed ${changed}; skipped ${r.skipped.length}` };
  }

  async trigger(agentId: string): Promise<JobOutcome> {
    const { agents, queue, settings, clock } = this.deps;
    const agent = await agents.get(agentId);
    if (!agent || agent.status !== "active") {
      await queue.unschedule(agentId);
      return { kind: "done", detail: `${agentId} is not active; schedule removed` };
    }
    const tick = tickAt(clock(), settings.tickIntervalMs);
    if (tick <= 0) throw new Error("the clock is before the first tick interval");
    const added = await queue.enqueue({ kind: "tick", agentId, tick });
    if (tick % EVALUATION_CADENCE === 0) await queue.enqueue({ kind: "evaluate", tick }, { delayMs: settings.evaluationDelayMs });
    return { kind: "done", detail: `${agentId} tick ${tick} ${added ? "enqueued" : "already enqueued"}` };
  }

  async tick(agentId: string, tick: number): Promise<JobOutcome> {
    const release = await this.deps.locks.acquire([agentId], this.deps.settings.lockTtlMs);
    if (!release) return { kind: "retry", afterMs: this.deps.settings.lockRetryMs, detail: `${agentId} is locked` };
    try {
      await this.deps.runner.tick(agentId, tick);
    } finally {
      await release();
    }
    return { kind: "done", detail: `${agentId} tick ${tick} ran` };
  }

  /**
   * Takes every active agent's lock, so no tick changes running state the evaluation reads and writes. A tick of the
   * same number that has not run yet is measured into the next evaluation instead; the history is never lost.
   */
  async evaluate(tick: number): Promise<JobOutcome> {
    if (tick % EVALUATION_CADENCE !== 0) throw new Error(`tick ${tick} is not on the evaluation cadence`);
    const ids = (await this.deps.agents.list()).filter((a) => a.status === "active").map((a) => a.agentId);
    const release = await this.deps.locks.acquire(ids, this.deps.settings.lockTtlMs);
    if (!release) return { kind: "retry", afterMs: this.deps.settings.lockRetryMs, detail: `evaluation ${tick} waits for agent locks` };
    try {
      await this.deps.runner.evaluate(tick);
    } finally {
      await release();
    }
    return { kind: "done", detail: `evaluation at tick ${tick} ran` };
  }
}

/**
 * The runner when TradingService, X402Client, WalletsService, and a market source are not configured in this process
 * (ARCHITECTURE.md section 11, "Not yet wired"). Fails closed: nothing is decided, bought, or sent, and each job says
 * why. Refused in production by `bootWorker`.
 */
export class UnconfiguredTickRunner implements TickRunner {
  constructor(private readonly log: (message: string) => void = () => {}) {}
  async tick(agentId: string, tick: number) {
    this.log(`tick ${agentId}:${tick} skipped: trading, x402, and wallets are not configured in this process`);
    return null;
  }
  async evaluate(tick: number) {
    this.log(`evaluation at tick ${tick} skipped: trading, x402, and wallets are not configured in this process`);
    return null;
  }
}
