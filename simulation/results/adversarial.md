# Adversarial reproduction

Two attacks, both run through the real fitness and allocation code.

## Winning-tick book

An agent whose window is four strictly positive trade returns is flagged for zero downside and is not given an adjusted fitness. Reproduction eligibility cannot open on that flag. The small-sample trick of showing only wins does not produce a score.

## Forced eligibility

A wrapper tells the runner every agent is eligible at every evaluation, which is the adversary trying to skip the trade-count, cooldown, profit, and percentile gates. Allocation is still the real function. On seed 4, 6 agents, 120 trending ticks, costs at zero except a free information edge of 0.02, the run does reproduce. At every allocation:

- child capital is taken only from profit above principal
- parent capital after the transfer is at least principal when the parent was at least at principal
- a parent already below principal transfers nothing
- child capital plus parent capital equals the pre-transfer capital

No agent ends with more than 5 descendants. A separate call with the population already at the cap is rejected for `population_cap`. Mutation still cannot carry `k`, `N_min`, or the reproduction fraction, because those fields are not on the genome. The earlier mutation test locks the numeric bounds.

## What this means for issue #31

No invariant broke. The contract tests in issue #31 should still assert parent principal, exact capital conservation, the descendant cap, and the population cap. This run does not add a case those four do not already cover. The zero-downside flag is an off-chain fitness rule, not a new on-chain invariant. It should be tested in the fitness module, which this file does, and does not need a new contract invariant beyond the four above.
