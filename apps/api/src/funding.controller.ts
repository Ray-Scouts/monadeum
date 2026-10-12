import { randomBytes } from "node:crypto";
import type { Principal } from "@monadeum/auth";
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { getAddress, isAddressEqual, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { ownedAgent } from "./agents.js";
import { API_DEPENDENCIES, fail, type ApiDependencies, type FundingDependencies } from "./dependencies.js";
import type { AssetDomain } from "./funding-chain.js";
import { FUNDING_OPEN_LIMIT } from "./funding-runtime.js";
import type { FundingAuthorization, FundingRecord } from "./funding-store.js";
import { jsonSafe } from "./json.js";
import { Caller, SessionGuard } from "./session.js";

// The relayed funding transfer (ARCHITECTURE.md sections 6.1 and 7, THREAT-MODEL.md scenario H): the owner signs an
// EIP-3009 `transferWithAuthorization` from the owner wallet on record to the agent's deployed account, which the API
// builds, and a platform relayer submits it and pays the MON gas. The recipient and amount are fixed by the owner's
// signature, so the relayer can submit the authorization but cannot redirect it.

const DAY_MS = 24 * 60 * 60 * 1000;
/** USDC requires `now > validAfter`; the authorization is valid from a few seconds before it is built. */
const VALID_AFTER_SKEW = 5n;
/** A submission is refused this close to `validBefore`, so a transaction is not sent that cannot be included in time. */
const SUBMIT_MARGIN = 30n;
const NONCE = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** The EIP-712 typed data the owner signs, in the settlement asset's own domain. */
export function fundingTypedData(domain: AssetDomain, authorization: FundingAuthorization) {
  return {
    domain: { name: domain.name, version: domain.version, chainId: domain.chainId, verifyingContract: domain.verifyingContract },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization" as const,
    message: authorization,
  };
}

export type FundingState = "prepared" | "expired" | "submitted" | "confirmed" | "failed";

/** What the client sees of one authorization. Integers are decimal strings. */
export function fundingView(record: FundingRecord, nowSeconds: bigint) {
  const a = record.authorization;
  const state: FundingState = record.status === "prepared" && a.validBefore <= nowSeconds ? "expired" : record.status;
  return jsonSafe({
    nonce: a.nonce,
    agentId: record.agentId,
    status: state,
    from: a.from,
    to: a.to,
    value: a.value,
    validAfter: a.validAfter,
    validBefore: a.validBefore,
    txHash: record.txHash,
    blockNumber: record.blockNumber,
    submittedAt: record.submittedAt,
    error: record.error,
  });
}

const brief = (error: unknown) => (error instanceof Error ? (error as { shortMessage?: string }).shortMessage ?? error.message : String(error)).split("\n")[0]!.slice(0, 200);

@Controller()
@UseGuards(SessionGuard)
export class FundingController {
  /** Serializes the relayer: one transaction is estimated, signed with the next nonce, claimed, and sent at a time. */
  private relayTail: Promise<unknown> = Promise.resolve();

  constructor(@Inject(API_DEPENDENCIES) private readonly deps: ApiDependencies) {}

  private funding(): FundingDependencies {
    if (!this.deps.funding) fail(503, "funding-unavailable", "no funding relayer is configured for this process");
    return this.deps.funding;
  }

  private nowSeconds() {
    return BigInt(Math.floor(this.deps.now() / 1000));
  }

  /**
   * The agent's account as a funding destination: the deployed account WalletsModule recorded, which the worker's
   * record must also name, and which has code on chain. Funds sent before deployment would not count as principal.
   */
  private async destination(principal: Principal, id: string, funding: FundingDependencies) {
    const owned = await ownedAgent(this.deps, principal, id);
    const { wallet, worker } = owned;
    if (!wallet || wallet.deployment.status !== "deployed") fail(409, "account-not-deployed", "the agent's account is not deployed; deploy it before funding");
    if (worker && !isAddressEqual(worker.account, wallet.account)) fail(409, "account-mismatch");
    if (worker?.status === "retired") fail(409, "agent-retired");
    let deployed: boolean;
    try {
      deployed = await funding.chain.hasCode(wallet.account);
    } catch (error) {
      fail(503, "chain-unavailable", brief(error));
    }
    if (!deployed) fail(409, "account-not-deployed", "the agent's account has no code on chain yet");
    return { ...owned, account: getAddress(wallet.account) };
  }

  private async domain(funding: FundingDependencies): Promise<AssetDomain> {
    try {
      return await funding.chain.assetDomain();
    } catch (error) {
      fail(503, "settlement-asset-unverified", brief(error));
    }
  }

  /** What the funding card shows: limits, the user's remaining relays today, and the owner wallet's balance on chain. */
  @Get("agents/:id/funding")
  async info(@Param("id") id: string, @Caller() principal: Principal) {
    const funding = this.funding();
    const { user, owner, wallet, worker } = await ownedAgent(this.deps, principal, id);
    const used = await funding.store.submittedSince(user.id, this.deps.now() - DAY_MS);
    let ownerBalance: bigint | null = null;
    let deployed = false;
    let decimals: number | null = null;
    let chainError: string | null = null;
    try {
      ownerBalance = await funding.chain.balanceOf(owner);
      deployed = wallet?.deployment.status === "deployed" && (await funding.chain.hasCode(wallet.account));
      decimals = (await funding.chain.assetDomain()).decimals;
    } catch (error) {
      chainError = brief(error);
    }
    const recent = await funding.store.listByAgent(id, 5);
    return jsonSafe({
      asset: funding.chain.asset,
      decimals,
      chainId: funding.chain.chainId,
      owner,
      account: wallet?.account ?? null,
      deployed,
      retired: worker?.status === "retired",
      ownerBalance,
      maxPerTransfer: funding.settings.maxPerTransfer,
      daily: { limit: funding.settings.dailyTransfersPerUser, used, remaining: Math.max(0, funding.settings.dailyTransfersPerUser - used) },
      relayer: funding.chain.relayer,
      chainError,
      recent: recent.map((r) => fundingView(r, this.nowSeconds())),
    });
  }

  /**
   * Builds the authorization for the owner to sign and stores it. `value` is in settlement-asset base units. The sender
   * is the owner wallet on record and the recipient the agent's deployed account, both read by the API, never from the
   * request; the nonce is 32 random bytes.
   */
  @Post("agents/:id/funding/prepare")
  async prepare(@Param("id") id: string, @Body() body: unknown, @Caller() principal: Principal) {
    const funding = this.funding();
    if (body === null || typeof body !== "object" || Array.isArray(body)) fail(400, "invalid-body");
    const b = body as Record<string, unknown>;
    for (const key of Object.keys(b)) if (key !== "value") fail(400, "unknown-field", `${key.slice(0, 64)} is not a field of a funding request`);
    if (typeof b.value !== "string" || !/^[1-9]\d{0,38}$/.test(b.value)) fail(400, "invalid-body", "value must be a positive integer in base units, as a decimal string");
    const value = BigInt(b.value);
    if (value > funding.settings.maxPerTransfer) fail(400, "limit-too-high", `value exceeds ${funding.settings.maxPerTransfer}`);

    const { user, owner, agent, account } = await this.destination(principal, id, funding);
    const now = this.deps.now();
    const nowSeconds = this.nowSeconds();
    if ((await funding.store.submittedSince(user.id, now - DAY_MS)) >= funding.settings.dailyTransfersPerUser) {
      fail(429, "funding-budget-exceeded", `at most ${funding.settings.dailyTransfersPerUser} relayed transfers per user per 24 hours`);
    }
    if ((await funding.store.openCount(user.id, nowSeconds)) >= FUNDING_OPEN_LIMIT) fail(429, "too-many-open-authorizations", "sign or let expire the authorizations already prepared");
    const domain = await this.domain(funding);
    let balance: bigint;
    try {
      balance = await funding.chain.balanceOf(owner);
    } catch (error) {
      fail(503, "chain-unavailable", brief(error));
    }
    if (balance < value) fail(409, "insufficient-balance", `the owner wallet holds ${balance} base units`);

    const authorization: FundingAuthorization = {
      from: getAddress(owner),
      to: account,
      value,
      validAfter: nowSeconds - VALID_AFTER_SKEW,
      validBefore: nowSeconds + BigInt(funding.settings.validitySeconds),
      nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
    };
    const record: FundingRecord = {
      agentId: agent.agentId,
      userId: user.id,
      asset: funding.chain.asset,
      authorization,
      createdAt: now,
      status: "prepared",
      signature: null,
      txHash: null,
      submittedAt: null,
      blockNumber: null,
      error: null,
    };
    if (!(await funding.store.prepare(record))) fail(409, "conflict", "nonce collision; retry");
    return {
      funding: fundingView(record, nowSeconds),
      agent: { id: agent.agentId, name: agent.name },
      decimals: domain.decimals,
      expiresAt: Number(authorization.validBefore) * 1000,
      typedData: jsonSafe(fundingTypedData(domain, authorization)),
    };
  }

  /**
   * Verifies the owner's signature against the stored authorization and has the relayer submit it. The client sends
   * only the nonce and the signature: the signed fields are the stored ones, so a signature over anything else does not
   * recover the owner. A repeated submission of the same nonce and signature answers the stored status and sends nothing.
   */
  @Post("agents/:id/funding/submit")
  @HttpCode(202)
  async submit(@Param("id") id: string, @Body() body: unknown, @Caller() principal: Principal) {
    const funding = this.funding();
    if (body === null || typeof body !== "object" || Array.isArray(body)) fail(400, "invalid-body");
    const b = body as Record<string, unknown>;
    for (const key of Object.keys(b)) if (key !== "nonce" && key !== "signature") fail(400, "unknown-field", `${key.slice(0, 64)} is not a field of a funding submission`);
    if (typeof b.nonce !== "string" || !NONCE.test(b.nonce)) fail(400, "invalid-body", "nonce must be 32 bytes of hex");
    if (typeof b.signature !== "string" || !SIGNATURE.test(b.signature)) fail(400, "invalid-body", "signature must be 65 bytes of hex");
    const nonce = b.nonce.toLowerCase() as Hex;
    const signature = b.signature.toLowerCase() as Hex;

    const owned = await ownedAgent(this.deps, principal, id);
    const record = await funding.store.get(nonce);
    if (!record || record.agentId !== owned.agent.agentId || record.userId !== owned.user.id) fail(404, "not-found");
    if (record.status !== "prepared") {
      if (record.signature !== signature) fail(409, "already-submitted", "this authorization was already submitted with another signature");
      return { funding: await this.reconcile(funding, record) };
    }
    const a = record.authorization;
    if (!isAddressEqual(a.from, owned.owner)) fail(409, "ownership-mismatch");
    if (this.nowSeconds() + SUBMIT_MARGIN >= a.validBefore) fail(409, "authorization-expired", "prepare a new authorization");

    const domain = await this.domain(funding);
    let signer: Address;
    try {
      signer = await recoverTypedDataAddress({ ...fundingTypedData(domain, a), signature });
    } catch {
      fail(400, "bad-signature");
    }
    if (!isAddressEqual(signer, a.from)) fail(400, "bad-signature", "the signature does not recover the owner wallet over the stored authorization");

    const { account } = await this.destination(principal, id, funding);
    if (!isAddressEqual(account, a.to)) fail(409, "account-mismatch");

    const run = this.relayTail.then(() => this.relay(funding, record, signature));
    this.relayTail = run.catch(() => undefined);
    return { funding: await run };
  }

  private async relay(funding: FundingDependencies, record: FundingRecord, signature: Hex) {
    const a = record.authorization;
    let balance: bigint;
    try {
      balance = await funding.chain.balanceOf(a.from);
    } catch (error) {
      fail(503, "chain-unavailable", brief(error));
    }
    if (balance < a.value) fail(409, "insufficient-balance", `the owner wallet holds ${balance} base units`);
    let prepared;
    try {
      prepared = await funding.chain.prepareRelay(a, signature);
    } catch (error) {
      fail(409, "relay-simulation-failed", brief(error));
    }
    let relayerBalance: bigint;
    try {
      relayerBalance = await funding.chain.nativeBalance(funding.chain.relayer);
    } catch (error) {
      fail(503, "chain-unavailable", brief(error));
    }
    if (relayerBalance < prepared.maxCost) {
      fail(503, "relayer-balance-low", `the funding relayer ${funding.chain.relayer} holds ${relayerBalance} wei and this transfer can cost up to ${prepared.maxCost} wei; nothing was submitted`);
    }
    const now = this.deps.now();
    const outcome = await funding.store.claim(a.nonce, { signature, txHash: prepared.hash, at: now, since: now - DAY_MS, limit: funding.settings.dailyTransfersPerUser });
    if (outcome === "budget-exceeded") fail(429, "funding-budget-exceeded", `at most ${funding.settings.dailyTransfersPerUser} relayed transfers per user per 24 hours`);
    if (outcome === "not-prepared") {
      // A concurrent submission of the same nonce claimed it first.
      const current = await funding.store.get(a.nonce);
      if (!current || current.signature !== signature) fail(409, "already-submitted");
      return this.reconcile(funding, current);
    }
    try {
      await prepared.send();
    } catch {
      // The hash is recorded; whether it reached the chain is settled by reading the receipt and the nonce's state.
    }
    const claimed = await funding.store.get(a.nonce);
    return this.reconcile(funding, claimed!);
  }

  /**
   * Moves a submitted authorization to confirmed or failed from the chain: the receipt when there is one; otherwise,
   * once the authorization has expired and the token reports its nonce unused, it can never be included, so it failed.
   */
  private async reconcile(funding: FundingDependencies, record: FundingRecord) {
    const nowSeconds = this.nowSeconds();
    if (record.status !== "submitted" || !record.txHash) return fundingView(record, nowSeconds);
    try {
      const receipt = await funding.chain.receipt(record.txHash);
      if (receipt) {
        const status = receipt.status === "success" ? "confirmed" : "failed";
        await funding.store.settle(record.authorization.nonce, { status, blockNumber: receipt.blockNumber, error: status === "failed" ? "reverted" : null });
      } else if (record.authorization.validBefore < nowSeconds && !(await funding.chain.authorizationUsed(record.authorization.from, record.authorization.nonce))) {
        await funding.store.settle(record.authorization.nonce, { status: "failed", blockNumber: null, error: "not-included" });
      }
    } catch {
      // Unknown for now; the next status read tries again.
    }
    return fundingView((await funding.store.get(record.authorization.nonce))!, nowSeconds);
  }

  @Get("agents/:id/funding/:nonce")
  async status(@Param("id") id: string, @Param("nonce") nonce: string, @Caller() principal: Principal) {
    const funding = this.funding();
    const owned = await ownedAgent(this.deps, principal, id);
    if (typeof nonce !== "string" || !NONCE.test(nonce)) fail(404, "not-found");
    const record = await funding.store.get(nonce as Hex);
    if (!record || record.agentId !== owned.agent.agentId || record.userId !== owned.user.id) fail(404, "not-found");
    return { funding: await this.reconcile(funding, record) };
  }
}
