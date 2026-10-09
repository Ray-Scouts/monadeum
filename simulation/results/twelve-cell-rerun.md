# Twelve-cell re-run at a reproducing threshold

`ECONOMICS.md` section 8 asks whether a reproducing population beats an equally sized static population on risk-adjusted, cost-inclusive return, across regimes. The first run was inconclusive because no agent ever reproduced. `reproduction-threshold.md` (issue #74) found that a reproducing population exists at `profitThresholdFraction` 0.1 with x402 at $0.01, and recommended this re-run with a no-purchase arm and child survival reported. This file is that re-run.

## Setup

Identical to the section 8 run (`cli-multiseed.ts`, `multiseed.md`) except for the arm parameters below: populations 10, 100, and 1,000; regimes trending, mean-reverting, choppy, and stress flash crash; seeds 1 to 50 in every cell, including population 1,000; 300 ticks; evolving and static modes on the same seeds; diversity on; all starting genomes in one niche; legal policy risk tolerance 0.25 and execution every tick; every other constant at its `src/protocol.ts` and `src/execution.ts` default. `protocol.ts` is not changed. The profit threshold is overridden per run through `createReproductionModule({ profitThresholdFraction })`, as in `reproduction-threshold.md`.

| arm | profit threshold fraction | x402 per call | information purchases |
|---|---:|---:|---|
| A | 0.1 | $0.01 | on |
| B (no purchase) | 0.1 | not charged | off |
| C (reference) | 0.5 | $0.05 (section 8 baseline) | on |

Arm B uses the new `RunConfig.informationPurchases: false`. With it off, no agent buys information, x402 spend is zero, and the information edge is never applied. The per-tick purchase draw is still taken, so the agent RNG stream is identical to a run where the price is above every budget. `test/rerun.test.ts` checks both properties.

Statistics are the section 8 ones: per cell, mean ROI over the 50 seeds for each mode, gap is evolving minus static in percentage points, and the two-sided Welch test from `src/aggregate.ts` on the per-seed ROI values. Static runs use the same arm costs and purchase setting as evolving runs; only reproduction differs.

Child survival pools every child of every evolving seed in the cell. "child active %" is the share still active at the end of the run. "child roi %" is the mean over children of (final capital minus starting capital) over starting capital. "child capital" and "child principal" are the mean final and starting capital of a child, against a $10 parent principal.

## Decision rule

Fixed before these runs, from `ECONOMICS.md` section 8. Evolution outperforms only if, in a strict majority of the 12 cells (at least 7), the evolving mean ROI is higher and the two-sided Welch p-value is below 0.05, and the median gap across the 12 cells is positive. If fewer than half the cells (fewer than 6) have p below 0.05 in either direction, the call is inconclusive. The stress regime is reported on its own. The section 8 text does not define "underperforms"; `decide` in `src/rerun.ts` reads it as the mirror of "outperforms", and labels any remaining outcome "mixed". Neither of those two cases occurred.

## Commands

From `simulation/`, after `bun run test` (which builds `dist/`):

```bash
# one job per arm, population, and regime; 36 jobs, 10 in parallel
for pop in 1000 100 10; do for arm in A B C; do for regime in trending mean_reverting choppy stress_flash_crash; do
  echo "$arm $pop $regime"
done; done; done | xargs -P 10 -L 1 zsh -c \
  'ARM=$0 POPS=$1 REGIMES=$2 SEEDS=50 OUT=results/twelve-cell-rerun/$0-$1-$2.json node dist/src/cli-rerun.js'
node dist/src/cli-rerun-report.js results/twelve-cell-rerun
```

Wall time was 703 seconds on a laptop with 11 cores. A population 1,000 evolving run takes about 2 to 3 seconds. The per-cell JSON outputs are in `results/twelve-cell-rerun/`, and the tables below are the report command's output.

## Arm A: threshold 0.1, x402 $0.01, purchases on

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -1.70 | -0.86 | -0.85 | 0.2812 | 2.48 | 72 | 124 | 57.3 | -40.6 | 0.330 | 0.551 |
| 10 | mean_reverting | 50 | -6.18 | -6.13 | -0.05 | 0.9287 | 0.74 | 52 | 37 | 100.0 | -12.1 | 0.465 | 0.528 |
| 10 | choppy | 50 | -5.28 | -5.07 | -0.21 | 0.7432 | 0.72 | 34 | 36 | 63.9 | -33.9 | 0.364 | 0.550 |
| 10 | stress_flash_crash | 50 | -9.80 | -9.79 | -0.02 | 0.9815 | 0.02 | 2 | 1 | 0.0 | -62.5 | 0.208 | 0.556 |
| 100 | trending | 50 | -1.91 | -1.15 | -0.76 | 0.2210 | 23.70 | 94 | 1185 | 58.7 | -35.7 | 0.357 | 0.553 |
| 100 | mean_reverting | 50 | -6.56 | -6.52 | -0.04 | 0.8473 | 5.10 | 100 | 255 | 95.3 | -15.4 | 0.448 | 0.530 |
| 100 | choppy | 50 | -5.49 | -5.32 | -0.17 | 0.7429 | 6.70 | 58 | 335 | 64.2 | -30.0 | 0.385 | 0.548 |
| 100 | stress_flash_crash | 50 | -10.11 | -10.10 | -0.01 | 0.9834 | 0.32 | 6 | 16 | 18.8 | -50.7 | 0.260 | 0.526 |
| 1000 | trending | 50 | -2.03 | -1.26 | -0.78 | 0.2305 | 245.76 | 94 | 12288 | 57.7 | -35.2 | 0.358 | 0.551 |
| 1000 | mean_reverting | 50 | -6.68 | -6.63 | -0.05 | 0.6172 | 48.60 | 100 | 2430 | 93.1 | -16.7 | 0.440 | 0.528 |
| 1000 | choppy | 50 | -5.55 | -5.37 | -0.17 | 0.7541 | 70.40 | 62 | 3520 | 64.1 | -28.4 | 0.394 | 0.549 |
| 1000 | stress_flash_crash | 50 | -10.15 | -10.13 | -0.02 | 0.9728 | 3.50 | 12 | 175 | 23.4 | -46.6 | 0.283 | 0.530 |

**Call: inconclusive.** 0 of 12 cells have p below 0.05. Median gap -0.11 pp. Evolving is lower in all 12 cells. Stress, reported separately: 0 of 3 cells have p below 0.05, gaps -0.01 to -0.02 pp, reproduction in 2 to 12 percent of seeds, and 0 to 23 percent of stress children active at the end.

## Arm B: threshold 0.1, no information purchases

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | 3.17 | 3.66 | -0.49 | 0.4925 | 4.28 | 90 | 214 | 71.5 | -8.3 | 0.514 | 0.560 |
| 10 | mean_reverting | 50 | -1.15 | -0.99 | -0.17 | 0.7455 | 1.94 | 80 | 97 | 73.2 | -5.8 | 0.497 | 0.528 |
| 10 | choppy | 50 | -0.13 | 0.03 | -0.16 | 0.7624 | 1.74 | 64 | 87 | 69.0 | -6.6 | 0.514 | 0.550 |
| 10 | stress_flash_crash | 50 | -4.19 | -4.16 | -0.03 | 0.9608 | 0.24 | 16 | 12 | 66.7 | -8.3 | 0.500 | 0.544 |
| 100 | trending | 50 | 2.82 | 3.29 | -0.47 | 0.4329 | 41.96 | 100 | 2098 | 65.3 | -7.6 | 0.514 | 0.557 |
| 100 | mean_reverting | 50 | -1.63 | -1.51 | -0.12 | 0.5657 | 17.22 | 100 | 861 | 66.8 | -5.4 | 0.501 | 0.530 |
| 100 | choppy | 50 | -0.48 | -0.33 | -0.15 | 0.7373 | 17.30 | 84 | 865 | 62.5 | -6.3 | 0.513 | 0.547 |
| 100 | stress_flash_crash | 50 | -4.53 | -4.49 | -0.04 | 0.9443 | 2.42 | 34 | 121 | 44.6 | -8.7 | 0.505 | 0.552 |
| 1000 | trending | 50 | 2.68 | 3.16 | -0.48 | 0.4433 | 427.62 | 100 | 21381 | 64.0 | -7.5 | 0.516 | 0.557 |
| 1000 | mean_reverting | 50 | -1.79 | -1.66 | -0.12 | 0.2460 | 169.78 | 100 | 8489 | 64.9 | -5.5 | 0.501 | 0.530 |
| 1000 | choppy | 50 | -0.54 | -0.39 | -0.16 | 0.7401 | 175.46 | 86 | 8773 | 63.7 | -6.2 | 0.513 | 0.547 |
| 1000 | stress_flash_crash | 50 | -4.55 | -4.52 | -0.03 | 0.9554 | 22.64 | 38 | 1132 | 45.8 | -8.4 | 0.504 | 0.550 |

**Call: inconclusive.** 0 of 12 cells have p below 0.05. Median gap -0.16 pp. Evolving is lower in all 12 cells. Stress, reported separately: 0 of 3 cells have p below 0.05, gaps -0.03 to -0.04 pp, reproduction in 16 to 38 percent of seeds, and 45 to 67 percent of stress children active at the end.

## Arm C: reference, threshold 0.5, x402 $0.05

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -35.64 | -35.64 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 10 | mean_reverting | 50 | -39.24 | -39.24 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 10 | choppy | 50 | -38.59 | -38.59 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 10 | stress_flash_crash | 50 | -42.42 | -42.42 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 100 | trending | 50 | -35.08 | -35.08 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 100 | mean_reverting | 50 | -39.39 | -39.39 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 100 | choppy | 50 | -38.66 | -38.66 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 100 | stress_flash_crash | 50 | -42.40 | -42.40 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 1000 | trending | 50 | -35.09 | -35.09 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 1000 | mean_reverting | 50 | -39.34 | -39.34 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 1000 | choppy | 50 | -38.49 | -38.49 | 0.00 | 1.0000 | 0.00 | 0 | 0 |
| 1000 | stress_flash_crash | 50 | -42.24 | -42.24 | 0.00 | 1.0000 | 0.00 | 0 | 0 |

**Call: inconclusive**, the published section 8 result. Every mean ROI matches `multiseed.md` to two decimals, with zero reproductions, so the current code, including the new purchase switch at its default, reproduces the baseline.

## Findings

1. Under the pre-registered rule the call is inconclusive in all three arms. No cell in any arm has p below 0.05. The stress cells are inconclusive on their own in every arm. Evolution has not shown that it outperforms a static population.
2. The direction is consistent, not mixed. In arms A and B, where reproduction occurs, the evolving mean ROI is lower than the static mean in all 24 cells. The gaps are small: -0.01 to -0.85 pp, largest in trending (about -0.8 pp in arm A and -0.5 pp in arm B) and smallest in stress, where few agents reproduce. This consistency is an observation, not a test result. The rule uses the unpaired Welch test per cell, and no sign test or paired test was pre-registered, so none is used for the call.
3. Children lose money on average in every cell. In arm A the mean child starts with about $0.53 to $0.56 and ends with $0.21 to $0.47, a mean child ROI of -12 to -63 percent, and 0 to 100 percent of children are active at the end (57 to 64 percent in trending and choppy). In arm B, with no information cost, children lose 5 to 9 percent and 45 to 73 percent stay active. Children do worse when they pay for information.
4. Turning information purchases off raises ROI for both modes by about 4.4 to 5.6 pp in every cell (for example static trending at population 100: +3.29 percent in arm B against -1.15 percent in arm A). At the assumed 0.002 edge, information does not pay for itself at $0.01, which is consistent with finding 7 of `reproduction-threshold.md`. It also raises the mean reproduction count by 1.7 to 12 times, because profit no longer leaks into x402.
5. Hypothesis, consistent with the data but not isolated by this experiment: the negative gap comes from moving parent profit into small children. A child with about $0.55 trading at risk 0.25 takes positions of about $0.14, where the fixed $0.001 gas per trade is about 0.7 percent of the position, on top of the 15 basis point fee and slippage assumption. A $10 parent pays about 0.04 percent. Small children pay proportionally more fixed cost, and their hidden skill is redrawn rather than inherited, so selection has nothing heritable to act on except the genome fields. A test of this would hold capital fixed and vary `max_child_capital` or the gas cost.

## Limitations

- The market paths are synthetic and the per-agent skill, the 0.002 information edge, and the 0.3 purchase probability are harness assumptions from `ECONOMICS.md` section 3, not measured values. Finding 4 depends on them entirely.
- Hidden skill is drawn fresh for each child, not inherited. In this harness reproduction can only pass on genome fields (risk tolerance, frequency, thresholds, pairs, budget), and under the legal policy risk tolerance starts at its 0.25 ceiling and execution frequency at its minimum of 1, so mutation can only move them one way. A harness where skill is partly heritable might give a different answer. That is a modeling choice to make explicitly, not an oversight to patch silently.
- Kuru fee and slippage are still the 15 basis point assumption, and gas is the $0.001 base case. Finding 5 is sensitive to both.
- The Welch test treats evolving and static seeds as independent samples, although each seed shares a market path across modes. A paired test would likely have more power. It was not used because it was not the pre-registered statistic.
- 300 ticks is a short horizon for a mechanism whose children start at about 5 percent of a parent principal. A longer run was not measured.
- Arm B is the "purchases off" case, not "a price above the budget". The two are equivalent in this harness (`test/rerun.test.ts`), but only because the harness genome budget is $0.05.
