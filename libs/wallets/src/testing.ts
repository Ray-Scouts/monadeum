import { AGENT_COMMITMENTS_ABI } from "@monadeum/commitment";
import type { AllowedCall } from "@monadeum/risk";
import { decodeFunctionData, getAddress, isAddressEqual, keccak256, toFunctionSelector, toHex, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  PaymasterUnavailableError,
  SubmissionRejectedError,
  type AgentHashes,
  type OperationLog,
  type OperationReceipt,
  type OwnerSigner,
  type PermissionState,
  type PreparedOperation,
  type SessionApproval,
  type SpendLimits,
  type WalletsChain,
} from "./chain.js";
import { tradedAssetsOf, type Call } from "./scope.js";
import { isRevokedOnChain } from "./wallets.service.js";
import { decodeX402InstallData, decodeX402ModuleCall, type X402ValidatorConfig } from "./x402.js";

// Test double, exported as `@monadeum/wallets/testing` so other packages can test against WalletsService without a
// chain. Never use it outside tests: it holds no key and enforces nothing.
//
// In-memory model of the account, the Kernel nonce rules the module depends on, the bundler, and the paymaster.
// It encodes the behavior verified in Kernel v3.1 (ValidationManager.sol, Kernel.sol): a validator installed below
// validNonceFrom is rejected, and an enable signature is bound to currentNonce.

const CONFIGURE = "0xc0f16000";
const REVOKE = "0x5e7ef000";
const COMMIT = toFunctionSelector(AGENT_COMMITMENTS_ABI[0]);
const ZERO: Hex = `0x${"0".repeat(64)}`;

interface Account {
  deployed: boolean;
  limits: SpendLimits | null;
  allowed: Set<string>;
  /** Tokens marked with the spend policy's `setTradedAsset`, lowercase. */
  traded: Set<string>;
  balance: bigint;
  currentNonce: number;
  validNonceFrom: number;
  permissions: Map<Hex, { installed: boolean; nonce: number }>;
  /** X402PaymentValidator configurations by lowercased validator address, as Kernel and the validator hold them. */
  x402: Map<string, { installed: boolean; config: X402ValidatorConfig | null }>;
  /** Next session-key nonce (key 0). Owner operations use another Kernel nonce key and do not move it. */
  sessionNonce: bigint;
}

interface Pooled {
  account: Address;
  nonce: bigint | null;
  include: () => OperationReceipt;
}

export interface FakeOptions {
  paymaster?: "up" | "down";
  gasPerOp?: bigint;
  /**
   * ok: included at once. rejected: the bundler refuses it. unknown: the request fails before the bundler sees it.
   * accepted-then-throw: the bundler accepts it into its mempool, then the response is lost. pending: accepted and
   * held until `mine()`.
   */
  submit?: "ok" | "rejected" | "unknown" | "accepted-then-throw" | "pending";
  bundlerDown?: boolean;
  /** Logs a session operation emits when included. Defaults to one marker log. */
  receiptLogs?: (account: Address, calls: Call[]) => OperationLog[];
  policyDeployed?: boolean;
}

export class FakeChain implements WalletsChain {
  readonly accounts = new Map<string, Account>();
  /** AgentCommitments state, by `registry:account`, lowercase. */
  readonly commitments = new Map<string, AgentHashes>();
  readonly submitted: { account: Address; kind: "owner" | "session"; sponsored: boolean; calls: Call[] }[] = [];
  prepareCalls = 0;
  options: Required<FakeOptions>;
  private readonly receipts = new Map<Hex, OperationReceipt>();
  readonly mempool = new Map<Hex, Pooled>();
  private seq = 0;
  private block = 100n;

  constructor(options: FakeOptions = {}) {
    this.options = {
      paymaster: "up", gasPerOp: 1000n, submit: "ok", policyDeployed: true, bundlerDown: false,
      receiptLogs: (account, calls) => [{ address: account, topics: [keccak256(toHex("Executed"))], data: keccak256(toHex(JSON.stringify(calls, (_, v) => (typeof v === "bigint" ? v.toString() : v)))) }],
      ...options,
    };
  }

  acct(address: Address): Account {
    const key = address.toLowerCase();
    let a = this.accounts.get(key);
    if (!a) {
      a = { deployed: false, limits: null, allowed: new Set(), traded: new Set(), balance: 0n, currentNonce: 1, validNonceFrom: 0, permissions: new Map(), sessionNonce: 0n, x402: new Map() };
      this.accounts.set(key, a);
    }
    return a;
  }

  async accountAddress(owner: Address, index: bigint): Promise<Address> {
    return getAddress(keccak256(toHex(`${owner.toLowerCase()}:${index}`)).slice(0, 42));
  }
  async isDeployed(account: Address) { return this.acct(account).deployed; }
  async nativeBalance(account: Address) { return this.acct(account).balance; }
  async policyDeployed() { return this.options.policyDeployed; }
  async policyConfigured(account: Address, scope: readonly AllowedCall[], limits: SpendLimits) {
    const a = this.acct(account);
    return a.limits?.perTxCap === limits.perTxCap && a.limits.dailyCap === limits.dailyCap &&
      scope.every((c) => a.allowed.has(`${c.target.toLowerCase()}:${c.selector}`)) &&
      tradedAssetsOf(scope).every((t) => a.traded.has(t.toLowerCase()));
  }
  configurationCalls(scope: readonly AllowedCall[], limits: SpendLimits): Call[] {
    const payload = JSON.stringify({
      limits: [limits.perTxCap.toString(), limits.dailyCap.toString()],
      traded: tradedAssetsOf(scope).map((t) => t.toLowerCase()),
      scope: scope.map((c) => `${c.target.toLowerCase()}:${c.selector}`),
    });
    return [{ to: "0x00000000000000000000000000000000000000f0", value: 0n, data: `${CONFIGURE}${Buffer.from(payload).toString("hex")}` }];
  }

  private prepared(account: Address, kind: "owner" | "session", calls: Call[], sponsored: boolean, apply: () => void, check?: () => void, nonce: bigint | null = null): PreparedOperation {
    this.prepareCalls++;
    if (sponsored && this.options.paymaster === "down") throw new PaymasterUnavailableError("paymaster timeout");
    check?.();
    const gas = this.options.gasPerOp;
    const userOpHash = keccak256(toHex(`op-${++this.seq}`));
    const include = (): OperationReceipt => {
      const a = this.acct(account);
      if (nonce !== null) {
        if (nonce !== a.sessionNonce) throw new Error("AA25 invalid account nonce");
        a.sessionNonce++;
      }
      this.submitted.push({ account, kind, sponsored, calls });
      apply();
      if (!sponsored) a.balance -= gas;
      const receipt: OperationReceipt = {
        success: true, actualGasCost: gas - 100n, sponsored,
        transactionHash: keccak256(toHex(`tx-${userOpHash}`)), blockNumber: ++this.block,
        logs: this.options.receiptLogs(account, calls),
        revertReason: null,
      };
      this.receipts.set(userOpHash, receipt);
      return receipt;
    };
    return {
      maxCost: gas,
      sponsored,
      userOpHash,
      nonce: nonce ?? 0n,
      submit: async () => {
        const mode = this.options.submit;
        if (mode === "rejected") throw new SubmissionRejectedError("AA23 reverted");
        if (mode === "unknown") throw new Error("socket hang up");
        if (nonce !== null && nonce < this.acct(account).sessionNonce) throw new SubmissionRejectedError("AA25 invalid account nonce");
        if (mode === "accepted-then-throw" || mode === "pending") {
          this.mempool.set(userOpHash, { account, nonce, include });
          if (mode === "accepted-then-throw") throw new Error("response lost after the bundler accepted the operation");
          return userOpHash;
        }
        include();
        return userOpHash;
      },
    };
  }

  /** Includes every pooled operation whose nonce is still next, in submission order, and drops the rest. */
  mine() {
    for (const [hash, pooled] of [...this.mempool]) {
      this.mempool.delete(hash);
      try { pooled.include(); } catch { /* nonce already used: dropped */ }
    }
  }

  /** The bundler forgets every pooled operation without including it. */
  dropMempool() {
    this.mempool.clear();
  }

  async getReceipt(hash: Hex) {
    if (this.options.bundlerDown) throw new Error("bundler unreachable");
    return this.receipts.get(hash) ?? null;
  }

  async isPending(hash: Hex) {
    if (this.options.bundlerDown) throw new Error("bundler unreachable");
    return this.mempool.has(hash);
  }

  async nextNonce(account: Address, _nonce: bigint) {
    return this.acct(account).sessionNonce;
  }

  async prepareOwnerOperation(input: { owner: OwnerSigner; index: bigint; account: Address; calls: Call[]; sponsored: boolean }) {
    return this.prepared(input.account, "owner", input.calls, input.sponsored, () => {
      const a = this.acct(input.account);
      a.deployed = true;
      for (const call of input.calls) {
        if (call.data.startsWith(CONFIGURE)) {
          const parsed = JSON.parse(Buffer.from(call.data.slice(CONFIGURE.length), "hex").toString());
          a.limits = { perTxCap: BigInt(parsed.limits[0]), dailyCap: BigInt(parsed.limits[1]) };
          for (const token of parsed.traded ?? []) a.traded.add(token);
          for (const entry of parsed.scope) a.allowed.add(entry);
        }
        // Kernel installModule / uninstallValidation, encoded exactly as libs/wallets/src/x402.ts builds them. The
        // validator refuses to replace a live configuration (onInstall reverts), modelled here as no change.
        const module = call.to.toLowerCase() === input.account.toLowerCase() ? decodeX402ModuleCall(call.data) : null;
        if (module?.kind === "install") {
          const key = module.validator.toLowerCase();
          if (!a.x402.get(key)?.installed) a.x402.set(key, { installed: true, config: decodeX402InstallData(module.installData) });
        }
        if (module?.kind === "uninstall") a.x402.set(module.validator.toLowerCase(), { installed: false, config: null });
        // AgentCommitments.commit from the account, write-once as the contract is; a repeat is modelled as no change.
        if (call.data.startsWith(COMMIT) && this.acct(call.to).deployed) {
          const key = `${call.to.toLowerCase()}:${input.account.toLowerCase()}`;
          if (!this.commitments.has(key)) {
            const { args } = decodeFunctionData({ abi: AGENT_COMMITMENTS_ABI, data: call.data });
            this.commitments.set(key, { genomeHash: args[0] as Hex, strategyVersionHash: args[1] as Hex });
          }
        }
        if (call.data.startsWith(REVOKE)) {
          const permissionId = `0x${call.data.slice(REVOKE.length)}` as Hex;
          const p = a.permissions.get(permissionId);
          if (p) p.installed = false;
          a.validNonceFrom = a.currentNonce + 1;
          a.currentNonce = a.validNonceFrom;
        }
      }
    });
  }

  async prepareSessionOperation(input: {
    owner: Address; index: bigint; account: Address; sessionKey: Hex; approval: SessionApproval; calls: Call[]; sponsored: boolean; nonce?: bigint;
  }) {
    const a = this.acct(input.account);
    const nonce = input.nonce ?? a.sessionNonce;
    return this.prepared(input.account, "session", input.calls, input.sponsored, () => {
      a.permissions.set(input.approval.permissionId, { installed: true, nonce: input.approval.enableNonce });
    }, () => {
      // Bundler simulation: the operation validates only if the key is still accepted by the account.
      const p = a.permissions.get(input.approval.permissionId);
      const installedOk = p?.installed && p.nonce >= a.validNonceFrom;
      const enableOk = !p?.installed && a.currentNonce === input.approval.enableNonce;
      if (!installedOk && !enableOk) throw new Error("AA24 signature error");
      if (keccak256(toHex(privateKeyToAddress(input.sessionKey))).slice(0, 10) !== input.approval.permissionId) throw new Error("wrong key");
    }, nonce);
  }

  async waitForReceipt(hash: Hex) {
    const r = this.receipts.get(hash);
    if (!r) throw new Error("receipt not found");
    return r;
  }

  async approveSession(input: { owner: OwnerSigner; index: bigint; account: Address; sessionKeyAddress: Address }): Promise<SessionApproval> {
    return { permissionId: keccak256(toHex(input.sessionKeyAddress)).slice(0, 10) as Hex, enableSignature: "0x5161", enableNonce: this.acct(input.account).currentNonce };
  }

  async permissionState(account: Address, permissionId: Hex): Promise<PermissionState> {
    const a = this.acct(account);
    const p = a.permissions.get(permissionId);
    return { installed: Boolean(p?.installed), validatorNonce: p?.nonce ?? 0, currentNonce: a.currentNonce, validNonceFrom: a.validNonceFrom };
  }

  async revocationCalls(input: { account: Address; permissionId: Hex }): Promise<Call[]> {
    return [{ to: input.account, value: 0n, data: `${REVOKE}${input.permissionId.slice(2)}` }];
  }

  async x402Installed(account: Address, validator: Address) {
    return Boolean(this.acct(account).x402.get(validator.toLowerCase())?.installed);
  }

  async x402Configured(account: Address, validator: Address, expected: X402ValidatorConfig) {
    const entry = this.acct(account).x402.get(validator.toLowerCase());
    const c = entry?.installed ? entry.config : null;
    if (!c) return false;
    return isAddressEqual(c.signer, expected.signer) && c.maxValue === expected.maxValue && c.paymentsPerEpoch === expected.paymentsPerEpoch &&
      c.maxValidity === expected.maxValidity && expected.payees.every((p) => c.payees.some((q) => isAddressEqual(p, q)));
  }

  async agentCommitment(registry: Address, account: Address): Promise<AgentHashes> {
    return this.commitments.get(`${registry.toLowerCase()}:${account.toLowerCase()}`) ?? { genomeHash: ZERO, strategyVersionHash: ZERO };
  }

  /** Gives `address` code, for contracts such as the x402 validator that the module checks before using. */
  deployContract(address: Address) {
    this.acct(address).deployed = true;
  }

  revoked(account: Address, permissionId: Hex, enableNonce: number) {
    const a = this.acct(account);
    const p = a.permissions.get(permissionId);
    return isRevokedOnChain({ installed: Boolean(p?.installed), validatorNonce: p?.nonce ?? 0, currentNonce: a.currentNonce, validNonceFrom: a.validNonceFrom }, enableNonce);
  }
}
