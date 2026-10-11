import type { AgentStore } from "@monadeum/agent-registry";
import { principalFrom, type ReadModelReader } from "@monadeum/read-model";
import type { Address } from "viem";
import { WorkerConfigError } from "./config.js";
import type { AgentLocks } from "./consumer/locks.js";

export interface PrincipalSyncResult {
  /** The finalized block the principals were computed through, or null when the read-model offers none. */
  asOf: bigint | null;
  /** Agents whose principal was written, with the new value. */
  updated: { agentId: string; principal: bigint }[];
  /** Agents left for the next run: locked, or already computed through a later block. */
  skipped: string[];
  /** Why nothing was computed, when nothing was. */
  reason?: "not-finalized" | "settlement-asset-unrecorded" | "settlement-asset-mismatch";
}

/**
 * The startup check: the settlement asset this worker counts must be the one the indexer recorded (libs/db 0010).
 * Throws on a mismatch, because then no row would ever count and no agent would ever be funded, silently. When the
 * indexer has not recorded one yet, it returns a message instead; the principal job then writes nothing until it has.
 */
export async function checkSettlementAsset(readModel: Pick<ReadModelReader, "settlementAsset">, configured: Address): Promise<string> {
  const recorded = await readModel.settlementAsset();
  const mine = configured.toLowerCase();
  if (recorded === null) return `the indexer has not recorded a settlement asset yet: principals wait until it records ${mine}`;
  if (recorded.toLowerCase() !== mine) {
    throw new WorkerConfigError(`WORKER_SETTLEMENT_ASSET_ADDRESS is ${mine} but the indexer records ${recorded}: no funding transfer would ever count`);
  }
  return `settlement asset ${mine} matches the indexer's`;
}

/**
 * Recomputes every agent's principal from the read-model and writes it to the agent record (EVOLUTION.md section 1.1,
 * ARCHITECTURE.md section 6.1). Run by the worker's repeatable `principal` job.
 *
 * - The right token only: it does nothing unless the read-model records the same settlement asset it is configured
 *   with (`checkSettlementAsset`).
 * - Finalized data only: it reads the read-model's finalized bound and nothing above it, and does nothing when the
 *   read-model has no finalized bound (empty, or ever filled under the indexer's confirmations rule).
 * - Recomputed, never incremented: the value is `principalFrom` over every row of the account up to that bound, so a
 *   repeated run, a replayed block, or a job retried after a crash computes the same value. A value equal to the
 *   stored one is not written.
 * - Monotonic in block order: a write records the block the value was computed through, and a value computed through
 *   an earlier block than the last write is never written over it.
 * - It writes under the agent's lock, the one ticks and evaluations take, so it never interleaves with a retirement
 *   or a tick reading the record; a locked agent is left for the next run.
 *
 * The tick and the evaluation never read the read-model themselves (ARCHITECTURE.md section 10): they read the
 * principal on the record, which this job keeps current.
 */
export class PrincipalSync {
  constructor(
    private readonly deps: {
      agents: AgentStore;
      readModel: ReadModelReader;
      /** The configured settlement asset; rows from any other contract never count. */
      settlementAsset: Address;
      locks: AgentLocks;
      lockTtlMs: number;
    },
  ) {}

  async run(): Promise<PrincipalSyncResult> {
    const { agents, readModel, settlementAsset, locks, lockTtlMs } = this.deps;
    // Checked on every run, not only at start: the indexer may record its asset after the worker started.
    const recorded = await readModel.settlementAsset();
    if (recorded === null) return { asOf: null, updated: [], skipped: [], reason: "settlement-asset-unrecorded" };
    if (recorded.toLowerCase() !== settlementAsset.toLowerCase()) return { asOf: null, updated: [], skipped: [], reason: "settlement-asset-mismatch" };
    const asOf = await readModel.finalizedThrough();
    if (asOf === null) return { asOf: null, updated: [], skipped: [], reason: "not-finalized" };
    const result: PrincipalSyncResult = { asOf, updated: [], skipped: [] };
    for (const { agentId } of await agents.list()) {
      const release = await locks.acquire([agentId], lockTtlMs);
      if (!release) {
        result.skipped.push(agentId);
        continue;
      }
      try {
        const agent = await agents.get(agentId);
        if (!agent) continue;
        if (agent.principalBlock !== undefined && agent.principalBlock > asOf) {
          result.skipped.push(agentId);
          continue;
        }
        const rows = (await readModel.events({ account: agent.account as Address })).filter((r) => r.blockNumber <= asOf);
        const principal = principalFrom({ account: agent.account as Address, owner: agent.owner as Address, settlementAsset }, rows);
        if (principal === agent.principal) continue;
        await agents.update({ ...agent, principal, principalBlock: asOf });
        result.updated.push({ agentId, principal });
      } finally {
        await release();
      }
    }
    return result;
  }
}
