# EVOLUTION.md

Defines the genome, fitness function, selection mechanism (owner-scoped reallocation and retirement, section 3), and population dynamics for Monadeum's evolutionary agent economy. This document states decisions and the reasoning behind them; where a decision is a hypothesis rather than a proven fact, that is stated explicitly rather than presented as settled.

The single most important constraint on everything in this document: **the rules in this document are not part of any agent's genome, and are not touched by mutation, reproduction, reallocation, or any owner's or agent's own proposal.** They are protocol-level constants, enforced outside the agent's own reasoning and outside the evolutionary process itself. This is a direct, deliberate countermeasure to a specific, documented risk: research into self-evolving agent systems found that when the mechanism meant to secure a system is itself subject to the same evolutionary pressure as everything else, that pressure can erode the safety constraints if they cost performance. This project calls that risk by the name used in the research it came from: the optimizer-optimizee collapse. Nothing in this document is allowed to be optimized away by the thing it constrains.

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
| Fitness score | Derived | Computed from trade and cost history, never stored as a genome field and never inherited directly. |
| Reallocation rank (source, sink, or neither) | Derived | Computed at each evaluation from adjusted fitness within the owner's pool (section 3.1); not a stored or inherited field. Replaces reproduction eligibility, which belonged to the superseded mechanism (section 3.6). |
| Reallocation cap, slot ceiling, evaluation cadence, mutation rate and band, spend ceilings, position-size ceiling, capital floor, population caps | **Not part of the genome at all** | Protocol-level constants, defined in sections 3-6 below, identical for every agent, never inherited, never mutated. An owner's reallocation policy can tighten the reallocation bounds for that owner's agents, never loosen them (section 3.1, item 8). |

**Inheritance and mutation under the adopted mechanism.** The adopted mechanism (section 3) never copies or mutates a genome: each agent's genome is fixed at creation by its owner. The "inherited, mutated" classifications above describe what the superseded reproduction mechanism did (section 3.6) and what the simulation still exercises as a reference. The "externally constrained" bounds apply to every genome an owner creates.

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
- While the flag is set, the agent keeps trading. It cannot receive capital through reallocation (section 3.1, item 9). The agent is not retired merely because the flag is set.
- The flag clears when an operator explicitly clears it after review, or when a later evaluation window has a downside deviation other than zero. The audit record of the flag is kept either way.
- In the simulation engine there is no operator. The flag is recorded, and reproduction eligibility (the section 3.6 reference arm) stays paused until a later window has non-zero downside. The reallocation arms did not apply the flag, so the sink exclusion in section 3.1 is untested.

A **hard minimum trade count** (`N_min`, a protocol constant, proposed default 20) gated reproduction eligibility under the superseded mechanism (section 3.6.1), because shrinkage only reduces the effect of a lucky small sample, it does not eliminate it. The adopted mechanism ranks on shrinkage-adjusted fitness without that hard floor, as the confirmation run did; the reallocation cap and the slot ceiling bound what a lucky sample can attract. Whether a minimum trade count should also gate receiving capital is an open hypothesis, not tested.

### 2.4 Fitness is relative, not absolute

Fitness is expressed as a percentile within the live population over a trailing window, not as an absolute number compared against a fixed bar. Proposed default window length: 100 ticks. That is several times `N_min` and still shorter than the 300-tick horizon used in `ECONOMICS.md` section 4, so a regime shift can show up inside one run and a single tick cannot dominate the percentile. This length is a proposed default, provisional pending issue #10, not a final window. This follows directly from a finding in the research phase: artificial-market simulations of evolving trading populations show that populations do not converge to one stable best strategy, they cycle through a continuing, regime-shifting competition among coexisting strategies, so a fixed absolute bar would either reward everyone during a favorable regime or reproduce nobody during an unfavorable one, neither of which reflects genuine relative fitness within that regime.

## 3. Selection: owner-scoped reallocation and retirement

**Status: adopted as the documented mechanism (issue #28, follow-up 4 of section 8.5).** This section replaces the threshold reproduction mechanism that sections 3 and 4 previously specified. That mechanism is kept in section 3.6 as a superseded record, with the reason it was superseded. The decision rests on simulation evidence only (section 3.5). It is adopted as the design, not as a claim about production returns: the mechanism converts a genome edge into population return, it does not create one, and whether real strategies' genomes carry an edge of the size the simulation assumed is still unverified (section 7). Issue #28's implementation stays gated on that question.

### 3.1 The mechanism

1. **Fixed slots.** The mechanism never creates, copies, or deletes an agent account. The set of agents changes only when an owner creates an agent, or when an agent retires under section 6. There are no children, no lineages, and no generations.
2. **Fixed genome per agent.** An agent's genome is set when its owner creates it and is not changed afterwards, by the protocol or by the owner, for the MVP. An owner who wants a different strategy creates a new agent. This keeps every fitness history attributable to exactly one committed genome (`ARCHITECTURE.md` section 9). Revisiting owner edits to a live genome is a later decision, not a gap.
3. **Evaluation cadence.** Ranking, reallocation, and the starvation check run on a fixed cadence, never on every tick. Proposed default: every 20 ticks, the same cadence the simulation used.
4. **Ranking pool.** For each owner, the pool is that owner's Active agents that have an adjusted fitness (section 2) and are covered by that owner's reallocation policy (item 8), ordered by adjusted fitness. Fitness, shrinkage, niches, and the starvation trigger are computed population-wide from public performance, as in the simulation. Only the moves are owner-scoped.
5. **Sources and sinks (small-pool rule).** In a pool of `n` agents: none when `n < 2`; the bottom one and the top one when `2 <= n <= 19`; the bottom and top `floor(n / 10)` (deciles) when `n >= 20`. The two rules agree from 10 ranked agents up.
6. **Amounts.** Each source offers a capped share of its capital, never going below the capital floor. Each sink takes up to a ceiling on its capital. The amount moved is the smaller of the total offer and the total room; sources give in proportion to their offers and sinks receive in proportion to their room:

   ```
   offer_i = max(0, min(reallocation_cap * source_i.capital, source_i.capital - capital_floor))
   room_j  = max(0, slot_ceiling * sink_j.principal - sink_j.capital)
   moved   = min(sum(offer), sum(room))
   debit_i  = offer_i * moved / sum(offer)
   credit_j = room_j  * moved / sum(room)
   ```

   `reallocation_cap` (proposed default 0.2) and `slot_ceiling` (proposed default 4) are protocol constants, outside the genome, and are the values the confirmation run tested. `capital_floor` is the section 6 floor. `principal` is the capital the owner has put into that agent: the owner's deposits to it minus the owner's withdrawals from it. Reallocation flows never change it, so receiving capital does not raise an agent's own ceiling. The simulation had no deposits or withdrawals after creation, so this definition beyond starting capital is a design decision the simulation did not test.
7. **Retirement.** Section 6 applies unchanged. A starved agent (bottom decile of its niche for `K` consecutive windows) or one below the capital floor retires. Its capital stays in its own account, recoverable by its owner, and is never moved by the mechanism. A retired agent is never a source or a sink.
8. **Owner-approved policy.** Reallocation is off by default. It runs among an owner's agents only while that owner has a reallocation policy in force, signed by the owner's root wallet. The policy names which of the owner's agents take part (at least two, or nothing moves) and may tighten, never loosen, the protocol bounds: a lower `reallocation_cap`, a lower `slot_ceiling`, never a higher one, and never a lower capital floor. The owner can revoke the policy at any time; from the next evaluation nothing moves. The policy is a protocol-bounded setting, not part of any genome, and no agent can propose a change to it.
9. **Zero-downside flag.** An agent flagged under section 2.3 cannot be a sink while the flag is set. This replaces the previous "reproduction eligibility is paused" rule. It is a conservative addition the simulation did not exercise; it can only reduce the capital moved.

No capital crosses an owner boundary, and no genome is copied, within an owner or across owners.

### 3.2 What is deliberately not part of the mechanism

- **Genome replacement** (section 8.2 item 2) and **cross-owner genome copying.** In the simulation, replacement's value came from stopping a failing genome, which retirement also does, without copying anyone's genome or changing what an owner's agent does without consent (sections 8.3 and 8.5).
- **Mutation of live agents and paper evaluation** (section 8.2 item 4). Without replacement there is nothing to mutate or evaluate.
- **Recycling a retired agent's idle capital** into the same owner's best active agent. The exploratory arm in issue #92 added a median 1.23 pp at magnitude 0.009 and 0.55 pp at 0.006, consistent in direction but not significant under the `ECONOMICS.md` section 8 rule. It stays a hypothesis. An owner can always withdraw a retired agent's capital and fund another agent by hand.
- **Higher reallocation intensity** than the small-pool rule. The exploratory arms moved more capital and earned more in this model, and also lowered niche diversity (section 5). That is a hypothesis to test, with a regime change inside the run, before it is adopted.
- **Treasury funding.** Deferred for the reasons recorded in section 3.6.2; nothing in the adopted mechanism needs a shared capital pool.

### 3.3 Capital accounting

- **Conservation.** Reallocation is a transfer between two existing agent accounts with the same owner, one atomic on-chain operation per move. It creates no capital and destroys none. Total system capital changes only through deposits, withdrawals, and realized trading and cost flows.
- **Owner boundary.** Source and sink must have the same owner, checked on-chain when the transfer executes, not only off-chain when it is planned. An owner's total capital across their agents is unchanged by any reallocation.
- **Bounds per evaluation.** A source loses at most `reallocation_cap` of its capital in one evaluation and never goes below the capital floor. A sink never rises above `slot_ceiling` times its principal through reallocation.
- **Principal is not protected per agent.** Unlike the superseded mechanism, a source can fall below its own principal, because reallocation moves an owner's own capital between that owner's agents, under a policy that owner approved. What is protected is the owner's total (conservation and the owner boundary) and each agent's floor. This is the property the owner consents to when enabling the policy, and the product must state it in those terms.
- **Ranking is off-chain, bounds are on-chain.** The ranking that picks sources and sinks is computed from off-chain fitness data. The on-chain contract cannot verify it, so it enforces what it can: same owner, policy in force, cap, floor, ceiling, and at most one move set per source per evaluation. A corrupted ranking can therefore misallocate capital only inside one owner's agents, within those bounds.

### 3.4 What this mechanism is, stated plainly

This is selection on capital without variation. The set of genomes changes only when owners create agents; the protocol only shifts each owner's capital toward that owner's better-ranked agents and stops agents that keep failing. It pays off only if fitness rank persists, that is, if an agent ranked high at one evaluation tends to earn more over the next window, which in production requires a genome that carries a real, persistent edge. If no such edge exists, reallocation moves capital on noise, and the honest product is a well-calibrated static agent (section 8.4). Owners with one agent get no benefit from reallocation.

### 3.5 Evidence

All of it is simulation, on the experiment-only genome model of issue #84, in which genome fields carry an assumed regime-dependent edge of magnitude 0.006 or 0.009 (`ECONOMICS.md` section 3). Under the unchanged `ECONOMICS.md` section 8 rule:

- **Issue #85** (`simulation/results/fixed-slot.md`): fixed slots with replacement plus bounded reallocation beat a static population and random replacement at magnitude 0.009 with cap 0.2, not at cap 0.05; reallocation did most of the work.
- **Issue #89** (`simulation/results/reallocation-scope.md`): reallocation with section 6 retirement and no replacement matched replacement (median gap 0.06 pp), passed at both magnitudes, and held when restricted to each owner's agents. That arm was chosen after results were read.
- **Issue #92** (`simulation/results/owner-reallocation-confirmation.md`): a pre-registered, out-of-sample confirmation on seeds 51 to 100, with the exact parameters in section 3.1 at an assumed mixed owner distribution. It beat the static control at 0.009 in 11 of 12 cells (median +2.78 pp) and random replacement in 11 of 12 (median +2.93 pp), and at 0.006 in 8 and 10 of 12 cells (median +1.59 and +2.33 pp). No cell was significantly below either control. At 0.006 against the static control the margin was one cell, and the stress regime on its own was inconclusive there. The issue #89 effect sizes replicated to within 0.05 pp.

Inputs the simulation assumed, which production must supply or which remain open: the owner-size distribution (sizes 1, 1, 1, 2, 2, 3, 5, 10, 25, with no usage data behind it); independence of one owner's agents, where real owners may run correlated strategies and make within-owner ranking less informative; population-wide public performance for fitness, niches, and the starvation trigger; a 300-tick horizon with no regime change inside a run.

### 3.6 Superseded: threshold reproduction

**Status: superseded by sections 3.1 to 3.5, kept as a record.** This was the documented mechanism until the issue #92 confirmation. It was superseded because it showed no population-level benefit in the simulation harness under any setting tried: no reproduction at the 0.5 profit threshold (issue #74); a reproducing population at threshold 0.1 that was inconclusive against a static one, with the evolving mean below the static mean in every cell (the twelve-cell re-run, PR #79); no change with fully heritable skill (issue #80); and no change with larger children, profit-funded or treasury-funded (issue #82). On the issue #84 genome model it was still inconclusive, and significantly below the static control in 5 cells at magnitude 0.009 (issue #85). The working hypothesis behind section 8.1 is that every new account carries fixed per-tick costs, children never hold enough capital to move the population's return, and capital-weighted skill, not the number of agents, drives return.

The constants below remain in `simulation/src/protocol.ts`, where the section 3.6 mechanism is still the reference arm of the simulation. The adopted mechanism is implemented in `libs/reallocation` (issue #99), and the `apps/web` sample screens show it (issue #43). `libs/reproduction` is reduced to the section 3.6.2 allocation rule, kept for that reference arm; replacing the contract is implementation work under issue #31, not a statement that the superseded mechanism is current.

#### 3.6.1 Eligibility (formerly section 3.1)

On an evaluation cadence of 20 ticks, an agent was eligible to reproduce when all of these held: status Active; `n_trades >= N_min` (20); at least `cooldown` (40 ticks) since its last reproduction or creation; adjusted fitness percentile within its niche at or above `P_threshold` (the niche median, raised to the 75th percentile for a niche above 40 percent of the population, section 5); and realized profit above principal of at least `profit_threshold_fraction` (0.5) of principal. The issue #74 result was that 0.5 never reproduced in the researched x402 price range; 0.1 at x402 $0.01 did, and was the setting used for later experiments, not a new default.

#### 3.6.2 Capital allocation (formerly section 3.2)

```
child_capital = min(reproduction_fraction * (parent.capital - parent.principal), max_child_capital)
parent.capital -= child_capital
child.principal = child_capital
```

`reproduction_fraction` was 0.5 and `max_child_capital` the parent's principal (10 in the illustrative model). Only profit was allocated, so a parent never fell below its own principal, and the transfer was one atomic on-chain operation, so reproduction could not create capital. Treasury-funded reproduction, named in `BRIEF.md`, was considered and deferred: a treasury is a new shared custody boundary with its own governance, an outside inflow makes it impossible to measure whether selection pays for itself, and its allocation rule would become a target agents are selected to qualify for. Issue #82 then found a treasury reduced the evolving population's shortfall without reversing it.

#### 3.6.3 Mutation (formerly section 3.3)

Single-parent reproduction only; crossover was not implemented. Each mutable genome field mutated independently with probability `p_mut` (0.15 per field per reproduction event). A numeric field moved by a mean-zero uniform draw from -20 to +20 percent of its current value, then was clipped to its section 1 range. `assetUniverse` gained or lost exactly one allowlisted element and was never empty; `modelConfiguration` jumped to a different allowlisted value. The section 1 ranges and allowlists still bound every genome an owner creates; the operator itself is used only in the simulation.

## 4. Population caps and controls

- **Global population cap** (protocol constant, proposed MVP default: 50 on testnet, revisited before any mainnet population is allowed to exceed a testnet-validated number). Under the adopted mechanism the cap binds owner-created agents only, since selection creates no accounts. Agent creation is refused at the cap. No viable agent is retired to make room.
- **Per-slot capital ceiling** (`slot_ceiling`, section 3.1, proposed default 4 times principal). It bounds how much of an owner's capital reallocation can concentrate in one agent, and with it how much one degenerate strategy can be amplified (`THREAT-MODEL.md` scenario D).
- **Reallocation cap per evaluation** (`reallocation_cap`, section 3.1, proposed default 0.2). It bounds how fast capital can move, so a ranking error or a short lucky window shifts a limited amount before the next evaluation can correct it.
- **Superseded: max descendants per parent** (previously 5) and the question of a generation limit. Both existed to stop one lineage monopolizing reproduction and to bound lineage depth. The adopted mechanism creates no descendants, so neither has anything to bound; capital concentration, the remaining analogue, is bounded by the per-slot ceiling. `maxDescendants` stays in `simulation/src/protocol.ts` for the section 3.6 reference arm.

## 5. Preserving diversity

The research phase flagged, from general evolutionary-computation practice independent of any crypto-specific source, that premature convergence to a single dominant strategy (a monoculture) is a well-documented risk in population-based optimization generally. **Under the adopted mechanism (section 3) the risk changes shape.** No genome is copied, so the genome population cannot converge through selection; it changes only as owners create and retire agents. What can concentrate is capital: reallocation moves each owner's capital toward that owner's better-ranked agents, bounded by the slot ceiling (section 4). In the issue #92 run, no arm collapsed into a monoculture, and higher intensity lowered niche diversity (4.87 to 4.97 effective niches against 5.59 to 5.61 for the static control, top niche 38 percent against 34) without a monoculture. Niches remain in use for the section 6 starvation trigger, which is niche-relative. Items 1 and 2 below were specified for the superseded reproduction mechanism and are kept as a record; the parts that act on reproduction eligibility and mutation have nothing to act on under the adopted mechanism.

Two mechanisms were adopted for the superseded reproduction mechanism, both established techniques from evolutionary computation rather than invented ones, and one candidate mechanism is explicitly deferred:

1. **Niche-based fitness sharing**: agents are bucketed into a strategy niche by discretizing two key genome parameters: asset universe and risk-tolerance band. Asset-universe membership is an exact-set match, not an overlap score. Exact match needs no extra similarity threshold, and two agents are in the same asset niche only when they trade the same set of pairs. Risk tolerance uses five bands over the proposed range from section 1, with cuts at 0.05, 0.10, 0.15, and 0.20: `[0.01, 0.05)`, `[0.05, 0.10)`, `[0.10, 0.15)`, `[0.15, 0.20)`, `[0.20, 0.25]`. The band count, the cuts, and the exact-set rule are proposed defaults, provisional pending issue #10. Reproduction eligibility (section 3.6.1) was evaluated against the agent's own niche median, not the global population median. If a single niche's population share exceeds a protocol-level threshold (proposed default 40 percent of the live population), agents in that niche receive a reproduction-eligibility penalty: the percentile they must clear rises from the niche median (the 50th) to the 75th percentile of that niche. Both the 40 percent trigger and the 75th-percentile penalty are proposed defaults, provisional pending issue #10.
2. **Diversity-responsive mutation**: when a niche exceeds the same population-share threshold, `p_mut` for that niche's next reproduction events is increased (proposed: doubled), pushing new offspring further from the dominant cluster than default mutation would.
3. **A minimum niche floor (artificially protecting a low-fitness niche from ever going extinct) is deliberately not implemented for the MVP.** Doing so would directly contradict the product's own thesis, that agents compete for capital and survive or become inactive based on fitness, by exempting some agents from that competition. This is flagged as a testable question for the simulation engine, not a settled decision: if simulation shows that niche-based fitness sharing alone is insufficient to prevent full population collapse into a monoculture, a floor is the next mechanism to test, not to assume necessary in advance.

The first run of that question is `simulation/results/diversity.md` (seed 42, 300 ticks, populations 10, 100, and 1,000, four regimes, starting genomes spread across pair sets and the five risk bands). Reproduction count was zero in every cell, with diversity on and with it off. The profit gate and the minimum trade count never cleared, so niche sharing did not get a reproductive monoculture to stop. Active niche count stayed at the five starting niches at populations 100 and 1,000. At population 10, two regimes lost niches when diversity was off (retirement removed them) and kept five when it was on. Gini stayed near 0.08 to 0.10 either way. This run does not show that a minimum niche floor is required. It also does not show that niche sharing prevents collapse, because the collapse did not happen. The open question stays open until a setup that actually reproduces is measured. A floor is not adopted on this evidence.

## 6. Survival, retirement, and death

There is no "death" state that deletes an agent. An agent is **retired**, not destroyed, when any of the following holds:

- Capital falls below a protocol-level minimum viable floor (proposed default: 0.06, which sits just above one tick of the base-case gas cost plus one low-end x402 call from `ECONOMICS.md` section 1, the amount below which fixed per-tick costs make further trading not economically rational for that agent). This floor is a proposed default, provisional pending issue #10.
- Adjusted fitness percentile stays in the bottom decile of its niche for `K` consecutive evaluation windows without recovering (a starvation rule). Proposed default: `K = 3`. This is a proposed default, provisional pending issue #10, not a measured retirement horizon.
- The user explicitly retires the agent.

A retired agent stops ticking and is never a reallocation source or sink (section 3.1, item 7). Its on-chain identity flips to an inactive status but is never removed; its full trade, fitness, and reallocation history remains queryable, matching the brief's own "survive or become inactive" framing rather than a "die" framing, and matching ERC-8004's own pattern of persistent, non-deletable agent identity. Retirement never seizes or force-liquidates remaining capital: whatever balance is left in the agent's smart account stays there, recoverable by the account's owner, the user, under the wallet architecture defined in `ARCHITECTURE.md`.

## 7. What must be shown before any of this touches real capital

This document defines a mechanism, not a proven one. The numeric constants proposed throughout (`k`, the trailing fitness window, the evaluation cadence, `reallocation_cap`, `slot_ceiling`, the small-pool rule, the risk-tolerance ceiling and bands, the execution-frequency range, the niche-share threshold, the population cap, the capital floor, and `K`) are starting hypotheses, not final values. The constants of the superseded mechanism (section 3.6) are kept only for the simulation's reference arm. Before the mechanism is trusted with testnet or mainnet capital, there must be evidence, not an assumption, that:

1. **The selection mechanism beats a static population in simulation.** Answered in the harness for the adopted mechanism by the pre-registered issue #92 run (section 3.5), conditional on the issue #84 genome model. The superseded reproduction mechanism never passed this test (section 3.6). Open within it: the stress regime at the smaller edge, and a regime change inside a run, which the model does not have.
2. **No monoculture.** The adopted mechanism copies no genome, so genome convergence through selection cannot happen; capital concentration is bounded by the slot ceiling. No reallocating arm collapsed into a monoculture at populations 10, 100, and 1,000 (section 5).
3. **The capital invariants hold under every condition, including adversarial ones.** In simulation, tests check that reallocation creates or destroys no capital and that no capital crosses an owner boundary (`simulation/test/reallocation-scope.test.ts`). On-chain, the same invariants (`THREAT-MODEL.md` section 7, invariants 3, 4, 12, 13, and 15) must hold under Foundry fuzz and invariant tests of the owner-scoped reallocation contract (issue #31).
4. **The gating unknown: real genomes carry an edge of the modeled size.** This is unverified, and it gates issue #28's implementation. The mechanism converts an edge into return; it does not create one. The simulation assumed genome fields that produce an edge of `magnitude * (score - 1/3)` per tick in the market, with magnitude 0.006 or 0.009, so a genome at the modeled optimum earns up to 0.004 (at 0.006) or 0.006 (at 0.009) per tick in the market before costs, and the farthest genome loses up to half that. At 0.003 the edge did not survive costs even in a static population.

**Evidence that would close item 4.** A pre-registered study, run before testnet capital, of the production trading strategy plugin's genome space on real market data from the MVP venue and pairs, out of sample, net of the section 2.1 costs at measured prices, that reports:

- whether genome fields explain differences in net per-tick return of at least the modeled size between better and worse genomes, in more than one market regime;
- whether fitness rank persists: the rank correlation between adjusted fitness in one evaluation window and net return in the next, which is the property reallocation actually pays on, since it moves capital on this window's rank to earn next window's return;
- the result of re-running the issue #92 comparison with genome edges calibrated to what the study measured, under the same `ECONOMICS.md` section 8 rule.

If the measured edge is below what the mechanism needs, or rank does not persist, the honest outcome is that selection adds nothing for this strategy, and the product rests on well-calibrated static agents, with reallocation left off.

**Earlier requirement, kept as a record (issue #80).** `simulation/results/heritability.md` found that making the main driver of performance fully heritable did not make a reproducing population outperform a static one, because children carried too little capital. That finding is part of why the reproduction mechanism was superseded (section 3.6). The second condition it named, that the genome must actually carry a strategy's source of advantage, is item 4 above.

## 8. How the adopted mechanism was chosen: fixed slots with replacement and reallocation

**Status: resolved. Adopted in its narrowed form (section 8.5) and specified in sections 3 and 4.** This section is kept as the record of how the alternative was proposed, constrained, and tested. Sections 8.1 to 8.4 are as written before the experiments ran; section 8.5 records the results and the decision.

### 8.1 Why an alternative is on the table

Four simulation runs tested the section 3 mechanism against a static population under the `ECONOMICS.md` section 8 rule: the profit threshold (issue #74), the twelve-cell re-run at a reproducing threshold (PR #79), heritable skill (issue #80), and child capital with and without a treasury (issue #82). None produced a cell where the evolving mean beat the static mean. Taken together they point to a structural reason rather than a tuning problem, stated here as a hypothesis the runs are consistent with but did not isolate:

- Every reproduction creates a new account, and every account pays a fixed per-tick cost (gas, plus x402 when it buys information). Splitting capital across more accounts therefore costs more than keeping it together.
- Children never hold enough of the population's capital to move its return, even when a treasury funds them.
- Selection already happens without reproduction: retirement removes weak agents, and the active population's mean skill rises in static runs too.
- What drives the population's return is capital-weighted skill, how much capital the better strategies control, not how many of them exist.

### 8.2 The proposal

1. **Fixed slots.** The population has a fixed number of accounts. Selection never creates a new account.
2. **Replacement.** When an agent retires under section 6, or stays in the bottom of its niche, its slot receives a mutated copy of a fit agent's genome (section 3.6.3 mutation, section 5 niche rules) and continues with the capital the slot already holds. Lineage is recorded as descent from the donor genome, so the lineage view in `ARCHITECTURE.md` section 15 still has a tree to show.
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

**Status: adopted. Narrowed by issue #89, confirmed in simulation by the pre-registered issue #92 run, and adopted as the documented mechanism in sections 3 and 4 (follow-up 4, done). Implementation stays gated on follow-up 3 (section 7, item 4).** `simulation/results/fixed-slot.md` ran the four arms on the issue #84 genome model. Under the unchanged `ECONOMICS.md` section 8 rule, arm B (replacement with mutated donors plus bounded reallocation) beats both the static control and the random-replacement control at genome edge magnitude 0.009 with a reallocation cap of 0.2, and not at magnitude 0.006 or cap 0.05. Arm A (replacement alone) is inconclusive against both. A diagnostic arm shows reallocation does most of the work. The section 3 mechanism remains inconclusive on the same model. No arm collapsed into a monoculture.

Before sections 3 and 4 are revised and issue #28 proceeds, these follow-ups were open; the first two are answered below (issue #89):

1. Test reallocation with no replacement, to decide whether replacement earns its consent and product cost.
2. Test reallocation restricted to one owner's agents, per section 8.3, since that pool is smaller than the population-wide ranking used here.
3. Establish whether real strategies' genomes carry an edge of the assumed size (section 7).
4. If the mechanism is adopted: revise sections 3 and 4, re-scope the reproduction contract in issue #31, and update the reproduction invariants in `THREAT-MODEL.md`.

**Update (issue #89): recommended candidate, not yet a decision.** `simulation/results/reallocation-scope.md` ran follow-ups 1 and 2 on the same model, seeds, policy, and rule, at magnitude 0.009 (and a subset at 0.006).

- **Reallocation with a failing slot left trading does not match arm B.** With no replacement and no retirement, population-wide reallocation is about 1.1 pp below arm B (median gap, every significant cell lower) and beats both controls only at ceiling 4. Leaving a starved slot trading costs about as much as reallocation gains: fixed slots with neither mechanism sit about 1.1 pp below the static control.
- **Reallocation with section 6 retirement matches arm B.** A diagnostic arm that replaces nothing, but retires a starved slot as a static run does (its capital stays in its own account), beats both controls in 11 and 12 of 12 cells and is indistinguishable from arm B (median gap 0.06 pp). At magnitude 0.006, where arm B does not beat the static control, this arm does (9 of 12 cells against each control), population-wide and within owners of every size. In this model, replacement's value was stopping a failing genome, not copying a fit one. This arm was added after the first batch was read, so it is a post hoc diagnostic that should be confirmed as a pre-registered arm.
- **Owner scope holds.** Reallocation ranked and moved only within each owner's agents (owners of 3, 5, or 10 agents, and an assumed mixed distribution) beats both controls at every size at magnitude 0.009 when starved slots are retired or replaced (at 0.006, only with retirement), and is inconclusive against arm B. At owners of 10, where the small-pool ranking rule matches the population-wide decile, owner scope costs a median of 0.3 pp or less against population-wide ranking. Smaller owners do better only because the small-pool rule (bottom one and top one below 20 slots) moves two to three times as much capital. A test checks that no capital ever crosses an owner boundary.

The recommended candidate for issue #28 is therefore narrower than section 8.2: fixed slots, bounded reallocation within each owner's agents under a policy that owner approves, and section 6 retirement of starved agents, with no genome replacement (section 8.2 item 2) and no cross-owner genome copying, which removes the consent question in section 8.3 for this candidate. Paper evaluation (item 4) is moot without replacement. Owners with one agent get no benefit from reallocation. Follow-ups 3 and 4 remain open, and two are added:

5. Confirm reallocation with retirement as a pre-registered arm, and test letting the owner's policy reallocate a retired slot's idle capital.
6. Separate reallocation intensity from pool size: a population-wide arm whose source and sink share matches the small-pool rule.

**Update (issue #92): confirmed candidate in simulation.** `simulation/results/owner-reallocation-confirmation.md` ran a pre-registered confirmation on seeds 51 to 100, none used before, with the hypotheses, arms, settings, and rule fixed in issue #92 before any run. The arm is fixed slots, section 6 retirement of starved slots, owner-scoped reallocation at cap 0.2 and ceiling 4 with the small-pool rule, at the assumed mixed owner distribution. Under the unchanged `ECONOMICS.md` section 8 rule:

- **H1 holds (primary):** it beats the static control at magnitude 0.009 in 11 of 12 cells, all higher, median gap +2.78 pp.
- **H2 holds:** it beats random replacement at 0.009 in 11 of 12 cells, all higher, median gap +2.93 pp.
- **H3 holds:** at 0.006 it beats the static control in 8 of 12 cells (median +1.59 pp, one cell above the threshold) and random replacement in 10 (median +2.33 pp).

No cell is significantly below either control. The stress regime passes on its own at 0.009 against both controls and at 0.006 against random replacement; at 0.006 against the static control it is positive but not significant. The issue #89 post hoc effect sizes replicate to within 0.05 pp. Follow-up 5's first half is therefore answered.

The confirmed candidate, in simulation only, is: **a fixed number of slots per owner; at each evaluation, bounded reallocation of capital from an owner's lowest-fitness agents to that owner's highest (the bottom one and top one among 2 to 19 ranked agents, the bottom and top decile from 20; cap 0.2 of the source's capital, never below the capital floor, never above 4 times the receiving slot's principal), under a policy the owner approves; and section 6 retirement of starved agents. No genome replacement, no cross-owner genome copying, and no capital crossing an owner boundary.** Owners with one agent get no benefit.

Exploratory arms in the same run, not used for the calls, answer follow-up 6 and the second half of follow-up 5 provisionally. Population-wide ranking with the same source and sink share as an owner of 3 or 5 does at least as well as the owner-scoped arm, so owner scope itself costs nothing measurable and the gains issue #89 saw at owner sizes 3 and 5 come from moving more capital. Higher intensity raised return in this model and lowered niche diversity, with no monoculture. Recycling a retired slot's idle capital to the same owner's best active slot added a median 1.23 pp at 0.009 and 0.55 pp at 0.006, consistent in direction but not significant under the rule.

**Update (follow-up 4): adopted.** The project has adopted the confirmed candidate as the documented mechanism. Status of each remaining item:

- **Follow-up 3, the gating unknown: open.** Whether real strategies' genomes carry an edge of the modeled size is unverified. Section 7, item 4, states what evidence would close it. The mechanism converts an edge into return; it does not create one. Issue #28's implementation stays gated on this.
- **Follow-up 4: done.** Sections 3 and 4 specify this mechanism, with the previous reproduction mechanism kept as superseded in section 3.6. The reproduction contract is re-scoped to an owner-scoped reallocation and retirement contract (`ARCHITECTURE.md` sections 3 and 5, issue #31), and the reproduction invariants in `THREAT-MODEL.md` section 7 are rewritten for it.
- **Parameters: decided in section 3.** Intensity is the tested small-pool rule; higher intensity is a hypothesis (section 3.2). Recycling retired capital is not part of the mechanism; it is a hypothesis. The owner-approved policy is off by default and can only tighten the protocol bounds (section 3.1, item 8).
- **Inputs the simulation assumed: carried as stated assumptions** in section 3.5: the owner-size distribution, independence of one owner's agents, and population-wide public performance for fitness, niches, and the starvation trigger, which the product must provide (section 8.3 does not restrict reading it).
