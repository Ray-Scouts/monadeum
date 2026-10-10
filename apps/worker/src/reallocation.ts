import { hashExecutionPlan, hashReallocationPolicy, type ReallocationPolicyV1 } from "@monadeum/commitment";
import type { PolicySource, ReallocationPolicy, ReallocationSettlement, SourceDebit } from "@monadeum/reallocation";
import {
  REALLOCATE_ABI,
  type CommittedReallocationPolicy,
  type Decision,
  type ExecutionPlan,
  type ReallocationLedger,
  type ReallocationParty,
  type ReallocationProposal,
} from "@monadeum/risk";
import type { AgentRecord, AgentStore, DebitRecord, DebitStore } from "@monadeum/agent-registry";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import type { ChainReader } from "./ports.js";

// The debit store is defined in `@monadeum/agent-registry`, so `@monadeum/db` can implement it on Postgres.
export { MemoryDebitStore } from "@monadeum/agent-registry";
export type { DebitRecord, DebitStore } from "@monadeum/agent-registry";

/**
 * Owners' reallocation policies, as committed on-chain. In-memory stand-in for the verified policy source of
 * ARCHITECTURE.md section 9: `commit` is where a production source would accept only a policy whose owner signature
 * matches the on-chain hash. It feeds the planner (`current`) and the RiskModule's ledger (`committed`) from the same
 * record, so the plan and the check use one policy.
 */
export class OwnerPolicies implements PolicySource {
  private readonly policies = new Map<string, { policy: ReallocationPolicyV1; hash: Hex; revoked: boolean }>();

  constructor(private readonly decimals: number) {}

  commit(policy: ReallocationPolicyV1): Hex {
    const hash = hashReallocationPolicy(policy);
    this.policies.set(policy.owner.toLowerCase(), { policy, hash, revoked: false });
    return hash;
  }

  revoke(owner: Hex): void {
    const entry = this.policies.get(owner.toLowerCase());
    if (entry) entry.revoked = true;
  }

  current(): readonly ReallocationPolicy[] {
    return [...this.policies.entries()].map(([owner, { policy, revoked }]) => ({
      owner,
      agents: policy.agents.map(String),
      ...(policy.reallocationCap !== undefined ? { reallocationCap: policy.reallocationCap } : {}),
      ...(policy.slotCeiling !== undefined ? { slotCeiling: policy.slotCeiling } : {}),
      ...(policy.capitalFloor !== undefined ? { capitalFloor: Number(BigInt(policy.capitalFloor)) / 10 ** this.decimals } : {}),
      revoked,
    }));
  }

  /** The policy the contract would check now: null when none is committed or it was revoked. */
  committed(owner: string): CommittedReallocationPolicy | null {
    const entry = this.policies.get(owner.toLowerCase());
    if (!entry || entry.revoked) return null;
    const p = entry.policy;
    return {
      hash: entry.hash,
      agents: p.agents.map(String),
      ...(p.reallocationCap !== undefined ? { reallocationCap: p.reallocationCap } : {}),
      ...(p.slotCeiling !== undefined ? { slotCeiling: p.slotCeiling } : {}),
      ...(p.capitalFloor !== undefined ? { capitalFloor: BigInt(p.capitalFloor) } : {}),
    };
  }
}

/** The batched operation of issue #31: `approve(contract, total)`, then one `reallocate` carrying every credit. */
export function buildReallocationPlan(proposal: ReallocationProposal, contract: Hex, settlementAsset: Hex): ExecutionPlan {
  const calls = [
    { target: settlementAsset, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [contract, proposal.total] }) },
    {
      target: contract,
      data: encodeFunctionData({
        abi: REALLOCATE_ABI,
        functionName: "reallocate",
        args: [BigInt(proposal.evaluation), proposal.policyHash, proposal.credits.map((c) => ({ sink: c.sink, amount: c.amount }))],
      }),
    },
  ];
  return { tickKey: proposal.moveKey, calls, planHash: hashExecutionPlan({ tickKey: proposal.moveKey, calls }) };
}

/**
 * Submits an approved reallocation plan from the source agent's account. Resolves when the operation is included and
 * succeeded; returns `{ submitted: false }` when it definitely sent nothing; throws when the outcome is unknown.
 */
export interface ReallocationExecutor {
  execute(input: { debit: SourceDebit; sourceAgentId: string; account: Hex; plan: ExecutionPlan }): Promise<{ ok: true } | { ok: false; submitted: false; reason: string }>;
}

/**
 * Fail-closed default. The reallocation contract (issue #31) is not deployed, so nothing is submitted. Once it is,
 * the executor sends the plan through `WalletsService.executeForTick` with the debit's key as the tick key.
 */
export class UnconfiguredReallocationExecutor implements ReallocationExecutor {
  async execute(): Promise<{ ok: false; submitted: false; reason: string }> {
    return { ok: false, submitted: false, reason: "reallocation contract is not configured" };
  }
}

export interface ReallocationRisk {
  reallocation(proposal: ReallocationProposal, plan: ExecutionPlan, ledger: ReallocationLedger): Decision;
}

/**
 * The settlement the worker gives ReallocationService. Each source's debit becomes a ReallocationProposal and its
 * ExecutionPlan, the RiskModule checks the plan against a ledger read from the registry and the chain, and only an
 * approved plan reaches the executor, the same gate as any trade (ARCHITECTURE.md section 3). The decision is written
 * under the debit's key before submission. A key already present is never submitted again: without the contract's
 * `Reallocated` events to reconcile against, an earlier attempt with an unknown outcome is left for review, and the
 * contract itself rejects a second debit of one source in one evaluation.
 */
export class RiskGatedSettlement implements ReallocationSettlement {
  constructor(
    private readonly agents: AgentStore,
    private readonly chain: ChainReader,
    private readonly policies: OwnerPolicies,
    private readonly risk: ReallocationRisk,
    private readonly executor: ReallocationExecutor,
    private readonly debits: DebitStore,
    private readonly addresses: { contract: Hex; settlementAsset: Hex },
  ) {}

  async debit(request: SourceDebit): Promise<void> {
    const existing = await this.debits.get(request.key);
    if (existing) throw new Error(`debit ${request.key} was already ${existing.status}; not submitted again`);

    const source = await this.agents.get(request.source);
    if (!source) throw new Error(`unknown source agent ${request.source}`);
    const found = await Promise.all(request.credits.map((c) => this.agents.get(c.sink)));
    const sinks = found.filter((s): s is AgentRecord => s !== undefined);
    if (sinks.length !== found.length) throw new Error(`unknown sink agent in ${request.key}`);
    const committed = this.policies.committed(request.owner);
    const proposal: ReallocationProposal = {
      schemaVersion: 1,
      moveKey: request.key,
      owner: source.owner,
      evaluation: request.sequence,
      // The plan is computed against the committed policy; with none, the RiskModule rejects it.
      policyHash: committed?.hash ?? `0x${"0".repeat(64)}`,
      sourceAgentId: source.agentId,
      source: source.account,
      credits: request.credits.map((c, i) => ({ sinkAgentId: c.sink, sink: sinks[i]!.account, amount: c.amount })),
      total: request.total,
    };
    const plan = buildReallocationPlan(proposal, this.addresses.contract, this.addresses.settlementAsset);
    const ledger: ReallocationLedger = {
      spentInWindow: await this.chain.windowTotal(source.account),
      decimals: await this.chain.decimals(),
      source: await this.party(source),
      sinks: await Promise.all(sinks.map((s) => this.party(s))),
      ownerPolicy: committed,
    };
    const decision = this.risk.reallocation(proposal, plan, ledger);
    const base: DebitRecord = { key: request.key, status: "approved", planHash: plan.planHash, decision, reason: null };
    if (!decision.approved) {
      await this.debits.claim({ ...base, status: "rejected", reason: decision.violations.join(",") });
      throw new Error(`rejected by the RiskModule: ${decision.violations.join(", ")}`);
    }
    if (!(await this.debits.claim(base))) throw new Error(`debit ${request.key} claimed concurrently`);
    // An exception here is an unknown outcome: the record stays approved and the key is never submitted again.
    const result = await this.executor.execute({ debit: request, sourceAgentId: source.agentId, account: source.account, plan });
    if (!result.ok) {
      await this.debits.write({ ...base, status: "failed", reason: result.reason });
      throw new Error(result.reason);
    }
    await this.debits.write({ ...base, status: "settled" });
  }

  private async party(agent: AgentRecord): Promise<ReallocationParty> {
    return {
      agentId: agent.agentId,
      account: agent.account,
      owner: agent.owner,
      status: agent.status,
      capital: await this.chain.balanceOf(agent.account),
      principal: agent.principal,
    };
  }
}
