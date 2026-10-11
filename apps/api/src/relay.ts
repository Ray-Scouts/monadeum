import { randomUUID } from "node:crypto";
import type { OwnerSigner } from "@monadeum/wallets";
import { isHex, toHex, verifyMessage, verifyTypedData, type Address, type Hex, type SignableMessage, type TypedDataDefinition } from "viem";
import { toAccount } from "viem/accounts";
import { jsonSafe } from "./json.js";

/**
 * What the owner's wallet is asked to sign. `message` is an EIP-191 personal message, which is how Kernel's ECDSA
 * validator has the owner sign a user operation hash; `typed-data` is EIP-712, used for Kernel's enable data and the
 * reallocation policy.
 */
export type SigningRequest = { kind: "message"; message: SignableMessage } | { kind: "typed-data"; typedData: TypedDataDefinition };

export type OperationKind = "deploy" | "revoke" | "policy" | "activate";
export type OperationStatus = "awaiting-signature" | "running" | "succeeded" | "failed";

/** What the client sees. `result` is the operation's own JSON-safe outcome. */
export interface OperationView {
  id: string;
  kind: OperationKind;
  agentIds: string[];
  owner: Address;
  status: OperationStatus;
  signatureRequest: ({ id: string; expiresAt: number } & SigningRequest) | null;
  result: unknown;
  error: string | null;
}

interface Pending {
  id: string;
  request: SigningRequest;
  expiresAt: number;
  resolve(signature: Hex): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface Operation {
  id: string;
  userId: string;
  kind: OperationKind;
  agentIds: string[];
  owner: Address;
  status: "running" | "succeeded" | "failed";
  pending: Pending | null;
  result: unknown;
  error: string | null;
  changed: { promise: Promise<void>; resolve(): void };
}

export type SubmitResult = { ok: true; view: OperationView } | { ok: false; reason: "not-found" | "no-pending-request" | "stale-request" | "bad-signature" };

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

const brief = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);

/**
 * Relays owner signatures for owner-signed operations without the platform ever holding an owner key (SECURITY.md
 * section 11). An operation runs a WalletsModule or policy call with a signer whose address is the owner wallet and
 * whose every signing method parks the call as a signature request. The request is returned to the client, the
 * owner's wallet signs it, the client posts the signature back, and the call continues. Each signature is verified
 * locally against the owner address before it is handed on, so a wrong signature fails here rather than at the
 * bundler. A request not answered within the timeout fails the operation closed.
 *
 * Operations live in this process's memory: the call is suspended mid-flight, so a signature must reach the same
 * API instance that started the operation (single instance or sticky routing), and a restart fails every open
 * operation. Nothing is lost by that: each operation it runs is idempotent and is started again by the client.
 */
export class SignatureRelay {
  private readonly operations = new Map<string, Operation>();

  constructor(
    private readonly timeoutMs: number,
    private readonly waitMs: number,
    private readonly now: () => number = Date.now,
    /** Finished operations stay readable this long. */
    private readonly retainMs = 10 * 60 * 1000,
  ) {}

  /**
   * Starts `work` with a relaying signer for `owner`, and returns once the operation asks for its first signature,
   * finishes, or the wait elapses. `present` turns the result into the JSON the client sees.
   */
  async start<R>(input: {
    userId: string;
    kind: OperationKind;
    agentIds: string[];
    owner: Address;
    work: (signer: OwnerSigner) => Promise<R>;
    present?: (result: R) => unknown;
  }): Promise<OperationView> {
    const op: Operation = {
      id: randomUUID(),
      userId: input.userId,
      kind: input.kind,
      agentIds: [...input.agentIds],
      owner: input.owner,
      status: "running",
      pending: null,
      result: null,
      error: null,
      changed: deferred(),
    };
    this.operations.set(op.id, op);
    const signer = this.signerFor(op);
    void (async () => {
      try {
        const result = await input.work(signer);
        op.result = jsonSafe(input.present ? input.present(result) : result);
        op.status = "succeeded";
      } catch (error) {
        op.error = brief(error);
        op.status = "failed";
      }
      this.clear(op);
      this.notify(op);
      setTimeout(() => this.operations.delete(op.id), this.retainMs).unref();
    })();
    return this.settle(op);
  }

  /** The operation, if it exists and belongs to `userId`. Another user's operation is reported as absent. */
  view(id: string, userId: string): OperationView | undefined {
    const op = this.operations.get(id);
    return op && op.userId === userId ? this.present(op) : undefined;
  }

  /** Waits for the operation's next signature request or its end, bounded by the wait. */
  async wait(id: string, userId: string): Promise<OperationView | undefined> {
    const op = this.operations.get(id);
    return op && op.userId === userId ? this.settle(op) : undefined;
  }

  /** Hands the owner's signature to the parked call after verifying it against the owner wallet. */
  async submit(input: { id: string; userId: string; requestId: string; signature: string }): Promise<SubmitResult> {
    const op = this.operations.get(input.id);
    if (!op || op.userId !== input.userId) return { ok: false, reason: "not-found" };
    const pending = op.pending;
    if (!pending) return { ok: false, reason: "no-pending-request" };
    if (pending.id !== input.requestId) return { ok: false, reason: "stale-request" };
    if (typeof input.signature !== "string" || !isHex(input.signature) || !(await this.verify(op.owner, pending.request, input.signature))) {
      return { ok: false, reason: "bad-signature" };
    }
    // The pending request may have expired while the signature was being checked.
    if (op.pending !== pending) return { ok: false, reason: "stale-request" };
    this.clear(op);
    pending.resolve(input.signature);
    this.notify(op);
    return { ok: true, view: await this.settle(op) };
  }

  private async verify(owner: Address, request: SigningRequest, signature: Hex): Promise<boolean> {
    try {
      // Recovered locally, so the owner wallet must be an EOA, as on AuthModule's wallet path.
      return request.kind === "message"
        ? await verifyMessage({ address: owner, message: request.message, signature })
        : await verifyTypedData({ ...request.typedData, address: owner, signature } as Parameters<typeof verifyTypedData>[0]);
    } catch {
      return false;
    }
  }

  private signerFor(op: Operation): OwnerSigner {
    const ask = (request: SigningRequest) => this.ask(op, request);
    const account = toAccount({
      address: op.owner,
      // A byte-array message is sent as hex, so the request is plain JSON.
      signMessage: ({ message }) => ask({ kind: "message", message: typeof message === "string" || typeof message.raw === "string" ? message : { raw: toHex(message.raw) } }),
      signTypedData: (typedData) => ask({ kind: "typed-data", typedData: typedData as TypedDataDefinition }),
      signTransaction: async () => {
        throw new Error("the owner wallet is never asked to sign a raw transaction through the API");
      },
    });
    return { address: op.owner, signer: account };
  }

  private ask(op: Operation, request: SigningRequest): Promise<Hex> {
    if (op.pending) return Promise.reject(new Error("an operation asks for one signature at a time"));
    return new Promise<Hex>((resolve, reject) => {
      const expiresAt = this.now() + this.timeoutMs;
      const timer = setTimeout(() => {
        if (op.pending?.timer !== timer) return;
        this.clear(op);
        reject(new Error("the owner did not sign in time"));
        this.notify(op);
      }, this.timeoutMs);
      timer.unref();
      op.pending = { id: randomUUID(), request, expiresAt, resolve, reject, timer };
      this.notify(op);
    });
  }

  private clear(op: Operation) {
    if (op.pending) clearTimeout(op.pending.timer);
    op.pending = null;
  }

  private notify(op: Operation) {
    const current = op.changed;
    op.changed = deferred();
    current.resolve();
  }

  private async settle(op: Operation): Promise<OperationView> {
    const deadline = this.now() + this.waitMs;
    while (op.status === "running" && !op.pending) {
      const remaining = deadline - this.now();
      if (remaining <= 0) break;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([op.changed.promise, new Promise<void>((r) => (timer = setTimeout(r, remaining)))]);
      clearTimeout(timer);
    }
    return this.present(op);
  }

  private present(op: Operation): OperationView {
    const status: OperationStatus = op.status === "running" ? (op.pending ? "awaiting-signature" : "running") : op.status;
    return {
      id: op.id,
      kind: op.kind,
      agentIds: [...op.agentIds],
      owner: op.owner,
      status,
      signatureRequest: op.pending ? (jsonSafe({ id: op.pending.id, expiresAt: op.pending.expiresAt, ...op.pending.request }) as OperationView["signatureRequest"]) : null,
      result: op.result,
      error: op.error,
    };
  }
}
