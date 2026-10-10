import type { AllowedCall } from "@monadeum/risk";
import { isAddressEqual, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { hasHeadroom, type SponsorshipBudget, type SponsorshipLedger } from "./budget.js";
import {
  PaymasterUnavailableError,
  SubmissionRejectedError,
  type OwnerSigner,
  type PermissionState,
  type PreparedOperation,
  type SpendLimits,
  type WalletsChain,
} from "./chain.js";
import { callsInScope, type Call } from "./scope.js";
import type { AgentWalletRecord, AgentWalletStore, SessionKeyVault } from "./store.js";

export interface WalletsSettings {
  scope: readonly AllowedCall[];
  budget: SponsorshipBudget;
  /** False when no paymaster is configured: every operation is paid by the account itself. */
  paymaster: boolean;
}

export type FailureReason =
  | "unknown-agent"
  | "conflict"
  | "not-deployed"
  | "misconfigured"
  | "policy-unavailable"
  | "no-session"
  | "revoked"
  | "out-of-scope"
  | "insufficient-gas"
  | "paymaster-unavailable"
  | "rejected"
  | "reverted"
  | "submission-unknown";

export type Failure = { ok: false; reason: FailureReason; detail?: string };

export interface OperationOutcome {
  userOpHash: Hex;
  sponsored: boolean;
  gasCost: bigint;
}

export type DeployResult = { ok: true; account: Address; created: boolean; operation: OperationOutcome | null } | Failure;
export type IssueResult = { ok: true; keyAddress: Address; permissionId: Hex; issued: boolean } | Failure;
export type ExecuteResult = ({ ok: true } & OperationOutcome) | Failure;
export type RevokeResult =
  | { ok: true; revokedLocallyAt: number; onChain: "verified"; operation: OperationOutcome | null }
  | { ok: false; revokedLocallyAt: number | null; reason: FailureReason; detail?: string };

export interface RevocationStatus {
  revoked: boolean;
  /** The key is no longer held by this process. */
  keyDestroyed: boolean;
  state: PermissionState;
  enableNonce: number;
}

/**
 * The session key and its enable signature are dead on chain: the permission validator is not installed, or was
 * installed under a nonce below `validNonceFrom` (Kernel rejects it in validation), and the Kernel nonce moved past
 * the one the enable signature is bound to, so the signature cannot install the validator again.
 */
export function isRevokedOnChain(state: PermissionState, enableNonce: number): boolean {
  const validatorDead = !state.installed || state.validatorNonce < state.validNonceFrom;
  return validatorDead && state.currentNonce > enableNonce;
}

const brief = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);

/**
 * WalletsModule logic, ARCHITECTURE.md sections 6, 7 and 10. Owns the agent account record, the session key, and the
 * sponsorship decision for every operation it sends. Holds no owner key: owner actions take an OwnerSigner.
 */
export class WalletsService {
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly chain: WalletsChain,
    private readonly store: AgentWalletStore,
    private readonly vault: SessionKeyVault,
    private readonly ledger: SponsorshipLedger,
    private readonly settings: WalletsSettings,
    private readonly now: () => number = Date.now,
  ) {}

  /** Serializes operations per agent inside this process. Across processes, the store's claim and pending hashes apply. */
  private exclusive<T>(agentId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.inflight.get(agentId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const tail = next.catch(() => undefined);
    this.inflight.set(agentId, tail);
    void tail.then(() => {
      if (this.inflight.get(agentId) === tail) this.inflight.delete(agentId);
    });
    return next;
  }

  /**
   * Deploys the agent's account and configures its spend policy in one owner-signed operation. Idempotent: a
   * repeated call for the same agent returns the existing account and sends nothing, and a call made while an
   * earlier operation is pending waits for that operation instead of sending a second one.
   */
  deploy(input: { agentId: string; owner: OwnerSigner; index: bigint; limits: SpendLimits }): Promise<DeployResult> {
    return this.exclusive(input.agentId, () => this.deployOnce(input));
  }

  private async deployOnce(input: { agentId: string; owner: OwnerSigner; index: bigint; limits: SpendLimits }): Promise<DeployResult> {
    const { agentId, owner, index, limits } = input;
    if (limits.perTxCap < 0n || limits.dailyCap < 0n || limits.perTxCap >= 2n ** 128n || limits.dailyCap >= 2n ** 128n) {
      return { ok: false, reason: "misconfigured", detail: "limits must fit uint128" };
    }
    const account = await this.chain.accountAddress(owner.address, index);
    let record = await this.store.get(agentId);
    if (!record) {
      const fresh: AgentWalletRecord = { agentId, owner: owner.address, index, account, deployment: { status: "pending", userOpHash: null }, session: null };
      if (!(await this.store.claim(fresh))) {
        record = await this.store.get(agentId);
        if (!record) return { ok: false, reason: "conflict", detail: "account already belongs to another agent" };
      } else {
        record = fresh;
      }
    }
    if (!isAddressEqual(record.owner, owner.address) || record.index !== index || !isAddressEqual(record.account, account)) {
      return { ok: false, reason: "conflict", detail: "agent already has a different owner, index, or account" };
    }

    // An earlier attempt submitted an operation: wait for it rather than send another one.
    if (record.deployment.status === "pending" && record.deployment.userOpHash) {
      try {
        await this.chain.waitForReceipt(record.deployment.userOpHash);
      } catch (error) {
        return { ok: false, reason: "submission-unknown", detail: brief(error) };
      }
    }

    if (await this.chain.isDeployed(account)) {
      if (!(await this.chain.policyConfigured(account, this.settings.scope, limits))) {
        // Deployed but not configured as asked. Never reconfigure silently: widening a scope is an owner action.
        return { ok: false, reason: "misconfigured", detail: "account exists but its spend policy does not match" };
      }
      record.deployment = { status: "deployed", userOpHash: record.deployment.userOpHash };
      await this.store.update(record);
      return { ok: true, account, created: false, operation: null };
    }

    // Calling an address without code succeeds silently, so configuring a missing policy would look like success.
    if (!(await this.chain.policyDeployed())) return { ok: false, reason: "policy-unavailable" };

    const calls = this.chain.configurationCalls(this.settings.scope, limits);
    const sent = await this.send(agentId, account, (sponsored) => this.chain.prepareOwnerOperation({ owner, index, account, calls, sponsored }), async (hash) => {
      record!.deployment = { status: "pending", userOpHash: hash };
      await this.store.update(record!);
    });
    if (!sent.ok) return sent;
    if (!(await this.chain.isDeployed(account)) || !(await this.chain.policyConfigured(account, this.settings.scope, limits))) {
      return { ok: false, reason: "misconfigured", detail: "operation succeeded but the account or its policy is not in place" };
    }
    record.deployment = { status: "deployed", userOpHash: sent.userOpHash };
    await this.store.update(record);
    return { ok: true, account, created: true, operation: { userOpHash: sent.userOpHash, sponsored: sent.sponsored, gasCost: sent.gasCost } };
  }

  /**
   * Generates a session key held only in the vault and has the owner approve a permission validator scoped to
   * exactly the configured allowlist, with the spend policy attached as policy and hook. Idempotent while a key is
   * active. A new key can be issued after the previous one is revoked (rotation).
   */
  issueSessionKey(input: { agentId: string; owner: OwnerSigner }): Promise<IssueResult> {
    return this.exclusive(input.agentId, async () => {
      const record = await this.store.get(input.agentId);
      if (!record) return { ok: false, reason: "unknown-agent" };
      if (!isAddressEqual(record.owner, input.owner.address)) return { ok: false, reason: "conflict", detail: "signer is not the account owner" };
      if (record.deployment.status !== "deployed") return { ok: false, reason: "not-deployed" };
      if (record.session?.status === "active") {
        return { ok: true, keyAddress: record.session.keyAddress, permissionId: record.session.permissionId, issued: false };
      }
      if (record.session?.status === "revoking") return { ok: false, reason: "revoked", detail: "a revocation is not yet verified" };

      const privateKey = generatePrivateKey();
      const keyAddress = privateKeyToAddress(privateKey);
      const approval = await this.chain.approveSession({ owner: input.owner, index: record.index, account: record.account, sessionKeyAddress: keyAddress });
      await this.vault.destroy(input.agentId);
      await this.vault.put(input.agentId, privateKey);
      record.session = {
        keyAddress,
        permissionId: approval.permissionId,
        enableSignature: approval.enableSignature,
        enableNonce: approval.enableNonce,
        status: "active",
        issuedAt: this.now(),
        revokedAt: null,
        revokeUserOpHash: null,
      };
      await this.store.update(record);
      return { ok: true, keyAddress, permissionId: approval.permissionId, issued: true };
    });
  }

  /** Sends calls signed by the agent's session key. Refuses to sign anything outside the allowlist or after revocation. */
  execute(input: { agentId: string; calls: Call[] }): Promise<ExecuteResult> {
    return this.exclusive(input.agentId, async () => {
      const record = await this.store.get(input.agentId);
      if (!record) return { ok: false, reason: "unknown-agent" };
      if (record.deployment.status !== "deployed") return { ok: false, reason: "not-deployed" };
      const session = record.session;
      if (!session) return { ok: false, reason: "no-session" };
      if (session.status !== "active") return { ok: false, reason: "revoked" };
      if (!callsInScope(this.settings.scope, input.calls)) return { ok: false, reason: "out-of-scope" };
      const sessionKey = await this.vault.get(input.agentId);
      if (!sessionKey) return { ok: false, reason: "revoked", detail: "session key is not held" };
      const approval = { permissionId: session.permissionId, enableSignature: session.enableSignature, enableNonce: session.enableNonce };
      const sent = await this.send(input.agentId, record.account, (sponsored) =>
        this.chain.prepareSessionOperation({ owner: record.owner, index: record.index, account: record.account, sessionKey, approval, calls: input.calls, sponsored }),
      );
      return sent.ok ? { ok: true, userOpHash: sent.userOpHash, sponsored: sent.sponsored, gasCost: sent.gasCost } : sent;
    });
  }

  /**
   * Owner revocation, THREAT-MODEL.md invariant 8. Immediate off chain: the key is destroyed in the vault and the
   * record marked before anything else, so this process cannot sign with it again. Then an owner-signed operation
   * uninstalls the permission validator and invalidates the Kernel nonce, and the result is read back from chain.
   * Bulk revocation holds (SECURITY.md section 9) are decided by the caller with RecoveryService before this call.
   *
   * The on-chain operation is always sponsored, outside the per-agent budget, because it is the emergency stop
   * (ARCHITECTURE.md section 7). If the paymaster is down or refuses, the account pays if its balance covers the
   * worst case; otherwise the result is `paymaster-unavailable`: the key is already destroyed here, but the chain
   * still accepts it until this call is retried and succeeds.
   */
  revokeSessionKey(input: { agentId: string; owner: OwnerSigner }): Promise<RevokeResult> {
    return this.exclusive(input.agentId, async () => {
      const record = await this.store.get(input.agentId);
      if (!record) return { ok: false, revokedLocallyAt: null, reason: "unknown-agent" };
      if (!isAddressEqual(record.owner, input.owner.address)) return { ok: false, revokedLocallyAt: null, reason: "conflict", detail: "signer is not the account owner" };
      const session = record.session;
      if (!session) return { ok: false, revokedLocallyAt: null, reason: "no-session" };

      if (session.status === "active") {
        session.status = "revoking";
        session.revokedAt = this.now();
        await this.store.update(record);
      }
      await this.vault.destroy(input.agentId);
      const revokedLocallyAt = session.revokedAt ?? this.now();

      let state: PermissionState;
      try {
        state = await this.chain.permissionState(record.account, session.permissionId);
      } catch (error) {
        return { ok: false, revokedLocallyAt, reason: "rejected", detail: `cannot read permission state: ${brief(error)}` };
      }
      if (isRevokedOnChain(state, session.enableNonce)) {
        session.status = "revoked";
        await this.store.update(record);
        return { ok: true, revokedLocallyAt, onChain: "verified", operation: null };
      }

      const calls = await this.chain.revocationCalls({ account: record.account, sessionKeyAddress: session.keyAddress, permissionId: session.permissionId, state });
      const sent = await this.send(input.agentId, record.account, (sponsored) =>
        this.chain.prepareOwnerOperation({ owner: input.owner, index: record.index, account: record.account, calls, sponsored }), async (hash) => {
          session.revokeUserOpHash = hash;
          await this.store.update(record);
        }, "revocation");
      if (!sent.ok) return { ok: false, revokedLocallyAt, reason: sent.reason, detail: sent.detail };

      const after = await this.chain.permissionState(record.account, session.permissionId);
      if (!isRevokedOnChain(after, session.enableNonce)) {
        return { ok: false, revokedLocallyAt, reason: "reverted", detail: "revocation landed but the chain still accepts the key" };
      }
      session.status = "revoked";
      await this.store.update(record);
      return { ok: true, revokedLocallyAt, onChain: "verified", operation: { userOpHash: sent.userOpHash, sponsored: sent.sponsored, gasCost: sent.gasCost } };
    });
  }

  /** Independent check, from chain state and the vault, that an agent's session key can no longer sign. */
  async revocationStatus(agentId: string): Promise<RevocationStatus | null> {
    const record = await this.store.get(agentId);
    if (!record?.session) return null;
    const state = await this.chain.permissionState(record.account, record.session.permissionId);
    return {
      revoked: isRevokedOnChain(state, record.session.enableNonce),
      keyDestroyed: (await this.vault.get(agentId)) === null,
      state,
      enableNonce: record.session.enableNonce,
    };
  }

  async sponsorship(agentId: string) {
    const usage = await this.ledger.usage(agentId);
    return { ...usage, budget: this.settings.budget, exhausted: !hasHeadroom(usage, this.settings.budget) };
  }

  /**
   * The gas decision for every operation, ARCHITECTURE.md sections 7 and 14. A budgeted operation is sponsored only
   * if the paymaster is configured, the agent has budget left, the paymaster answers, and the worst-case cost fits
   * the remaining budget. A revocation is sponsored whenever the paymaster answers, and is never charged to the
   * budget. Otherwise the account pays in native MON, and only if its balance covers the worst case; if not, the
   * operation is not sent.
   */
  private async send(
    agentId: string,
    account: Address,
    prepare: (sponsored: boolean) => Promise<PreparedOperation>,
    onSubmitted?: (hash: Hex) => Promise<void>,
    kind: "budgeted" | "revocation" = "budgeted",
  ): Promise<({ ok: true } & OperationOutcome) | Failure> {
    let prepared: PreparedOperation | null = null;
    let reserved = 0n;
    let paymasterDown = !this.settings.paymaster;
    try {
      const sponsorable = kind === "revocation" || hasHeadroom(await this.ledger.usage(agentId), this.settings.budget);
      if (this.settings.paymaster && sponsorable) {
        try {
          const candidate = await prepare(true);
          if (!candidate.sponsored) {
            paymasterDown = true;
          } else if (kind === "revocation") {
            prepared = candidate;
          } else if (await this.ledger.reserve(agentId, candidate.maxCost, this.settings.budget)) {
            prepared = candidate;
            reserved = candidate.maxCost;
          }
        } catch (error) {
          if (!(error instanceof PaymasterUnavailableError)) throw error;
          // Paymaster down: never assume sponsorship. Fall through to the account paying (section 14).
          paymasterDown = true;
        }
      }
      if (!prepared) {
        const own = await prepare(false);
        if (own.sponsored) return { ok: false, reason: "rejected", detail: "unsponsored operation carries paymaster data" };
        if ((await this.chain.nativeBalance(account)) < own.maxCost) {
          return { ok: false, reason: kind === "revocation" && paymasterDown ? "paymaster-unavailable" : "insufficient-gas" };
        }
        prepared = own;
      }
    } catch (error) {
      return { ok: false, reason: "rejected", detail: brief(error) };
    }

    let hash: Hex;
    try {
      hash = await prepared.submit();
    } catch (error) {
      if (error instanceof SubmissionRejectedError) {
        if (reserved > 0n) await this.ledger.release(agentId, reserved);
        return { ok: false, reason: "rejected", detail: brief(error) };
      }
      // The bundler may have accepted it. Keep the reservation: the budget fails closed, never open.
      return { ok: false, reason: "submission-unknown", detail: brief(error) };
    }
    await onSubmitted?.(hash);

    let receipt;
    try {
      receipt = await this.chain.waitForReceipt(hash);
    } catch (error) {
      return { ok: false, reason: "submission-unknown", detail: brief(error) };
    }
    if (reserved > 0n) await this.ledger.settle(agentId, reserved, receipt.sponsored ? receipt.actualGasCost : 0n);
    if (!receipt.success) return { ok: false, reason: "reverted", detail: hash };
    return { ok: true, userOpHash: hash, sponsored: receipt.sponsored, gasCost: receipt.actualGasCost };
  }
}
