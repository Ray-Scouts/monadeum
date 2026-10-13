import type { ChainEvent } from "@monadeum/indexer";
import type { TradeRecord } from "@monadeum/trading";
import type { PaymentLogEntry } from "@monadeum/x402";
import type { ApiDependencies } from "./dependencies.js";
import { jsonSafe } from "./json.js";

/** How many records of each category the endpoint lists. The `count` beside each list is the full number in the store. */
export const EVIDENCE_LIMIT = 50;

/**
 * The public evidence document (ARCHITECTURE.md section 10, "Public evidence endpoint"). Every record has a chain
 * reference, and every field is an address, a hash, a block number, or an amount. Nothing here identifies a user:
 * agents appear only by their public account address, and a trade or payment is keyed by neither agent ID nor tick key.
 */
export interface EvidenceEvent {
  account: string;
  contract: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: number;
}

export interface EvidenceCategory<T> {
  /** Records of this kind in the store, all of which carry a transaction hash. */
  count: number;
  /** The latest records, newest first, at most `EVIDENCE_LIMIT`. */
  items: T[];
}

export interface EvidenceTrade {
  account: string;
  transactionHash: string;
  blockNumber: string;
  pair: string;
  side: "buy" | "sell";
  /** Base units of the traded asset: received by a buy, sold by a sell. */
  baseAmount: string;
  /** Settlement-asset base units: paid by a buy, received by a sell. */
  quoteAmount: string;
  /** Executed price, quote per base at the 1e18 scale. */
  executedPrice: string;
  /** Fee as the store recorded it, in the asset it is charged in. */
  fee: { asset: "base" | "quote"; amount: string; source: string };
  /** Costs in settlement-asset base units, and the native gas in wei. */
  costs: { gasWei: string; gas: string; fees: string; slippage: string } | null;
  /** The realized P&L the position store settled for this trade, settlement-asset base units; null when the position store has none for it. */
  realizedPnl: string | null;
}

export interface EvidencePayment {
  provider: string;
  /** Settlement-asset base units. */
  price: string;
  /** The settlement transaction hash the provider's response carried. */
  settlementTransaction: string;
  /** `anomaly` when the payment log recorded a reconciliation problem, else `settled`. The page re-checks the transaction on chain either way. */
  reconciliation: "settled" | "anomaly";
  anomaly: string | null;
}

export interface Evidence {
  generatedAt: string;
  chainId: number;
  /** The block the read-model had synced to, or null before it started. */
  indexedThrough: string | null;
  events: {
    deployed: EvidenceCategory<EvidenceEvent & { factory: string; paymaster: string; userOpHash: string }>;
    limitsSet: EvidenceCategory<EvidenceEvent & { perTxCap: string; dailyCap: string }>;
    callAllowed: EvidenceCategory<EvidenceEvent & { target: string; selector: string; allowed: boolean }>;
    spent: EvidenceCategory<EvidenceEvent & { amount: string; windowTotal: string }>;
  };
  trades: EvidenceCategory<EvidenceTrade>;
  payments: EvidenceCategory<EvidencePayment>;
}

const newestFirst = (rows: ChainEvent[]) => [...rows].reverse();
const str = (v: unknown) => String(v);

function base(e: ChainEvent): EvidenceEvent {
  return { account: str(e.account ?? ""), contract: e.address, transactionHash: e.transactionHash, blockNumber: e.blockNumber.toString(), logIndex: e.logIndex };
}

async function category<T>(deps: ApiDependencies, kind: string, project: (e: ChainEvent) => T): Promise<EvidenceCategory<T>> {
  const rows = await deps.readModel.events({ kind });
  return { count: rows.length, items: newestFirst(rows).slice(0, EVIDENCE_LIMIT).map(project) };
}

function tradeOf(record: TradeRecord, realized: bigint | undefined): EvidenceTrade | null {
  const { fill, order } = record;
  if (!fill || record.status !== "filled") return null;
  const sell = fill.side === "sell";
  return {
    account: order.account,
    transactionHash: fill.transactionHash,
    blockNumber: fill.blockNumber.toString(),
    pair: order.pair,
    side: sell ? "sell" : "buy",
    baseAmount: (sell ? fill.baseIn : fill.baseOut).toString(),
    quoteAmount: (sell ? fill.quoteOut : fill.quoteIn).toString(),
    executedPrice: fill.executedPrice.toString(),
    fee: sell ? { asset: "quote", amount: fill.feeQuote.toString(), source: fill.feeSource } : { asset: "base", amount: fill.feeBase.toString(), source: fill.feeSource },
    costs: record.costs ? { gasWei: record.costs.gasWei.toString(), gas: record.costs.gas.toString(), fees: record.costs.fees.toString(), slippage: record.costs.slippage.toString() } : null,
    realizedPnl: realized === undefined ? null : realized.toString(),
  };
}

function paymentOf(entry: PaymentLogEntry): EvidencePayment {
  return {
    provider: entry.provider,
    price: entry.price.toString(),
    settlementTransaction: entry.settlementRef ?? "",
    reconciliation: entry.anomaly ? "anomaly" : "settled",
    anomaly: entry.anomaly,
  };
}

/** Builds the public evidence document from the read-only stores. */
export async function buildEvidence(deps: ApiDependencies): Promise<Evidence> {
  const [deployed, limitsSet, callAllowed, spent, cursor, filledTotal, filled, settled] = await Promise.all([
    category(deps, "account.deployed", (e) => ({ ...base(e), factory: str(e.data.factory), paymaster: str(e.data.paymaster), userOpHash: str(e.data.userOpHash) })),
    category(deps, "spend.limits-set", (e) => ({ ...base(e), perTxCap: str(e.data.perTxCap), dailyCap: str(e.data.dailyCap) })),
    category(deps, "spend.call-allowed", (e) => ({ ...base(e), target: str(e.data.target), selector: str(e.data.selector), allowed: e.data.allowed === true })),
    category(deps, "spend.spent", (e) => ({ ...base(e), amount: str(e.data.amount), windowTotal: str(e.data.windowTotal) })),
    deps.readModel.cursor(),
    deps.trades.filledTotal(),
    deps.trades.filledRecords(EVIDENCE_LIMIT),
    deps.payments.settled(EVIDENCE_LIMIT),
  ]);
  const positions = new Map<string, Awaited<ReturnType<ApiDependencies["positions"]["get"]>>>();
  for (const r of filled) if (!positions.has(r.order.agentId)) positions.set(r.order.agentId, await deps.positions.get(r.order.agentId));
  const trades = filled.flatMap((r) => tradeOf(r, positions.get(r.order.agentId)?.applied[r.key]) ?? []);
  return jsonSafe({
    generatedAt: new Date(deps.now()).toISOString(),
    chainId: deps.settings.chainId,
    indexedThrough: cursor ? cursor.number.toString() : null,
    events: { deployed, limitsSet, callAllowed, spent },
    trades: { count: filledTotal, items: trades },
    payments: { count: settled.count, items: settled.entries.map(paymentOf) },
  }) as Evidence;
}
