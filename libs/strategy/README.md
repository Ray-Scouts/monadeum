# Trading strategy

The plugin proposes at most one action. It buys information only when three things are true: the provider is Nansen or DeFiLlama, the price is within `informationBudget`, and `0.002 * notional` is greater than that price. `0.002` is the simulation's hypothesized information edge, not a measured alpha. If the inequality fails, the plugin may still trade, but it does not pay for the quote.

When the signal plus any purchased information's edge is not positive, the plugin proposes `flat`. That is the exit decision: the worker closes an open position on `flat`, and treats it as no action when nothing is open. No exit-specific genome field exists (`EVOLUTION.md` section 1).

Notional is `capital * riskTolerance`, clipped to the legal band 0.01 through 0.25. That is the policy the sizing sweep found viable relative to all-in, which is not legal. `executionFrequency` below 1 tick is rejected.

## Strategy version

`STRATEGY_VERSION` (`src/version.ts`, exported as `@monadeum/strategy/version`) is the strategy-version document of `ARCHITECTURE.md` section 16.4, rule 7, that every agent account commits on chain when it is deployed (section 9). `codeDigest` is the SHA-256 of the exact bytes of `src/propose.ts`, and `test/version.test.ts` fails when the file and the digest disagree. Changing `src/propose.ts` therefore means setting the new digest and raising `version`, and every live agent committed under the old version stops ticking once the worker verifies commitments.
