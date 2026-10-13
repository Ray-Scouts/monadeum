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

/** What every order records, whichever side. Amounts are base units; prices are quote per base at the 1e18 scale. */
interface OrderCommon {
  tickKey: string;
  agentId: string;
  account: Hex;
  pair: string;
  maxSlippageBps: number;
  /** What slippage and the position's basis are measured against: the mid, else the side of the book this order takes. */
  reference: { kind: "mid" | "ask" | "bid"; price: bigint };
  /**
   * Quote per MON at the 1e18 scale that this order's gas converts at, and where it came from: "market" when the base
   * is native MON (the reference itself), else the MON price source. Absent on records written before it existed,
   * which were all on a native-MON market, so the reference stands in.
   */
  monPrice?: { price: bigint; source: string };
  takerFeeBps: number;
  preparedAtBlock: bigint;
}

/** A buy as built at plan time: spend exactly `quoteIn` of the settlement asset for at least `minBaseOut`. */
export interface BuyOrder extends OrderCommon {
  side: "buy";
  quoteIn: bigint;
  expectedBaseOut: bigint;
  minBaseOut: bigint;
}

/** A close as built at plan time: sell exactly `baseIn`, the whole open position, for at least `minQuoteOut`. */
export interface SellOrder extends OrderCommon {
  side: "sell";
  baseIn: bigint;
  expectedQuoteOut: bigint;
  minQuoteOut: bigint;
}

export type OrderSnapshot = BuyOrder | SellOrder;

/** Realized costs of one trade, in settlement-asset base units. Slippage is negative on a price improvement. */
export interface TradeCosts {
  gasWei: bigint;
  gas: bigint;
  fees: bigint;
  slippage: bigint;
}

/** A buy's fill. `side` is optional so that a record written before sells existed still reads as a buy. */
export interface BuyFill {
  side?: "buy";
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
 * A sell's fill. The fee is the market's taker fee rate applied to the quote received, on the hypothesis that Kuru
 * charges a sell's fee in the asset received, as it does for a buy. That has not been observed on a receipt; the
 * measured taker fee is 0 bps (ECONOMICS.md section 1), so the hypothesis changes nothing until a fee is charged.
 */
export interface SellFill {
  side: "sell";
  transactionHash: Hex;
  blockNumber: bigint;
  baseIn: bigint;
  quoteOut: bigint;
  /** Quote received plus the fee. */
  grossQuoteOut: bigint;
  feeSource: "taker-fee-bps";
  feeQuote: bigint;
  executedPrice: bigint;
}

export type Fill = BuyFill | SellFill;

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

/**
 * Durable trade store. `claim` inserts only if the key is absent, atomically, and reports whether it did; `write`
 * replaces the record under its key. A write must be durable before it resolves. `findByTransaction` matches the
 * fill's transaction hash case-insensitively and returns the earliest-claimed match. `@monadeum/db` provides the
 * Postgres implementation.
 */
export interface TradeStore {
  claim(record: TradeRecord): Promise<boolean>;
  write(record: TradeRecord): Promise<void>;
  get(key: string): Promise<TradeRecord | undefined>;
  findByTransaction(hash: Hex): Promise<TradeRecord | undefined>;
}

/**
 * Read side of the trade store, for the API. A trade is counted once its record is `filled`: an operation the chain
 * included and this module attributed. A policy rejection, a blocked close, a failed or reverted operation, and a
 * record still in flight or under review are not trades and are not counted. The agent is the order's `agentId`.
 */
export interface TradeCounts {
  /** Filled trades of each agent in `agentIds`; an agent with none maps to 0. */
  filledByAgent(agentIds: readonly string[]): Promise<Map<string, number>>;
  /** Filled trades across every agent. */
  filledTotal(): Promise<number>;
  /**
   * The summed costs of every trade of each agent in `agentIds` that carries costs, a reverted one included (it still
   * paid gas): the same entries `toCostedFill` hands FitnessModule. An agent with none maps to zeros.
   */
  costsByAgent(agentIds: readonly string[]): Promise<Map<string, TradeCosts>>;
}

/** Sums trade costs field by field. */
export function sumCosts(costs: Iterable<TradeCosts>): TradeCosts {
  const total: TradeCosts = { gasWei: 0n, gas: 0n, fees: 0n, slippage: 0n };
  for (const c of costs) {
    total.gasWei += c.gasWei;
    total.gas += c.gas;
    total.fees += c.fees;
    total.slippage += c.slippage;
  }
  return total;
}

/** Cumulative realized P&L per agent, read from the positions (base units, signed). */
export interface RealizedPnl {
  /** Realized P&L of each agent in `agentIds`; an agent with no position maps to 0. */
  realizedByAgent(agentIds: readonly string[]): Promise<Map<string, bigint>>;
}

/** In-memory store for tests and local development only. */
export class MemoryTradeStore implements TradeStore, TradeCounts {
  private readonly rows = new Map<string, TradeRecord>();
  async claim(record: TradeRecord): Promise<boolean> {
    if (this.rows.has(record.key)) return false;
    this.rows.set(record.key, record);
    return true;
  }
  async write(record: TradeRecord): Promise<void> {
    this.rows.set(record.key, record);
  }
  async get(key: string): Promise<TradeRecord | undefined> {
    return this.rows.get(key);
  }
  async findByTransaction(hash: Hex): Promise<TradeRecord | undefined> {
    const h = hash.toLowerCase();
    return [...this.rows.values()].find((r) => r.fill?.transactionHash.toLowerCase() === h);
  }
  async filledByAgent(agentIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map(agentIds.map((id) => [id, 0]));
    for (const r of this.rows.values()) {
      const n = counts.get(r.order.agentId);
      if (r.status === "filled" && n !== undefined) counts.set(r.order.agentId, n + 1);
    }
    return counts;
  }
  async filledTotal(): Promise<number> {
    return [...this.rows.values()].filter((r) => r.status === "filled").length;
  }
  async costsByAgent(agentIds: readonly string[]): Promise<Map<string, TradeCosts>> {
    const rows = [...this.rows.values()];
    return new Map(agentIds.map((id) => [id, sumCosts(rows.filter((r) => r.order.agentId === id && r.costs).map((r) => r.costs!))]));
  }
}

/**
 * One agent's open position on the service's market. Money is settlement-asset base units; size is base units.
 *
 * `basis` is the open size valued at the reference price captured when each buy was planned, not at the price paid.
 * The gap between the two is that buy's fee and slippage, which FitnessModule already counts as costs, so carrying it
 * in the basis as well would count it twice. Realized P&L is therefore market P&L between reference prices, and
 * realized P&L minus every trade's gas, fees, and slippage equals the settlement asset received minus that paid.
 *
 * `closing` is the tick key of a close that may still be in flight. While it is set, no other close is built, so a
 * crash or an unknown outcome mid-close cannot sell the same position twice.
 *
 * `applied` maps each trade key already settled into the position to the realized P&L it produced, so settling a
 * trade again, after a crash or from a second caller, changes nothing and returns the same figure.
 */
export interface Position {
  agentId: string;
  pair: string;
  size: bigint;
  basis: bigint;
  realized: bigint;
  closing: string | null;
  applied: Record<string, bigint>;
}

/**
 * Durable position store. A write must be durable before it resolves. Writes for one agent are serialized by the
 * worker, which runs one tick of an agent at a time; a store written concurrently for one agent would need a
 * compare-and-set on top. Only the in-memory implementation exists so far.
 */
export interface PositionStore {
  get(agentId: string): Promise<Position | undefined>;
  write(position: Position): Promise<void>;
}

/** In-memory store for tests and local development only. */
export class MemoryPositionStore implements PositionStore, RealizedPnl {
  private readonly rows = new Map<string, Position>();
  async get(agentId: string): Promise<Position | undefined> {
    const p = this.rows.get(agentId);
    return p ? structuredClone(p) : undefined;
  }
  async write(position: Position): Promise<void> {
    this.rows.set(position.agentId, structuredClone(position));
  }
  async realizedByAgent(agentIds: readonly string[]): Promise<Map<string, bigint>> {
    return new Map(agentIds.map((id) => [id, this.rows.get(id)?.realized ?? 0n]));
  }
}
