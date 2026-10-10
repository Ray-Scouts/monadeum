import type { AllowedCall } from "@monadeum/risk";
import { getKernelAddressFromECDSA, signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { toPermissionValidator } from "@zerodev/permissions";
import { CallPolicyVersion, CallType, toCallPolicy } from "@zerodev/permissions/policies";
import { toECDSASigner } from "@zerodev/permissions/signers";
import type { Policy } from "@zerodev/permissions";
import {
  addressToEmptyAccount,
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  getKernelV3Nonce,
  KernelV3AccountAbi,
  type KernelValidatorHook,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1, VALIDATOR_TYPE } from "@zerodev/sdk/constants";
import type { Signer } from "@zerodev/sdk/types";
import {
  BaseError,
  concatHex,
  createPublicClient,
  encodeFunctionData,
  http,
  pad,
  parseAbi,
  RpcRequestError,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import { formatUserOperationRequest, type UserOperation } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import {
  PaymasterUnavailableError,
  SubmissionRejectedError,
  type OperationReceipt,
  type OwnerSigner,
  type PermissionState,
  type PreparedOperation,
  type SessionApproval,
  type SpendLimits,
  type WalletsChain,
} from "./chain.js";
import type { Call } from "./scope.js";

// Kernel v3.1 on EntryPoint 0.7 and call policy v0.0.4: the versions the issue #18 and #19 spikes ran on Monad testnet.
export const entryPoint = getEntryPoint("0.7");
export const kernelVersion = KERNEL_V3_1;

/** The on-chain spend policy, ARCHITECTURE.md section 16.3 and contracts/src/IAgentSpendPolicy.sol. */
export const spendPolicyAbi = parseAbi([
  "struct Limits { uint128 perTxCap; uint128 dailyCap; }",
  "function setLimits(Limits newLimits)",
  "function setAllowed(address target, bytes4 selector, bool allowed)",
  "function limits(address account) view returns (Limits)",
  "function isAllowed(address account, address target, bytes4 selector) view returns (bool)",
]);

export interface SpendPolicyConfig {
  address: Address;
  /** Install data for the policy role, defined by the issue #25 implementation. Empty until it specifies one. */
  policyData: Hex;
  /** Install data for the hook role, defined by the issue #25 implementation. Empty until it specifies one. */
  hookData: Hex;
}

export interface ZeroDevChainConfig {
  chain: Chain;
  rpcUrl: string;
  bundlerUrl: string;
  /** Absent: no operation is ever sponsored. */
  paymasterUrl: string | null;
  spendPolicy: SpendPolicyConfig;
  scope: readonly AllowedCall[];
  /** For tests: replaces the HTTP transports. */
  transport?: { rpc?: Transport; bundler?: Transport; paymaster?: Transport };
}

/**
 * The ZeroDev permission policies for a session key. Two layers, both fixed at issuance:
 * - Call policy v0.0.4 with exactly the allowlist, value 0 and call type CALL on every entry. This binds the key's
 *   own scope, independent of the per-account allowlist on the spend policy contract.
 * - The spend policy contract, as a policy (validation phase `check`) and as the validator's hook (`record`).
 * The SDK's Policy type has no variant for a custom contract; `policyParams` is only read by the SDK's permission
 * deserializer, which this module never uses, so the label below is not interpreted.
 */
export function sessionPolicies(scope: readonly AllowedCall[], spendPolicy: SpendPolicyConfig): Policy[] {
  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    permissions: scope.map((c) => ({ target: c.target, selector: c.selector, valueLimit: 0n, callType: CallType.CALL })),
  });
  const custom: Policy = {
    getPolicyData: () => spendPolicy.policyData,
    getPolicyInfoInBytes: () => concatHex(["0x0000", spendPolicy.address]),
    policyParams: { type: "sudo", policyAddress: spendPolicy.address },
  };
  return [callPolicy, custom];
}

export function spendPolicyHook(spendPolicy: SpendPolicyConfig): KernelValidatorHook {
  return { getIdentifier: () => spendPolicy.address, getEnableData: async () => spendPolicy.hookData };
}

export function permissionValidationId(permissionId: Hex): Hex {
  return concatHex([VALIDATOR_TYPE.PERMISSION, pad(permissionId, { size: 20, dir: "right" })]);
}

/** Worst-case gas charge of a prepared operation, in wei. */
export function maxOperationCost(op: Pick<UserOperation<"0.7">, "callGasLimit" | "verificationGasLimit" | "preVerificationGas" | "maxFeePerGas"> & {
  paymasterVerificationGasLimit?: bigint | undefined;
  paymasterPostOpGasLimit?: bigint | undefined;
}): bigint {
  const gas = op.callGasLimit + op.verificationGasLimit + op.preVerificationGas + (op.paymasterVerificationGasLimit ?? 0n) + (op.paymasterPostOpGasLimit ?? 0n);
  return gas * op.maxFeePerGas;
}

function isBundlerRejection(error: unknown): boolean {
  return error instanceof BaseError && error.walk((e) => e instanceof RpcRequestError) instanceof RpcRequestError;
}

export class ZeroDevChain implements WalletsChain {
  readonly publicClient: PublicClient;

  constructor(private readonly config: ZeroDevChainConfig) {
    this.publicClient = createPublicClient({ chain: config.chain, transport: config.transport?.rpc ?? http(config.rpcUrl) });
  }

  async accountAddress(owner: Address, index: bigint): Promise<Address> {
    // Computed locally from the Kernel v3.1 implementation's init code hash; no RPC call for EntryPoint 0.7.
    return getKernelAddressFromECDSA({ publicClient: this.publicClient, entryPoint, kernelVersion, eoaAddress: owner, index });
  }

  async isDeployed(account: Address): Promise<boolean> {
    const code = await this.publicClient.getCode({ address: account });
    return Boolean(code && code !== "0x");
  }

  nativeBalance(account: Address): Promise<bigint> {
    return this.publicClient.getBalance({ address: account });
  }

  async policyDeployed(): Promise<boolean> {
    return this.isDeployed(this.config.spendPolicy.address);
  }

  async policyConfigured(account: Address, scope: readonly AllowedCall[], limits: SpendLimits): Promise<boolean> {
    const address = this.config.spendPolicy.address;
    try {
      const current = await this.publicClient.readContract({ address, abi: spendPolicyAbi, functionName: "limits", args: [account] });
      if (current.perTxCap !== limits.perTxCap || current.dailyCap !== limits.dailyCap) return false;
      for (const c of scope) {
        const allowed = await this.publicClient.readContract({ address, abi: spendPolicyAbi, functionName: "isAllowed", args: [account, c.target, c.selector] });
        if (!allowed) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  configurationCalls(scope: readonly AllowedCall[], limits: SpendLimits): Call[] {
    const to = this.config.spendPolicy.address;
    return [
      { to, value: 0n, data: encodeFunctionData({ abi: spendPolicyAbi, functionName: "setLimits", args: [{ perTxCap: limits.perTxCap, dailyCap: limits.dailyCap }] }) },
      ...scope.map((c) => ({ to, value: 0n, data: encodeFunctionData({ abi: spendPolicyAbi, functionName: "setAllowed", args: [c.target, c.selector, true] }) })),
    ];
  }

  // The account address is passed in, not looked up through getSenderAddress. The address comes from the record,
  // derived from the same owner and index, and the EntryPoint rejects an operation whose initCode does not create
  // its sender (AA14), so a mismatch cannot deploy or act on a different account.
  private async ownerAccount(owner: Signer, index: bigint, expected: Address) {
    const sudo = await signerToEcdsaValidator(this.publicClient, { signer: owner, entryPoint, kernelVersion });
    return createKernelAccount(this.publicClient, { entryPoint, kernelVersion, index, address: expected, plugins: { sudo } });
  }

  private async permissionValidator(sessionSigner: Signer) {
    return toPermissionValidator(this.publicClient, {
      signer: await toECDSASigner({ signer: sessionSigner }),
      policies: sessionPolicies(this.config.scope, this.config.spendPolicy),
      entryPoint,
      kernelVersion,
    });
  }

  async approveSession(input: { owner: OwnerSigner; index: bigint; account: Address; sessionKeyAddress: Address }): Promise<SessionApproval> {
    const sudo = await signerToEcdsaValidator(this.publicClient, { signer: input.owner.signer, entryPoint, kernelVersion });
    const regular = await this.permissionValidator(addressToEmptyAccount(input.sessionKeyAddress));
    const account = await createKernelAccount(this.publicClient, {
      entryPoint, kernelVersion, index: input.index, address: input.account,
      plugins: { sudo, regular, hook: spendPolicyHook(this.config.spendPolicy) },
    });
    const before = await getKernelV3Nonce(this.publicClient, input.account);
    const enableSignature = await account.kernelPluginManager.getPluginEnableSignature(input.account);
    const after = await getKernelV3Nonce(this.publicClient, input.account);
    // The signature binds the nonce read inside the SDK. A change around it would make the recorded nonce ambiguous.
    if (before !== after) throw new Error("Kernel nonce changed while the owner was signing; retry");
    return { permissionId: regular.getIdentifier(), enableSignature, enableNonce: before };
  }

  private client(account: Awaited<ReturnType<typeof createKernelAccount>>, sponsored: boolean, failed: { paymaster: boolean }) {
    let paymaster: Parameters<typeof createKernelAccountClient>[0]["paymaster"];
    if (sponsored) {
      if (!this.config.paymasterUrl) throw new PaymasterUnavailableError("no paymaster configured");
      const pm = createZeroDevPaymasterClient({ chain: this.config.chain, transport: this.config.transport?.paymaster ?? http(this.config.paymasterUrl) });
      paymaster = {
        getPaymasterStubData: async (p) => {
          try { return await pm.getPaymasterStubData(p); } catch (error) { failed.paymaster = true; throw error; }
        },
        getPaymasterData: async (p) => {
          try { return await pm.getPaymasterData(p); } catch (error) { failed.paymaster = true; throw error; }
        },
      };
    }
    return createKernelAccountClient({
      account,
      chain: this.config.chain,
      client: this.publicClient,
      bundlerTransport: this.config.transport?.bundler ?? http(this.config.bundlerUrl),
      paymaster,
    });
  }

  private async prepare(account: Awaited<ReturnType<typeof createKernelAccount>>, calls: Call[], sponsored: boolean): Promise<PreparedOperation> {
    const failed = { paymaster: false };
    const client = this.client(account, sponsored, failed);
    let op: UserOperation<"0.7">;
    try {
      op = (await client.prepareUserOperation({ calls })) as UserOperation<"0.7">;
    } catch (error) {
      if (failed.paymaster) throw new PaymasterUnavailableError(error instanceof Error ? error.message : String(error));
      throw error;
    }
    const hasPaymaster = Boolean(op.paymaster && op.paymaster !== zeroAddress);
    return {
      maxCost: maxOperationCost(op),
      sponsored: hasPaymaster,
      submit: async () => {
        const signature = await account.signUserOperation(op);
        try {
          // Submitted as prepared: going through sendUserOperation would prepare again and change the gas figures.
          return await client.request({
            method: "eth_sendUserOperation",
            params: [formatUserOperationRequest({ ...op, signature }), entryPoint.address],
          }, { retryCount: 0 });
        } catch (error) {
          if (isBundlerRejection(error)) throw new SubmissionRejectedError(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    };
  }

  async prepareOwnerOperation(input: { owner: OwnerSigner; index: bigint; account: Address; calls: Call[]; sponsored: boolean }): Promise<PreparedOperation> {
    const account = await this.ownerAccount(input.owner.signer, input.index, input.account);
    return this.prepare(account, input.calls, input.sponsored);
  }

  async prepareSessionOperation(input: {
    owner: Address; index: bigint; account: Address; sessionKey: Hex; approval: SessionApproval; calls: Call[]; sponsored: boolean;
  }): Promise<PreparedOperation> {
    const sudo = await signerToEcdsaValidator(this.publicClient, { signer: addressToEmptyAccount(input.owner), entryPoint, kernelVersion });
    const regular = await this.permissionValidator(privateKeyToAccount(input.sessionKey));
    if (regular.getIdentifier() !== input.approval.permissionId) throw new Error("session key does not match the approved permission");
    const account = await createKernelAccount(this.publicClient, {
      entryPoint, kernelVersion, index: input.index, address: input.account,
      plugins: { sudo, regular, hook: spendPolicyHook(this.config.spendPolicy), pluginEnableSignature: input.approval.enableSignature },
    });
    return this.prepare(account, input.calls, input.sponsored);
  }

  async waitForReceipt(userOpHash: Hex): Promise<OperationReceipt> {
    const bundler = createKernelAccountClient({
      chain: this.config.chain, client: this.publicClient, bundlerTransport: this.config.transport?.bundler ?? http(this.config.bundlerUrl),
    });
    const receipt = await bundler.waitForUserOperationReceipt({ hash: userOpHash });
    return {
      success: receipt.success,
      actualGasCost: receipt.actualGasCost,
      sponsored: Boolean(receipt.paymaster && receipt.paymaster !== zeroAddress),
    };
  }

  async permissionState(account: Address, permissionId: Hex): Promise<PermissionState> {
    const address = account;
    const abi = KernelV3AccountAbi;
    const [config, currentNonce, validNonceFrom] = await Promise.all([
      this.publicClient.readContract({ address, abi, functionName: "validationConfig", args: [permissionValidationId(permissionId)] }),
      this.publicClient.readContract({ address, abi, functionName: "currentNonce" }),
      this.publicClient.readContract({ address, abi, functionName: "validNonceFrom" }),
    ]);
    return { installed: config.hook !== zeroAddress, validatorNonce: config.nonce, currentNonce, validNonceFrom };
  }

  async revocationCalls(input: { account: Address; sessionKeyAddress: Address; permissionId: Hex; state: PermissionState }): Promise<Call[]> {
    const calls: Call[] = [];
    if (input.state.installed) {
      const validator = await this.permissionValidator(addressToEmptyAccount(input.sessionKeyAddress));
      if (validator.getIdentifier() !== input.permissionId) throw new Error("permission ID does not match the session key");
      calls.push({
        to: input.account,
        value: 0n,
        data: encodeFunctionData({
          abi: KernelV3AccountAbi,
          functionName: "uninstallValidation",
          args: [permissionValidationId(input.permissionId), await validator.getEnableData(input.account), this.config.spendPolicy.hookData],
        }),
      });
    }
    // Moves validNonceFrom and currentNonce past every existing permission and every outstanding enable signature.
    calls.push({
      to: input.account,
      value: 0n,
      data: encodeFunctionData({ abi: KernelV3AccountAbi, functionName: "invalidateNonce", args: [input.state.currentNonce + 1] }),
    });
    return calls;
  }
}
