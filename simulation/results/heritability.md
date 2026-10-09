# Heritable skill

Issue #80. `twelve-cell-rerun.md` (arm A) found the evolving population slightly below the static one in every cell where reproduction happened, and named one likely cause as a hypothesis: an agent's performance in the harness comes mostly from a hidden per-agent `skill`, and a child drew a fresh `skill` instead of inheriting any of its parent's, so selection had almost nothing heritable to act on. This file tests that hypothesis by making `skill` partly heritable and repeating the arm A comparison.

This is a test of the mechanism, not a claim about production. In production there is no hidden `skill` value. Any heritable advantage has to come from the genome itself (strategy parameters, information sources, model configuration). A positive result here would have shown what the mechanism can do given heritable signal, not that real strategies provide it. The result is negative, which is informative in a different way: see the findings.

## Setup

A child's skill is `h * parent.skill + (1 - h) * fresh`, where `fresh` is drawn from the founder distribution (uniform on -0.002 to 0.004 per tick) using the same agent RNG draw, in the same position in the stream, as before this change. `h` is `RunConfig.skillHeritability`, validated to [0, 1], default 0. Founders are unaffected.

Everything else is PR #79 arm A: profit threshold fraction 0.1 (through `createReproductionModule({ profitThresholdFraction })`), x402 $0.01, information purchases on, populations 10, 100, and 1,000, regimes trending, mean-reverting, choppy, and stress flash crash, seeds 1 to 50 in every cell including population 1,000, 300 ticks, evolving and static modes on the same seeds, diversity on, all starting genomes in one niche, risk tolerance 0.25, execution every tick. `protocol.ts` is not changed. Static runs use the same `h` value, which has no effect there because static runs have no children.

`h` takes the values 0, 0.25, 0.5, 0.75, and 1. The no-purchase arm is PR #79 arm B (threshold 0.1, information purchases off) at one `h`. The choice rule was fixed before the arm A results were read: run it at the smallest `h` whose arm A call is "outperforms", and if there is none, at `h = 1`, the strongest heritable signal the parameter allows. No `h` gave "outperforms", so the no-purchase arm is at `h = 1`.

Per-cell statistics and child survival are exactly as in `twelve-cell-rerun.md`. Added columns, in a second table per arm:

- "skill start": mean over seeds of the founders' mean skill. Founders are identical in both modes and at every `h`.
- "end active": mean over seeds of the mean skill of agents still active at tick 300, evolving and static. Retirement removes low performers in both modes, so the static column is the control for how far retirement alone moves this number.
- "end weighted": mean over seeds of the capital-weighted mean skill over every agent at tick 300, active or retired. This is the skill that actually drives the population's ROI, because ROI is measured on total capital.
- "paired p (secondary)": a two-sided paired t-test on per-seed evolving minus static ROI, pairing runs that share a seed and so a market path. It is reported as an observation only. It is not the pre-registered statistic and is not used for any call.

Skill is shown in basis points per tick (0.0010 is 10.00).

## Decision rule

Unchanged from `ECONOMICS.md` section 8 and applied by `decide` in `src/rerun.ts`. Evolution outperforms only if at least 7 of the 12 cells have the evolving mean ROI higher with a two-sided Welch p below 0.05, and the median gap across the 12 cells is positive. Fewer than 6 cells with p below 0.05 in either direction is inconclusive. The stress regime is reported on its own.

## The h = 0 equivalence check

`h = 0` must reproduce PR #79 arm A. Two checks:

1. `test/heritability.test.ts` asserts that a run with `skillHeritability: 0` is deep-equal to a run with it unset, on an arm A configuration that reproduces. It also asserts that `h = 1` gives every child exactly its parent's skill, that founders do not depend on `h`, and that values outside [0, 1] and non-finite values are rejected.
2. Every field of the 12 published arm A rows in `results/twelve-cell-rerun/A-*.json` (14 fields per row: means, gap, Welch p, reproduction counts, child statistics) was compared with `Object.is` against the `h = 0` rows in `results/heritability/A-h0-*.json`. 168 of 168 fields are identical, so `h = 0` matches PR #79 arm A bit for bit, not only to the reported precision.

## Commands

From `simulation/`, after `bun run test` (which builds `dist/`):

```bash
# arm A at five h values: 60 jobs, 10 in parallel
for pop in 1000 100 10; do for h in 0 0.25 0.5 0.75 1; do for regime in trending mean_reverting choppy stress_flash_crash; do
  echo "A $h $pop $regime"
done; done; done | xargs -P 10 -L 1 zsh -c \
  'ARM=$0 H=$1 POPS=$2 REGIMES=$3 SEEDS=50 OUT=results/heritability/$0-h$1-$2-$3.json node dist/src/cli-rerun.js'

# no-purchase arm at h = 1: 12 jobs, same loop with "B 1 $pop $regime"

node dist/src/cli-rerun-report.js results/heritability
```

Wall time on a laptop with 11 cores: 975 seconds for the 60 arm A jobs and 274 seconds for the 12 arm B jobs. No seeds were reduced anywhere. The per-cell JSON outputs are in `results/heritability/`, and the tables below are the report command's output.

## Summary

| h | cells p < 0.05 | direction | median gap pp | stress (3 cells) | call | skill start | evolving end active | evolving end weighted | static end weighted |
|---:|---:|---|---:|---|---|---:|---:|---:|---:|
| 0 | 0 of 12 | evolving lower in 12 of 12 | -0.11 | inconclusive, gaps -0.01 to -0.02 | inconclusive | 10.02 to 10.66 | 15.55 to 19.42 | 10.54 to 11.81 | 10.54 to 12.00 |
| 0.25 | 0 of 12 | evolving lower in 12 of 12 | -0.11 | inconclusive, gaps -0.01 to -0.02 | inconclusive | same | 16.48 to 19.42 | 10.54 to 11.83 | same |
| 0.5 | 0 of 12 | evolving lower in 12 of 12 | -0.12 | inconclusive, gaps -0.01 to -0.02 | inconclusive | same | 17.36 to 19.42 | 10.54 to 11.86 | same |
| 0.75 | 0 of 12 | evolving lower in 12 of 12 | -0.11 | inconclusive, gaps -0.01 to -0.02 | inconclusive | same | 17.80 to 19.50 | 10.54 to 11.88 | same |
| 1 | 0 of 12 | evolving lower in 12 of 12 | -0.11 | inconclusive, gaps -0.01 to -0.02 | inconclusive | same | 17.83 to 20.12 | 10.54 to 11.91 | same |
| 1, no purchase | 0 of 12 | evolving lower in 12 of 12 | -0.17 | inconclusive, gaps -0.03 to -0.04 | inconclusive | same | 15.55 to 19.46 | 10.52 to 11.95 | 10.52 to 11.99 |

Ranges are across the 12 cells. Per-cell values are in the tables below.

## Arm A-h0

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

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.11 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

| pop | regime | skill start | evolving end active | static end active | evolving end weighted | static end weighted | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|
| 10 | trending | 10.66 | 16.26 | 20.30 | 11.73 | 12.00 | <0.0001 |
| 10 | mean_reverting | 10.66 | 17.62 | 18.94 | 11.81 | 11.92 | 0.0002 |
| 10 | choppy | 10.66 | 17.82 | 19.28 | 11.57 | 11.67 | 0.0004 |
| 10 | stress_flash_crash | 10.66 | 19.42 | 19.54 | 11.20 | 11.19 | 0.3222 |
| 100 | trending | 10.33 | 15.87 | 19.54 | 11.36 | 11.65 | <0.0001 |
| 100 | mean_reverting | 10.33 | 17.16 | 17.90 | 11.51 | 11.59 | <0.0001 |
| 100 | choppy | 10.33 | 17.04 | 18.19 | 11.24 | 11.33 | 0.0007 |
| 100 | stress_flash_crash | 10.33 | 18.15 | 18.22 | 10.84 | 10.84 | 0.4815 |
| 1000 | trending | 10.02 | 15.55 | 19.44 | 11.06 | 11.36 | <0.0001 |
| 1000 | mean_reverting | 10.02 | 16.94 | 17.66 | 11.21 | 11.29 | <0.0001 |
| 1000 | choppy | 10.02 | 16.77 | 18.06 | 10.93 | 11.03 | 0.0002 |
| 1000 | stress_flash_crash | 10.02 | 17.81 | 17.88 | 10.54 | 10.54 | 0.1728 |

## Arm A-h0.25

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -1.72 | -0.86 | -0.87 | 0.2684 | 2.52 | 72 | 126 | 57.9 | -41.2 | 0.324 | 0.549 |
| 10 | mean_reverting | 50 | -6.18 | -6.13 | -0.06 | 0.9267 | 0.74 | 52 | 37 | 100.0 | -12.5 | 0.463 | 0.528 |
| 10 | choppy | 50 | -5.28 | -5.07 | -0.22 | 0.7355 | 0.72 | 34 | 36 | 61.1 | -34.2 | 0.363 | 0.550 |
| 10 | stress_flash_crash | 50 | -9.80 | -9.79 | -0.02 | 0.9815 | 0.02 | 2 | 1 | 0.0 | -62.5 | 0.208 | 0.556 |
| 100 | trending | 50 | -1.91 | -1.15 | -0.77 | 0.2189 | 23.74 | 94 | 1187 | 58.2 | -35.6 | 0.357 | 0.552 |
| 100 | mean_reverting | 50 | -6.56 | -6.52 | -0.04 | 0.8432 | 5.10 | 100 | 255 | 94.1 | -15.9 | 0.446 | 0.530 |
| 100 | choppy | 50 | -5.49 | -5.32 | -0.17 | 0.7392 | 6.72 | 58 | 336 | 62.5 | -29.9 | 0.386 | 0.549 |
| 100 | stress_flash_crash | 50 | -10.11 | -10.10 | -0.01 | 0.9860 | 0.32 | 6 | 16 | 18.8 | -49.1 | 0.268 | 0.526 |
| 1000 | trending | 50 | -2.04 | -1.26 | -0.78 | 0.2264 | 245.60 | 94 | 12280 | 57.0 | -35.1 | 0.359 | 0.551 |
| 1000 | mean_reverting | 50 | -6.68 | -6.63 | -0.05 | 0.6138 | 48.52 | 100 | 2426 | 92.5 | -17.1 | 0.438 | 0.528 |
| 1000 | choppy | 50 | -5.55 | -5.37 | -0.17 | 0.7520 | 70.18 | 62 | 3509 | 62.6 | -28.3 | 0.395 | 0.549 |
| 1000 | stress_flash_crash | 50 | -10.15 | -10.13 | -0.02 | 0.9678 | 3.50 | 12 | 175 | 23.4 | -46.7 | 0.282 | 0.530 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.11 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

| pop | regime | skill start | evolving end active | static end active | evolving end weighted | static end weighted | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|
| 10 | trending | 10.66 | 17.04 | 20.30 | 11.77 | 12.00 | <0.0001 |
| 10 | mean_reverting | 10.66 | 18.25 | 18.94 | 11.83 | 11.92 | 0.0001 |
| 10 | choppy | 10.66 | 18.15 | 19.28 | 11.59 | 11.67 | 0.0003 |
| 10 | stress_flash_crash | 10.66 | 19.42 | 19.54 | 11.20 | 11.19 | 0.3222 |
| 100 | trending | 10.33 | 16.91 | 19.54 | 11.41 | 11.65 | <0.0001 |
| 100 | mean_reverting | 10.33 | 17.60 | 17.90 | 11.53 | 11.59 | <0.0001 |
| 100 | choppy | 10.33 | 17.40 | 18.19 | 11.26 | 11.33 | 0.0007 |
| 100 | stress_flash_crash | 10.33 | 18.16 | 18.22 | 10.84 | 10.84 | 0.5519 |
| 1000 | trending | 10.02 | 16.48 | 19.44 | 11.12 | 11.36 | <0.0001 |
| 1000 | mean_reverting | 10.02 | 17.34 | 17.66 | 11.23 | 11.29 | <0.0001 |
| 1000 | choppy | 10.02 | 17.13 | 18.06 | 10.95 | 11.03 | 0.0002 |
| 1000 | stress_flash_crash | 10.02 | 17.81 | 17.88 | 10.54 | 10.54 | 0.1427 |

## Arm A-h0.5

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -1.72 | -0.86 | -0.87 | 0.2699 | 2.52 | 72 | 126 | 58.7 | -40.8 | 0.327 | 0.549 |
| 10 | mean_reverting | 50 | -6.18 | -6.13 | -0.06 | 0.9265 | 0.74 | 52 | 37 | 100.0 | -12.5 | 0.463 | 0.528 |
| 10 | choppy | 50 | -5.28 | -5.07 | -0.22 | 0.7355 | 0.72 | 34 | 36 | 61.1 | -34.2 | 0.363 | 0.550 |
| 10 | stress_flash_crash | 50 | -9.80 | -9.79 | -0.02 | 0.9815 | 0.02 | 2 | 1 | 0.0 | -62.5 | 0.209 | 0.556 |
| 100 | trending | 50 | -1.91 | -1.15 | -0.76 | 0.2199 | 23.74 | 94 | 1187 | 57.7 | -35.6 | 0.357 | 0.552 |
| 100 | mean_reverting | 50 | -6.57 | -6.52 | -0.04 | 0.8430 | 5.10 | 100 | 255 | 93.7 | -15.9 | 0.446 | 0.530 |
| 100 | choppy | 50 | -5.49 | -5.32 | -0.18 | 0.7383 | 6.70 | 58 | 335 | 62.4 | -30.2 | 0.384 | 0.549 |
| 100 | stress_flash_crash | 50 | -10.11 | -10.10 | -0.01 | 0.9858 | 0.32 | 6 | 16 | 18.8 | -50.1 | 0.262 | 0.526 |
| 1000 | trending | 50 | -2.04 | -1.26 | -0.78 | 0.2271 | 245.68 | 94 | 12284 | 57.4 | -35.0 | 0.359 | 0.552 |
| 1000 | mean_reverting | 50 | -6.68 | -6.63 | -0.05 | 0.6128 | 48.52 | 100 | 2426 | 92.5 | -17.1 | 0.438 | 0.528 |
| 1000 | choppy | 50 | -5.55 | -5.37 | -0.17 | 0.7501 | 70.06 | 62 | 3503 | 61.4 | -28.3 | 0.395 | 0.549 |
| 1000 | stress_flash_crash | 50 | -10.15 | -10.13 | -0.02 | 0.9631 | 3.50 | 12 | 175 | 23.4 | -46.3 | 0.284 | 0.530 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.12 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

| pop | regime | skill start | evolving end active | static end active | evolving end weighted | static end weighted | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|
| 10 | trending | 10.66 | 17.68 | 20.30 | 11.81 | 12.00 | <0.0001 |
| 10 | mean_reverting | 10.66 | 18.87 | 18.94 | 11.86 | 11.92 | 0.0001 |
| 10 | choppy | 10.66 | 18.46 | 19.28 | 11.61 | 11.67 | 0.0003 |
| 10 | stress_flash_crash | 10.66 | 19.42 | 19.54 | 11.20 | 11.19 | 0.3222 |
| 100 | trending | 10.33 | 17.74 | 19.54 | 11.46 | 11.65 | <0.0001 |
| 100 | mean_reverting | 10.33 | 18.04 | 17.90 | 11.54 | 11.59 | <0.0001 |
| 100 | choppy | 10.33 | 17.72 | 18.19 | 11.27 | 11.33 | 0.0006 |
| 100 | stress_flash_crash | 10.33 | 18.16 | 18.22 | 10.84 | 10.84 | 0.5488 |
| 1000 | trending | 10.02 | 17.36 | 19.44 | 11.17 | 11.36 | <0.0001 |
| 1000 | mean_reverting | 10.02 | 17.76 | 17.66 | 11.25 | 11.29 | <0.0001 |
| 1000 | choppy | 10.02 | 17.47 | 18.06 | 10.97 | 11.03 | 0.0002 |
| 1000 | stress_flash_crash | 10.02 | 17.83 | 17.88 | 10.54 | 10.54 | 0.1241 |

## Arm A-h0.75

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | -1.72 | -0.86 | -0.86 | 0.2719 | 2.52 | 72 | 126 | 59.5 | -40.6 | 0.328 | 0.549 |
| 10 | mean_reverting | 50 | -6.18 | -6.13 | -0.05 | 0.9276 | 0.74 | 52 | 37 | 100.0 | -12.3 | 0.464 | 0.528 |
| 10 | choppy | 50 | -5.28 | -5.07 | -0.22 | 0.7360 | 0.72 | 34 | 36 | 61.1 | -34.1 | 0.363 | 0.550 |
| 10 | stress_flash_crash | 50 | -9.80 | -9.79 | -0.02 | 0.9816 | 0.02 | 2 | 1 | 0.0 | -62.4 | 0.209 | 0.556 |
| 100 | trending | 50 | -1.91 | -1.15 | -0.76 | 0.2243 | 23.88 | 94 | 1194 | 58.8 | -35.1 | 0.361 | 0.553 |
| 100 | mean_reverting | 50 | -6.56 | -6.52 | -0.04 | 0.8458 | 5.10 | 100 | 255 | 93.7 | -15.6 | 0.447 | 0.530 |
| 100 | choppy | 50 | -5.49 | -5.32 | -0.17 | 0.7402 | 6.68 | 58 | 334 | 62.0 | -29.9 | 0.386 | 0.549 |
| 100 | stress_flash_crash | 50 | -10.11 | -10.10 | -0.01 | 0.9850 | 0.32 | 6 | 16 | 18.8 | -50.2 | 0.262 | 0.526 |
| 1000 | trending | 50 | -2.03 | -1.26 | -0.78 | 0.2305 | 245.56 | 94 | 12278 | 57.1 | -34.7 | 0.361 | 0.552 |
| 1000 | mean_reverting | 50 | -6.68 | -6.63 | -0.05 | 0.6179 | 48.52 | 100 | 2426 | 92.5 | -16.8 | 0.440 | 0.528 |
| 1000 | choppy | 50 | -5.55 | -5.37 | -0.17 | 0.7512 | 69.84 | 62 | 3492 | 61.6 | -28.1 | 0.396 | 0.549 |
| 1000 | stress_flash_crash | 50 | -10.15 | -10.13 | -0.02 | 0.9644 | 3.50 | 12 | 175 | 23.4 | -46.8 | 0.282 | 0.530 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.11 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.02 pp.

| pop | regime | skill start | evolving end active | static end active | evolving end weighted | static end weighted | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|
| 10 | trending | 10.66 | 18.60 | 20.30 | 11.86 | 12.00 | <0.0001 |
| 10 | mean_reverting | 10.66 | 19.50 | 18.94 | 11.88 | 11.92 | 0.0001 |
| 10 | choppy | 10.66 | 18.76 | 19.28 | 11.63 | 11.67 | 0.0003 |
| 10 | stress_flash_crash | 10.66 | 19.42 | 19.54 | 11.20 | 11.19 | 0.3222 |
| 100 | trending | 10.33 | 18.56 | 19.54 | 11.51 | 11.65 | <0.0001 |
| 100 | mean_reverting | 10.33 | 18.48 | 17.90 | 11.56 | 11.59 | <0.0001 |
| 100 | choppy | 10.33 | 18.02 | 18.19 | 11.29 | 11.33 | 0.0006 |
| 100 | stress_flash_crash | 10.33 | 18.17 | 18.22 | 10.84 | 10.84 | 0.5400 |
| 1000 | trending | 10.02 | 18.17 | 19.44 | 11.22 | 11.36 | <0.0001 |
| 1000 | mean_reverting | 10.02 | 18.19 | 17.66 | 11.26 | 11.29 | <0.0001 |
| 1000 | choppy | 10.02 | 17.80 | 18.06 | 10.99 | 11.03 | 0.0002 |
| 1000 | stress_flash_crash | 10.02 | 17.83 | 17.88 | 10.54 | 10.54 | 0.1173 |

## Arm A-h1

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

| pop | regime | skill start | evolving end active | static end active | evolving end weighted | static end weighted | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|
| 10 | trending | 10.66 | 19.32 | 20.30 | 11.91 | 12.00 | <0.0001 |
| 10 | mean_reverting | 10.66 | 20.12 | 18.94 | 11.90 | 11.92 | 0.0001 |
| 10 | choppy | 10.66 | 19.04 | 19.28 | 11.65 | 11.67 | 0.0003 |
| 10 | stress_flash_crash | 10.66 | 19.42 | 19.54 | 11.20 | 11.19 | 0.3222 |
| 100 | trending | 10.33 | 19.39 | 19.54 | 11.57 | 11.65 | <0.0001 |
| 100 | mean_reverting | 10.33 | 18.91 | 17.90 | 11.58 | 11.59 | <0.0001 |
| 100 | choppy | 10.33 | 18.33 | 18.19 | 11.31 | 11.33 | 0.0007 |
| 100 | stress_flash_crash | 10.33 | 18.18 | 18.22 | 10.84 | 10.84 | 0.5412 |
| 1000 | trending | 10.02 | 19.03 | 19.44 | 11.28 | 11.36 | <0.0001 |
| 1000 | mean_reverting | 10.02 | 18.61 | 17.66 | 11.28 | 11.29 | <0.0001 |
| 1000 | choppy | 10.02 | 18.14 | 18.06 | 11.01 | 11.03 | 0.0002 |
| 1000 | stress_flash_crash | 10.02 | 17.83 | 17.88 | 10.54 | 10.54 | 0.1168 |

## Arm B-h1

| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 50 | 3.19 | 3.66 | -0.47 | 0.5132 | 4.26 | 90 | 213 | 73.2 | -7.7 | 0.517 | 0.560 |
| 10 | mean_reverting | 50 | -1.16 | -0.99 | -0.17 | 0.7359 | 1.92 | 80 | 96 | 70.8 | -6.4 | 0.494 | 0.528 |
| 10 | choppy | 50 | -0.15 | 0.03 | -0.17 | 0.7408 | 1.76 | 64 | 88 | 64.8 | -7.5 | 0.509 | 0.550 |
| 10 | stress_flash_crash | 50 | -4.19 | -4.16 | -0.03 | 0.9570 | 0.24 | 16 | 12 | 66.7 | -10.4 | 0.489 | 0.544 |
| 100 | trending | 50 | 2.83 | 3.29 | -0.46 | 0.4474 | 41.88 | 100 | 2094 | 64.3 | -7.0 | 0.517 | 0.557 |
| 100 | mean_reverting | 50 | -1.65 | -1.51 | -0.14 | 0.5004 | 17.22 | 100 | 861 | 60.9 | -5.7 | 0.500 | 0.530 |
| 100 | choppy | 50 | -0.50 | -0.33 | -0.17 | 0.7149 | 17.34 | 84 | 867 | 59.5 | -6.6 | 0.511 | 0.547 |
| 100 | stress_flash_crash | 50 | -4.53 | -4.49 | -0.04 | 0.9313 | 2.42 | 34 | 121 | 44.6 | -11.2 | 0.492 | 0.552 |
| 1000 | trending | 50 | 2.70 | 3.16 | -0.46 | 0.4613 | 426.64 | 100 | 21332 | 63.8 | -6.9 | 0.519 | 0.557 |
| 1000 | mean_reverting | 50 | -1.80 | -1.66 | -0.14 | 0.1938 | 169.78 | 100 | 8489 | 57.8 | -5.7 | 0.500 | 0.530 |
| 1000 | choppy | 50 | -0.55 | -0.39 | -0.17 | 0.7214 | 175.52 | 86 | 8776 | 60.5 | -6.5 | 0.511 | 0.547 |
| 1000 | stress_flash_crash | 50 | -4.55 | -4.52 | -0.03 | 0.9456 | 22.64 | 38 | 1132 | 44.6 | -10.9 | 0.491 | 0.550 |

Call: **inconclusive**. 0 of 12 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.17 pp.

Stress cells only: Call: **inconclusive**. 0 of 3 cells have p < 0.05 (0 with evolving higher, 0 with evolving lower). Median gap -0.03 pp.

| pop | regime | skill start | evolving end active | static end active | evolving end weighted | static end weighted | paired p (secondary) |
|---:|---|---:|---:|---:|---:|---:|---:|
| 10 | trending | 10.66 | 19.46 | 19.17 | 11.95 | 11.99 | <0.0001 |
| 10 | mean_reverting | 10.66 | 17.91 | 17.65 | 11.76 | 11.77 | <0.0001 |
| 10 | choppy | 10.66 | 17.52 | 17.64 | 11.59 | 11.60 | <0.0001 |
| 10 | stress_flash_crash | 10.66 | 17.16 | 17.10 | 11.16 | 11.16 | 0.0698 |
| 100 | trending | 10.33 | 18.90 | 18.20 | 11.64 | 11.66 | <0.0001 |
| 100 | mean_reverting | 10.33 | 16.54 | 15.43 | 11.42 | 11.43 | <0.0001 |
| 100 | choppy | 10.33 | 16.24 | 15.89 | 11.27 | 11.28 | <0.0001 |
| 100 | stress_flash_crash | 10.33 | 15.96 | 16.01 | 10.82 | 10.82 | 0.0104 |
| 1000 | trending | 10.02 | 18.45 | 17.91 | 11.35 | 11.38 | <0.0001 |
| 1000 | mean_reverting | 10.02 | 16.02 | 14.86 | 11.13 | 11.14 | <0.0001 |
| 1000 | choppy | 10.02 | 15.87 | 15.40 | 10.98 | 10.98 | <0.0001 |
| 1000 | stress_flash_crash | 10.02 | 15.55 | 15.67 | 10.52 | 10.52 | 0.0062 |
## Findings

1. **No `h` gives "outperforms" under the pre-registered rule, so there is no smallest such `h`.** The call is inconclusive at every `h` in {0, 0.25, 0.5, 0.75, 1} and in the no-purchase arm at `h = 1`. No cell in any of the six arms has a Welch p below 0.05. The stress cells are inconclusive on their own in every arm.
2. **Heritability barely moves the gap.** From `h = 0` to `h = 1` the per-cell gap changes by at most 0.02 pp (population 1,000 trending: -0.78 to -0.77 pp; population 10 trending: -0.85 to -0.86 pp), and the median gap stays at -0.11 to -0.12 pp. The evolving mean is below the static mean in all 12 cells at every `h`, as in PR #79.
3. **Selection does act on heritable skill, but it acts on very little capital.** With `h` raised, the mean skill of active agents in the evolving population rises (population 1,000 trending: 15.55 at `h = 0` to 19.03 at `h = 1`, against 10.02 at the start), and at `h = 1` it exceeds the static population's in the mean-reverting cells at every population and in the choppy cells at populations 100 and 1,000. So reproduction does pass on above-average skill once it can. The capital-weighted skill, which is what ROI depends on, moves much less: in the same cell 11.06 at `h = 0` to 11.28 at `h = 1`, still below the static 11.36. It is below the static value in every non-stress cell at every `h`, and within 0.01 of it in the stress cells, where few agents reproduce.
4. **Most of the rise in mean skill is retirement, in both modes.** Active mean skill roughly doubles from the start in static runs too (about 10 to 18 to 20), because the capital floor and the bottom-decile rule remove low-skill agents whatever the mode. Reproduction is not what lifts the population's skill in this harness.
5. **Child survival does not depend on `h`.** Children start with about $0.53 to $0.56 at every `h`. At population 1,000 trending, mean child ROI is -35.2 percent at `h = 0` and -34.3 percent at `h = 1`, and 57.7 against 57.3 percent of children are active at the end. Across all arm A cells, child ROI varies by at most 1.6 points between any two `h` values. With purchases off at `h = 1`, children lose 5.7 to 11.2 percent and 45 to 73 percent stay active, close to PR #79 arm B.
6. **The no-purchase arm shows the same pattern.** At `h = 1` with purchases off, ROI rises for both modes by roughly the same 4.4 to 5.6 pp as in PR #79, the gap is -0.03 to -0.47 pp (median -0.17 pp, against -0.16 pp in PR #79 arm B at `h = 0`), and no cell has p below 0.05. The information-cost finding and the heritability finding are separate: removing the information cost does not make heritability matter.
7. **Hypothesis for why, consistent with the data but not isolated by this run:** the capital moved into children is too small for any inherited advantage to show at the population level within 300 ticks. At population 1,000 trending, an evolving seed creates about 246 children with about $0.55 each, roughly $136 of a $10,000 starting population, or 1.4 percent. A child at risk 0.25 takes positions of about $0.14, where the fixed $0.001 gas is about 0.7 percent per trade. As a rough estimate, a child with the founder maximum skill of 0.004 per tick earns on the order of cents over its life on that base, and that is spread over 1.4 percent of capital, while the parent capital moved out of a high-skill $10 account is no longer compounding at the parent's skill. This points at the minimum child capital, not heritability, as the binding constraint. A test would hold `h = 1` and raise `max_child_capital` or the reproduction fraction, or lower gas.
8. **Secondary observation, not used for any call.** The paired t-test on per-seed differences, which uses the shared market path, has p below 0.05 with evolving lower in all 9 non-stress cells at every `h` in arm A, and in 11 of 12 cells in the no-purchase arm. The pre-registered Welch test does not see these differences because the between-seed spread in ROI is much larger than the gap. Read as an observation only: on a matched market path, reproduction in this harness makes the population slightly worse, at every `h` tested.

## What this decides

Issue #80 named three outcomes. This is the third: evolution does not outperform at any `h`, so heritability of skill is not the binding problem in this harness. The next hypothesis to test before issue #28 is the minimum child capital (finding 7).

This does not show that heritability is unimportant in production. It shows that in this harness, with children carrying about 5 percent of a parent principal, even perfect inheritance of the strongest performance driver does not change the population result. In production there is no hidden skill. Any heritable advantage would have to come from the genome, and whether real strategies provide one is a separate, open question that this experiment does not address.

## Limitations

- Hidden skill is a harness device. Its range (-0.002 to 0.004 per tick), the uniform distribution of the fresh draw, and the linear blend `h * parent + (1 - h) * fresh` are modeling assumptions, not measured properties of any real strategy. A model where children inherit skill with a different distribution, or where skill drifts over time, might behave differently.
- The blend shrinks a child toward the founder mean of 0.001, so at `h` below 1 a high-skill parent's children are on average less skilled than the parent. Only `h = 1` passes the advantage on in full, and it still does not change the call.
- Markets are synthetic, and the 0.002 information edge, the 0.3 purchase probability, the 15 basis point fee and slippage assumption, and the $0.001 gas base case are the harness assumptions from `ECONOMICS.md` section 3 and `twelve-cell-rerun.md`. Finding 7 is sensitive to gas and to the child capital rule.
- 300 ticks is short for children that start at about 5 percent of a parent principal. A longer horizon was not measured, and heritable skill compounds over generations, so a longer run might show more. That is a hypothesis, not a measured result.
- The Welch test treats evolving and static seeds as independent although they share a market path. The paired test in finding 8 has more power, but it was not pre-registered and is not used for the call.
- "end active" is averaged over the seeds that have at least one active agent at the end, so a seed where every agent retired does not contribute to it.
