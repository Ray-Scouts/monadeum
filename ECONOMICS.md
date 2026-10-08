# ECONOMICS.md

The capital, cost, and population model for Monadeum, plus preliminary simulation results. This document states its own limitations honestly: the numbers below come from a small, hand-written, deliberately simplified model built to produce a first, directionally useful read, not from the production simulation engine (`simulation/` in this repository, an implementation-phase deliverable per `ARCHITECTURE.md`). Where an input is a researched fact, it is marked as such; where it is an assumption because no researched number exists yet, that is marked too.

---

## 1. Cost model inputs

| Cost | Value used | Status |
|---|---|---|
| Gas per trade on Monad | $0.001 (a base-case value near the low end of a $0.0005-$0.007 researched range; the model does not separately test the high end) | Researched, back-of-envelope from Monad's own documented gas pricing model and current MON price; not independently measured from a real transaction receipt. |
| Nansen x402 call | $0.05 (low end of a $0.01-$7.50 researched range) | Researched, taken from Nansen's own x402 manifest via Monad's API Hub. |
| DeFiLlama x402 call | $0.01 flat | Researched, taken directly from Monad's API Hub catalog. |
| Kuru trading fee + slippage | 10 bps + 5 bps (15 bps combined) | **Assumption, not researched.** Kuru sets fees per market with no platform-wide schedule found in research; no confirmed number exists yet for any specific pair. This is the single most important number in this document to replace with a real figure before any of the results below are trusted further. |
| Paymaster gas sponsorship budget | Not yet modeled numerically | See `ARCHITECTURE.md` section 7 for the mechanism; this document does not yet price it because the per-agent sponsorship budget is a product decision (how many free transactions per agent) not a researched fact. |

## 2. Capital model

Starting capital per agent is a user decision, not a protocol constant; $10 is used as the illustrative default throughout this document, generalizing the brief's own $5 worked example to a slightly higher floor that at least partially covers a realistic first tick of gas plus one information purchase without immediately approaching the minimum viable floor defined in `EVOLUTION.md`.

Total system capital only ever changes through deposits, withdrawals, and realized trading and cost flows. Reproduction reallocates existing capital from a parent to a child; it is never a source of new capital. This is restated here because it is the single invariant this document's simulation results depend on holding, and it is verified directly in the model below (see section 4).

## 3. What the preliminary model actually simulates

A population of agents, each with a small, fixed, hidden "skill" parameter (representing that some agents are genuinely, if only slightly, better than others), trades once per tick against one of four market regimes, pays the costs in section 1, and occasionally purchases information at a fixed 30 percent probability per tick, which grants a small expected-value edge. Every `EVAL_EVERY` ticks, the reproduction rule from `EVOLUTION.md` is evaluated: minimum trade count, cooldown, fitness percentile within the live population, and a profit-above-principal threshold, all exactly as defined there but without the niche-based diversity mechanism (section 5 of `EVOLUTION.md`), which the model does not yet implement. Four regimes are tested: a trending market (small positive drift), a mean-reverting market (oscillating drift), a choppy sideways market (zero drift, pure noise), and a stress scenario (a single sharp negative shock partway through the run). Each is run at population sizes of 10, 100, and 1,000, once with reproduction enabled ("evolving") and once with it disabled ("static," an equivalent population that just keeps trading with its original, unmutated genome), so the two can be compared directly. The run is seeded and deterministic, per the brief's own requirement for the eventual simulation engine.

**Important, stated limitation of this specific model, not a footnote**: every agent trades with its entire current balance every single tick. This is not how a real Monadeum agent will behave (`riskTolerance` in `EVOLUTION.md` bounds position size well below 100 percent of capital, and `executionFrequency` bounds how often an agent trades at all), but it is what this quick preliminary model does, and it matters enormously for the results below.

## 4. Results

### 4.1 Preliminary single-seed table

The block below is the preliminary model, one seed (`RNG_SEED = 42`), all-in every tick. It is the antecedent. Section 4.2 is the result that supersedes it.

```
 pop             regime      mode  end_pop  total_cap  roi_pct  sortino   gini  repro
  10           trending    static       10      90.74    -9.26  -0.0754  0.230      0
  10           trending  evolving       10      89.57   -10.43  -0.0639  0.169      0
  10     mean_reverting    static       10      42.37   -57.63  -0.2961  0.280      0
  10     mean_reverting  evolving       10      54.46   -45.54  -0.2219  0.193      0
  10             choppy    static       10      48.48   -51.52  -0.2075  0.241      0
  10             choppy  evolving       10      43.98   -56.02  -0.2312  0.245      0
  10 stress_flash_crash    static       10      41.30   -58.70  -0.2539  0.245      0
  10 stress_flash_crash  evolving       10      42.83   -57.17  -0.2416  0.235      0
 100           trending    static      100     971.79    -2.82  -0.0316  0.181      0
 100           trending  evolving      114    1024.04     2.40  -0.0158  0.222     14
 100     mean_reverting    static      100     477.27   -52.27  -0.2481  0.174      0
 100     mean_reverting  evolving      100     529.86   -47.01  -0.2249  0.213      0
 100             choppy    static      100     524.66   -47.53  -0.1990  0.269      0
 100             choppy  evolving      100     510.70   -48.93  -0.2026  0.257      0
 100 stress_flash_crash    static      100     469.90   -53.01  -0.2143  0.208      0
 100 stress_flash_crash  evolving      100     502.71   -49.73  -0.1999  0.195      1
1000           trending    static     1000   10159.72     1.60  -0.0119  0.186      0
1000           trending  evolving     1155   10143.63     1.44  -0.0178  0.231    157
1000     mean_reverting    static     1000    5160.75   -48.39  -0.2350  0.224      0
1000     mean_reverting  evolving     1005    5077.10   -49.23  -0.2387  0.218      7
1000             choppy    static     1000    4871.11   -51.29  -0.2128  0.252      0
1000             choppy  evolving     1001    4892.75   -51.07  -0.2119  0.250      7
1000 stress_flash_crash    static     1000    4935.51   -50.64  -0.2051  0.217      0
1000 stress_flash_crash  evolving     1000    4708.71   -52.91  -0.2158  0.215      0
```

(`roi_pct` is total ending population capital versus total starting capital deployed; `sortino` is the population-level realized risk-adjusted return over the full run; `gini` is the Gini coefficient of capital across surviving agents; `repro` is the total count of reproduction events.)

### 4.2 Multi-seed legal policy

`simulation/results/multiseed.md` is 50 seeds, 300 ticks, diversity on, risk tolerance 0.25, trade every tick. That policy was the best static legal cell in the sizing sweep. Mean ROI is about -35 to -36 percent in the trending regime and about -39 to -42 percent in the other three, at every population size. The sample standard deviation is a few percentage points, and smaller at population 1,000 except where the regime itself is noisy. Evolving and static match to the reported precision in every one of the 12 cells. The Welch two-sided p-value on ROI is 1. The gap is 0. No cell is outside the noise of a single run, because the two modes are the same run: reproduction count stays at zero, so the evolutionary branch never diverges.

## 5. What these numbers actually say, read honestly

**The multi-seed legal-policy runs are the numbers to use.** The paragraphs under the next heading were written about section 4.1 and stay here so that antecedent is not quietly rewritten. They are not a description of section 4.2.

Under the legal policy, both modes lose about 35 to 42 percent of capital over 300 ticks. The loss is stable across 50 seeds. It is not an evolving-versus-static result. Nothing reproduced, so niche sharing, shrinkage, and the reproduction threshold did not get a chance to move ROI. The stress regime has the worst mean, about -42 percent, and there is no evolutionary pattern there to be an exception to. The sizing sweep already points at the fixed x402 charge on a capped position as the drag. Section 8, once published, is the go/no-go that uses these cells.

### What the preliminary single-seed table said

**The dominant finding is not about evolution, it is about cost drag, and it is a genuinely useful finding to have surfaced this early.** Every regime except the mildly-trending one loses roughly 45 to 60 percent of deployed capital over 300 ticks, including the static, no-reproduction baseline. That loss is not evolution's fault: it comes from the combination of trading full capital every single tick and paying a 15-basis-point-per-tick assumed fee-and-slippage cost, which compounds to a large cumulative drag over hundreds of ticks regardless of any trading edge. This is exactly the kind of result a simulation phase is supposed to surface before real capital is at risk: **trading frequency and position sizing are not minor tuning parameters, they are the first-order determinant of whether this system is economically viable at all**, and the default assumption used in this quick model (trade everything, every tick) is a bad one that `EVOLUTION.md`'s genome already defines the tools to avoid (`executionFrequency`, `riskTolerance`), but which this preliminary model does not yet apply. Before any testnet capital is committed, the production simulation engine needs to sweep realistic position-size and frequency ranges, not the worst-case default used here to get a first result quickly.

**Where the model does show evolution's effect, it is directionally consistent with the thesis, not proof of it.** In every case at population sizes of 100 and 1,000, the evolving population's ROI is less negative, or more positive, than the equivalent static population's: trending at 1,000 agents goes from 1.60 percent static to 1.44 percent evolving (roughly flat, within noise), but at 100 agents trending goes from -2.82 percent static to +2.40 percent evolving, and every loss-making regime shows evolving losing less than static (mean-reverting at 100 agents: -52.27 percent static versus -47.01 percent evolving; stress scenario at 1,000 agents: -50.64 percent static versus, in this run, a worse -52.91 percent evolving, the one case that does not follow the pattern and should not be smoothed over). This is one seed, one simplified model, and a small number of regimes; it is evidence worth taking seriously that reallocating capital toward higher-fitness lineages helps, not evidence that settles the question of whether evolutionary reproduction is actually useful, which remains genuinely open and is the first thing the production simulation engine (section 6) must test properly, not assume. The stress-scenario exception above is itself useful: it is a concrete illustration of the exact risk `EVOLUTION.md` section 7 asks the real simulation engine to test, whether a fitness signal tuned on normal conditions transfers to a shock.

**Population growth from reproduction stayed bounded, not runaway, at every scale tested.** At 1,000 starting agents, the evolving population grew to at most 1,155 (a 15.5 percent increase) over the run; at 100 agents, to at most 114. No run approached the population cap (`max_population = pop_size * 2` in this model). This is a useful, if preliminary, data point against one of the risks `EVOLUTION.md` section 4 exists to prevent, uncontrolled population explosion, though it should be re-tested at longer time horizons and under the niche-based diversity mechanism this model does not yet implement, which could change reproduction dynamics.

**Capital concentration (Gini) stayed moderate across every scenario**, in a 0.17 to 0.28 range, well short of extreme concentration (a Gini near 1.0 would mean nearly all capital in one agent). This is a preliminary, favorable signal against runaway capital concentration, not a guarantee; it should be retested once the niche-based diversity and correlation-penalty mechanisms from `EVOLUTION.md` section 5 are actually implemented in the model, since this run did not include them.

## 6. What the production simulation engine must do that this preliminary model does not

1. **Apply realistic position sizing and execution frequency**, sweeping the `riskTolerance` and `executionFrequency` genome ranges from `EVOLUTION.md` rather than the all-in, every-tick default used here, which this section 5 already shows is the dominant driver of the loss results above. The first sweep is in `simulation/results/sizing.md` (seed 42, 300 ticks, populations 10, 100, and 1,000, all four regimes, static and evolving). It does not reproduce this section's 45 to 60 percent all-in loss: that figure came from `prelim_sim.py`, which is not in the repository, and the new engine was not tuned to match it. In the new engine, static all-in ROI on this seed is about +20 to +30 percent in the trending regime and about -15 to -37 percent otherwise. The best legal policy (risk tolerance 0.25, every tick) is worse than all-in in every cell, because x402 is a fixed charge (0.05 at probability 0.30) while a capped position earns less gross pnl. Zero-cost runs of that legal policy are positive (about +7 to +21 percent). The with-cost gap is about 46 to 51 percentage points, and on the legal rows x402 is the largest cost line. Capping size does not, in this model, explain the preliminary loss. It makes the fixed information cost heavier. Later sections replace the single seed.
2. **Implement the niche-based fitness-sharing and diversity-responsive mutation mechanisms** from `EVOLUTION.md` section 5, which this preliminary model omitted entirely; the Gini and reproduction-count results above are a baseline without those mechanisms, not a validation of them.
3. **Replace the assumed 15-basis-point Kuru fee-and-slippage figure with a measured one**, from either Kuru's own published per-market fee data or a real testnet trade, before any cost-sensitivity conclusion in this document is treated as final.
4. **Run many seeds per scenario, not one**, and report a distribution, not a point estimate. Section 4.1 is still one seed. Section 4.2 is the 50-seed distribution that replaces it for the legal policy.
5. **Directly test the specific adversarial reproduction scenario `EVOLUTION.md` section 3.2 and `THREAT-MODEL.md` section 6 (scenario D) describe**: a simulated agent or mutation deliberately trying to game the fitness function, to verify the capital-conservation and parent-survival invariants hold even under an adversarial input, not just under the benign random mutation this preliminary model used.

## 7. Reproducibility

The script that produced section 4.1's results, `prelim_sim.py`, is a preliminary research artifact, not part of this repository; it was written and run as a one-off during the architecture phase to ground this document in real numbers rather than invented ones, seeded with `RNG_SEED = 42` for determinism. It is superseded by the `simulation/` package in this repository. Section 4.2, `simulation/results/multiseed.md`, `simulation/results/sizing.md`, `simulation/results/diversity.md`, `simulation/results/adversarial.md`, and `simulation/results/reproduction-threshold.md` are the runs of that package.

## 8. Go/no-go on the evolutionary mechanism

The question from `EVOLUTION.md` section 7, item 1, is whether a reproducing population beats an equally sized static population on risk-adjusted, cost-inclusive return, across regimes. The rule used here was fixed before these runs were read as a verdict. Evolution counts as outperforming only if, in a majority of the 12 cells (3 population sizes by 4 regimes), the evolving mean ROI is higher, the two-sided Welch p-value is below 0.05, and the median gap across cells is positive. The stress regime is reported on its own and is not averaged away. If fewer than half the cells have p below 0.05 in either direction, the call is inconclusive rather than a finding that evolution hurts.

**The call is inconclusive.**

Section 4.2 is 50 seeds, 300 ticks, diversity on, risk tolerance 0.25, trade every tick. That is the best static legal policy from `simulation/results/sizing.md`. In all 12 cells the evolving and static ROI means match, the gap is 0, and the Welch p-value is 1. Zero cells have p below 0.05. The median gap is 0. The stress regime is the worst mean, about -42 percent, for both modes. There is no evolutionary pattern there to be an exception to.

The reason the modes match is that reproduction count is zero. `simulation/results/diversity.md` shows the same zero with niches spread out. The profit gate, the minimum trade count, and the fixed x402 cost leave nobody eligible, so niche sharing, shrinkage, and the reproduction threshold never move capital. `simulation/results/adversarial.md` shows the capital invariants hold when eligibility is forced. That is a safety result, not evidence that evolution improves returns.

Mean ROI under the legal policy is a loss of about 35 percent in the trending regime and about 39 to 42 percent in the others, stable across seeds. `simulation/results/sizing.md` attributes that drag to the fixed x402 charge on a capped position, not to evolution. The preliminary 45 to 60 percent all-in loss in section 4.1 is a different model and is not the basis of this call.

**What this means for M3 (issue #28).** Put it on hold. Do not build the production evolutionary engine on these reproduction rules as currently scoped. The narrower next step is one experiment, not an implementation: vary the profit threshold and the x402 price inside the ranges this document already states, and see whether a reproducing population exists at all. Only if that experiment produces a non-zero reproduction count should the 12-cell comparison be run again. Until a difference between evolving and static shows up, a static population with the information-cost problem understood is the part that has something to tune. Evolution has not earned issue #28 yet.

**Outcome of that experiment (issue #74).** `simulation/results/reproduction-threshold.md` varies `profitThresholdFraction` over 0, 0.1, 0.25, and 0.5 and the x402 price from $0.01 to $7.50, with every other setting at the section 8 baseline. At the documented threshold of 0.5, reproduction stays at zero at every price in the researched range, in every regime, at populations 10, 100, and 1,000. Price alone does not open it. A reproducing population does exist inside the documented price range at a lower threshold: at 0.1 with x402 at the $0.01 low end, population 100 reproduces in 94 percent of trending seeds, 100 percent of mean-reverting seeds, 58 percent of choppy seeds, and 6 percent of stress seeds. At the $0.05 baseline price, reproduction is zero at every threshold from 0.1 up. The profit gate is the one that binds; `n_min` is never the sole blocker. A threshold of 0 reproduces almost everywhere, but its children start with $0.01 to $0.17 and are mostly retired, so it is not a useful operating point. Above $0.05 no agent buys information, because the harness genome's information budget is $0.05, so higher prices in the researched range are the no-information case, not a cost the agents pay.

For issue #28 this means the 12-cell comparison should be re-run, now that a non-zero reproduction count exists, at `profitThresholdFraction` 0.1 and x402 $0.01, with the no-purchase case (price above the information budget) as a second arm. The re-run should report child survival alongside ROI, because children at 0.1 start with about 5 percent of a parent principal. Issue #28 stays on hold until that re-run shows a difference between evolving and static. This experiment shows only that reproduction can occur, not that it helps.
