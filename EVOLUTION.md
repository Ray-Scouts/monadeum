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
| `riskTolerance` (max position size as a fraction of capital) | Mutable, inherited, mutated, externally constrained | Mutation cannot push this above a protocol-level hard ceiling regardless of how many generations mutate it upward. Proposed default ceiling: 0.25. Proposed default floor: 0.01. Both are provisional pending the M1 simulation epic (issue #10). |
| `executionFrequency` (tick interval) | Mutable, inherited, mutated, externally constrained | Bounded below by a protocol minimum interval, so no agent can mutate toward a tick rate that turns gas and x402 cost into a denial-of-service against itself or the shared RPC/facilitator infrastructure. Proposed default range: 1 to 50 ticks. The floor of 1 is the minimum interval. The ceiling of 50 gives mutation a clip. Both are provisional pending issue #10. |
| `timeHorizon` (signal lookback window) | Mutable, inherited, mutated | |
| `entryConditions`, `exitConditions` (indicator thresholds) | Mutable, inherited, mutated | Strategy-plugin-specific parameter schema, validated against the plugin's own bounds before being accepted. |
| `informationSources` (which of the MVP's two x402 providers to query, and how often) | Mutable, inherited, mutated, externally constrained | Bounded by `informationBudget` below. |
| `informationBudget` (max x402 spend per tick and per day) | Mutable, inherited, mutated, externally constrained | Mutation cannot push this above a protocol-level daily spend ceiling; see `SECURITY.md`. The simulation harness clips this at 1 per tick so a mutation cannot remove the ceiling. That clip is a proposed default, provisional pending issue #10, not a measured product limit. |
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

where `r_i` is the per-tick return net of costs, and `target` is a protocol-level minimum acceptable return (defaulted to zero: any tick that loses money net of costs counts against downside deviation). If `downside_deviation` is exactly zero (no losing ticks at all in the window), the agent is not assigned an artificially maximal score; it is flagged for review instead. The operational workflow for that flag is in section 2.3. A real strategy realizing genuine zero downside over a meaningful sample is a strong signal of something worth investigating on its own, wash trading against a predictable counterparty, a policy-engine gap the agent is exploiting, or a market-data or accounting bug, not a signal to reward blindly.

### 2.3 Skill versus luck: shrinkage toward the population

The academic literature this project's research phase surveyed is explicit that raw backtest or short-sample performance is systematically prone to reflecting luck, not skill, and that this project has no external result available that resolves the question cleanly. Rather than pretending to solve it, this design mitigates it with a standard technique: shrink each agent's fitness estimate toward the population's own median fitness, weighted by how much evidence that agent has actually produced.

```
w(n) = n / (n + k)
adjusted_fitness = w(n) * raw_sortino + (1 - w(n)) * population_median_sortino
```

`n` is the agent's trade count in the evaluation window, and `k` is a protocol-level constant representing how many trades of evidence it takes before an agent's own track record is trusted more than the population's baseline. Proposed default: `k = 20`. At that value, `w(n)` reaches one half at the same trade count as `N_min`, so an agent is only half-trusted on its own record at the point reproduction eligibility can even be considered. The order of magnitude is tens of trades: `k = 1` would make shrinkage do almost nothing, and a `k` in the hundreds would keep almost every MVP-scale track record glued to the population median. This value is a proposed default, provisional pending the M1 simulation epic (issue #10), not a final constant.

This does not claim to separate skill from luck with certainty; it claims something narrower and defensible: an agent with very little evidence is scored close to the population average rather than close to whatever its first few, possibly lucky or unlucky, trades happened to produce, and an agent with a long track record is scored increasingly on its own merits.

**Zero downside deviation.** When section 2.2 flags an agent because `downside_deviation` is exactly zero and the window contains at least one trade, the following workflow applies. It is a proposed operating rule, provisional pending issue #10, not a claim that the right reviewer or the right pause length has been measured.

- The flag triggers on that window. It does not trigger on a window with no trades.
- A platform operator reviews the flag. The agent does not review itself, and the model does not clear its own flag.
- While the flag is set, the agent keeps trading. Reproduction eligibility is paused. The agent is not retired merely because the flag is set.
- The flag clears when an operator explicitly clears it after review, or when a later evaluation window has a downside deviation other than zero. The audit record of the flag is kept either way.
- In the simulation engine there is no operator. The flag is recorded, and reproduction eligibility stays paused until a later window has non-zero downside.

A **hard minimum trade count** (`N_min`, a protocol constant, proposed default 20) gates reproduction eligibility regardless of shrinkage-adjusted score. Shrinkage alone is not sufficient protection against a single lucky trade triggering premature reproduction; the hard floor exists because shrinkage only reduces the size of the effect, it does not eliminate the risk of a very small sample producing a high score by chance.

### 2.4 Fitness is relative, not absolute

Fitness is expressed as a percentile within the live population over a trailing window, not as an absolute number compared against a fixed bar. Proposed default window length: 100 ticks. That is several times `N_min` and still shorter than the 300-tick horizon used in `ECONOMICS.md` section 4, so a regime shift can show up inside one run and a single tick cannot dominate the percentile. This length is a proposed default, provisional pending issue #10, not a final window. This follows directly from a finding in the research phase: artificial-market simulations of evolving trading populations show that populations do not converge to one stable best strategy, they cycle through a continuing, regime-shifting competition among coexisting strategies, so a fixed absolute bar would either reward everyone during a favorable regime or reproduce nobody during an unfavorable one, neither of which reflects genuine relative fitness within that regime.

## 3. Reproduction

### 3.1 Eligibility

All of the following must hold, evaluated on a fixed cadence (not on every tick, so that reproduction decisions are never made on single-tick noise). Proposed default cadence: every 20 ticks. Proposed default `cooldown`: 40 ticks, two evaluation cadences, which is the concrete reading of "long enough to span multiple evaluation windows" until simulation tunes it. Both numbers are proposed defaults, provisional pending issue #10, not final.

1. Agent status is Active.
2. `n_trades >= N_min` (protocol constant, proposed default 20).
3. Time since the agent's last reproduction event (or since creation, for an agent that has never reproduced) is at least `cooldown` (protocol constant, proposed default: long enough to span multiple evaluation windows, tuned in simulation before being fixed).
4. Adjusted fitness percentile within the agent's strategy niche (section 5) is at or above `P_threshold` (protocol constant, proposed default: 50th percentile, meaning an agent must be at or above the median of its own niche, not the global population, which is what makes the niche-based fitness-sharing mechanism in section 5 actually bind).
5. Accumulated realized profit (capital above the agent's own starting principal) is at least `profit_threshold_fraction * principal` (protocol constant, proposed default 50 percent). This generalizes the brief's original worked example ($5 doubling to $10 before reproducing, a 100 percent threshold) into a named, tunable constant rather than a hard-coded number, because the correct threshold is an empirical question for the simulation engine, not something this document can determine from first principles. **Recommendation pending the re-run in issue #28, not a settled decision:** `simulation/results/reproduction-threshold.md` (issue #74) found zero reproductions at 0.5 at every x402 price in the researched range, and a non-zero reproduction count at 0.1 with x402 at $0.01. If the re-run of the evolving versus static comparison at 0.1 shows that evolution earns its complexity, the proposed default should move from 0.5 to 0.1. Until then the default stays 0.5, and `simulation/src/protocol.ts` is unchanged. That re-run (`simulation/results/twelve-cell-rerun.md`) was inconclusive under the `ECONOMICS.md` section 8 rule, with the evolving mean slightly below the static mean in every cell, so the recommendation is to keep 0.5 as the proposed default for now. 0.1 remains the setting at which the mechanism reproduces in this harness, and is the one to use for the next experiment, not a new default.

### 3.2 Capital allocation

```
child_capital = min(
  reproduction_fraction * (parent.capital - parent.principal),
  max_child_capital
)
parent.capital -= child_capital
child.principal = child_capital
```

`reproduction_fraction` (protocol constant, proposed default 50 percent) and `max_child_capital` (protocol constant, an absolute ceiling) are both fixed, non-genome parameters. Proposed default for `max_child_capital`: the parent's own starting principal (10 in the illustrative capital model of `ECONOMICS.md`). The ceiling exists so a single reproduction cannot move an arbitrarily large profit into one child. This number is a proposed default, provisional pending issue #10, not a final ceiling. The allocation is computed against the parent's **profit only**, `parent.capital - parent.principal`, never against the parent's principal.

**Explicit invariant, enforced by the ledger, not just by this formula**: `parent.capital >= parent.principal` must hold both before and after every reproduction event. A parent never reproduces itself below its own starting capital. This is a deliberate departure from the brief's original $5 to $10 to two times $5 worked example, which implicitly has the parent give up half its total capital, effectively halving the parent for every child produced. That version does not conserve the parent's own survival, which the brief itself later asks this document to investigate (brief section 15: "investigate parent survival"). The mechanism adopted here answers that question directly: the parent survives every reproduction event by construction, because only profit above its own principal is ever at risk of being allocated to a child.

**Capital conservation invariant, system-wide**: reproduction is a transfer, never a creation. `child_capital` credited to the child must exactly equal the debit from the parent's smart account, verified on-chain (the transfer is one atomic on-chain operation, not two independent balance updates that could diverge under a partial failure). Total system capital, summed across every agent smart account, only changes due to deposits, withdrawals, and realized trading/cost flows, never due to a reproduction event. This is the concrete, testable form of the brief's own instruction that there must be no mechanism that accidentally creates unlimited capital.

**Treasury-funded reproduction: considered and deferred.** `BRIEF.md` names treasury-funded reproduction, where a platform or population treasury pays for some or all of a child's capital, as a mechanism to investigate beside threshold-based and fitness-weighted reproduction. It was considered as an alternative to, and as a supplement for, the profit-only allocation above, and deferred for the MVP for three reasons. First, a treasury is a shared capital pool, a new custody boundary with its own governance questions (who funds it, who may spend from it, under which rule) that the per-agent account isolation in `ARCHITECTURE.md` section 6 deliberately avoids. Second, capital from outside the parent becomes a new inflow into the population. That does not break the conservation invariant, but it makes the question this mechanism must answer first, whether reproduction is self-funding, impossible to measure, because simulation could no longer separate what evolution earned from what the treasury subsidized. Third, any treasury allocation rule becomes a target in its own right, and agents would be selected for qualifying for subsidy rather than for trading well. Revisit after the profit-only mechanism is validated in simulation and on testnet, and only if the results show populations stalling for lack of reproduction capital.

**Simulation result and recommendation pending a re-run, not a settled decision (issue #82).** `simulation/results/child-capital.md` tested larger children in the harness at fully heritable skill: a reproduction fraction of 1, a minimum child capital of 1, 2.5, or 5 funded from profit, and the same minimums topped up from a treasury. No arm outperformed a static population under the `ECONOMICS.md` section 8 rule. Profit-funded minimums above 1 mostly stopped reproduction, and a treasury reduced the evolving population's shortfall without reversing it. The recommendation is to change nothing in this section on that evidence: keep `reproduction_fraction` at 0.5 and `max_child_capital` at the parent's principal as proposed defaults, keep treasury-funded reproduction deferred, and reconsider the reproduction mechanism as a whole, per `ECONOMICS.md` section 8, before issue #28. `simulation/src/protocol.ts` is unchanged.

### 3.3 Mutation

Single-parent reproduction only for the MVP. Crossover (combining two parents' genomes) is deliberately not implemented: it requires a mate-selection mechanism and a way to combine potentially incompatible genome instances that has no validated design yet, and the brief's own base case is single-parent inheritance. This is noted as a documented future extension, not a gap.

Each mutable genome field (section 1) is mutated independently with probability `p_mut` (protocol constant, proposed default 15 percent per field per reproduction event). A mutated numeric field's new value is drawn from a uniform distribution on the symmetric interval from -20 percent to +20 percent of the field's current value, added to that current value, then clipped to the field's allowed range from section 1. The draw is mean-zero: the perturbation is as likely to shrink the field as to grow it. This is a proposed default, provisional pending issue #10.

Fields that are not numeric do not use that percentage draw:

- A set-valued field (`assetUniverse`) either gains or loses exactly one element from the platform allowlist, chosen uniformly, and the result is clipped so the set is never empty and never leaves the allowlist.
- An allow-listed categorical field (`modelConfiguration`) jumps to a different value in its allowlist, chosen uniformly.

Both of those rules use the same per-field `p_mut`. They are proposed defaults, provisional pending issue #10, stated here so the simulation engine does not invent a second mutation rule for non-numeric fields.

## 4. Population caps and controls

- **Global population cap** (protocol constant, proposed MVP default: 50 on testnet, revisited before any mainnet population is allowed to exceed a testnet-validated number): when the population is at cap, reproduction is paused platform-wide until a slot is freed by natural retirement (section 6), not by force-retiring a viable agent to make room. This avoids creating a perverse incentive where an agent's continued existence is threatened by another agent's reproduction eligibility rather than by its own performance.
- **Max descendants per parent** (protocol constant, proposed default 5): prevents one highly fit lineage from monopolizing reproduction slots indefinitely, which would collapse population diversity by construction regardless of any other diversity mechanism.
- **No hard generation limit** for the MVP: the population cap already bounds how many agents can exist at once, which indirectly bounds how deep any lineage can practically grow; a separate generation ceiling is not added without evidence from simulation that it is needed.

## 5. Preserving diversity

The research phase flagged, from general evolutionary-computation practice independent of any crypto-specific source, that premature convergence to a single dominant strategy (a monoculture) is a well-documented risk in population-based optimization generally. Two mechanisms are adopted for the MVP, both established techniques from evolutionary computation rather than invented ones, and one candidate mechanism is explicitly deferred:

1. **Niche-based fitness sharing**: agents are bucketed into a strategy niche by discretizing two key genome parameters: asset universe and risk-tolerance band. Asset-universe membership is an exact-set match, not an overlap score. Exact match needs no extra similarity threshold, and two agents are in the same asset niche only when they trade the same set of pairs. Risk tolerance uses five bands over the proposed range from section 1, with cuts at 0.05, 0.10, 0.15, and 0.20: `[0.01, 0.05)`, `[0.05, 0.10)`, `[0.10, 0.15)`, `[0.15, 0.20)`, `[0.20, 0.25]`. The band count, the cuts, and the exact-set rule are proposed defaults, provisional pending issue #10. Reproduction eligibility (section 3.1, rule 4) is evaluated against the agent's own niche median, not the global population median. If a single niche's population share exceeds a protocol-level threshold (proposed default 40 percent of the live population), agents in that niche receive a reproduction-eligibility penalty: the percentile they must clear rises from the niche median (the 50th) to the 75th percentile of that niche. Both the 40 percent trigger and the 75th-percentile penalty are proposed defaults, provisional pending issue #10.
2. **Diversity-responsive mutation**: when a niche exceeds the same population-share threshold, `p_mut` for that niche's next reproduction events is increased (proposed: doubled), pushing new offspring further from the dominant cluster than default mutation would.
3. **A minimum niche floor (artificially protecting a low-fitness niche from ever going extinct) is deliberately not implemented for the MVP.** Doing so would directly contradict the product's own thesis, that agents compete for capital and survive or become inactive based on fitness, by exempting some agents from that competition. This is flagged as a testable question for the simulation engine, not a settled decision: if simulation shows that niche-based fitness sharing alone is insufficient to prevent full population collapse into a monoculture, a floor is the next mechanism to test, not to assume necessary in advance.

The first run of that question is `simulation/results/diversity.md` (seed 42, 300 ticks, populations 10, 100, and 1,000, four regimes, starting genomes spread across pair sets and the five risk bands). Reproduction count was zero in every cell, with diversity on and with it off. The profit gate and the minimum trade count never cleared, so niche sharing did not get a reproductive monoculture to stop. Active niche count stayed at the five starting niches at populations 100 and 1,000. At population 10, two regimes lost niches when diversity was off (retirement removed them) and kept five when it was on. Gini stayed near 0.08 to 0.10 either way. This run does not show that a minimum niche floor is required. It also does not show that niche sharing prevents collapse, because the collapse did not happen. The open question stays open until a setup that actually reproduces is measured. A floor is not adopted on this evidence.

## 6. Survival, retirement, and death

There is no "death" state that deletes an agent. An agent is **retired**, not destroyed, when any of the following holds:

- Capital falls below a protocol-level minimum viable floor (proposed default: 0.06, which sits just above one tick of the base-case gas cost plus one low-end x402 call from `ECONOMICS.md` section 1, the amount below which fixed per-tick costs make further trading not economically rational for that agent). This floor is a proposed default, provisional pending issue #10.
- Adjusted fitness percentile stays in the bottom decile of its niche for `K` consecutive evaluation windows without recovering (a starvation rule). Proposed default: `K = 3`. This is a proposed default, provisional pending issue #10, not a measured retirement horizon.
- The user explicitly retires the agent.

A retired agent stops ticking. Its on-chain identity flips to an inactive status but is never removed; its full trade, fitness, and lineage history remains queryable, matching the brief's own "survive or become inactive" framing rather than a "die" framing, and matching ERC-8004's own pattern of persistent, non-deletable agent identity. Retirement never seizes or force-liquidates remaining capital: whatever balance is left in the agent's smart account stays there, recoverable by the account's owner, the user, under the wallet architecture defined in `ARCHITECTURE.md`.

## 7. What simulation must validate before any of this touches real capital

This document defines a mechanism, not a proven one. The specific numeric constants proposed throughout (`k`, the trailing fitness window, the evaluation cadence, `N_min`, `cooldown`, `P_threshold`, `profit_threshold_fraction`, `reproduction_fraction`, `max_child_capital`, `p_mut`, the mutation band, the risk-tolerance ceiling and bands, the execution-frequency range, the niche-share threshold, the population cap, the capital floor, and `K`) are starting hypotheses for the simulation engine to test and tune, not final values. Before any of this mechanism is trusted with testnet or mainnet capital, the simulation engine (see `ECONOMICS.md`) must produce evidence, not an assumption, that:

1. A reproducing population achieves better risk-adjusted, cost-inclusive returns than an equivalently sized population of independently configured static agents with no reproduction, across multiple market regimes (trending, mean-reverting, choppy, and a stress scenario). If it does not, the evolutionary mechanism is not earning its own complexity, and that is a legitimate outcome for this document to report honestly, not a result to suppress.
2. Niche-based fitness sharing, as specified in section 5, actually prevents collapse into a monoculture at population sizes of 10, 100, and 1,000 agents, within a reasonable number of generations.
3. The capital-conservation and parent-survival invariants in section 3.2 hold under every simulated condition, including adversarial ones (a simulated agent deliberately trying to trigger rapid, repeated reproduction).

**Requirement to verify, not a settled fact (issue #80).** `simulation/results/heritability.md` found that, in the simulation harness, making the main driver of performance fully heritable did not make a reproducing population outperform a static one under the `ECONOMICS.md` section 8 rule, because children carry too little capital for an inherited advantage to reach the population's return. Two conditions therefore have to be shown, not assumed, before item 1 above can pass: first, that reproduction moves enough capital into children for their performance to matter at the population level (the next experiment, on `max_child_capital`, the reproduction fraction, and gas); second, that the genome actually carries a strategy's source of advantage, so that a child inherits what made its parent fit. The harness models the second condition with a hidden skill value that has no production counterpart. In production, heritable advantage can only come from genome fields (section 1), and whether any real strategy's advantage is captured by those fields is an open question.

## 8. Proposed alternative under evaluation: fixed slots with replacement and reallocation

**Status: hypothesis, not a decision.** Sections 3 and 4 remain the documented mechanism until the experiment below reports. Nothing in this section changes a protocol constant, the reproduction contract scope in issue #31, or the invariants in `THREAT-MODEL.md`.

### 8.1 Why an alternative is on the table

Four simulation runs tested the section 3 mechanism against a static population under the `ECONOMICS.md` section 8 rule: the profit threshold (issue #74), the twelve-cell re-run at a reproducing threshold (PR #79), heritable skill (issue #80), and child capital with and without a treasury (issue #82). None produced a cell where the evolving mean beat the static mean. Taken together they point to a structural reason rather than a tuning problem, stated here as a hypothesis the runs are consistent with but did not isolate:

- Every reproduction creates a new account, and every account pays a fixed per-tick cost (gas, plus x402 when it buys information). Splitting capital across more accounts therefore costs more than keeping it together.
- Children never hold enough of the population's capital to move its return, even when a treasury funds them.
- Selection already happens without reproduction: retirement removes weak agents, and the active population's mean skill rises in static runs too.
- What drives the population's return is capital-weighted skill, how much capital the better strategies control, not how many of them exist.

### 8.2 The proposal

1. **Fixed slots.** The population has a fixed number of accounts. Selection never creates a new account.
2. **Replacement.** When an agent retires under section 6, or stays in the bottom of its niche, its slot receives a mutated copy of a fit agent's genome (section 3.3 mutation, section 5 niche rules) and continues with the capital the slot already holds. Lineage is recorded as descent from the donor genome, so the lineage view in `ARCHITECTURE.md` section 15 still has a tree to show.
3. **Bounded reallocation.** At each evaluation, a capped fraction of capital moves from the lowest-fitness slots to the highest, never below a slot's capital floor and never above a per-slot ceiling. This targets capital-weighted skill directly.
4. **Paper evaluation before capital.** A mutated genome first trades on paper, off-chain and at no gas cost, for a fixed number of ticks, and takes over a slot only if its paper fitness clears a threshold.

### 8.3 Constraints this must satisfy before it can replace section 3

These are stated now so the experiment does not produce a mechanism the product cannot ship.

- **Ownership.** Each agent's account is owned by its user's embedded wallet (`ARCHITECTURE.md` section 6), and retirement never seizes capital (section 6). Reallocation can therefore move capital only between accounts with the same owner, under a policy that owner has approved. Moving capital across owners is out of scope.
- **Consent to replacement.** Adopting another agent's genome changes what an owner's agent does. Whether that happens automatically, by opt-in, or only among one owner's own agents is a product decision this section does not make. Whether a genome may be copied across owners is a separate open question.
- **Capital conservation.** Replacement moves no capital. Reallocation moves capital between existing accounts and creates none, so the invariant that reproduction cannot create capital becomes a property of a transfer rather than of an allocation formula.
- **Fewer accounts and keys.** No smart account or session key is created per descendant, which bounds the account, gas, and key-management surface in `SECURITY.md` sections 1, 2, and 11.

### 8.4 What must be true in simulation first

1. **The genome must drive performance.** In the current harness, performance comes mostly from a hidden per-agent skill value, and under the legal policy the genome fields that matter most are pinned. No selection mechanism can work under that model, including this one. The harness must first model a regime-dependent link between genome fields and returns, which is also what production would rely on. Tracked in issue #84.
2. **The comparison must be fair.** The control is not only a static population. It also includes replacement with random genomes, so the test shows that selection beats chance, not only that refilling slots helps.

The experiment, tracked in issue #85, compares four arms under the unchanged `ECONOMICS.md` section 8 decision rule: static; replacement with random genomes; replacement with mutated genomes from fit donors; and replacement plus bounded reallocation. If the last arm beats both controls, this section becomes the candidate mechanism for issue #28 and sections 3 and 4 are revised. If it does not, the honest conclusion is that evolution does not add value in this model, and the product should rest on well-calibrated static agents.

### 8.5 Result (issue #85)

**Status: candidate mechanism for issue #28, not yet a decision, narrowed by issue #89 (below).** `simulation/results/fixed-slot.md` ran the four arms on the issue #84 genome model. Under the unchanged `ECONOMICS.md` section 8 rule, arm B (replacement with mutated donors plus bounded reallocation) beats both the static control and the random-replacement control at genome edge magnitude 0.009 with a reallocation cap of 0.2, and not at magnitude 0.006 or cap 0.05. Arm A (replacement alone) is inconclusive against both. A diagnostic arm shows reallocation does most of the work. The section 3 mechanism remains inconclusive on the same model. No arm collapsed into a monoculture.

Before sections 3 and 4 are revised and issue #28 proceeds, these follow-ups were open; the first two are answered below (issue #89):

1. Test reallocation with no replacement, to decide whether replacement earns its consent and product cost.
2. Test reallocation restricted to one owner's agents, per section 8.3, since that pool is smaller than the population-wide ranking used here.
3. Establish whether real strategies' genomes carry an edge of the assumed size (section 7).
4. If the mechanism is adopted: revise sections 3 and 4, re-scope the reproduction contract in issue #31, and update the reproduction invariants in `THREAT-MODEL.md`.

**Update (issue #89): recommended candidate, not yet a decision.** `simulation/results/reallocation-scope.md` ran follow-ups 1 and 2 on the same model, seeds, policy, and rule, at magnitude 0.009 (and a subset at 0.006).

- **Reallocation with a failing slot left trading does not match arm B.** With no replacement and no retirement, population-wide reallocation is about 1.1 pp below arm B (median gap, every significant cell lower) and beats both controls only at ceiling 4. Leaving a starved slot trading costs about as much as reallocation gains: fixed slots with neither mechanism sit about 1.1 pp below the static control.
- **Reallocation with section 6 retirement matches arm B.** A diagnostic arm that replaces nothing, but retires a starved slot as a static run does (its capital stays in its own account), beats both controls in 11 and 12 of 12 cells and is indistinguishable from arm B (median gap 0.06 pp). In this model, replacement's value was stopping a failing genome, not copying a fit one. This arm was added after the first batch was read, so it is a post hoc diagnostic that should be confirmed as a pre-registered arm.
- **Owner scope holds.** Reallocation ranked and moved only within each owner's agents (owners of 3, 5, or 10 agents, and an assumed mixed distribution) beats both controls at every size when starved slots are retired or replaced, and is inconclusive against arm B. At owners of 10, where the small-pool ranking rule matches the population-wide decile, owner scope costs a median of 0.3 pp or less against population-wide ranking. Smaller owners do better only because the small-pool rule (bottom one and top one below 20 slots) moves two to three times as much capital. A test checks that no capital ever crosses an owner boundary.

The recommended candidate for issue #28 is therefore narrower than section 8.2: fixed slots, bounded reallocation within each owner's agents under a policy that owner approves, and section 6 retirement of starved agents, with no genome replacement (section 8.2 item 2) and no cross-owner genome copying, which removes the consent question in section 8.3 for this candidate. Paper evaluation (item 4) is moot without replacement. Owners with one agent get no benefit from reallocation. Follow-ups 3 and 4 remain open, and two are added:

5. Confirm reallocation with retirement as a pre-registered arm, and test letting the owner's policy reallocate a retired slot's idle capital.
6. Separate reallocation intensity from pool size: a population-wide arm whose source and sink share matches the small-pool rule.

