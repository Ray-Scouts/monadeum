// Per-agent paymaster sponsorship budget, ARCHITECTURE.md section 7: the platform sponsors an agent's operations up
// to a fixed number of operations and a fixed gas amount, then the agent's own account pays. Both limits apply; the
// first one reached ends sponsorship. Gas is in wei of the chain's native token, which is what the paymaster spends.

export interface SponsorshipBudget {
  /** Sponsored user operations per agent, deployment included. */
  operations: number;
  /** Sponsored gas per agent, in wei, deployment included. */
  gasWei: bigint;
}

export interface SponsorshipUsage {
  operations: number;
  /** Settled gas plus every open reservation. */
  gasWei: bigint;
}

/**
 * Durable per-agent ledger. `reserve` must be atomic with respect to other reservations for the same agent: a
 * durable store implements it as a conditional update, so two concurrent operations cannot both take the last slot.
 * `settle` and `release` throw when the agent has no ledger row. `@monadeum/db` provides the Postgres implementation.
 */
export interface SponsorshipLedger {
  usage(agentId: string): Promise<SponsorshipUsage>;
  /** Takes one operation slot and `maxCost` wei if both fit in the budget. Returns false and changes nothing otherwise. */
  reserve(agentId: string, maxCost: bigint, budget: SponsorshipBudget): Promise<boolean>;
  /** Replaces a reservation with the gas the receipt reports. The operation slot stays taken. */
  settle(agentId: string, reserved: bigint, actual: bigint): Promise<void>;
  /** Returns a reservation whose operation was definitely never submitted. */
  release(agentId: string, reserved: bigint): Promise<void>;
}

export function hasHeadroom(usage: SponsorshipUsage, budget: SponsorshipBudget): boolean {
  return usage.operations < budget.operations && usage.gasWei < budget.gasWei;
}

export class MemorySponsorshipLedger implements SponsorshipLedger {
  private readonly rows = new Map<string, SponsorshipUsage>();

  async usage(agentId: string): Promise<SponsorshipUsage> {
    return { ...(this.rows.get(agentId) ?? { operations: 0, gasWei: 0n }) };
  }

  async reserve(agentId: string, maxCost: bigint, budget: SponsorshipBudget): Promise<boolean> {
    if (maxCost <= 0n) return false;
    const row = this.rows.get(agentId) ?? { operations: 0, gasWei: 0n };
    if (row.operations + 1 > budget.operations || row.gasWei + maxCost > budget.gasWei) return false;
    this.rows.set(agentId, { operations: row.operations + 1, gasWei: row.gasWei + maxCost });
    return true;
  }

  async settle(agentId: string, reserved: bigint, actual: bigint): Promise<void> {
    const row = this.rows.get(agentId);
    if (!row) throw new Error(`no reservation for ${agentId}`);
    // A receipt above the reservation is still recorded in full: the budget reflects what the paymaster spent.
    this.rows.set(agentId, { operations: row.operations, gasWei: row.gasWei - reserved + actual });
  }

  async release(agentId: string, reserved: bigint): Promise<void> {
    const row = this.rows.get(agentId);
    if (!row) throw new Error(`no reservation for ${agentId}`);
    this.rows.set(agentId, { operations: row.operations - 1, gasWei: row.gasWei - reserved });
  }
}
