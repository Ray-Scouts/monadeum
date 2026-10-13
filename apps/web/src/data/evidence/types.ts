// The public evidence document as `GET /public/evidence` serves it (apps/api/src/evidence.ts, ARCHITECTURE.md section
// 10). Amounts are decimal strings in base units. Nothing here is trusted until the browser has re-read it from the chain.

export interface EvidenceEvent {
  account: string;
  contract: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: number;
}

export interface EvidenceCategory<T> {
  count: number;
  items: T[];
}

export interface EvidenceTrade {
  account: string;
  transactionHash: string;
  blockNumber: string;
  pair: string;
  side: "buy" | "sell";
  baseAmount: string;
  quoteAmount: string;
  executedPrice: string;
  fee: { asset: "base" | "quote"; amount: string; source: string };
  costs: { gasWei: string; gas: string; fees: string; slippage: string } | null;
  realizedPnl: string | null;
}

export interface EvidencePayment {
  provider: string;
  price: string;
  settlementTransaction: string;
  reconciliation: "settled" | "anomaly";
  anomaly: string | null;
}

export interface Evidence {
  generatedAt: string;
  chainId: number;
  indexedThrough: string | null;
  events: {
    deployed: EvidenceCategory<EvidenceEvent & { factory: string; paymaster: string; userOpHash: string }>;
    limitsSet: EvidenceCategory<EvidenceEvent & { perTxCap: string; dailyCap: string }>;
    callAllowed: EvidenceCategory<EvidenceEvent & { target: string; selector: string; allowed: boolean }>;
    spent: EvidenceCategory<EvidenceEvent & { amount: string; windowTotal: string }>;
  };
  reallocations: {
    moved: EvidenceCategory<EvidenceEvent & { sink: string; amount: string; evaluation: string }>;
    retired: EvidenceCategory<EvidenceEvent>;
    evaluationsAdvanced: EvidenceCategory<EvidenceEvent & { evaluation: string }>;
  };
  trades: EvidenceCategory<EvidenceTrade>;
  payments: EvidenceCategory<EvidencePayment>;
}

/**
 * The outcome of re-checking a record on the chain. `checking` is the state before the check has finished and is
 * never shown as verified. Only `verified` is green; every failure, including an unreachable RPC, is `unverified`.
 */
export type Verification =
  | { state: "checking" }
  | { state: "verified"; detail: string; chain?: { blockNumber: string; from: string; to: string | null } }
  | { state: "unverified"; reason: string };

export const CHECKING: Verification = { state: "checking" };
