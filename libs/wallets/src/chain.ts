import type { AllowedCall } from "@monadeum/risk";
import type { Signer } from "@zerodev/sdk/types";
import type { Address, Hex } from "viem";
import type { Call } from "./scope.js";

/**
 * The user's root wallet as a signer. The platform never holds this key (SECURITY.md section 11): in production the
 * API supplies a signer that relays each signature request to the user's embedded wallet for approval.
 */
export interface OwnerSigner {
  address: Address;
  signer: Signer;
}

/** On-chain limits of IAgentSpendPolicy, settlement-asset base units. */
export interface SpendLimits {
  perTxCap: bigint;
  dailyCap: bigint;
}

/** A signed-ready user operation whose worst-case gas cost is known before it is submitted. */
export interface PreparedOperation {
  /** Upper bound on gas this operation can be charged, in wei. On Monad the charge is based on the gas limit. */
  maxCost: bigint;
  sponsored: boolean;
  submit(): Promise<Hex>;
}

export interface OperationReceipt {
  success: boolean;
  actualGasCost: bigint;
  /** True when the receipt names a paymaster, so the paymaster, not the account, paid the gas. */
  sponsored: boolean;
}

export interface PermissionState {
  /** `validationConfig(vId).hook` is nonzero. */
  installed: boolean;
  validatorNonce: number;
  currentNonce: number;
  validNonceFrom: number;
}

export interface SessionApproval {
  permissionId: Hex;
  enableSignature: Hex;
  enableNonce: number;
}

/** The paymaster could not be reached or refused to sponsor. Nothing was signed or submitted. */
export class PaymasterUnavailableError extends Error {}
/** The bundler answered and rejected the operation. It was not accepted, so no gas can be charged for it. */
export class SubmissionRejectedError extends Error {}

/**
 * Everything WalletsService needs from the chain, the bundler, and the paymaster. `ZeroDevChain` implements it with
 * the ZeroDev SDK; unit tests implement it in memory.
 */
export interface WalletsChain {
  accountAddress(owner: Address, index: bigint): Promise<Address>;
  isDeployed(account: Address): Promise<boolean>;
  nativeBalance(account: Address): Promise<bigint>;
  /** The spend policy contract has code. */
  policyDeployed(): Promise<boolean>;
  /** The account's limits equal `limits` and every scope entry is allowed on the spend policy. */
  policyConfigured(account: Address, scope: readonly AllowedCall[], limits: SpendLimits): Promise<boolean>;
  /** Owner calls that configure the spend policy for a new account: `setLimits` and one `setAllowed` per scope entry. */
  configurationCalls(scope: readonly AllowedCall[], limits: SpendLimits): Call[];

  prepareOwnerOperation(input: { owner: OwnerSigner; index: bigint; account: Address; calls: Call[]; sponsored: boolean }): Promise<PreparedOperation>;
  prepareSessionOperation(input: {
    owner: Address;
    index: bigint;
    account: Address;
    sessionKey: Hex;
    approval: SessionApproval;
    calls: Call[];
    sponsored: boolean;
  }): Promise<PreparedOperation>;
  waitForReceipt(userOpHash: Hex): Promise<OperationReceipt>;

  /** The owner signs the Kernel enable data for a permission validator scoped to `scope` with the spend policy attached. */
  approveSession(input: { owner: OwnerSigner; index: bigint; account: Address; sessionKeyAddress: Address }): Promise<SessionApproval>;
  permissionState(account: Address, permissionId: Hex): Promise<PermissionState>;
  /** Owner calls that revoke the session key: uninstall its validator if installed, and invalidate the Kernel nonce. */
  revocationCalls(input: { account: Address; sessionKeyAddress: Address; permissionId: Hex; state: PermissionState }): Promise<Call[]>;
}
