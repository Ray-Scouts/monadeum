# Minimum child capital

Issue #82. `heritability.md` (issue #80) found that even fully heritable skill (`h = 1`) does not make a reproducing population outperform a static one under the `ECONOMICS.md` section 8 rule, and named a hypothesis it did not isolate: children are too small to matter. At profit threshold 0.1 a parent becomes eligible with about 1 of profit, so under `EVOLUTION.md` section 3.2 a child starts with about 0.5. This file tests that hypothesis by making children larger in three ways: a larger reproduction fraction, a minimum child capital gate funded from profit, and a treasury that tops each child up to the minimum.

Like `heritability.md`, this is a test of the mechanism in the harness, not a claim about production. Skill here is the harness's hidden per-agent value, fully inherited at `h = 1`, which is the most favorable case the harness can express, so a negative result is informative.

## Setup

Base settings are PR #81 at `h = 1`: profit threshold fraction 0.1 (through `createReproductionModule({ profitThresholdFraction })`), x402 $0.01, information purchases on, skill heritability 1, populations 10, 100, and 1,000, regimes trending, mean-reverting, choppy, and stress flash crash, seeds 1 to 50 in every cell including population 1,000, 300 ticks, evolving and static modes on the same seeds, diversity on, all starting genomes in one niche, risk tolerance 0.25, execution every tick. `protocol.ts` is not changed. The three new parameters are experiment-only fields of `RunConfig` whose defaults leave behavior unchanged:

- `reproductionFraction`, in (0, 1], default `PROTOCOL.reproductionFraction` (0.5). It is passed to the unchanged `allocateCapital` from `@monadeum/reproduction`, so at 1 the child receives the parent's whole profit, still capped by `max_child_capital` and still under the invariant `parent.capital >= parent.principal`.
- `minChildCapital`, `m`, default 0. A parent that passes every eligibility gate reproduces only if its child would start with at least `m`. Otherwise nothing is transferred and the parent's profit keeps accumulating. Because `allocateCapital` computes `min(fraction * profit, max_child_capital)`, the gate is `fraction * profit >= m`. The gate is recorded in the existing gate accounting as `min_child_capital`, beside the other gates, including as the sole blocker when it is the only one that fails. `max_child_capital` is unchanged: the parent's own principal, as in `EVOLUTION.md` section 3.2 and the existing harness. That is 10 for a founder and at least `m` for a child born under the gate, so the ceiling never blocks a child at `m` in any arm run here.
- `treasury`, a starting balance, default 0. Described below.

### Treasury accounting

In a treasury arm each child is topped up to `m` from a treasury balance:

- The parent's contribution is the normal `allocateCapital` result, `min(fraction * profit, max_child_capital)`, debited from the parent exactly as without a treasury.
- If that contribution is below `m`, the shortfall `m - contribution` is debited from the treasury and credited to the child, so the child starts with exactly `m` and its principal is `m`. A contribution at or above `m` gets no top-up.
- A top-up is all or nothing. If the treasury cannot cover the whole shortfall, there is no top-up and the plain `m` gate applies: the child is created only if the parent's own contribution reaches `m`. No arm reached this case (see below), but the runner implements it and a test covers it.
- The treasury is counted in total capital in both modes. Starting capital is `population * 10 + treasury`, and ending capital is the sum of every agent's capital plus the unspent treasury balance. In static mode the treasury is never spent, so it is idle cash at zero return. Both modes therefore start with the same total capital, and ROI is measured over the same base.
- Total capital is conserved. Every change in total capital equals gross trading P&L minus fees, slippage, gas, and x402. A reproduction event and a top-up only move capital between the parent, the treasury, and the child. `test/child-capital.test.ts` asserts this in both modes.

Treasury size is `m * (cap - population)`, where `cap` is the experiment population cap (`max(50, 2 * population)`). A run never creates more than `cap - population` children, because retired agents keep their slot, and no top-up exceeds `m`. This is therefore the smallest balance that cannot run out under any outcome, chosen so that no cell's result depends on when a treasury empties. It is 40 `m` at population 10 and `population * m` at 100 and 1,000, so the treasury is `m` per 10 of founder capital at populations 100 and 1,000 and 4 `m` per 10 at population 10: 1,000, 2,500, and 5,000 at population 1,000. The largest mean spend in any cell was 1,062.8 of 5,000 (population 1,000 trending, fraction 0.5, `m = 5`).

Because the treasury enlarges the ROI base, a treasury arm's percentage gap is smaller than the same dollar gap would be without it. The summary table therefore also reports the gap restated on founder capital alone (`gap * (founder capital + treasury) / founder capital`), which is the dollar gap as a percentage of `population * 10`. The Welch p-value is unaffected, because the treasury rescales both modes' ROI by the same factor.

### Arms

Fourteen arms, every one a full 12-cell comparison:

- Profit-funded grid without a treasury: fraction in {0.5, 1} by `m` in {0, 1, 2.5, 5}. Eight arms.
- Treasury top-up at fraction in {0.5, 1} by `m` in {1, 2.5, 5}. Six arms. `m = 0` has nothing to top up, so it has no treasury arm.

The full grid was affordable, so no arm was dropped. Two results could be predicted from the rules before the runs, and both held: at fraction 0.5, `m = 2.5` needs profit of 5, half the principal, which is the documented threshold that `reproduction-threshold.md` found never clears, and `m = 5` needs 10. At fraction 1, the profit threshold 0.1 already guarantees a contribution of at least 1 from a founder, so `m = 1` could bind only for a child reproducing on less than 1 of profit. It did not bind in these runs: the fraction 1, `m = 1` arm matches fraction 1, `m = 0` in all 276 compared fields, and its treasury arm spends nothing.

Columns are as in `heritability.md`. Added in a second table per arm:

- "child start capital": mean starting capital (principal) of the children, pooled over seeds. This is the "child principal" column of the first table, repeated for reading.
- "child capital share %": mean over seeds of the children's capital as a share of all agent capital at tick 300. Unspent treasury is excluded, so the column measures how much of the capital actually trading is in children. It is end capital, not starting capital, so it is lower than the 1.4 percent `heritability.md` quoted for the same cell, which was children's starting capital over founder capital.
- "evolving end weighted skill" and "static end weighted skill": mean over seeds of the capital-weighted mean skill over every agent at tick 300, in basis points per tick, as in `heritability.md`. Unspent treasury has no skill and is excluded, so in treasury arms the evolving value includes capital the static population holds as idle cash.
- "treasury": starting treasury. "treasury spent": mean over seeds of the treasury spent on top-ups.
- "paired p (secondary)": as in `heritability.md`, a paired t-test on per-seed evolving minus static ROI, reported as an observation only and not used for any call.

## Decision rule

Unchanged from `ECONOMICS.md` section 8 and applied by `decide` in `src/rerun.ts`. Evolution outperforms only if at least 7 of the 12 cells have the evolving mean ROI higher with a two-sided Welch p below 0.05, and the median gap across the 12 cells is positive. Fewer than 6 cells with p below 0.05 in either direction is inconclusive. The stress regime is reported on its own.

## The equivalence check

Fraction 0.5, `m = 0`, and no treasury must reproduce PR #81 at `h = 1`. Two checks:

1. `test/child-capital.test.ts` asserts that a run with `reproductionFraction: 0.5, minChildCapital: 0, treasury: 0` is deep-equal to a run with all three unset, on a configuration that reproduces, and that the `min_child_capital` gate is never recorded there.
2. Every field of the 12 published rows in `results/heritability/A-h1-*.json` (20 fields per row: means, gap, Welch p, reproduction counts, child statistics, skill statistics, paired p) was compared with `Object.is` against the rows in `results/child-capital/A-h1-f0.5-m0-*.json`. 240 of 240 fields are identical, so the baseline arm matches PR #81 at `h = 1` bit for bit.

The other tests in `test/child-capital.test.ts` check that the `m` gate keeps every child at or above `m` and is counted, that fraction 1 gives the child exactly `min(profit, max_child_capital)` and never takes a parent below its principal, that the treasury tops every child up to `m` and conserves total capital in both modes with the static treasury untouched, that an exhausted treasury falls back to the plain gate, and that out-of-range values are rejected.

## Commands

From `simulation/`, after `bun run test` (which builds `dist/`):

```bash
# 14 arms x 12 cells = 168 jobs, 10 in parallel
for pop in 1000 100 10; do for f in 0.5 1; do
  for m in 0 1 2.5 5; do for regime in trending mean_reverting choppy stress_flash_crash; do echo "$f $m 0 $pop $regime"; done; done
  for m in 1 2.5 5; do for regime in trending mean_reverting choppy stress_flash_crash; do echo "$f $m 1 $pop $regime"; done; done
done; done | xargs -P 10 -L 1 zsh -c 'suffix=""; [ "$2" = 1 ] && suffix="-t"; \
  ARM=A H=1 F=$0 M=$1 T=$2 POPS=$3 REGIMES=$4 SEEDS=50 \
  OUT=results/child-capital/A-h1-f$0-m$1$suffix-$3-$4.json node dist/src/cli-rerun.js'

node dist/src/cli-rerun-report.js results/child-capital
```

Wall time on a laptop with 11 cores: 2,309 seconds for the 168 jobs. No seeds were reduced anywhere. The per-cell JSON outputs are in `results/child-capital/`, and the per-arm tables below are the report command's output.

## Summary

| arm | fraction | m | treasury | cells p < 0.05 | direction (gap sign) | median gap pp | median gap on founder capital pp | stress (3 cells) | call | cells reproducing | child start capital | child capital share % | child active % | child roi % |
|---|---:|---:|---|---:|---|---:|---:|---|---|---:|---:|---:|---:|---:|
| A-h1-f0.5-m0 | 0.5 | 0 | no | 0 of 12 | lower 12, higher 0, zero 0 | -0.11 | -0.11 | inconclusive, gaps -0.02 to -0.01 | inconclusive | 12 of 12 | 0.55 | 0.00 to 0.89 | 0 to 100 | -62.4 to -12.0 |
| A-h1-f0.5-m1 | 0.5 | 1 | no | 0 of 12 | lower 5, higher 0, zero 7 | 0.00 | 0.00 | inconclusive, gaps 0.00 | inconclusive | 5 of 12 | 1.06 | 0.01 to 0.32 | 88 to 100 | -11.2 to -5.8 |
| A-h1-f0.5-m2.5 | 0.5 | 2.5 | no | 0 of 12 | lower 0, higher 0, zero 12 | 0.00 | 0.00 | inconclusive, gaps 0.00 | inconclusive | 0 of 12 | n/a | n/a | n/a | n/a |
| A-h1-f0.5-m5 | 0.5 | 5 | no | 0 of 12 | lower 0, higher 0, zero 12 | 0.00 | 0.00 | inconclusive, gaps 0.00 | inconclusive | 0 of 12 | n/a | n/a | n/a | n/a |
| A-h1-f1-m0 | 1 | 0 | no | 0 of 12 | lower 12, higher 0, zero 0 | -0.11 | -0.11 | inconclusive, gaps -0.02 to -0.01 | inconclusive | 12 of 12 | 1.09 | 0.01 to 1.55 | 0 to 100 | -39.7 to -5.4 |
| A-h1-f1-m1 | 1 | 1 | no | 0 of 12 | lower 12, higher 0, zero 0 | -0.11 | -0.11 | inconclusive, gaps -0.02 to -0.01 | inconclusive | 12 of 12 | 1.09 | 0.01 to 1.55 | 0 to 100 | -39.7 to -5.4 |
| A-h1-f1-m2.5 | 1 | 2.5 | no | 0 of 12 | lower 3, higher 0, zero 9 | 0.00 | 0.00 | inconclusive, gaps 0.00 | inconclusive | 3 of 12 | 2.60 | 0.13 to 0.19 | 100 | -1.5 to -1.1 |
| A-h1-f1-m5 | 1 | 5 | no | 0 of 12 | lower 0, higher 0, zero 12 | 0.00 | 0.00 | inconclusive, gaps 0.00 | inconclusive | 0 of 12 | n/a | n/a | n/a | n/a |
| A-h1-f0.5-m1-t | 0.5 | 1 | yes | 0 of 12 | lower 12, higher 0, zero 0 | -0.09 | -0.11 | inconclusive, gaps -0.02 to -0.01 | inconclusive | 12 of 12 | 1.00 | 0.01 to 2.00 | 0 to 100 | -43.6 to -5.7 |
| A-h1-f0.5-m2.5-t | 0.5 | 2.5 | yes | 0 of 12 | lower 12, higher 0, zero 0 | -0.06 | -0.08 | inconclusive, gaps -0.02 to -0.01 | inconclusive | 12 of 12 | 2.50 | 0.04 to 5.43 | 0 to 100 | -29.0 to -1.6 |
| A-h1-f0.5-m5-t | 0.5 | 5 | yes | 0 of 12 | lower 12, higher 0, zero 0 | -0.02 | -0.03 | inconclusive, gaps -0.01 | inconclusive | 12 of 12 | 5.00 | 0.09 to 10.25 | 96 to 100 | -16.2 to 0.3 |
| A-h1-f1-m1-t | 1 | 1 | yes | 0 of 12 | lower 12, higher 0, zero 0 | -0.09 | -0.11 | inconclusive, gaps -0.02 to -0.01 | inconclusive | 12 of 12 | 1.09 | 0.01 to 1.55 | 0 to 100 | -39.7 to -5.4 |
| A-h1-f1-m2.5-t | 1 | 2.5 | yes | 0 of 12 | lower 12, higher 0, zero 0 | -0.06 | -0.08 | inconclusive, gaps -0.02 to -0.01 | inconclusive | 12 of 12 | 2.50 | 0.04 to 3.99 | 0 to 100 | -29.0 to -1.6 |
| A-h1-f1-m5-t | 1 | 5 | yes | 0 of 12 | lower 12, higher 0, zero 0 | -0.02 | -0.04 | inconclusive, gaps -0.01 | inconclusive | 12 of 12 | 5.00 | 0.09 to 7.91 | 94 to 100 | -16.2 to 0.2 |

Gap columns are percentage points of the arm's own ROI base. "Median gap on founder capital" restates each cell's gap on founder capital alone, so treasury arms are comparable with the others. Ranges are across the cells of the arm that reproduce. Per-cell values are in the tables below.

## Arm A-h1-f0.5-m0

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -1.71 | -0.86 | -0.86 | 0.2759 | 2.52 | 72 | 126 | 60.3 | -40.1 | 0.331 | 0.549 |
| 10 | mean_reverting | 50 | -6.18 | -6.13 | -0.05 | 0.9292 | 0.74 | 52 | 37 | 100.0 | -12.0 | 0.465 | 0.528 |
| 10 | choppy | 50 | -5.28 | -5.07 | -0.22 | 0.7386 | 0.72 | 34 | 36 | 58.3 | -33.5 | 0.366 | 0.550 |
| 10 | stress_flash_crash | 50 | -9.80 | -9.79 | -0.02 | 0.9816 | 0.02 | 2 | 1 | 0.0 | -62.4 | 0.209 | 0.556 |
| 100 | trending | 50 | -1.90 | -1.15 | -0.75 | 0.2266 | 23.80 | 94 | 1190 | 58.7 | -34.6 | 0.363 | 0.553 |
| 100 | mean_reverting | 50 | -6.56 | -6.52 | -0.04 | 0.8491 | 5.10 | 100 | 255 | 93.7 | -15.3 | 0.449 | 0.530 |
| 100 | choppy | 50 | -5.49 | -5.32 | -0.17 | 0.7397 | 6.66 | 58 | 333 | 61.9 | -29.6 | 0.388 | 0.549 |
| 100 | stress_flash_crash | 50 | -10.11 | -10.10 | -0.01 | 0.9851 | 0.32 | 6 | 16 | 18.8 | -49.8 | 0.264 | 0.526 |
| 1000 | trending | 50 | -2.03 | -1.26 | -0.77 | 0.2336 | 245.74 | 94 | 12287 | 57.3 | -34.3 | 0.364 | 0.552 |
| 1000 | mean_reverting | 50 | -6.68 | -6.63 | -0.05 | 0.6233 | 48.54 | 100 | 2427 | 92.5 | -16.5 | 0.442 | 0.528 |
| 1000 | choppy | 50 | -5.55 | -5.37 | -0.17 | 0.7536 | 69.86 | 62 | 3493 | 61.8 | -27.7 | 0.398 | 0.550 |
| 1000 | stress_flash_crash | 50 | -10.15 | -10.13 | -0.02 | 0.9646 | 3.50 | 12 | 175 | 23.4 | -46.6 | 0.283 | 0.530 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.11 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 0.549 | 0.83 | 11.91 | 12.00 | 0 | 0.0 | <0.0001 |
| 10 | mean_reverting | 0.528 | 0.36 | 11.90 | 11.92 | 0 | 0.0 | 0.0001 |
| 10 | choppy | 0.550 | 0.27 | 11.65 | 11.67 | 0 | 0.0 | 0.0003 |
| 10 | stress_flash_crash | 0.556 | 0.00 | 11.20 | 11.19 | 0 | 0.0 | 0.3222 |
| 100 | trending | 0.553 | 0.86 | 11.57 | 11.65 | 0 | 0.0 | <0.0001 |
| 100 | mean_reverting | 0.530 | 0.24 | 11.58 | 11.59 | 0 | 0.0 | <0.0001 |
| 100 | choppy | 0.549 | 0.27 | 11.31 | 11.33 | 0 | 0.0 | 0.0007 |
| 100 | stress_flash_crash | 0.526 | 0.01 | 10.84 | 10.84 | 0 | 0.0 | 0.5412 |
| 1000 | trending | 0.552 | 0.89 | 11.28 | 11.36 | 0 | 0.0 | <0.0001 |
| 1000 | mean_reverting | 0.528 | 0.23 | 11.28 | 11.29 | 0 | 0.0 | <0.0001 |
| 1000 | choppy | 0.550 | 0.29 | 11.01 | 11.03 | 0 | 0.0 | 0.0002 |
| 1000 | stress_flash_crash | 0.530 | 0.01 | 10.54 | 10.54 | 0 | 0.0 | 0.1168 |

## Arm A-h1-f0.5-m1

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -0.90 | -0.86 | -0.04 | 0.9595 | 0.34 | 24 | 17 | 88.2 | -9.5 | 0.978 | 1.078 |
| 10 | mean_reverting | 50 | -6.13 | -6.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | choppy | 50 | -5.07 | -5.07 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | stress_flash_crash | 50 | -9.79 | -9.79 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | trending | 50 | -1.18 | -1.15 | -0.03 | 0.9599 | 3.04 | 44 | 152 | 88.2 | -6.8 | 0.986 | 1.058 |
| 100 | mean_reverting | 50 | -6.52 | -6.52 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | choppy | 50 | -5.32 | -5.32 | -0.00 | 0.9983 | 0.12 | 2 | 6 | 100.0 | -5.8 | 0.968 | 1.028 |
| 100 | stress_flash_crash | 50 | -10.10 | -10.10 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | trending | 50 | -1.29 | -1.26 | -0.03 | 0.9608 | 32.26 | 44 | 1613 | 88.3 | -6.9 | 0.986 | 1.059 |
| 1000 | mean_reverting | 50 | -6.63 | -6.63 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | choppy | 50 | -5.38 | -5.37 | -0.00 | 0.9978 | 1.10 | 2 | 55 | 100.0 | -11.2 | 0.929 | 1.047 |
| 1000 | stress_flash_crash | 50 | -10.13 | -10.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 1.078 | 0.32 | 11.99 | 12.00 | 0 | 0.0 | 0.0062 |
| 10 | mean_reverting | n/a | 0.00 | 11.92 | 11.92 | 0 | 0.0 | 1.0000 |
| 10 | choppy | n/a | 0.00 | 11.67 | 11.67 | 0 | 0.0 | 1.0000 |
| 10 | stress_flash_crash | n/a | 0.00 | 11.19 | 11.19 | 0 | 0.0 | 1.0000 |
| 100 | trending | 1.058 | 0.29 | 11.64 | 11.65 | 0 | 0.0 | 0.0085 |
| 100 | mean_reverting | n/a | 0.00 | 11.59 | 11.59 | 0 | 0.0 | 1.0000 |
| 100 | choppy | 1.028 | 0.01 | 11.33 | 11.33 | 0 | 0.0 | 0.3222 |
| 100 | stress_flash_crash | n/a | 0.00 | 10.84 | 10.84 | 0 | 0.0 | 1.0000 |
| 1000 | trending | 1.059 | 0.31 | 11.35 | 11.36 | 0 | 0.0 | 0.0052 |
| 1000 | mean_reverting | n/a | 0.00 | 11.29 | 11.29 | 0 | 0.0 | 1.0000 |
| 1000 | choppy | 1.047 | 0.01 | 11.03 | 11.03 | 0 | 0.0 | 0.3222 |
| 1000 | stress_flash_crash | n/a | 0.00 | 10.54 | 10.54 | 0 | 0.0 | 1.0000 |

## Arm A-h1-f0.5-m1-t

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -1.20 | -0.61 | -0.58 | 0.3002 | 2.50 | 72 | 125 | 68.0 | -20.6 | 0.794 | 1.000 |
| 10 | mean_reverting | 50 | -4.41 | -4.38 | -0.04 | 0.9348 | 0.74 | 52 | 37 | 100.0 | -5.7 | 0.943 | 1.000 |
| 10 | choppy | 50 | -3.76 | -3.62 | -0.15 | 0.7527 | 0.72 | 34 | 36 | 58.3 | -16.8 | 0.832 | 1.000 |
| 10 | stress_flash_crash | 50 | -7.01 | -6.99 | -0.02 | 0.9733 | 0.02 | 2 | 1 | 0.0 | -43.6 | 0.564 | 1.000 |
| 100 | trending | 50 | -1.70 | -1.04 | -0.66 | 0.2492 | 23.84 | 94 | 1192 | 62.2 | -17.8 | 0.822 | 1.000 |
| 100 | mean_reverting | 50 | -5.96 | -5.93 | -0.04 | 0.8614 | 5.10 | 100 | 255 | 93.7 | -7.4 | 0.926 | 1.000 |
| 100 | choppy | 50 | -4.98 | -4.84 | -0.15 | 0.7547 | 6.70 | 58 | 335 | 65.7 | -15.1 | 0.849 | 1.000 |
| 100 | stress_flash_crash | 50 | -9.19 | -9.18 | -0.01 | 0.9797 | 0.32 | 6 | 16 | 37.5 | -31.6 | 0.684 | 1.000 |
| 1000 | trending | 50 | -1.81 | -1.14 | -0.67 | 0.2604 | 246.18 | 94 | 12309 | 61.5 | -17.5 | 0.825 | 1.000 |
| 1000 | mean_reverting | 50 | -6.07 | -6.03 | -0.04 | 0.6520 | 48.62 | 100 | 2431 | 92.7 | -7.9 | 0.921 | 1.000 |
| 1000 | choppy | 50 | -5.04 | -4.89 | -0.15 | 0.7630 | 70.24 | 62 | 3512 | 64.5 | -14.1 | 0.859 | 1.000 |
| 1000 | stress_flash_crash | 50 | -9.23 | -9.21 | -0.02 | 0.9637 | 3.50 | 12 | 175 | 34.9 | -29.2 | 0.708 | 1.000 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.09 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 1.000 | 1.93 | 12.16 | 12.00 | 40 | 1.1 | <0.0001 |
| 10 | mean_reverting | 1.000 | 0.73 | 12.00 | 11.92 | 40 | 0.3 | 0.0002 |
| 10 | choppy | 1.000 | 0.61 | 11.73 | 11.67 | 40 | 0.3 | 0.0003 |
| 10 | stress_flash_crash | 1.000 | 0.01 | 11.20 | 11.19 | 40 | 0.0 | 0.3222 |
| 100 | trending | 1.000 | 1.93 | 11.81 | 11.65 | 100 | 10.7 | <0.0001 |
| 100 | mean_reverting | 1.000 | 0.50 | 11.65 | 11.59 | 100 | 2.4 | <0.0001 |
| 100 | choppy | 1.000 | 0.58 | 11.39 | 11.33 | 100 | 3.0 | 0.0007 |
| 100 | stress_flash_crash | 1.000 | 0.02 | 10.84 | 10.84 | 100 | 0.2 | 0.4482 |
| 1000 | trending | 1.000 | 2.00 | 11.53 | 11.36 | 1000 | 110.4 | <0.0001 |
| 1000 | mean_reverting | 1.000 | 0.48 | 11.35 | 11.29 | 1000 | 22.9 | <0.0001 |
| 1000 | choppy | 1.000 | 0.62 | 11.09 | 11.03 | 1000 | 31.7 | 0.0003 |
| 1000 | stress_flash_crash | 1.000 | 0.03 | 10.54 | 10.54 | 1000 | 1.6 | 0.1312 |

## Arm A-h1-f0.5-m2.5

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -0.86 | -0.86 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | mean_reverting | 50 | -6.13 | -6.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | choppy | 50 | -5.07 | -5.07 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | stress_flash_crash | 50 | -9.79 | -9.79 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | trending | 50 | -1.15 | -1.15 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | mean_reverting | 50 | -6.52 | -6.52 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | choppy | 50 | -5.32 | -5.32 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | stress_flash_crash | 50 | -10.10 | -10.10 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | trending | 50 | -1.26 | -1.26 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | mean_reverting | 50 | -6.63 | -6.63 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | choppy | 50 | -5.37 | -5.37 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | stress_flash_crash | 50 | -10.13 | -10.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | n/a | 0.00 | 12.00 | 12.00 | 0 | 0.0 | 1.0000 |
| 10 | mean_reverting | n/a | 0.00 | 11.92 | 11.92 | 0 | 0.0 | 1.0000 |
| 10 | choppy | n/a | 0.00 | 11.67 | 11.67 | 0 | 0.0 | 1.0000 |
| 10 | stress_flash_crash | n/a | 0.00 | 11.19 | 11.19 | 0 | 0.0 | 1.0000 |
| 100 | trending | n/a | 0.00 | 11.65 | 11.65 | 0 | 0.0 | 1.0000 |
| 100 | mean_reverting | n/a | 0.00 | 11.59 | 11.59 | 0 | 0.0 | 1.0000 |
| 100 | choppy | n/a | 0.00 | 11.33 | 11.33 | 0 | 0.0 | 1.0000 |
| 100 | stress_flash_crash | n/a | 0.00 | 10.84 | 10.84 | 0 | 0.0 | 1.0000 |
| 1000 | trending | n/a | 0.00 | 11.36 | 11.36 | 0 | 0.0 | 1.0000 |
| 1000 | mean_reverting | n/a | 0.00 | 11.29 | 11.29 | 0 | 0.0 | 1.0000 |
| 1000 | choppy | n/a | 0.00 | 11.03 | 11.03 | 0 | 0.0 | 1.0000 |
| 1000 | stress_flash_crash | n/a | 0.00 | 10.54 | 10.54 | 0 | 0.0 | 1.0000 |

## Arm A-h1-f0.5-m2.5-t

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -0.72 | -0.43 | -0.29 | 0.4641 | 2.48 | 72 | 124 | 77.4 | -5.4 | 2.364 | 2.500 |
| 10 | mean_reverting | 50 | -3.08 | -3.06 | -0.02 | 0.9523 | 0.74 | 52 | 37 | 100.0 | -1.6 | 2.461 | 2.500 |
| 10 | choppy | 50 | -2.62 | -2.53 | -0.08 | 0.7965 | 0.72 | 34 | 36 | 77.8 | -5.2 | 2.370 | 2.500 |
| 10 | stress_flash_crash | 50 | -4.90 | -4.89 | -0.01 | 0.9759 | 0.02 | 2 | 1 | 0.0 | -29.0 | 1.774 | 2.500 |
| 100 | trending | 50 | -1.33 | -0.92 | -0.41 | 0.4181 | 24.00 | 94 | 1200 | 75.0 | -4.9 | 2.377 | 2.500 |
| 100 | mean_reverting | 50 | -5.24 | -5.22 | -0.02 | 0.9038 | 5.12 | 100 | 256 | 98.4 | -2.1 | 2.448 | 2.500 |
| 100 | choppy | 50 | -4.36 | -4.26 | -0.11 | 0.7997 | 6.76 | 58 | 338 | 78.4 | -4.9 | 2.378 | 2.500 |
| 100 | stress_flash_crash | 50 | -8.09 | -8.08 | -0.01 | 0.9817 | 0.32 | 6 | 16 | 43.8 | -19.5 | 2.014 | 2.500 |
| 1000 | trending | 50 | -1.43 | -1.00 | -0.42 | 0.4287 | 245.88 | 94 | 12294 | 75.3 | -4.9 | 2.379 | 2.500 |
| 1000 | mean_reverting | 50 | -5.33 | -5.30 | -0.03 | 0.7423 | 48.64 | 100 | 2432 | 97.7 | -2.2 | 2.444 | 2.500 |
| 1000 | choppy | 50 | -4.40 | -4.30 | -0.10 | 0.8225 | 70.24 | 62 | 3512 | 77.8 | -4.5 | 2.388 | 2.500 |
| 1000 | stress_flash_crash | 50 | -8.12 | -8.10 | -0.02 | 0.9631 | 3.50 | 12 | 175 | 40.6 | -19.7 | 2.008 | 2.500 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.06 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.01 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 2.500 | 5.35 | 12.92 | 12.00 | 100 | 4.8 | <0.0001 |
| 10 | mean_reverting | 2.500 | 1.86 | 12.28 | 11.92 | 100 | 1.5 | 0.0004 |
| 10 | choppy | 2.500 | 1.66 | 12.00 | 11.67 | 100 | 1.4 | 0.0007 |
| 10 | stress_flash_crash | 2.500 | 0.04 | 11.20 | 11.19 | 100 | 0.0 | 0.3222 |
| 100 | trending | 2.500 | 5.30 | 12.58 | 11.65 | 250 | 46.8 | <0.0001 |
| 100 | mean_reverting | 2.500 | 1.32 | 11.87 | 11.59 | 250 | 10.1 | <0.0001 |
| 100 | choppy | 2.500 | 1.59 | 11.64 | 11.33 | 250 | 13.2 | 0.0015 |
| 100 | stress_flash_crash | 2.500 | 0.07 | 10.85 | 10.84 | 250 | 0.6 | 0.4669 |
| 1000 | trending | 2.500 | 5.43 | 12.32 | 11.36 | 2500 | 479.1 | <0.0001 |
| 1000 | mean_reverting | 2.500 | 1.26 | 11.56 | 11.29 | 2500 | 95.9 | <0.0001 |
| 1000 | choppy | 2.500 | 1.66 | 11.35 | 11.03 | 2500 | 137.0 | 0.0005 |
| 1000 | stress_flash_crash | 2.500 | 0.07 | 10.55 | 10.54 | 2500 | 6.9 | 0.1281 |

## Arm A-h1-f0.5-m5

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -0.86 | -0.86 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | mean_reverting | 50 | -6.13 | -6.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | choppy | 50 | -5.07 | -5.07 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | stress_flash_crash | 50 | -9.79 | -9.79 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | trending | 50 | -1.15 | -1.15 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | mean_reverting | 50 | -6.52 | -6.52 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | choppy | 50 | -5.32 | -5.32 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | stress_flash_crash | 50 | -10.10 | -10.10 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | trending | 50 | -1.26 | -1.26 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | mean_reverting | 50 | -6.63 | -6.63 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | choppy | 50 | -5.37 | -5.37 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | stress_flash_crash | 50 | -10.13 | -10.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | n/a | 0.00 | 12.00 | 12.00 | 0 | 0.0 | 1.0000 |
| 10 | mean_reverting | n/a | 0.00 | 11.92 | 11.92 | 0 | 0.0 | 1.0000 |
| 10 | choppy | n/a | 0.00 | 11.67 | 11.67 | 0 | 0.0 | 1.0000 |
| 10 | stress_flash_crash | n/a | 0.00 | 11.19 | 11.19 | 0 | 0.0 | 1.0000 |
| 100 | trending | n/a | 0.00 | 11.65 | 11.65 | 0 | 0.0 | 1.0000 |
| 100 | mean_reverting | n/a | 0.00 | 11.59 | 11.59 | 0 | 0.0 | 1.0000 |
| 100 | choppy | n/a | 0.00 | 11.33 | 11.33 | 0 | 0.0 | 1.0000 |
| 100 | stress_flash_crash | n/a | 0.00 | 10.84 | 10.84 | 0 | 0.0 | 1.0000 |
| 1000 | trending | n/a | 0.00 | 11.36 | 11.36 | 0 | 0.0 | 1.0000 |
| 1000 | mean_reverting | n/a | 0.00 | 11.29 | 11.29 | 0 | 0.0 | 1.0000 |
| 1000 | choppy | n/a | 0.00 | 11.03 | 11.03 | 0 | 0.0 | 1.0000 |
| 1000 | stress_flash_crash | n/a | 0.00 | 10.54 | 10.54 | 0 | 0.0 | 1.0000 |

## Arm A-h1-f0.5-m5-t

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -0.32 | -0.29 | -0.04 | 0.8993 | 2.46 | 72 | 123 | 95.9 | 0.2 | 5.008 | 5.000 |
| 10 | mean_reverting | 50 | -2.05 | -2.04 | -0.00 | 0.9850 | 0.74 | 52 | 37 | 100.0 | -0.2 | 4.990 | 5.000 |
| 10 | choppy | 50 | -1.71 | -1.69 | -0.02 | 0.9285 | 0.72 | 34 | 36 | 97.2 | -0.7 | 4.963 | 5.000 |
| 10 | stress_flash_crash | 50 | -3.27 | -3.26 | -0.01 | 0.9738 | 0.02 | 2 | 1 | 100.0 | -16.2 | 4.191 | 5.000 |
| 100 | trending | 50 | -0.81 | -0.77 | -0.05 | 0.9177 | 23.34 | 94 | 1167 | 96.7 | 0.2 | 5.009 | 5.000 |
| 100 | mean_reverting | 50 | -4.35 | -4.35 | -0.01 | 0.9680 | 5.14 | 100 | 257 | 100.0 | -0.3 | 4.983 | 5.000 |
| 100 | choppy | 50 | -3.58 | -3.55 | -0.04 | 0.9216 | 6.64 | 58 | 332 | 98.8 | -0.9 | 4.954 | 5.000 |
| 100 | stress_flash_crash | 50 | -6.74 | -6.73 | -0.01 | 0.9790 | 0.32 | 6 | 16 | 100.0 | -12.5 | 4.375 | 5.000 |
| 1000 | trending | 50 | -0.88 | -0.84 | -0.04 | 0.9287 | 238.94 | 94 | 11947 | 97.2 | 0.3 | 5.013 | 5.000 |
| 1000 | mean_reverting | 50 | -4.43 | -4.42 | -0.01 | 0.9079 | 48.54 | 100 | 2427 | 100.0 | -0.3 | 4.983 | 5.000 |
| 1000 | choppy | 50 | -3.62 | -3.58 | -0.03 | 0.9316 | 70.04 | 62 | 3502 | 98.0 | -0.8 | 4.959 | 5.000 |
| 1000 | stress_flash_crash | 50 | -6.77 | -6.75 | -0.01 | 0.9706 | 3.50 | 12 | 175 | 96.6 | -11.2 | 4.440 | 5.000 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.01 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.000 | 10.23 | 14.03 | 12.00 | 200 | 10.9 | 0.0535 |
| 10 | mean_reverting | 5.000 | 3.62 | 12.72 | 11.92 | 200 | 3.3 | 0.0441 |
| 10 | choppy | 5.000 | 3.25 | 12.41 | 11.67 | 200 | 3.2 | 0.0425 |
| 10 | stress_flash_crash | 5.000 | 0.09 | 11.22 | 11.19 | 200 | 0.1 | 0.3222 |
| 100 | trending | 5.000 | 10.03 | 13.69 | 11.65 | 500 | 103.8 | 0.0881 |
| 100 | mean_reverting | 5.000 | 2.66 | 12.22 | 11.59 | 500 | 23.0 | 0.0302 |
| 100 | choppy | 5.000 | 3.10 | 12.01 | 11.33 | 500 | 29.6 | 0.0261 |
| 100 | stress_flash_crash | 5.000 | 0.14 | 10.87 | 10.84 | 500 | 1.4 | 0.4596 |
| 1000 | trending | 5.000 | 10.25 | 13.47 | 11.36 | 5000 | 1062.8 | 0.0861 |
| 1000 | mean_reverting | 5.000 | 2.53 | 11.90 | 11.29 | 5000 | 217.1 | <0.0001 |
| 1000 | choppy | 5.000 | 3.29 | 11.76 | 11.03 | 5000 | 311.8 | 0.0185 |
| 1000 | stress_flash_crash | 5.000 | 0.16 | 10.58 | 10.54 | 5000 | 15.6 | 0.1650 |

## Arm A-h1-f1-m0

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -1.59 | -0.86 | -0.73 | 0.3590 | 1.76 | 72 | 88 | 54.5 | -19.4 | 0.887 | 1.098 |
| 10 | mean_reverting | 50 | -6.18 | -6.13 | -0.05 | 0.9289 | 0.74 | 52 | 37 | 100.0 | -5.4 | 1.000 | 1.057 |
| 10 | choppy | 50 | -5.27 | -5.07 | -0.20 | 0.7572 | 0.54 | 34 | 27 | 44.4 | -17.1 | 0.920 | 1.109 |
| 10 | stress_flash_crash | 50 | -9.81 | -9.79 | -0.02 | 0.9738 | 0.02 | 2 | 1 | 0.0 | -39.7 | 0.670 | 1.111 |
| 100 | trending | 50 | -1.81 | -1.15 | -0.66 | 0.2972 | 16.38 | 94 | 819 | 48.0 | -17.3 | 0.916 | 1.106 |
| 100 | mean_reverting | 50 | -6.56 | -6.52 | -0.04 | 0.8488 | 5.10 | 100 | 255 | 93.7 | -6.9 | 0.986 | 1.059 |
| 100 | choppy | 50 | -5.48 | -5.32 | -0.16 | 0.7582 | 5.48 | 58 | 274 | 58.8 | -14.5 | 0.935 | 1.092 |
| 100 | stress_flash_crash | 50 | -10.11 | -10.10 | -0.01 | 0.9799 | 0.32 | 6 | 16 | 37.5 | -30.2 | 0.735 | 1.053 |
| 1000 | trending | 50 | -1.92 | -1.26 | -0.66 | 0.3137 | 165.42 | 94 | 8271 | 44.8 | -17.2 | 0.913 | 1.102 |
| 1000 | mean_reverting | 50 | -6.68 | -6.63 | -0.05 | 0.6263 | 48.60 | 100 | 2430 | 92.7 | -7.4 | 0.978 | 1.056 |
| 1000 | choppy | 50 | -5.54 | -5.37 | -0.16 | 0.7658 | 59.12 | 62 | 2956 | 58.5 | -13.6 | 0.947 | 1.095 |
| 1000 | stress_flash_crash | 50 | -10.15 | -10.13 | -0.02 | 0.9643 | 3.50 | 12 | 175 | 34.3 | -28.0 | 0.763 | 1.059 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.11 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 1.098 | 1.55 | 11.93 | 12.00 | 0 | 0.0 | <0.0001 |
| 10 | mean_reverting | 1.057 | 0.78 | 11.90 | 11.92 | 0 | 0.0 | 0.0001 |
| 10 | choppy | 1.109 | 0.51 | 11.65 | 11.67 | 0 | 0.0 | 0.0002 |
| 10 | stress_flash_crash | 1.111 | 0.01 | 11.20 | 11.19 | 0 | 0.0 | 0.3222 |
| 100 | trending | 1.106 | 1.50 | 11.59 | 11.65 | 0 | 0.0 | <0.0001 |
| 100 | mean_reverting | 1.059 | 0.54 | 11.58 | 11.59 | 0 | 0.0 | <0.0001 |
| 100 | choppy | 1.092 | 0.53 | 11.31 | 11.33 | 0 | 0.0 | 0.0003 |
| 100 | stress_flash_crash | 1.053 | 0.03 | 10.84 | 10.84 | 0 | 0.0 | 0.4470 |
| 1000 | trending | 1.102 | 1.51 | 11.30 | 11.36 | 0 | 0.0 | <0.0001 |
| 1000 | mean_reverting | 1.056 | 0.51 | 11.28 | 11.29 | 0 | 0.0 | <0.0001 |
| 1000 | choppy | 1.095 | 0.58 | 11.01 | 11.03 | 0 | 0.0 | 0.0001 |
| 1000 | stress_flash_crash | 1.059 | 0.03 | 10.54 | 10.54 | 0 | 0.0 | 0.1255 |

## Arm A-h1-f1-m1

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -1.59 | -0.86 | -0.73 | 0.3590 | 1.76 | 72 | 88 | 54.5 | -19.4 | 0.887 | 1.098 |
| 10 | mean_reverting | 50 | -6.18 | -6.13 | -0.05 | 0.9289 | 0.74 | 52 | 37 | 100.0 | -5.4 | 1.000 | 1.057 |
| 10 | choppy | 50 | -5.27 | -5.07 | -0.20 | 0.7572 | 0.54 | 34 | 27 | 44.4 | -17.1 | 0.920 | 1.109 |
| 10 | stress_flash_crash | 50 | -9.81 | -9.79 | -0.02 | 0.9738 | 0.02 | 2 | 1 | 0.0 | -39.7 | 0.670 | 1.111 |
| 100 | trending | 50 | -1.81 | -1.15 | -0.66 | 0.2972 | 16.38 | 94 | 819 | 48.0 | -17.3 | 0.916 | 1.106 |
| 100 | mean_reverting | 50 | -6.56 | -6.52 | -0.04 | 0.8488 | 5.10 | 100 | 255 | 93.7 | -6.9 | 0.986 | 1.059 |
| 100 | choppy | 50 | -5.48 | -5.32 | -0.16 | 0.7582 | 5.48 | 58 | 274 | 58.8 | -14.5 | 0.935 | 1.092 |
| 100 | stress_flash_crash | 50 | -10.11 | -10.10 | -0.01 | 0.9799 | 0.32 | 6 | 16 | 37.5 | -30.2 | 0.735 | 1.053 |
| 1000 | trending | 50 | -1.92 | -1.26 | -0.66 | 0.3137 | 165.42 | 94 | 8271 | 44.8 | -17.2 | 0.913 | 1.102 |
| 1000 | mean_reverting | 50 | -6.68 | -6.63 | -0.05 | 0.6263 | 48.60 | 100 | 2430 | 92.7 | -7.4 | 0.978 | 1.056 |
| 1000 | choppy | 50 | -5.54 | -5.37 | -0.16 | 0.7658 | 59.12 | 62 | 2956 | 58.5 | -13.6 | 0.947 | 1.095 |
| 1000 | stress_flash_crash | 50 | -10.15 | -10.13 | -0.02 | 0.9643 | 3.50 | 12 | 175 | 34.3 | -28.0 | 0.763 | 1.059 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.11 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 1.098 | 1.55 | 11.93 | 12.00 | 0 | 0.0 | <0.0001 |
| 10 | mean_reverting | 1.057 | 0.78 | 11.90 | 11.92 | 0 | 0.0 | 0.0001 |
| 10 | choppy | 1.109 | 0.51 | 11.65 | 11.67 | 0 | 0.0 | 0.0002 |
| 10 | stress_flash_crash | 1.111 | 0.01 | 11.20 | 11.19 | 0 | 0.0 | 0.3222 |
| 100 | trending | 1.106 | 1.50 | 11.59 | 11.65 | 0 | 0.0 | <0.0001 |
| 100 | mean_reverting | 1.059 | 0.54 | 11.58 | 11.59 | 0 | 0.0 | <0.0001 |
| 100 | choppy | 1.092 | 0.53 | 11.31 | 11.33 | 0 | 0.0 | 0.0003 |
| 100 | stress_flash_crash | 1.053 | 0.03 | 10.84 | 10.84 | 0 | 0.0 | 0.4470 |
| 1000 | trending | 1.102 | 1.51 | 11.30 | 11.36 | 0 | 0.0 | <0.0001 |
| 1000 | mean_reverting | 1.056 | 0.51 | 11.28 | 11.29 | 0 | 0.0 | <0.0001 |
| 1000 | choppy | 1.095 | 0.58 | 11.01 | 11.03 | 0 | 0.0 | 0.0001 |
| 1000 | stress_flash_crash | 1.059 | 0.03 | 10.54 | 10.54 | 0 | 0.0 | 0.1255 |

## Arm A-h1-f1-m1-t

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -1.13 | -0.61 | -0.52 | 0.3590 | 1.76 | 72 | 88 | 54.5 | -19.4 | 0.887 | 1.098 |
| 10 | mean_reverting | 50 | -4.42 | -4.38 | -0.04 | 0.9289 | 0.74 | 52 | 37 | 100.0 | -5.4 | 1.000 | 1.057 |
| 10 | choppy | 50 | -3.76 | -3.62 | -0.14 | 0.7572 | 0.54 | 34 | 27 | 44.4 | -17.1 | 0.920 | 1.109 |
| 10 | stress_flash_crash | 50 | -7.01 | -6.99 | -0.02 | 0.9738 | 0.02 | 2 | 1 | 0.0 | -39.7 | 0.670 | 1.111 |
| 100 | trending | 50 | -1.64 | -1.04 | -0.60 | 0.2972 | 16.38 | 94 | 819 | 48.0 | -17.3 | 0.916 | 1.106 |
| 100 | mean_reverting | 50 | -5.97 | -5.93 | -0.04 | 0.8488 | 5.10 | 100 | 255 | 93.7 | -6.9 | 0.986 | 1.059 |
| 100 | choppy | 50 | -4.98 | -4.84 | -0.15 | 0.7582 | 5.48 | 58 | 274 | 58.8 | -14.5 | 0.935 | 1.092 |
| 100 | stress_flash_crash | 50 | -9.19 | -9.18 | -0.01 | 0.9799 | 0.32 | 6 | 16 | 37.5 | -30.2 | 0.735 | 1.053 |
| 1000 | trending | 50 | -1.74 | -1.14 | -0.60 | 0.3137 | 165.42 | 94 | 8271 | 44.8 | -17.2 | 0.913 | 1.102 |
| 1000 | mean_reverting | 50 | -6.07 | -6.03 | -0.05 | 0.6263 | 48.60 | 100 | 2430 | 92.7 | -7.4 | 0.978 | 1.056 |
| 1000 | choppy | 50 | -5.03 | -4.89 | -0.15 | 0.7658 | 59.12 | 62 | 2956 | 58.5 | -13.6 | 0.947 | 1.095 |
| 1000 | stress_flash_crash | 50 | -9.23 | -9.21 | -0.02 | 0.9643 | 3.50 | 12 | 175 | 34.3 | -28.0 | 0.763 | 1.059 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.09 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 1.098 | 1.55 | 11.93 | 12.00 | 40 | 0.0 | <0.0001 |
| 10 | mean_reverting | 1.057 | 0.78 | 11.90 | 11.92 | 40 | 0.0 | 0.0001 |
| 10 | choppy | 1.109 | 0.51 | 11.65 | 11.67 | 40 | 0.0 | 0.0002 |
| 10 | stress_flash_crash | 1.111 | 0.01 | 11.20 | 11.19 | 40 | 0.0 | 0.3222 |
| 100 | trending | 1.106 | 1.50 | 11.59 | 11.65 | 100 | 0.0 | <0.0001 |
| 100 | mean_reverting | 1.059 | 0.54 | 11.58 | 11.59 | 100 | 0.0 | <0.0001 |
| 100 | choppy | 1.092 | 0.53 | 11.31 | 11.33 | 100 | 0.0 | 0.0003 |
| 100 | stress_flash_crash | 1.053 | 0.03 | 10.84 | 10.84 | 100 | 0.0 | 0.4470 |
| 1000 | trending | 1.102 | 1.51 | 11.30 | 11.36 | 1000 | 0.0 | <0.0001 |
| 1000 | mean_reverting | 1.056 | 0.51 | 11.28 | 11.29 | 1000 | 0.0 | <0.0001 |
| 1000 | choppy | 1.095 | 0.58 | 11.01 | 11.03 | 1000 | 0.0 | 0.0001 |
| 1000 | stress_flash_crash | 1.059 | 0.03 | 10.54 | 10.54 | 1000 | 0.0 | 0.1255 |

## Arm A-h1-f1-m2.5

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -0.86 | -0.86 | -0.00 | 0.9972 | 0.08 | 6 | 4 | 100.0 | -1.1 | 2.557 | 2.586 |
| 10 | mean_reverting | 50 | -6.13 | -6.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | choppy | 50 | -5.07 | -5.07 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | stress_flash_crash | 50 | -9.79 | -9.79 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | trending | 50 | -1.15 | -1.15 | -0.00 | 0.9945 | 0.64 | 18 | 32 | 100.0 | -1.5 | 2.546 | 2.585 |
| 100 | mean_reverting | 50 | -6.52 | -6.52 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | choppy | 50 | -5.32 | -5.32 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | stress_flash_crash | 50 | -10.10 | -10.10 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | trending | 50 | -1.26 | -1.26 | -0.00 | 0.9956 | 5.30 | 20 | 265 | 100.0 | -1.5 | 2.565 | 2.606 |
| 1000 | mean_reverting | 50 | -6.63 | -6.63 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | choppy | 50 | -5.37 | -5.37 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | stress_flash_crash | 50 | -10.13 | -10.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 2.586 | 0.19 | 12.00 | 12.00 | 0 | 0.0 | 0.3222 |
| 10 | mean_reverting | n/a | 0.00 | 11.92 | 11.92 | 0 | 0.0 | 1.0000 |
| 10 | choppy | n/a | 0.00 | 11.67 | 11.67 | 0 | 0.0 | 1.0000 |
| 10 | stress_flash_crash | n/a | 0.00 | 11.19 | 11.19 | 0 | 0.0 | 1.0000 |
| 100 | trending | 2.585 | 0.16 | 11.65 | 11.65 | 0 | 0.0 | 0.2089 |
| 100 | mean_reverting | n/a | 0.00 | 11.59 | 11.59 | 0 | 0.0 | 1.0000 |
| 100 | choppy | n/a | 0.00 | 11.33 | 11.33 | 0 | 0.0 | 1.0000 |
| 100 | stress_flash_crash | n/a | 0.00 | 10.84 | 10.84 | 0 | 0.0 | 1.0000 |
| 1000 | trending | 2.606 | 0.13 | 11.36 | 11.36 | 0 | 0.0 | 0.2121 |
| 1000 | mean_reverting | n/a | 0.00 | 11.29 | 11.29 | 0 | 0.0 | 1.0000 |
| 1000 | choppy | n/a | 0.00 | 11.03 | 11.03 | 0 | 0.0 | 1.0000 |
| 1000 | stress_flash_crash | n/a | 0.00 | 10.54 | 10.54 | 0 | 0.0 | 1.0000 |

## Arm A-h1-f1-m2.5-t

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -0.71 | -0.43 | -0.28 | 0.4801 | 1.78 | 72 | 89 | 65.2 | -5.9 | 2.352 | 2.500 |
| 10 | mean_reverting | 50 | -3.08 | -3.06 | -0.02 | 0.9459 | 0.74 | 52 | 37 | 100.0 | -1.6 | 2.461 | 2.500 |
| 10 | choppy | 50 | -2.62 | -2.53 | -0.09 | 0.7921 | 0.54 | 34 | 27 | 70.4 | -6.2 | 2.346 | 2.500 |
| 10 | stress_flash_crash | 50 | -4.90 | -4.89 | -0.01 | 0.9764 | 0.02 | 2 | 1 | 0.0 | -29.0 | 1.774 | 2.500 |
| 100 | trending | 50 | -1.32 | -0.92 | -0.40 | 0.4322 | 16.40 | 94 | 820 | 65.4 | -5.8 | 2.354 | 2.500 |
| 100 | mean_reverting | 50 | -5.24 | -5.22 | -0.02 | 0.8898 | 5.12 | 100 | 256 | 98.4 | -2.1 | 2.448 | 2.500 |
| 100 | choppy | 50 | -4.36 | -4.26 | -0.11 | 0.8030 | 5.52 | 58 | 276 | 72.8 | -5.0 | 2.375 | 2.500 |
| 100 | stress_flash_crash | 50 | -8.09 | -8.08 | -0.01 | 0.9820 | 0.32 | 6 | 16 | 43.8 | -19.5 | 2.014 | 2.500 |
| 1000 | trending | 50 | -1.41 | -1.00 | -0.41 | 0.4431 | 164.68 | 94 | 8234 | 63.7 | -5.7 | 2.358 | 2.500 |
| 1000 | mean_reverting | 50 | -5.33 | -5.30 | -0.03 | 0.7125 | 48.64 | 100 | 2432 | 97.7 | -2.2 | 2.444 | 2.500 |
| 1000 | choppy | 50 | -4.40 | -4.30 | -0.10 | 0.8168 | 58.96 | 62 | 2948 | 73.4 | -4.8 | 2.381 | 2.500 |
| 1000 | stress_flash_crash | 50 | -8.12 | -8.10 | -0.02 | 0.9632 | 3.50 | 12 | 175 | 40.6 | -19.7 | 2.008 | 2.500 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.06 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.01 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 2.500 | 3.99 | 12.46 | 12.00 | 100 | 2.5 | <0.0001 |
| 10 | mean_reverting | 2.500 | 1.87 | 12.18 | 11.92 | 100 | 1.1 | 0.0003 |
| 10 | choppy | 2.500 | 1.27 | 11.85 | 11.67 | 100 | 0.8 | 0.0004 |
| 10 | stress_flash_crash | 2.500 | 0.04 | 11.20 | 11.19 | 100 | 0.0 | 0.3222 |
| 100 | trending | 2.500 | 3.75 | 12.09 | 11.65 | 250 | 22.9 | <0.0001 |
| 100 | mean_reverting | 2.500 | 1.33 | 11.79 | 11.59 | 250 | 7.4 | <0.0001 |
| 100 | choppy | 2.500 | 1.32 | 11.51 | 11.33 | 250 | 7.8 | 0.0006 |
| 100 | stress_flash_crash | 2.500 | 0.07 | 10.85 | 10.84 | 250 | 0.5 | 0.4665 |
| 1000 | trending | 2.500 | 3.77 | 11.81 | 11.36 | 2500 | 230.0 | <0.0001 |
| 1000 | mean_reverting | 2.500 | 1.26 | 11.48 | 11.29 | 2500 | 70.2 | <0.0001 |
| 1000 | choppy | 2.500 | 1.42 | 11.22 | 11.03 | 2500 | 82.9 | 0.0002 |
| 1000 | stress_flash_crash | 2.500 | 0.07 | 10.55 | 10.54 | 2500 | 5.0 | 0.1249 |

## Arm A-h1-f1-m5

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -0.86 | -0.86 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | mean_reverting | 50 | -6.13 | -6.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | choppy | 50 | -5.07 | -5.07 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 10 | stress_flash_crash | 50 | -9.79 | -9.79 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | trending | 50 | -1.15 | -1.15 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | mean_reverting | 50 | -6.52 | -6.52 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | choppy | 50 | -5.32 | -5.32 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 100 | stress_flash_crash | 50 | -10.10 | -10.10 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | trending | 50 | -1.26 | -1.26 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | mean_reverting | 50 | -6.63 | -6.63 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | choppy | 50 | -5.37 | -5.37 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |
| 1000 | stress_flash_crash | 50 | -10.13 | -10.13 | 0.00 | 1.0000 | 0.00 | 0 | 0 | n/a | n/a | n/a | n/a |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap 0.00 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | n/a | 0.00 | 12.00 | 12.00 | 0 | 0.0 | 1.0000 |
| 10 | mean_reverting | n/a | 0.00 | 11.92 | 11.92 | 0 | 0.0 | 1.0000 |
| 10 | choppy | n/a | 0.00 | 11.67 | 11.67 | 0 | 0.0 | 1.0000 |
| 10 | stress_flash_crash | n/a | 0.00 | 11.19 | 11.19 | 0 | 0.0 | 1.0000 |
| 100 | trending | n/a | 0.00 | 11.65 | 11.65 | 0 | 0.0 | 1.0000 |
| 100 | mean_reverting | n/a | 0.00 | 11.59 | 11.59 | 0 | 0.0 | 1.0000 |
| 100 | choppy | n/a | 0.00 | 11.33 | 11.33 | 0 | 0.0 | 1.0000 |
| 100 | stress_flash_crash | n/a | 0.00 | 10.84 | 10.84 | 0 | 0.0 | 1.0000 |
| 1000 | trending | n/a | 0.00 | 11.36 | 11.36 | 0 | 0.0 | 1.0000 |
| 1000 | mean_reverting | n/a | 0.00 | 11.29 | 11.29 | 0 | 0.0 | 1.0000 |
| 1000 | choppy | n/a | 0.00 | 11.03 | 11.03 | 0 | 0.0 | 1.0000 |
| 1000 | stress_flash_crash | n/a | 0.00 | 10.54 | 10.54 | 0 | 0.0 | 1.0000 |

## Arm A-h1-f1-m5-t

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -0.34 | -0.29 | -0.06 | 0.8317 | 1.78 | 72 | 89 | 94.4 | -0.1 | 4.997 | 5.000 |
| 10 | mean_reverting | 50 | -2.05 | -2.04 | -0.01 | 0.9786 | 0.74 | 52 | 37 | 100.0 | -0.2 | 4.990 | 5.000 |
| 10 | choppy | 50 | -1.71 | -1.69 | -0.02 | 0.9128 | 0.54 | 34 | 27 | 96.3 | -0.8 | 4.959 | 5.000 |
| 10 | stress_flash_crash | 50 | -3.27 | -3.26 | -0.01 | 0.9743 | 0.02 | 2 | 1 | 100.0 | -16.2 | 4.191 | 5.000 |
| 100 | trending | 50 | -0.85 | -0.77 | -0.08 | 0.8499 | 16.20 | 94 | 810 | 96.3 | 0.1 | 5.006 | 5.000 |
| 100 | mean_reverting | 50 | -4.36 | -4.35 | -0.01 | 0.9539 | 5.14 | 100 | 257 | 100.0 | -0.3 | 4.983 | 5.000 |
| 100 | choppy | 50 | -3.58 | -3.55 | -0.04 | 0.9161 | 5.42 | 58 | 271 | 97.8 | -0.9 | 4.957 | 5.000 |
| 100 | stress_flash_crash | 50 | -6.74 | -6.73 | -0.01 | 0.9793 | 0.32 | 6 | 16 | 100.0 | -12.5 | 4.375 | 5.000 |
| 1000 | trending | 50 | -0.92 | -0.84 | -0.08 | 0.8561 | 163.20 | 94 | 8160 | 96.3 | 0.2 | 5.010 | 5.000 |
| 1000 | mean_reverting | 50 | -4.43 | -4.42 | -0.01 | 0.8767 | 48.54 | 100 | 2427 | 100.0 | -0.3 | 4.983 | 5.000 |
| 1000 | choppy | 50 | -3.62 | -3.58 | -0.04 | 0.9210 | 58.74 | 62 | 2937 | 97.5 | -0.8 | 4.959 | 5.000 |
| 1000 | stress_flash_crash | 50 | -6.77 | -6.75 | -0.01 | 0.9707 | 3.50 | 12 | 175 | 96.6 | -11.2 | 4.440 | 5.000 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.01 pp.

| pop | regime | child start capital | child capital share % | evolving end weighted skill | static end weighted skill | treasury | treasury spent | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.000 | 7.91 | 13.32 | 12.00 | 200 | 7.0 | 0.0006 |
| 10 | mean_reverting | 5.000 | 3.65 | 12.63 | 11.92 | 200 | 2.9 | 0.0081 |
| 10 | choppy | 5.000 | 2.57 | 12.18 | 11.67 | 200 | 2.1 | 0.0183 |
| 10 | stress_flash_crash | 5.000 | 0.09 | 11.21 | 11.19 | 200 | 0.1 | 0.3222 |
| 100 | trending | 5.000 | 7.44 | 12.94 | 11.65 | 500 | 63.1 | <0.0001 |
| 100 | mean_reverting | 5.000 | 2.67 | 12.15 | 11.59 | 500 | 20.3 | 0.0022 |
| 100 | choppy | 5.000 | 2.62 | 11.83 | 11.33 | 500 | 21.2 | 0.0071 |
| 100 | stress_flash_crash | 5.000 | 0.14 | 10.87 | 10.84 | 500 | 1.3 | 0.4594 |
| 1000 | trending | 5.000 | 7.51 | 12.68 | 11.36 | 5000 | 635.5 | <0.0001 |
| 1000 | mean_reverting | 5.000 | 2.53 | 11.83 | 11.29 | 5000 | 191.4 | <0.0001 |
| 1000 | choppy | 5.000 | 2.84 | 11.57 | 11.03 | 5000 | 229.4 | 0.0058 |
| 1000 | stress_flash_crash | 5.000 | 0.16 | 10.57 | 10.54 | 5000 | 13.8 | 0.1603 |
## Findings

1. **No arm outperforms under the pre-registered rule.** The call is inconclusive in all 14 arms. No cell in any arm has a Welch p below 0.05, in either direction. The stress cells are inconclusive on their own in every arm.
2. **No cell anywhere has the evolving mean above the static mean.** In every arm that reproduces, the evolving mean is below the static mean in every cell where children exist (all 12 cells in 9 of the 14 arms). In the other cells the arms do not reproduce and the gap is exactly 0. Of 168 cells, 0 have a positive gap.
3. **Profit-funded larger children mostly means no children.** At fraction 0.5, `m = 2.5` and `m = 5` require profit of 5 and 10, half and all of a founder's principal, and nothing reproduces in any of the 24 cells, consistent with `reproduction-threshold.md` at threshold 0.5. `m = 1` at fraction 0.5 reproduces in 5 of 12 cells with about one eighth of the baseline's children (population 1,000 trending: 32.3 against 245.7 per seed). At fraction 1, `m = 2.5` reproduces in 3 cells, about 5 children per seed at most, and `m = 5` in none. Where the gate binds, the gap shrinks toward 0 because reproduction nearly stops, not because children perform better. Doubling the fraction to 1 does double child size, to about 1.09, and makes children lose less (-5.4 to -39.7 percent against -12.0 to -62.4 percent), but the median gap is unchanged at -0.11 pp and the population 1,000 trending gap only moves from -0.77 to -0.66 pp.
4. **The treasury makes children larger without stopping reproduction, and the gap shrinks with `m`, but never turns positive.** With a treasury the reproduction count is essentially the baseline's, and children start at `m`, or above it where the parent's own contribution already exceeds it (fraction 1, `m = 1`). Restated on founder capital, the median gap moves from -0.11 pp (no treasury) to -0.11, -0.08, and -0.03 pp at `m` of 1, 2.5, and 5 for fraction 0.5, and to -0.11, -0.08, and -0.04 pp for fraction 1. At population 1,000 trending, fraction 0.5, the dollar gap per seed goes from -77.2 to -73.2, -52.7, and -6.3 as `m` rises. Larger children reduce the harm reproduction does; they do not produce a gain.
5. **Children at `m = 5` survive and roughly break even, and still do not lift the population.** At `m = 5` with a treasury, 94 to 100 percent of children are active at the end, and mean child ROI is -0.9 to +0.3 percent in the non-stress cells (-11.2 to -16.2 percent in stress). Children hold up to 10.3 percent of trading capital (population 1,000 trending), against 0.9 percent at the baseline. The capital-weighted skill of the evolving population is above the static population's in every non-stress cell of every treasury arm (population 1,000 trending at fraction 0.5, `m = 5`: 13.47 against 11.36), partly because top-up capital goes to children of above-median parents while the static treasury holds idle cash with no skill. Even so, the evolving mean stays slightly below the static mean in every cell.
6. **Hypothesis for why, consistent with the data but not isolated by this run:** every additional account carries fixed per-tick costs that do not scale with its capital: x402 at $0.01 with a 0.3 purchase probability and $0.001 gas per trade, about $0.004 per tick, or about $1.2 over a full 300-tick life. On a $5 child taking positions of about $1.25 at risk 0.25, that is about 0.08 percent of capital per tick, the same order as the edge a high-skill child earns on that position after the 15 basis points of fee and slippage. So a $5 child earns about what the idle treasury cash earns in the static population, zero, while the parent's share of profit moved into it stops compounding in a larger account. This would explain why the gap approaches 0 from below as `m` rises without crossing it. A test would vary gas and the x402 price, or the information purchase probability, at `m = 5` with a treasury.
7. **Secondary observation, not used for any call.** The paired t-test on per-seed differences has p below 0.05 with evolving lower in 9 of 12 cells in every arm that reproduces in all 12 cells, except fraction 0.5, `m = 5` with a treasury, where it is 6 of 12. It is never below 0.05 with evolving higher.

## What this decides

Issue #82 named three outcomes. This is the third: evolution does not outperform in any arm, profit-funded or treasury-funded, at any reproduction fraction or minimum child capital tested. Child size is not the binding constraint either. Raising it from profit stops reproduction; raising it from a treasury makes reproduction less harmful but not beneficial.

With the profit threshold (issue #74 and PR #79), heritability (issue #80), and child capital (this experiment) each tested in the harness, the reproduction mechanism as designed in `EVOLUTION.md` sections 3 and 4 has not shown a population-level benefit under any setting tried. Per issue #82, the mechanism as designed should be reconsidered before issue #28 proceeds. That is a statement about this harness and its cost model: the harness has no production counterpart for hidden skill, and finding 6 is a hypothesis that fixed per-account costs, not the reproduction rules alone, may be what a split population cannot overcome.

## Limitations

- Hidden skill, its range, and `h = 1` are harness devices, as in `heritability.md`. The markets are synthetic, and the cost model (0.002 information edge, 0.3 purchase probability, 15 basis points of fee and slippage, $0.001 gas, x402 $0.01) is the harness assumption from `ECONOMICS.md` section 3. Finding 6 is sensitive to all of these.
- The treasury is sized so it never runs out. A smaller treasury would fund fewer top-ups and fall back to the plain `m` gate once empty, which by finding 3 means fewer children, so it is not expected to change the sign of the gap. That expectation is not measured here.
- The treasury arm tops up every child from the first reproduction. A treasury that subsidizes only selected parents, or that charges the subsidy back from later profit, was not tested.
- `max_child_capital` stays at the parent's own principal, so a child's own children are capped at that child's starting capital. It never binds at `m` in these arms, but with a larger fraction it can cap grandchildren of small children.
- 300 ticks is short. Children at `m = 5` survive, so a longer horizon might let compounding skill show. That is a hypothesis, not a measured result.
- The Welch test treats evolving and static seeds as independent although they share a market path. The paired test in finding 7 has more power, but it was not pre-registered and is not used for the call.
