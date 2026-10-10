import type { Hex } from "viem";
import type { AgentRecord } from "./agents.js";

/** Settlement-asset reads the worker takes from the chain, never from a proposal (ARCHITECTURE.md section 16.1 Ledger). */
export interface ChainReader {
  /** The settlement asset's `decimals`, read from the token contract. */
  decimals(): Promise<number>;
  /** The account's settlement-asset balance, base units. */
  balanceOf(account: Hex): Promise<bigint>;
  /** The spend policy's `windowTotal(account)` (section 16.3), so the RiskModule and the chain use one window. */
  windowTotal(account: Hex): Promise<bigint>;
}

/** The market reading a tick observes. Every field is untrusted input until validated. */
export interface MarketReading {
  symbol: unknown;
  signal: number;
  observedAt: string;
}

/** The market data source. Returns null when it cannot be read, which fails the tick with no action. */
export interface MarketSource {
  read(agent: AgentRecord): Promise<MarketReading | null>;
}
