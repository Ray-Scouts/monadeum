export const INFO_EDGE = 0.002;
export const RISK_FLOOR = 0.01;
export const RISK_CEILING = 0.25;
/** STARTING value (hypothesis, ARCHITECTURE.md section 8.1): the most the optional Smart Money signal moves the entry edge. */
export const SMART_MONEY_WEIGHT = 0.001;

export interface Quote {
  provider: string;
  price: number;
}

export interface AgentView {
  capital: number;
  riskTolerance: number;
  executionFrequency: number;
  informationBudget: number;
  pair: string;
  ticksSinceTrade: number;
  signal: number;
  /** Optional bounded external signal in [-1, 1]. Absent or non-finite means none. It never changes `notional`. */
  smartMoney?: number;
}

export interface Action {
  kind: "trade";
  pair: string;
  side: "long" | "flat";
  notional: number;
  buyInformation: boolean;
}

const ALLOWED = new Set(["nansen", "defillama"]);

export function clipRisk(riskTolerance: number): number {
  return Math.min(RISK_CEILING, Math.max(RISK_FLOOR, riskTolerance));
}

export function propose(state: AgentView, quote: Quote | null): Action | null {
  if (state.executionFrequency < 1) throw new Error("execution frequency below 1 tick");
  if (state.ticksSinceTrade < state.executionFrequency) return null;
  const notional = Math.min(state.capital * clipRisk(state.riskTolerance), state.capital);
  if (notional <= 0) return null;
  const buyInformation = Boolean(
    quote &&
      ALLOWED.has(quote.provider) &&
      quote.price <= state.informationBudget &&
      INFO_EDGE * notional > quote.price,
  );
  const edge = buyInformation ? INFO_EDGE : 0;
  const bias = Number.isFinite(state.smartMoney) ? Math.max(-1, Math.min(1, state.smartMoney as number)) * SMART_MONEY_WEIGHT : 0;
  if (state.signal + edge + bias <= 0) return { kind: "trade", pair: state.pair, side: "flat", notional: 0, buyInformation: false };
  return { kind: "trade", pair: state.pair, side: "long", notional, buyInformation };
}
