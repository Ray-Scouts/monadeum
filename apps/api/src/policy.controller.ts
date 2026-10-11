import type { Principal } from "@monadeum/auth";
import {
  buildPolicyCommitment,
  hashReallocationPolicy,
  reallocationDomain,
  reallocationPolicyTypedData,
  type ReallocationPolicyV1,
} from "@monadeum/commitment";
import { CAPITAL_FLOOR, MIN_POLICY_AGENTS, REALLOCATION_CAP, SLOT_CEILING } from "@monadeum/reallocation/constants";
import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import type { Address, Hex, LocalAccount } from "viem";
import { callerUser, ownedAgent } from "./agents.js";
import { API_DEPENDENCIES, fail, type ApiDependencies } from "./dependencies.js";
import { Caller, SessionGuard } from "./session.js";

const MAX_POLICY_AGENTS = 100;

const BPS = 10_000;

/**
 * The EIP-712 typed data the owner signs for a reallocation policy: exactly what the reallocation contract verifies in
 * `commitPolicyBySig`, in the domain of the deployed contract on `chainId` (ARCHITECTURE.md section 16.5). Its struct
 * hash is the on-chain commitment.
 */
export function policyTypedData(chainId: number, contract: Address, policy: ReallocationPolicyV1) {
  return reallocationPolicyTypedData(policy, reallocationDomain(chainId, contract));
}

/** The protocol capital floor in settlement-asset base units. */
export function capitalFloorBaseUnits(decimals: number): bigint {
  const exact = Math.min(decimals, 12);
  return BigInt(Math.round(CAPITAL_FLOOR * 10 ** exact)) * 10n ** BigInt(decimals - exact);
}

/**
 * Owner-signed reallocation policy (EVOLUTION.md section 3.1 item 8). The API builds the policy from the caller's own
 * agents and the caller's owner wallet, checks that it only tightens the protocol bounds, and relays the contract's
 * EIP-712 typed data to the owner's wallet. A verified signature is recorded append-only and handed to the policy
 * writer, which commits it on chain through `commitPolicyBySig`; without a writer the policy is recorded but not
 * committed. The policy names agents by smart account address, which is how the contract keys them.
 *
 * The nonce is the ledger's next sequence. It equals the contract's `policyNonce(owner)` only while every commit and
 * revocation for this owner goes through this ledger; a writer must read the on-chain nonce before committing, and the
 * contract refuses a mismatch with `BadNonce` (fails closed).
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
    // Fractions become the contract's basis points rounding down, which can only tighten a bound further.
    let capBps = Math.round(REALLOCATION_CAP * BPS);
    let slotCeilingBps = Math.round(SLOT_CEILING * BPS);
    const protocolFloor = capitalFloorBaseUnits(this.deps.settings.settlementDecimals);
    let capitalFloor = protocolFloor;
    if (b.reallocationCap !== undefined) {
      if (typeof b.reallocationCap !== "number" || !(b.reallocationCap > 0 && b.reallocationCap <= REALLOCATION_CAP)) fail(400, "loosens-protocol-bound", `reallocationCap must be in (0, ${REALLOCATION_CAP}]`);
      capBps = Math.floor(b.reallocationCap * BPS);
      if (capBps < 1) fail(400, "invalid-body", `reallocationCap must be at least ${1 / BPS}`);
    }
    if (b.slotCeiling !== undefined) {
      if (typeof b.slotCeiling !== "number" || !(b.slotCeiling >= 1 && b.slotCeiling <= SLOT_CEILING)) fail(400, "loosens-protocol-bound", `slotCeiling must be in [1, ${SLOT_CEILING}]`);
      slotCeilingBps = Math.floor(b.slotCeiling * BPS);
    }
    if (b.capitalFloor !== undefined) {
      if (typeof b.capitalFloor !== "string" || !/^[1-9]\d{0,38}$/.test(b.capitalFloor) || BigInt(b.capitalFloor) < protocolFloor) fail(400, "loosens-protocol-bound", `capitalFloor must be at least ${protocolFloor} base units`);
      capitalFloor = BigInt(b.capitalFloor);
    }
    const contract = this.deps.settings.reallocationContract;
    if (!contract) fail(503, "reallocation-contract-not-configured");

    const user = await callerUser(this.deps, principal);
    const owner = user.ownerWallet;
    if (!owner) fail(403, "no-owner-wallet");
    const accounts: Address[] = [];
    for (const id of agentIds) {
      await ownedAgent(this.deps, principal, id);
      // The contract keys agents by smart account address (section 16.5); an agent without one cannot be named.
      const wallet = await this.deps.walletStore.get(id);
      if (!wallet) fail(409, "agent-has-no-account", id);
      accounts.push(wallet.account);
    }

    const sequence = ((await this.deps.policies.latest(owner))?.sequence ?? -1) + 1;
    const policy: ReallocationPolicyV1 = { owner, agents: accounts, capBps, slotCeilingBps, capitalFloor, nonce: BigInt(sequence) };
    const policyHash = hashReallocationPolicy(policy);
    const typedData = policyTypedData(this.deps.settings.chainId, contract, policy);
    // What is recorded: the signed fields, base units as decimal strings, and the agent IDs they name, in order.
    const normalized = {
      contract,
      owner: policy.owner,
      agents: [...policy.agents],
      agentIds,
      capBps,
      slotCeilingBps,
      capitalFloor: capitalFloor.toString(),
      nonce: sequence.toString(),
    };

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
        const { txHash } = await this.deps.policyWriter.commitPolicy(buildPolicyCommitment(policy, signature));
        return { sequence, policyHash, signature, committed: { txHash }, reason: null };
      },
    });
    return { policy: { sequence, policyHash, document: normalized }, operation };
  }
}
