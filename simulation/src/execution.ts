import type { CostModel, ExecutionBackend, Fill, Order, Bar } from "./types.js";

export const DEFAULT_COSTS: CostModel = {
  gasUsd: 0.001,
  x402Usd: 0.05,
  feeBps: 10,
  slippageBps: 5,
  infoPurchaseProbability: 0.3,
  infoEdge: 0.002,
};

export function createExecutionBackend(): ExecutionBackend {
  return {
    execute(order: Order, bar: Bar, costs: CostModel): Fill {
      return {
        pnl: order.notional * (bar.ret + order.edge),
        fee: (order.notional * costs.feeBps) / 10_000,
        slippage: (order.notional * costs.slippageBps) / 10_000,
        gas: costs.gasUsd,
      };
    },
  };
}
