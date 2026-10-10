import type { AllowedCall } from "@monadeum/risk";
import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  PaymasterUnavailableError,
  SubmissionRejectedError,
  type OperationLog,
  type OperationReceipt,
  type OwnerSigner,
  type PermissionState,
  type PreparedOperation,
  type SessionApproval,
  type SpendLimits,
  type WalletsChain,
} from "./chain.js";
import type { Call } from "./scope.js";
import { isRevokedOnChain } from "./wallets.service.js";

// Test double, exported as `@monadeum/wallets/testing` so other packages can test against WalletsService without a
// chain. Never use it outside tests: it holds no key and enforces nothing.
//
// In-memory model of the account, the Kernel nonce rules the module depends on, the bundler, and the paymaster.
// It encodes the behavior verified in Kernel v3.1 (ValidationManager.sol, Kernel.sol): a validator installed below
// validNonceFrom is rejected, and an enable signature is bound to currentNonce.

const CONFIGURE = "0xc0f16000";
const REVOKE = "0x5e7ef000";

interface Account {
  deployed: boolean;
  limits: SpendLimits | null;
  allowed: Set<string>;
  balance: bigint;
  currentNonce: number;
  validNonceFrom: number;
  permissions: Map<Hex, { installed: boolean; nonce: number }>;
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
      a = { deployed: false, limits: null, allowed: new Set(), balance: 0n, currentNonce: 1, validNonceFrom: 0, permissions: new Map(), sessionNonce: 0n };
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
      scope.every((c) => a.allowed.has(`${c.target.toLowerCase()}:${c.selector}`));
  }
  configurationCalls(scope: readonly AllowedCall[], limits: SpendLimits): Call[] {
    const payload = JSON.stringify({ limits: [limits.perTxCap.toString(), limits.dailyCap.toString()], scope: scope.map((c) => `${c.target.toLowerCase()}:${c.selector}`) });
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
          for (const entry of parsed.scope) a.allowed.add(entry);
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

  revoked(account: Address, permissionId: Hex, enableNonce: number) {
    const a = this.acct(account);
    const p = a.permissions.get(permissionId);
    return isRevokedOnChain({ installed: Boolean(p?.installed), validatorNonce: p?.nonce ?? 0, currentNonce: a.currentNonce, validNonceFrom: a.validNonceFrom }, enableNonce);
  }
}
