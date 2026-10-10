import type { Hex } from "viem";

export interface Call {
  target: Hex;
  data: Hex;
}

export interface LogEntry {
  address: Hex;
  topics: Hex[];
  data: Hex;
}

/** What the signer reports once the operation is in a block. */
export interface OperationReceipt {
  /** Whether the operation's calls succeeded. An ERC-4337 operation can revert while its bundle transaction succeeds. */
  success: boolean;
  transactionHash: Hex;
  blockNumber: bigint;
  /** Native gas actually charged for the operation, in wei. */
  gasCostWei: bigint;
  logs: LogEntry[];
  revertReason: string | null;
}

export type OperationStatus =
  | { state: "absent" }
  | { state: "pending"; ref: Hex }
  | { state: "included"; ref: Hex; receipt: OperationReceipt };

/**
 * Signs and submits an execution plan from the agent's smart account. Implemented by WalletsModule (issue #24); this
 * package never holds a key.
 *
 * Contract the implementation must meet:
 * - `submit` sends every call in one operation, with native value 0, and returns the operation reference (for
 *   ERC-4337, the user operation hash). It throws `SignerRejected` only when it knows nothing was or will be included,
 *   for example a bundler simulation revert; any other throw is treated as an unknown outcome.
 * - `lookup` answers from the bundler and the chain, not from process memory, whether an operation for this tick key
 *   exists. It must find one even when `ref` is null, which is the crash-between-send-and-record case.
 *   `WalletsTradeSigner` meets this through WalletsModule's per-tick record, written before submission.
 */
export interface TradeSigner {
  submit(request: { tickKey: string; account: Hex; calls: Call[] }): Promise<{ ref: Hex }>;
  lookup(request: { tickKey: string; account: Hex; ref: Hex | null }): Promise<OperationStatus>;
}

/** A definitive rejection before inclusion. Nothing reached the chain. */
export class SignerRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SignerRejected";
  }
}

/** The order as built at plan time. Amounts are base units; prices are quote per base at the 1e18 scale. */
export interface OrderSnapshot {
  tickKey: string;
  agentId: string;
  account: Hex;
  pair: string;
  side: "buy";
  quoteIn: bigint;
  expectedBaseOut: bigint;
  minBaseOut: bigint;
  maxSlippageBps: number;
  reference: { kind: "mid" | "ask"; price: bigint };
  takerFeeBps: number;
  preparedAtBlock: bigint;
}

/** Realized costs of one trade, in settlement-asset base units. Slippage is negative on a price improvement. */
export interface TradeCosts {
  gasWei: bigint;
  gas: bigint;
  fees: bigint;
  slippage: bigint;
}

export interface Fill {
  transactionHash: Hex;
  blockNumber: bigint;
  quoteIn: bigint;
  baseOut: bigint;
  /** Base filled across the market's `Trade` events, before the taker fee. */
  grossBaseFilled: bigint;
  /** Where the fee came from: the gap between gross fill and amount received, or the market's taker fee rate. */
  feeSource: "trade-events" | "taker-fee-bps";
  feeBase: bigint;
  executedPrice: bigint;
}

/**
 * policy: the RiskModule rejected the plan, or the plan presented does not match the approved one; nothing was sent.
 * execution: the signer or the chain rejected or reverted the operation; gas may have been paid.
 * network: the signer or RPC could not be reached; the outcome is unknown until reconciled.
 */
export interface TradeFailure {
  kind: "policy" | "execution" | "network";
  reason: string;
  violations?: string[];
}

/**
 * claimed: the tick owns this trade; an operation may or may not have been sent.
 * submitted: the signer returned a reference; not yet seen in a block.
 * filled / failed: final.
 * needs-review: the chain shows something this module cannot attribute; never resubmitted automatically.
 */
export type TradeStatus = "claimed" | "submitted" | "filled" | "failed" | "needs-review";

export interface TradeRecord {
  key: string;
  order: OrderSnapshot;
  planHash: Hex;
  calls: Call[];
  status: TradeStatus;
  ref: Hex | null;
  fill: Fill | null;
  costs: TradeCosts | null;
  failure: TradeFailure | null;
}

export interface TradeStore {
  /** Inserts only if the key is absent, atomically, and reports whether it did. A durable store implements insert-if-absent. */
  claim(record: TradeRecord): boolean;
  write(record: TradeRecord): void;
  get(key: string): TradeRecord | undefined;
  findByTransaction(hash: Hex): TradeRecord | undefined;
}

export class MemoryTradeStore implements TradeStore {
  private readonly rows = new Map<string, TradeRecord>();
  claim(record: TradeRecord): boolean {
    if (this.rows.has(record.key)) return false;
    this.rows.set(record.key, record);
    return true;
  }
  write(record: TradeRecord): void {
    this.rows.set(record.key, record);
  }
  get(key: string): TradeRecord | undefined {
    return this.rows.get(key);
  }
  findByTransaction(hash: Hex): TradeRecord | undefined {
    const h = hash.toLowerCase();
    return [...this.rows.values()].find((r) => r.fill?.transactionHash.toLowerCase() === h);
  }
}
