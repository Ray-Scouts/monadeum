import type { Principal } from "@monadeum/auth";
import { buildPolicyCommitment, hashReallocationPolicy, normalizeReallocationPolicy, type ReallocationPolicyV1 } from "@monadeum/commitment";
import { CAPITAL_FLOOR, MIN_POLICY_AGENTS, REALLOCATION_CAP, SLOT_CEILING } from "@monadeum/reallocation/constants";
import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import type { Address, Hex, LocalAccount } from "viem";
import { callerUser, ownedAgent } from "./agents.js";
import { API_DEPENDENCIES, fail, type ApiDependencies } from "./dependencies.js";
import { Caller, SessionGuard } from "./session.js";

const MAX_POLICY_AGENTS = 100;

/**
 * The EIP-712 typed data the owner signs for a reallocation policy: the section 16.4 policy hash, bound to the owner,
 * the sequence, and the chain. Provisional: the reallocation contract (issue #31) fixes the scheme it verifies, and
 * this definition changes with it if it differs.
 */
export function policyTypedData(chainId: number, owner: Address, sequence: number, policyHash: Hex) {
  return {
    domain: { name: "Monadeum Reallocation Policy", version: "1", chainId },
    types: {
      ReallocationPolicy: [
        { name: "owner", type: "address" },
        { name: "sequence", type: "uint256" },
        { name: "policyHash", type: "bytes32" },
      ],
    },
    primaryType: "ReallocationPolicy",
    message: { owner, sequence: BigInt(sequence), policyHash },
  } as const;
}

/** The protocol capital floor in settlement-asset base units. */
export function capitalFloorBaseUnits(decimals: number): bigint {
  const exact = Math.min(decimals, 12);
  return BigInt(Math.round(CAPITAL_FLOOR * 10 ** exact)) * 10n ** BigInt(decimals - exact);
}

/**
 * Owner-signed reallocation policy (EVOLUTION.md section 3.1 item 8). The API builds the document from the caller's
 * own agents and the caller's owner wallet, checks that it only tightens the protocol bounds, and relays the typed data
 * to the owner's wallet. A verified signature is recorded append-only and handed to the policy writer, which commits it
 * on chain; until the reallocation contract exists there is no writer and the policy is recorded but not committed.
 */
@Controller("policies")
@UseGuards(SessionGuard)
export class PolicyController {
  constructor(@Inject(API_DEPENDENCIES) private readonly deps: ApiDependencies) {}

  @Get("reallocation")
  async current(@Caller() principal: Principal) {
    const user = await callerUser(this.deps, principal);
    const policy = user.ownerWallet ? await this.deps.policies.latest(user.ownerWallet) : undefined;
    return { policy: policy ?? null };
  }

  @Post("reallocation")
  @HttpCode(202)
  async propose(@Body() body: unknown, @Caller() principal: Principal) {
    const b = (body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(b.agentIds) || b.agentIds.length < MIN_POLICY_AGENTS || b.agentIds.length > MAX_POLICY_AGENTS || !b.agentIds.every((a) => typeof a === "string")) {
      fail(400, "invalid-body", `agentIds must list ${MIN_POLICY_AGENTS} to ${MAX_POLICY_AGENTS} agent IDs`);
    }
    const agentIds = [...new Set(b.agentIds as string[])];
    if (agentIds.length < MIN_POLICY_AGENTS) fail(400, "invalid-body", "agentIds must be distinct");

    // Tightening only (invariant 5): each optional bound is checked against the protocol value it may not loosen.
    const tightening: Partial<Pick<ReallocationPolicyV1, "reallocationCap" | "slotCeiling" | "capitalFloor">> = {};
    if (b.reallocationCap !== undefined) {
      if (typeof b.reallocationCap !== "number" || !(b.reallocationCap > 0 && b.reallocationCap <= REALLOCATION_CAP)) fail(400, "loosens-protocol-bound", `reallocationCap must be in (0, ${REALLOCATION_CAP}]`);
      tightening.reallocationCap = b.reallocationCap;
    }
    if (b.slotCeiling !== undefined) {
      if (typeof b.slotCeiling !== "number" || !(b.slotCeiling >= 1 && b.slotCeiling <= SLOT_CEILING)) fail(400, "loosens-protocol-bound", `slotCeiling must be in [1, ${SLOT_CEILING}]`);
      tightening.slotCeiling = b.slotCeiling;
    }
    if (b.capitalFloor !== undefined) {
      const floor = capitalFloorBaseUnits(this.deps.settings.settlementDecimals);
      if (typeof b.capitalFloor !== "string" || !/^[1-9]\d{0,38}$/.test(b.capitalFloor) || BigInt(b.capitalFloor) < floor) fail(400, "loosens-protocol-bound", `capitalFloor must be at least ${floor} base units`);
      tightening.capitalFloor = b.capitalFloor;
    }

    const user = await callerUser(this.deps, principal);
    const owner = user.ownerWallet;
    if (!owner) fail(403, "no-owner-wallet");
    const registryIds: string[] = [];
    for (const id of agentIds) {
      const { agent } = await ownedAgent(this.deps, principal, id);
      // The policy names agents by identity registry ID, which exists only once the registry does (section 9).
      if (agent.registryId === null) fail(409, "agent-not-registered", id);
      registryIds.push(agent.registryId);
    }

    const sequence = ((await this.deps.policies.latest(owner))?.sequence ?? -1) + 1;
    const document: ReallocationPolicyV1 = { schemaVersion: 1, owner, sequence, agents: registryIds, ...tightening };
    const normalized = normalizeReallocationPolicy(document);
    const policyHash = hashReallocationPolicy(document);
    const typedData = policyTypedData(this.deps.settings.chainId, owner, sequence, policyHash);

    const operation = await this.deps.relay.start({
      userId: user.id,
      kind: "policy",
      agentIds,
      owner,
      work: async (signer) => {
        const checked = await this.deps.auth.ownerSignerFor(principal, signer);
        if (!checked.ok) throw new Error(`owner signer refused: ${checked.reason}`);
        const signature = await (signer.signer as LocalAccount).signTypedData(typedData);
        const appended = await this.deps.policies.append({ owner, sequence, document: normalized, policyHash, signature, createdAt: this.deps.now() });
        if (!appended) throw new Error(`policy sequence ${sequence} was recorded concurrently; propose again`);
        if (!this.deps.policyWriter) return { sequence, policyHash, signature, committed: null, reason: "reallocation-contract-not-configured" };
        const { txHash } = await this.deps.policyWriter.commitPolicy(buildPolicyCommitment(document, signature));
        return { sequence, policyHash, signature, committed: { txHash }, reason: null };
      },
    });
    return { policy: { sequence, policyHash, document: normalized }, operation };
  }
}
