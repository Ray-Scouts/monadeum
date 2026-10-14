import { agentCommitmentCall } from "@monadeum/commitment";
import type { AllowedCall } from "@monadeum/risk";
import { encodeAbiParameters, isAddressEqual, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { hasHeadroom, type SponsorshipBudget, type SponsorshipLedger } from "./budget.js";
import {
  PaymasterUnavailableError,
  SubmissionRejectedError,
  type AgentHashes,
  type OperationReceipt,
  type OwnerSigner,
  type PermissionState,
  type PreparedOperation,
  type SpendLimits,
  type WalletsChain,
} from "./chain.js";
import { callsInScope, type Call } from "./scope.js";
import { x402InstallCall, x402UninstallCall, x402ValidatorInstallData, type X402ValidatorConfig } from "./x402.js";
import type { AgentWalletRecord, AgentWalletStore, SessionKeyVault, TickAttempt, TickOperationRecord } from "./store.js";

/**
 * The x402 key and its validator (ARCHITECTURE.md section 16.3, x402 signature path). `maxValue` and
 * `paymentsPerEpoch` are deployment configuration; see `X402_LIMITS` for the decided values the configuration
 * defaults to.
 */
export interface X402WalletSettings {
  validator: Address;
  settlementAsset: Address;
  maxValue: bigint;
  paymentsPerEpoch: number;
  maxValidity: number;
  /** The x402 providers' pay-to addresses. */
  payees: readonly Address[];
  /** Holds x402 keys. Must be a different vault from the session-key vault. */
  vault: SessionKeyVault;
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_HASH = /^0x0{64}$/;

export interface WalletsSettings {
  scope: readonly AllowedCall[];
  budget: SponsorshipBudget;
  /** False when no paymaster is configured: every operation is paid by the account itself. */
  paymaster: boolean;
  /** Absent or null: no x402 key is created and no validator is installed; the agent cannot pay x402. */
  x402?: X402WalletSettings | null;
  /**
   * The deployed AgentCommitments contract (ARCHITECTURE.md section 9). Set: every deployment carries the agent's
   * genome and strategy-version hashes and commits them from the new account in the same owner-signed operation, and a
   * deployment without them is refused. Absent or null: nothing is committed on chain.
   */
  commitments?: Address | null;
}

export interface DeployInput {
  agentId: string;
  owner: OwnerSigner;
  index: bigint;
  limits: SpendLimits;
  /** The section 16.4 hashes the account commits; required when `commitments` is configured. */
  commitment?: AgentHashes;
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
  | "submission-unknown"
  | "busy";

/** `userOpHash` is set whenever an operation may have been submitted, so it can always be found again. */
export type Failure = { ok: false; reason: FailureReason; detail?: string; userOpHash?: Hex };

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

export type TickStatus =
  | { state: "absent" }
  | { state: "pending"; userOpHash: Hex }
  | { state: "included"; userOpHash: Hex; receipt: OperationReceipt };

/**
 * `ok: true`: the operation is in a block; `receipt.success` says whether its calls succeeded. `pending` and
 * `submission-unknown` carry the hash of an operation that may still land. Every other reason means nothing for this
 * call was submitted.
 */
export type TickExecuteResult =
  | { ok: true; userOpHash: Hex; receipt: OperationReceipt }
  | { ok: false; reason: "pending"; userOpHash: Hex; detail?: string }
  | Failure;

export interface RevocationStatus {
  /** The session key is dead on chain, and so is the x402 key when the agent has one. */
  revoked: boolean;
  /** The key is no longer held by this process. */
  keyDestroyed: boolean;
  state: PermissionState;
  enableNonce: number;
  /** The x402 key, when the agent has one. `keyDestroyed` is null when this process holds no x402 vault. */
  x402?: { installed: boolean; keyDestroyed: boolean | null } | null;
}

export type X402InstallResult = { ok: true; keyAddress: Address; installed: boolean; operation: OperationOutcome | null } | Failure;

/** What the x402 payer may use to sign for an agent: the account and a signer over the x402 key, never the key itself. */
export interface X402SigningKey {
  account: Address;
  keyAddress: Address;
  validator: Address;
  sign(args: { hash: Hex }): Promise<Hex>;
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

/**
 * The chain accepts the session key's permission: either it is installed at or above `validNonceFrom`, or it is not
 * installed yet and the owner's enable signature can still install it, because Kernel v3.1 binds that signature to
 * `currentNonce` and installs the permission with the first session-key operation (enable mode).
 */
export function isSessionAcceptedOnChain(state: PermissionState, enableNonce: number): boolean {
  if (state.installed) return state.validatorNonce >= state.validNonceFrom;
  return state.currentNonce === enableNonce && enableNonce >= state.validNonceFrom;
}

/** The session key as WalletsModule and the chain see it, for an agent that has one. */
export interface SessionStatus {
  status: "active" | "revoking" | "revoked";
  keyAddress: Address;
  permissionId: Hex;
  issuedAt: number;
  /** The key is held by this process's vault. */
  keyHeld: boolean;
  state: PermissionState;
  enableNonce: number;
  /** `isSessionAcceptedOnChain`: the chain would accept an operation signed by this key now. */
  acceptedOnChain: boolean;
}

const brief = (error: unknown, max = 200) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, max);

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
  ) {
    if (settings.x402 && settings.x402.vault === vault) throw new Error("the x402 key vault must be separate from the session key vault");
  }

  private x402Config(keyAddress: Address): X402ValidatorConfig {
    const x = this.settings.x402!;
    return { signer: keyAddress, maxValue: x.maxValue, paymentsPerEpoch: x.paymentsPerEpoch, maxValidity: x.maxValidity, payees: x.payees };
  }

  /**
   * The x402 key for an install: the one already in the x402 vault when an earlier install attempt left it there,
   * otherwise a new one. Recorded as `installing` before any operation is prepared, and the install call built.
   */
  private async prepareX402Install(record: AgentWalletRecord): Promise<{ ok: true; calls: Call[]; keyAddress: Address } | Failure> {
    const x = this.settings.x402!;
    if (!(await this.chain.isDeployed(x.validator))) return { ok: false, reason: "policy-unavailable", detail: "the x402 validator has no code" };
    let key = await x.vault.get(record.agentId);
    if (key && record.x402?.status !== "installing") {
      // A key left over from a revoked install is never reused.
      await x.vault.destroy(record.agentId);
      key = null;
    }
    if (!key) {
      key = generatePrivateKey();
      await x.vault.put(record.agentId, key);
    }
    const keyAddress = privateKeyToAddress(key);
    let installData: Hex;
    try {
      installData = x402ValidatorInstallData(this.x402Config(keyAddress), { account: record.account, settlementAsset: x.settlementAsset, validator: x.validator });
    } catch (error) {
      return { ok: false, reason: "misconfigured", detail: brief(error) };
    }
    record.x402 = { keyAddress, validator: x.validator, status: "installing", installedAt: null, revokedAt: null };
    await this.store.update(record);
    return { ok: true, calls: [x402InstallCall(record.account, x.validator, installData)], keyAddress };
  }

  /** After an install landed, or when an earlier one may have: marks the key active only if the chain shows it so. */
  private async confirmX402(record: AgentWalletRecord): Promise<boolean> {
    const x402 = record.x402;
    if (!x402 || x402.status !== "installing" || !this.settings.x402) return false;
    if (!(await this.chain.x402Configured(record.account, x402.validator, this.x402Config(x402.keyAddress)))) return false;
    record.x402 = { ...x402, status: "active", installedAt: this.now() };
    await this.store.update(record);
    return true;
  }

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
   * The counterfactual address of the owner's account at `index`, the one `deploy` deploys. Computed without
   * deploying anything, so agent creation can record the account before the owner signs the deployment.
   */
  accountAddress(owner: Address, index: bigint): Promise<Address> {
    return this.chain.accountAddress(owner, index);
  }

  /**
   * Deploys the agent's account and configures its spend policy in one owner-signed operation. Idempotent: a
   * repeated call for the same agent returns the existing account and sends nothing, and a call made while an
   * earlier operation is pending waits for that operation instead of sending a second one.
   */
  deploy(input: DeployInput): Promise<DeployResult> {
    return this.exclusive(input.agentId, () => this.deployOnce(input));
  }

  /**
   * True when the account's on-chain commitment is exactly `expected`. Calling an address without code succeeds
   * silently, so a registry without code reads as no commitment rather than a match.
   */
  private async committed(registry: Address, account: Address, expected: AgentHashes): Promise<boolean> {
    const c = await this.chain.agentCommitment(registry, account);
    return c.genomeHash.toLowerCase() === expected.genomeHash.toLowerCase() && c.strategyVersionHash.toLowerCase() === expected.strategyVersionHash.toLowerCase();
  }

  private async deployOnce(input: DeployInput): Promise<DeployResult> {
    const { agentId, owner, index, limits, commitment } = input;
    if (limits.perTxCap < 0n || limits.dailyCap < 0n || limits.perTxCap >= 2n ** 128n || limits.dailyCap >= 2n ** 128n) {
      return { ok: false, reason: "misconfigured", detail: "limits must fit uint128" };
    }
    const registry = this.settings.commitments ?? null;
    if (registry && !(commitment && BYTES32.test(commitment.genomeHash) && BYTES32.test(commitment.strategyVersionHash) && !ZERO_HASH.test(commitment.genomeHash) && !ZERO_HASH.test(commitment.strategyVersionHash))) {
      return { ok: false, reason: "misconfigured", detail: "agent commitments are configured: a deployment needs the genome and strategy-version hashes" };
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
      if (registry && !(await this.committed(registry, account, commitment!))) {
        // The commitment rides in the operation that deployed the account, so a deployed account without it was
        // deployed some other way, or committed other hashes; neither is repaired here.
        return { ok: false, reason: "misconfigured", detail: "account exists but its on-chain genome commitment does not match" };
      }
      record.deployment = { status: "deployed", userOpHash: record.deployment.userOpHash };
      await this.store.update(record);
      // An earlier attempt's operation may have installed the x402 validator; mark it active only if the chain shows it.
      await this.confirmX402(record);
      return { ok: true, account, created: false, operation: null };
    }

    // Calling an address without code succeeds silently, so configuring a missing policy would look like success.
    if (!(await this.chain.policyDeployed())) return { ok: false, reason: "policy-unavailable" };
    // The same holds for the commitment: a commit to an address without code would land as a silent no-op.
    if (registry && !(await this.chain.isDeployed(registry))) {
      return { ok: false, reason: "misconfigured", detail: "the agent commitments contract has no code" };
    }

    // The x402 validator is installed in the same owner-signed operation that deploys the account, when configured.
    let x402Calls: Call[] = [];
    if (this.settings.x402) {
      const prepared = await this.prepareX402Install(record);
      if (!prepared.ok) return prepared;
      x402Calls = prepared.calls;
    }

    // The account commits its own genome and strategy-version hashes in the operation that deploys it (section 9).
    const commitCalls: Call[] = registry ? [agentCommitmentCall(registry, commitment!)] : [];
    const calls = [...this.chain.configurationCalls(this.settings.scope, limits), ...x402Calls, ...commitCalls];
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
    if (this.settings.x402 && !(await this.confirmX402(record))) {
      return { ok: false, reason: "misconfigured", detail: "operation succeeded but the x402 validator is not configured as asked" };
    }
    if (registry && !(await this.committed(registry, account, commitment!))) {
      return { ok: false, reason: "misconfigured", detail: "operation succeeded but the chain does not show the genome commitment" };
    }
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

      if (!(await this.chain.isDeployed(record.account))) return { ok: false, reason: "not-deployed", detail: "the account has no code on chain" };

      // Held only in this process's memory until the owner has approved it and the chain accepts the approval.
      const privateKey = generatePrivateKey();
      const keyAddress = privateKeyToAddress(privateKey);
      const approval = await this.chain.approveSession({ owner: input.owner, index: record.index, account: record.account, sessionKeyAddress: keyAddress });
      // Read back from chain: the account would accept the approval now. Otherwise nothing is recorded or kept.
      let state: PermissionState;
      try {
        state = await this.chain.permissionState(record.account, approval.permissionId);
      } catch (error) {
        return { ok: false, reason: "rejected", detail: `cannot read permission state: ${brief(error)}` };
      }
      if (!isSessionAcceptedOnChain(state, approval.enableNonce)) {
        return { ok: false, reason: "rejected", detail: "the account does not accept the approval: its Kernel nonce moved while the owner was signing; retry" };
      }
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

  /**
   * Installs the x402 validator with a new x402 key on an already deployed account, in an owner-signed operation:
   * for an account deployed before x402 was configured, or after a revocation removed the previous key. Idempotent
   * while the key is active. Refuses while a revocation is unverified, and when the chain shows a validator
   * configuration other than the one this call would install.
   */
  installX402(input: { agentId: string; owner: OwnerSigner }): Promise<X402InstallResult> {
    return this.exclusive(input.agentId, async () => {
      if (!this.settings.x402) return { ok: false, reason: "misconfigured", detail: "x402 is not configured" };
      const record = await this.store.get(input.agentId);
      if (!record) return { ok: false, reason: "unknown-agent" };
      if (!isAddressEqual(record.owner, input.owner.address)) return { ok: false, reason: "conflict", detail: "signer is not the account owner" };
      if (record.deployment.status !== "deployed") return { ok: false, reason: "not-deployed" };
      if (record.x402?.status === "revoking") return { ok: false, reason: "revoked", detail: "an x402 revocation is not yet verified" };
      if (record.x402?.status === "active") return { ok: true, keyAddress: record.x402.keyAddress, installed: false, operation: null };
      if (await this.confirmX402(record)) return { ok: true, keyAddress: record.x402!.keyAddress, installed: false, operation: null };
      if (await this.chain.x402Installed(record.account, this.settings.x402.validator)) {
        return { ok: false, reason: "misconfigured", detail: "an x402 validator configuration other than this one is installed; revoke it first" };
      }
      const prepared = await this.prepareX402Install(record);
      if (!prepared.ok) return prepared;
      const sent = await this.send(input.agentId, record.account, (sponsored) =>
        this.chain.prepareOwnerOperation({ owner: input.owner, index: record.index, account: record.account, calls: prepared.calls, sponsored }),
      );
      if (!sent.ok) return sent;
      if (!(await this.confirmX402(record))) return { ok: false, reason: "misconfigured", detail: "operation succeeded but the x402 validator is not configured as asked" };
      return { ok: true, keyAddress: prepared.keyAddress, installed: true, operation: { userOpHash: sent.userOpHash, sponsored: sent.sponsored, gasCost: sent.gasCost } };
    });
  }

  /**
   * The agent's x402 signing key for the payer, or null when the agent has no active x402 key, this process holds no
   * x402 vault, or the vault no longer holds the key. The private key never leaves this object.
   */
  async x402SigningKey(agentId: string): Promise<X402SigningKey | null> {
    const x = this.settings.x402;
    const record = await this.store.get(agentId);
    if (!x || !record || record.x402?.status !== "active" || record.deployment.status !== "deployed") return null;
    const key = await x.vault.get(agentId);
    if (!key) return null;
    const signer = privateKeyToAccount(key);
    if (!isAddressEqual(signer.address, record.x402.keyAddress)) return null;
    return { account: record.account, keyAddress: signer.address, validator: record.x402.validator, sign: (args) => signer.sign(args) };
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
      const x402 = record.x402 ?? null;
      if (!session && !x402) return { ok: false, revokedLocallyAt: null, reason: "no-session" };

      // Off chain first, for both keys: marked, then destroyed, before anything else can fail.
      const now = this.now();
      if (session?.status === "active") {
        session.status = "revoking";
        session.revokedAt = now;
      }
      if (x402 && (x402.status === "active" || x402.status === "installing")) {
        x402.status = "revoking";
        x402.revokedAt = now;
      }
      await this.store.update(record);
      await this.vault.destroy(input.agentId);
      if (this.settings.x402) await this.settings.x402.vault.destroy(input.agentId);
      const revokedLocallyAt = session?.revokedAt ?? x402?.revokedAt ?? now;

      // Kernel's ERC-1271 path ignores the nonce, so the x402 key is dead only once its validator is uninstalled.
      const live = async () => {
        const state = session ? await this.chain.permissionState(record.account, session.permissionId) : null;
        return {
          state,
          sessionLive: Boolean(session && state && !isRevokedOnChain(state, session.enableNonce)),
          x402Live: x402 ? await this.chain.x402Installed(record.account, x402.validator) : false,
        };
      };
      const markRevoked = async () => {
        if (session) session.status = "revoked";
        if (x402) x402.status = "revoked";
        await this.store.update(record);
      };

      let before;
      try {
        before = await live();
      } catch (error) {
        return { ok: false, revokedLocallyAt, reason: "rejected", detail: `cannot read permission state: ${brief(error)}` };
      }
      if (!before.sessionLive && !before.x402Live) {
        await markRevoked();
        return { ok: true, revokedLocallyAt, onChain: "verified", operation: null };
      }

      const calls: Call[] = [];
      if (session && before.sessionLive) {
        calls.push(...(await this.chain.revocationCalls({ account: record.account, sessionKeyAddress: session.keyAddress, permissionId: session.permissionId, state: before.state! })));
      }
      if (x402 && before.x402Live) calls.push(x402UninstallCall(record.account, x402.validator));
      const sent = await this.send(input.agentId, record.account, (sponsored) =>
        this.chain.prepareOwnerOperation({ owner: input.owner, index: record.index, account: record.account, calls, sponsored }), async (hash) => {
          if (session) session.revokeUserOpHash = hash;
          await this.store.update(record);
        }, "revocation");
      if (!sent.ok) return { ok: false, revokedLocallyAt, reason: sent.reason, detail: sent.detail };

      const after = await live();
      if (after.sessionLive || after.x402Live) {
        return { ok: false, revokedLocallyAt, reason: "reverted", detail: "revocation landed but the chain still accepts a key" };
      }
      await markRevoked();
      return { ok: true, revokedLocallyAt, onChain: "verified", operation: { userOpHash: sent.userOpHash, sponsored: sent.sponsored, gasCost: sent.gasCost } };
    });
  }

  /**
   * The session key's state read from chain and the vault: whether the account accepts it now (installed, or
   * installable by the owner's enable signature at the first session-key operation). Null when the agent has none.
   */
  async sessionStatus(agentId: string): Promise<SessionStatus | null> {
    const record = await this.store.get(agentId);
    const session = record?.session;
    if (!record || !session) return null;
    const state = await this.chain.permissionState(record.account, session.permissionId);
    return {
      status: session.status,
      keyAddress: session.keyAddress,
      permissionId: session.permissionId,
      issuedAt: session.issuedAt,
      keyHeld: (await this.vault.get(agentId)) !== null,
      state,
      enableNonce: session.enableNonce,
      acceptedOnChain: isSessionAcceptedOnChain(state, session.enableNonce),
    };
  }

  /** Independent check, from chain state and the vault, that an agent's session key can no longer sign. */
  async revocationStatus(agentId: string): Promise<RevocationStatus | null> {
    const record = await this.store.get(agentId);
    if (!record?.session) return null;
    const state = await this.chain.permissionState(record.account, record.session.permissionId);
    const x402 = record.x402
      ? {
          installed: await this.chain.x402Installed(record.account, record.x402.validator),
          keyDestroyed: this.settings.x402 ? (await this.settings.x402.vault.get(agentId)) === null : null,
        }
      : null;
    return {
      revoked: isRevokedOnChain(state, record.session.enableNonce) && !x402?.installed,
      keyDestroyed: (await this.vault.get(agentId)) === null,
      state,
      enableNonce: record.session.enableNonce,
      x402,
    };
  }

  async sponsorship(agentId: string) {
    const usage = await this.ledger.usage(agentId);
    return { ...usage, budget: this.settings.budget, exhausted: !hasHeadroom(usage, this.settings.budget) };
  }

  /**
   * Session-key execution for one tick, at most once across restarts. The operation's hash is computed from the
   * prepared operation and written to the store, keyed by (agent ID, tick key), before it is submitted. A repeated
   * call for the same tick never prepares blindly: it looks the tick up first and returns what it finds, and sends
   * again only when every earlier attempt is provably not included and cannot be (see `lookupTick`). A re-attempt
   * reuses the nonce of the attempt it replaces, so at most one of them can ever be included.
   *
   * While an earlier tick of the same agent may still land, a new tick is refused with `busy`, so two ticks never
   * race for one nonce. Every result where an operation may have been submitted carries its `userOpHash`.
   */
  executeForTick(input: { agentId: string; tickKey: string; calls: Call[] }): Promise<TickExecuteResult> {
    return this.exclusive(input.agentId, () => this.executeForTickOnce(input));
  }

  /**
   * Where a tick's operation stands, answered from the store, the bundler, and the chain: `absent` (nothing was
   * submitted, or every attempt is provably dead), `pending` (the bundler holds it), or `included` with the full
   * receipt. Throws when it cannot tell, for example when the bundler is unreachable, or when an attempt's nonce was
   * consumed by an operation it cannot identify; the caller must not treat that as absent.
   */
  lookupTick(agentId: string, tickKey: string): Promise<TickStatus> {
    return this.exclusive(agentId, async (): Promise<TickStatus> => {
      const op = await this.store.getOperation(agentId, tickKey);
      return op ? (await this.statusOf(op)).status : { state: "absent" };
    });
  }

  /** The agent that owns an account, for callers that know only the account address. */
  async agentIdOf(account: Address): Promise<string | undefined> {
    return (await this.store.findByAccount(account))?.agentId;
  }

  private async executeForTickOnce(input: { agentId: string; tickKey: string; calls: Call[] }): Promise<TickExecuteResult> {
    const { agentId, tickKey, calls } = input;
    const record = await this.store.get(agentId);
    if (!record) return { ok: false, reason: "unknown-agent" };
    if (record.deployment.status !== "deployed") return { ok: false, reason: "not-deployed" };
    const session = record.session;
    if (!session) return { ok: false, reason: "no-session" };
    const callsHash = keccak256(encodeAbiParameters(parseAbiParameters("(address to, uint256 value, bytes data)[]"), [calls]));

    let op = await this.store.getOperation(agentId, tickKey);
    let pinnedNonce: bigint | undefined;
    if (op) {
      if (op.callsHash !== callsHash) return { ok: false, reason: "conflict", detail: "tick key already used with different calls" };
      let found: { status: TickStatus; superseded: boolean };
      try {
        found = await this.statusOf(op);
      } catch (error) {
        return { ok: false, reason: "submission-unknown", detail: brief(error), userOpHash: op.attempts.at(-1)?.userOpHash };
      }
      if (found.status.state === "included") return { ok: true, userOpHash: found.status.userOpHash, receipt: found.status.receipt };
      if (found.status.state === "pending") return { ok: false, reason: "pending", userOpHash: found.status.userOpHash };
      const last = op.attempts.filter((a) => !a.rejected).at(-1);
      if (last && !found.superseded) pinnedNonce = last.nonce;
      // Earlier attempts are dead: return their reservations before a new one is taken.
      let released = false;
      for (const a of op.attempts) {
        if (a.reserved > 0n) {
          await this.ledger.release(agentId, a.reserved);
          a.reserved = 0n;
          released = true;
        }
      }
      if (released) await this.store.updateOperation(op);
    }

    if (session.status !== "active") return { ok: false, reason: "revoked" };
    if (!callsInScope(this.settings.scope, calls)) return { ok: false, reason: "out-of-scope" };
    const sessionKey = await this.vault.get(agentId);
    if (!sessionKey) return { ok: false, reason: "revoked", detail: "session key is not held" };

    if (!op) {
      for (const other of await this.store.listOperations(agentId)) {
        if (other.included || other.attempts.every((a) => a.rejected)) continue;
        try {
          const s = await this.statusOf(other);
          if (s.status.state === "pending") return { ok: false, reason: "busy", detail: `tick ${other.tickKey} is pending` };
        } catch (error) {
          return { ok: false, reason: "busy", detail: `tick ${other.tickKey} is unresolved: ${brief(error)}` };
        }
      }
      op = { agentId, tickKey, account: record.account, callsHash, attempts: [], included: null };
      if (!(await this.store.claimOperation(op))) return { ok: false, reason: "conflict", detail: "tick claimed concurrently" };
    }
    const tick = op;

    const approval = { permissionId: session.permissionId, enableSignature: session.enableSignature, enableNonce: session.enableNonce };
    const chosen = await this.choose(agentId, record.account, (sponsored) =>
      this.chain.prepareSessionOperation({
        owner: record.owner, index: record.index, account: record.account, sessionKey, approval, calls, sponsored, nonce: pinnedNonce,
      }), "budgeted");
    if (!chosen.ok) return chosen;
    const { prepared, reserved } = chosen;
    if (pinnedNonce !== undefined && prepared.nonce !== pinnedNonce) {
      if (reserved > 0n) await this.ledger.release(agentId, reserved);
      return { ok: false, reason: "rejected", detail: "prepared operation does not carry the pinned nonce" };
    }

    // Durable before submission: after this write, a crash can never lose the operation's hash.
    const attempt: TickAttempt = { userOpHash: prepared.userOpHash, nonce: prepared.nonce, sponsored: prepared.sponsored, reserved, rejected: false };
    tick.attempts.push(attempt);
    await this.store.updateOperation(tick);

    let hash: Hex;
    try {
      hash = await prepared.submit();
    } catch (error) {
      if (error instanceof SubmissionRejectedError) {
        if (reserved > 0n) await this.ledger.release(agentId, reserved);
        attempt.reserved = 0n;
        attempt.rejected = true;
        await this.store.updateOperation(tick);
        return { ok: false, reason: "rejected", detail: brief(error, 500) };
      }
      return { ok: false, reason: "submission-unknown", detail: brief(error), userOpHash: prepared.userOpHash };
    }
    if (hash.toLowerCase() !== prepared.userOpHash.toLowerCase()) {
      return { ok: false, reason: "submission-unknown", detail: `bundler returned ${hash}, expected ${prepared.userOpHash}`, userOpHash: prepared.userOpHash };
    }

    let receipt: OperationReceipt;
    try {
      receipt = await this.chain.waitForReceipt(hash);
    } catch (error) {
      return { ok: false, reason: "submission-unknown", detail: brief(error), userOpHash: hash };
    }
    await this.markIncluded(tick, attempt, receipt);
    return { ok: true, userOpHash: hash, receipt };
  }

  /** Records inclusion, then settles the attempt's reservation. A crash between the two leaves the worst case reserved. */
  private async markIncluded(op: TickOperationRecord, attempt: TickAttempt, receipt: OperationReceipt) {
    const reserved = attempt.reserved;
    op.included = { userOpHash: attempt.userOpHash, receipt };
    attempt.reserved = 0n;
    await this.store.updateOperation(op);
    if (reserved > 0n) await this.ledger.settle(op.agentId, reserved, receipt.sponsored ? receipt.actualGasCost : 0n);
  }

  /**
   * `superseded`: an attempt's nonce was consumed by another tick's recorded, included operation, so none of this
   * tick's attempts can ever be included and a new attempt must take a fresh nonce.
   */
  private async statusOf(op: TickOperationRecord): Promise<{ status: TickStatus; superseded: boolean }> {
    if (op.included) return { status: { state: "included", userOpHash: op.included.userOpHash, receipt: op.included.receipt }, superseded: false };
    const live = op.attempts.filter((a) => !a.rejected);
    for (const a of live) {
      const receipt = await this.chain.getReceipt(a.userOpHash);
      if (receipt) {
        await this.markIncluded(op, a, receipt);
        return { status: { state: "included", userOpHash: a.userOpHash, receipt }, superseded: false };
      }
    }
    for (const a of live) {
      if (await this.chain.isPending(a.userOpHash)) return { status: { state: "pending", userOpHash: a.userOpHash }, superseded: false };
    }
    let superseded = false;
    for (const nonce of new Set(live.map((a) => a.nonce))) {
      if ((await this.chain.nextNonce(op.account, nonce)) <= nonce) continue;
      // The nonce was used, and not by any of this tick's attempts. Only another tick's known inclusion proves by what.
      const others = await this.store.listOperations(op.agentId);
      const takenBy = others.find((o) => o.tickKey !== op.tickKey && o.included &&
        o.attempts.some((a) => a.userOpHash === o.included!.userOpHash && a.nonce === nonce));
      if (!takenBy) throw new Error(`nonce ${nonce} of tick ${op.tickKey} was consumed by an operation this module cannot identify`);
      superseded = true;
    }
    // Not in a block, not held by the bundler, and its nonce unused or taken by another tick: nothing of it can land.
    return { status: { state: "absent" }, superseded };
  }

  /**
   * The gas decision for every operation, ARCHITECTURE.md sections 7 and 14. A budgeted operation is sponsored only
   * if the paymaster is configured, the agent has budget left, the paymaster answers, and the worst-case cost fits
   * the remaining budget. A revocation is sponsored whenever the paymaster answers, and is never charged to the
   * budget. Otherwise the account pays in native MON, and only if its balance covers the worst case; if not, the
   * operation is not sent. Nothing is submitted here; a returned reservation must be settled or released.
   */
  private async choose(
    agentId: string,
    account: Address,
    prepare: (sponsored: boolean) => Promise<PreparedOperation>,
    kind: "budgeted" | "revocation",
  ): Promise<{ ok: true; prepared: PreparedOperation; reserved: bigint } | Failure> {
    let paymasterDown = !this.settings.paymaster;
    try {
      const sponsorable = kind === "revocation" || hasHeadroom(await this.ledger.usage(agentId), this.settings.budget);
      if (this.settings.paymaster && sponsorable) {
        try {
          const candidate = await prepare(true);
          if (!candidate.sponsored) {
            paymasterDown = true;
          } else if (kind === "revocation") {
            return { ok: true, prepared: candidate, reserved: 0n };
          } else if (await this.ledger.reserve(agentId, candidate.maxCost, this.settings.budget)) {
            return { ok: true, prepared: candidate, reserved: candidate.maxCost };
          }
        } catch (error) {
          if (!(error instanceof PaymasterUnavailableError)) throw error;
          // Paymaster down: never assume sponsorship. Fall through to the account paying (section 14).
          paymasterDown = true;
        }
      }
      const own = await prepare(false);
      if (own.sponsored) return { ok: false, reason: "rejected", detail: "unsponsored operation carries paymaster data" };
      if ((await this.chain.nativeBalance(account)) < own.maxCost) {
        return { ok: false, reason: kind === "revocation" && paymasterDown ? "paymaster-unavailable" : "insufficient-gas" };
      }
      return { ok: true, prepared: own, reserved: 0n };
    } catch (error) {
      return { ok: false, reason: "rejected", detail: brief(error) };
    }
  }

  private async send(
    agentId: string,
    account: Address,
    prepare: (sponsored: boolean) => Promise<PreparedOperation>,
    onSubmitted?: (hash: Hex) => Promise<void>,
    kind: "budgeted" | "revocation" = "budgeted",
  ): Promise<({ ok: true } & OperationOutcome) | Failure> {
    const chosen = await this.choose(agentId, account, prepare, kind);
    if (!chosen.ok) return chosen;
    const { prepared, reserved } = chosen;

    let hash: Hex;
    try {
      hash = await prepared.submit();
    } catch (error) {
      if (error instanceof SubmissionRejectedError) {
        if (reserved > 0n) await this.ledger.release(agentId, reserved);
        return { ok: false, reason: "rejected", detail: brief(error, 500) };
      }
      // The bundler may have accepted it. Keep the reservation: the budget fails closed, never open.
      return { ok: false, reason: "submission-unknown", detail: brief(error), userOpHash: prepared.userOpHash };
    }
    await onSubmitted?.(hash);

    let receipt;
    try {
      receipt = await this.chain.waitForReceipt(hash);
    } catch (error) {
      return { ok: false, reason: "submission-unknown", detail: brief(error), userOpHash: hash };
    }
    if (reserved > 0n) await this.ledger.settle(agentId, reserved, receipt.sponsored ? receipt.actualGasCost : 0n);
    if (!receipt.success) return { ok: false, reason: "reverted", detail: hash, userOpHash: hash };
    return { ok: true, userOpHash: hash, sponsored: receipt.sponsored, gasCost: receipt.actualGasCost };
  }
}
