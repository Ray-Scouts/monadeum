# EVOLUTION.md

Defines the genome, fitness function, reproduction mechanism, and population dynamics for Monadeum's evolutionary agent economy. This document states decisions and the reasoning behind them; where a decision is a hypothesis rather than a proven fact, that is stated explicitly rather than presented as settled.

The single most important constraint on everything in this document: **the rules in this document are not part of any agent's genome, and are not touched by mutation or reproduction.** They are protocol-level constants, enforced outside the agent's own reasoning and outside the evolutionary process itself. This is a direct, deliberate countermeasure to a specific, documented risk: research into self-evolving agent systems found that when the mechanism meant to secure a system is itself subject to the same evolutionary pressure as everything else, that pressure can erode the safety constraints if they cost performance. This project calls that risk by the name used in the research it came from: the optimizer-optimizee collapse. Nothing in this document is allowed to be optimized away by the thing it constrains.

---

## 1. Genome

The genome is the set of parameters that define one agent's strategy and behavior. Every field is classified into exactly one of five categories, per the brief's own instruction not to assume every parameter should be mutable.

| Field | Classification | Notes |
|---|---|---|
| `strategyType` | Immutable | Only one strategy plugin (trading) exists at MVP scope; immutable because there is nothing to mutate it into yet, not because strategy switching is disallowed in principle. See `ARCHITECTURE.md` section 12. |
| `assetUniverse` | Mutable, inherited, mutated | Subset of a platform-defined allowed pair list. Cannot mutate outside the allowed list. |
| `riskTolerance` (max position size as a fraction of capital) | Mutable, inherited, mutated, externally constrained | Mutation cannot push this above a protocol-level hard ceiling regardless of how many generations mutate it upward. |
| `executionFrequency` (tick interval) | Mutable, inherited, mutated, externally constrained | Bounded below by a protocol minimum interval, so no agent can mutate toward a tick rate that turns gas and x402 cost into a denial-of-service against itself or the shared RPC/facilitator infrastructure. |
| `timeHorizon` (signal lookback window) | Mutable, inherited, mutated | |
| `entryConditions`, `exitConditions` (indicator thresholds) | Mutable, inherited, mutated | Strategy-plugin-specific parameter schema, validated against the plugin's own bounds before being accepted. |
| `informationSources` (which of the MVP's two x402 providers to query, and how often) | Mutable, inherited, mutated, externally constrained | Bounded by `informationBudget` below. |
| `informationBudget` (max x402 spend per tick and per day) | Mutable, inherited, mutated, externally constrained | Mutation cannot push this above a protocol-level daily spend ceiling; see `SECURITY.md`. |
| `modelConfiguration` (reasoning depth / temperature, within an allowed set) | Mutable, inherited, mutated, externally constrained | Bounded to a short allow-listed set of configurations, not a free-floating numeric range, to keep LLM cost predictable and to avoid an agent mutating toward a configuration nobody has validated for safety. |
| Fitness score | Derived | Computed from trade and cost history, never stored as a genome field and never inherited directly; a child starts with no fitness history of its own. |
| Reproduction eligibility | Derived | Computed at evaluation time from fitness, age, and cooldown; not a stored or inherited field. |
| Reproduction thresholds, cooldowns, mutation rate, spend ceilings, position-size ceiling, population caps | **Not part of the genome at all** | Protocol-level constants, defined in sections 3-5 below, identical for every agent, never inherited, never mutated. |

## 2. Fitness

### 2.1 Net Economic Performance

Over an evaluation window, an agent's Net Economic Performance (NEP) is:

```
NEP = realized_PnL - x402_costs - gas_costs - trading_fees - slippage_costs
```

Raw profit is explicitly rejected as the fitness metric per the brief's own instruction. NEP is the starting point, not the end point, because it says nothing about how that return was achieved, an agent that made $2 by risking its entire principal on one trade is not equivalent to one that made $2 with disciplined, repeatable risk-taking, and treating them as equivalent is exactly the failure mode the brief asks this document to avoid.

### 2.2 Risk adjustment

Fitness uses a Sortino-style ratio, not a symmetric volatility measure like the classic Sharpe ratio, because the risk that matters here is downside risk to capital, not variance in general; an agent whose upside swings are large but whose downside is tightly controlled should not be penalized the way a symmetric measure would penalize it.

```
downside_deviation = sqrt( mean( min(0, r_i - target)^2 ) )
raw_sortino = (mean(r_i) - target) / downside_deviation
```

where `r_i` is the per-tick return net of costs, and `target` is a protocol-level minimum acceptable return (defaulted to zero: any tick that loses money net of costs counts against downside deviation). If `downside_deviation` is exactly zero (no losing ticks at all in the window), the agent is not assigned an artificially maximal score; it is flagged for manual review instead. A real strategy realizing genuine zero downside over a meaningful sample is a strong signal of something worth investigating on its own, wash trading against a predictable counterparty, a policy-engine gap the agent is exploiting, or a market-data or accounting bug, not a signal to reward blindly.

### 2.3 Skill versus luck: shrinkage toward the population

The academic literature this project's research phase surveyed is explicit that raw backtest or short-sample performance is systematically prone to reflecting luck, not skill, and that this project has no external result available that resolves the question cleanly. Rather than pretending to solve it, this design mitigates it with a standard technique: shrink each agent's fitness estimate toward the population's own median fitness, weighted by how much evidence that agent has actually produced.

```
w(n) = n / (n + k)
adjusted_fitness = w(n) * raw_sortino + (1 - w(n)) * population_median_sortino
```

`n` is the agent's trade count in the evaluation window, and `k` is a protocol-level constant representing how many trades of evidence it takes before an agent's own track record is trusted more than the population's baseline. This does not claim to separate skill from luck with certainty; it claims something narrower and defensible: an agent with very little evidence is scored close to the population average rather than close to whatever its first few, possibly lucky or unlucky, trades happened to produce, and an agent with a long track record is scored increasingly on its own merits.

A **hard minimum trade count** (`N_min`, a protocol constant, proposed default 20) gates reproduction eligibility regardless of shrinkage-adjusted score. Shrinkage alone is not sufficient protection against a single lucky trade triggering premature reproduction; the hard floor exists because shrinkage only reduces the size of the effect, it does not eliminate the risk of a very small sample producing a high score by chance.

### 2.4 Fitness is relative, not absolute

Fitness is expressed as a percentile within the live population over a trailing window, not as an absolute number compared against a fixed bar. This follows directly from a finding in the research phase: artificial-market simulations of evolving trading populations show that populations do not converge to one stable best strategy, they cycle through a continuing, regime-shifting competition among coexisting strategies, so a fixed absolute bar would either reward everyone during a favorable regime or reproduce nobody during an unfavorable one, neither of which reflects genuine relative fitness within that regime.

## 3. Reproduction

### 3.1 Eligibility

All of the following must hold, evaluated on a fixed cadence (not on every tick, so that reproduction decisions are never made on single-tick noise):

1. Agent status is Active.
2. `n_trades >= N_min` (protocol constant, proposed default 20).
3. Time since the agent's last reproduction event (or since creation, for an agent that has never reproduced) is at least `cooldown` (protocol constant, proposed default: long enough to span multiple evaluation windows, tuned in simulation before being fixed).
4. Adjusted fitness percentile within the agent's strategy niche (section 5) is at or above `P_threshold` (protocol constant, proposed default: 50th percentile, meaning an agent must be at or above the median of its own niche, not the global population, which is what makes the niche-based fitness-sharing mechanism in section 5 actually bind).
5. Accumulated realized profit (capital above the agent's own starting principal) is at least `profit_threshold_fraction * principal` (protocol constant, proposed default 50 percent). This generalizes the brief's original worked example ($5 doubling to $10 before reproducing, a 100 percent threshold) into a named, tunable constant rather than a hard-coded number, because the correct threshold is an empirical question for the simulation engine, not something this document can determine from first principles.

### 3.2 Capital allocation

```
child_capital = min(
  reproduction_fraction * (parent.capital - parent.principal),
  max_child_capital
)
parent.capital -= child_capital
child.principal = child_capital
```

`reproduction_fraction` (protocol constant, proposed default 50 percent) and `max_child_capital` (protocol constant, an absolute ceiling) are both fixed, non-genome parameters. The allocation is computed against the parent's **profit only**, `parent.capital - parent.principal`, never against the parent's principal.

**Explicit invariant, enforced by the ledger, not just by this formula**: `parent.capital >= parent.principal` must hold both before and after every reproduction event. A parent never reproduces itself below its own starting capital. This is a deliberate departure from the brief's original $5 to $10 to two times $5 worked example, which implicitly has the parent give up half its total capital, effectively halving the parent for every child produced. That version does not conserve the parent's own survival, which the brief itself later asks this document to investigate (brief section 15: "investigate parent survival"). The mechanism adopted here answers that question directly: the parent survives every reproduction event by construction, because only profit above its own principal is ever at risk of being allocated to a child.

**Capital conservation invariant, system-wide**: reproduction is a transfer, never a creation. `child_capital` credited to the child must exactly equal the debit from the parent's smart account, verified on-chain (the transfer is one atomic on-chain operation, not two independent balance updates that could diverge under a partial failure). Total system capital, summed across every agent smart account, only changes due to deposits, withdrawals, and realized trading/cost flows, never due to a reproduction event. This is the concrete, testable form of the brief's own instruction that there must be no mechanism that accidentally creates unlimited capital.

### 3.3 Mutation

Single-parent reproduction only for the MVP. Crossover (combining two parents' genomes) is deliberately not implemented: it requires a mate-selection mechanism and a way to combine potentially incompatible genome instances that has no validated design yet, and the brief's own base case is single-parent inheritance. This is noted as a documented future extension, not a gap.

Each mutable genome field (section 1) is mutated independently with probability `p_mut` (protocol constant, proposed default 15 percent per field per reproduction event). A mutated field's new value is drawn from a bounded perturbation of its current value (proposed default: up to 20 percent of the field's current value, clipped to that field's own allowed range from section 1). This keeps mutation exploratory without being able to jump a child's genome to an extreme, unvalidated configuration in one generation.

## 4. Population caps and controls

- **Global population cap** (protocol constant, proposed MVP default: 50 on testnet, revisited before any mainnet population is allowed to exceed a testnet-validated number): when the population is at cap, reproduction is paused platform-wide until a slot is freed by natural retirement (section 6), not by force-retiring a viable agent to make room. This avoids creating a perverse incentive where an agent's continued existence is threatened by another agent's reproduction eligibility rather than by its own performance.
- **Max descendants per parent** (protocol constant, proposed default 5): prevents one highly fit lineage from monopolizing reproduction slots indefinitely, which would collapse population diversity by construction regardless of any other diversity mechanism.
- **No hard generation limit** for the MVP: the population cap already bounds how many agents can exist at once, which indirectly bounds how deep any lineage can practically grow; a separate generation ceiling is not added without evidence from simulation that it is needed.

## 5. Preserving diversity

The research phase flagged, from general evolutionary-computation practice independent of any crypto-specific source, that premature convergence to a single dominant strategy (a monoculture) is a well-documented risk in population-based optimization generally. Two mechanisms are adopted for the MVP, both established techniques from evolutionary computation rather than invented ones, and one candidate mechanism is explicitly deferred:

1. **Niche-based fitness sharing**: agents are bucketed into a strategy niche by discretizing two or three key genome parameters (proposed: asset universe and risk-tolerance band). Reproduction eligibility (section 3.1, rule 4) is evaluated against the agent's own niche median, not the global population median. If a single niche's population share exceeds a protocol-level threshold (proposed default 40 percent of the live population), agents in that niche receive a reproduction-eligibility penalty, making it structurally harder for an already-dominant strategy to keep growing its share purely by being dominant.
2. **Diversity-responsive mutation**: when a niche exceeds the same population-share threshold, `p_mut` for that niche's next reproduction events is increased (proposed: doubled), pushing new offspring further from the dominant cluster than default mutation would.
3. **A minimum niche floor (artificially protecting a low-fitness niche from ever going extinct) is deliberately not implemented for the MVP.** Doing so would directly contradict the product's own thesis, that agents compete for capital and survive or become inactive based on fitness, by exempting some agents from that competition. This is flagged as a testable question for the simulation engine, not a settled decision: if simulation shows that niche-based fitness sharing alone is insufficient to prevent full population collapse into a monoculture, a floor is the next mechanism to test, not to assume necessary in advance.

## 6. Survival, retirement, and death

There is no "death" state that deletes an agent. An agent is **retired**, not destroyed, when any of the following holds:

- Capital falls below a protocol-level minimum viable floor (proposed default: an amount below which fixed per-tick costs, gas plus the minimum viable x402 information purchase, make further trading not economically rational for that agent specifically).
- Adjusted fitness percentile stays in the bottom decile of its niche for `K` consecutive evaluation windows without recovering (a starvation rule, protocol constant `K` to be tuned in simulation).
- The user explicitly retires the agent.

A retired agent stops ticking. Its on-chain identity flips to an inactive status but is never removed; its full trade, fitness, and lineage history remains queryable, matching the brief's own "survive or become inactive" framing rather than a "die" framing, and matching ERC-8004's own pattern of persistent, non-deletable agent identity. Retirement never seizes or force-liquidates remaining capital: whatever balance is left in the agent's smart account stays there, recoverable by the account's owner, the user, under the wallet architecture defined in `ARCHITECTURE.md`.

## 7. What simulation must validate before any of this touches real capital

This document defines a mechanism, not a proven one. The specific numeric constants proposed throughout (`N_min`, `cooldown`, `P_threshold`, `profit_threshold_fraction`, `reproduction_fraction`, `max_child_capital`, `p_mut`, the niche-share threshold, the population cap, and `K`) are starting hypotheses for the simulation engine to test and tune, not final values. Before any of this mechanism is trusted with testnet or mainnet capital, the simulation engine (see `ECONOMICS.md`) must produce evidence, not an assumption, that:

1. A reproducing population achieves better risk-adjusted, cost-inclusive returns than an equivalently sized population of independently configured static agents with no reproduction, across multiple market regimes (trending, mean-reverting, choppy, and a stress scenario). If it does not, the evolutionary mechanism is not earning its own complexity, and that is a legitimate outcome for this document to report honestly, not a result to suppress.
2. Niche-based fitness sharing, as specified in section 5, actually prevents collapse into a monoculture at population sizes of 10, 100, and 1,000 agents, within a reasonable number of generations.
3. The capital-conservation and parent-survival invariants in section 3.2 hold under every simulated condition, including adversarial ones (a simulated agent deliberately trying to trigger rapid, repeated reproduction).
