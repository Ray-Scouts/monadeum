import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Per-agent mutual exclusion across worker processes, so at most one job touches an agent's running state at a time:
 * the per-agent concurrency of 1 that ARCHITECTURE.md section 11 asks for. BullMQ's open-source edition has no
 * per-group concurrency, so the consumer takes this lock around each tick and around each evaluation (which takes
 * every active agent's lock). A job that cannot take its lock is delayed and retried, never run alongside.
 */
export interface AgentLocks {
  /** Takes every lock in `agentIds` or none. Returns the release function, or null when any lock is held. */
  acquire(agentIds: readonly string[], ttlMs: number): Promise<(() => Promise<void>) | null>;
}

/** For tests and a single process. */
export class MemoryAgentLocks implements AgentLocks {
  private readonly held = new Set<string>();

  async acquire(agentIds: readonly string[], _ttlMs?: number) {
    const ids = [...new Set(agentIds)];
    if (ids.some((id) => this.held.has(id))) return null;
    for (const id of ids) this.held.add(id);
    return async () => {
      for (const id of ids) this.held.delete(id);
    };
  }

  isHeld(agentId: string): boolean {
    return this.held.has(agentId);
  }
}

// Deletes the key only if it still holds this holder's token, so a lock that expired and was taken by another
// process is never released by the first one.
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Redis locks: `SET key token NX PX ttl` per agent, released by a compare-and-delete script. The TTL bounds how long a
 * crashed holder blocks an agent; it must exceed the longest tick, or two ticks of one agent could overlap after it
 * expires. That bound is a configured assumption (WORKER_AGENT_LOCK_MS), not a measured tick duration.
 */
export class RedisAgentLocks implements AgentLocks {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "monadeum:agent-lock:",
  ) {}

  async acquire(agentIds: readonly string[], ttlMs: number) {
    const token = randomUUID();
    const taken: string[] = [];
    const release = async () => {
      for (const key of taken) await this.redis.eval(RELEASE, 1, key, token);
    };
    for (const id of [...new Set(agentIds)].sort()) {
      const key = this.prefix + id;
      if ((await this.redis.set(key, token, "PX", ttlMs, "NX")) !== "OK") {
        await release();
        return null;
      }
      taken.push(key);
    }
    return release;
  }
}
