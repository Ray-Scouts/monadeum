# Trading strategy

The plugin proposes at most one action. It buys information only when three things are true: the provider is Nansen or DeFiLlama, the price is within `informationBudget`, and `0.002 * notional` is greater than that price. `0.002` is the simulation's hypothesized information edge, not a measured alpha. If the inequality fails, the plugin may still trade, but it does not pay for the quote.

Notional is `capital * riskTolerance`, clipped to the legal band 0.01 through 0.25. That is the policy the sizing sweep found viable relative to all-in, which is not legal. `executionFrequency` below 1 tick is rejected.
