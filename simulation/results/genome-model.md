# Genome performance model

Issue #84. In the harness so far, an agent's performance comes mostly from a hidden per-agent `skill` value drawn from -0.002 to 0.004 per tick, not from its genome, and under the legal policy every founder has the same genome. Selection can only act on what the genome carries, so in that model no selection mechanism can show a benefit, and `EVOLUTION.md` section 8.4 names a genome-to-return link as a prerequisite for issue #85. Production has no hidden skill: any advantage there has to come from the genome.

This file defines an experiment-only performance model in which the genome produces a regime-dependent edge, states every number in it as an assumption, and validates it in a static population before it is used for any selection comparison. It is a device that gives selection something to find. It is not a claim that real strategies have this structure, or any edge at all.

## Which genome fields can carry performance

Under the legal policy (risk tolerance 0.25, execution frequency 1, the section 8 baseline used by every re-run), two fields are pinned: `riskTolerance` sits at its 0.25 ceiling and `executionFrequency` at its minimum of 1. The model therefore does not link performance to either. It links performance only to fields that the harness strategy reads and that the policy leaves free:

- `timeHorizon`, the lookback of the trailing-mean signal.
- `entryThreshold`, the level the trailing mean plus edge must clear to go long.
- The traded pair, `assetUniverse[0]`. The rest of the pair set changes the niche (`EVOLUTION.md` section 5) but not what is traded.

Issue #84 also lists `exitThreshold`. It is not used: the harness strategy (`src/strategy.ts`) is long or flat and never reads `exitThreshold`, and neither does the production strategy plugin. Linking performance to it would create an edge from a field that changes no action, which nothing in production could reproduce. If a strategy that reads it is added, it can join the score with its own weight.

## Functional form

All of this is in `src/genome-model.ts`.

Per regime there is one optimum genome:

| regime | optimum `timeHorizon` | optimum `entryThreshold` | optimum pair |
|---|---:|---:|---|
| trending | 100 | -0.002 | PAIR_A |
| mean_reverting | 3 | -0.006 | PAIR_B |
| choppy | 12 | -0.004 | PAIR_C |
| stress_flash_crash | 12 | -0.004 | PAIR_C |

A genome's score, in [0, 1], is a weighted closeness to that optimum:

```
horizon_distance = min(1, |ln(timeHorizon / optimum.timeHorizon)| / ln(200))
entry_distance   = min(1, |entryThreshold - optimum.entryThreshold| / 0.02)
pair_match       = 1 if assetUniverse[0] == optimum.pair else 0
score            = 0.4 * (1 - horizon_distance) + 0.3 * (1 - entry_distance) + 0.3 * pair_match
distance         = 1 - score
edge             = magnitude * (score - 1/3)
```

While an agent is in the market, `edge` is added to the bar return exactly where the hidden skill was added before (`src/runner.ts`), and it also enters the entry signal (trailing mean plus edge against the threshold), as the hidden skill did. An information purchase still adds `infoEdge` on that tick. The edge range is `[-magnitude/3, 2 magnitude/3]`, so at magnitude 0.006 it is -0.002 to 0.004 per tick, the hidden skill range.

### Why these choices (assumptions, not measurements)

- **Regime dependence.** A long lookback is assumed to pay in a trending market, a short one in a mean-reverting market, and a middle one in a choppy market, which is the example in issue #84. Horizon distance is measured on a log scale over the allowed range 1 to 200, because a step from 3 to 6 changes a lookback far more than a step from 100 to 103.
- **The stress regime shares the choppy optimum.** It is a choppy market with one shock at tick 150. A genome fit to the regime before the shock is not told about the shock, which is the transfer question in `EVOLUTION.md` section 7.
- **Entry thresholds are negative at every optimum.** The edge accrues only while the agent is in the market, so an optimum genome that is rarely in the market would collect little of it. Each optimum threshold is set so the optimum genome should be in the market on most ticks: for example, at a lookback of 100 in the trending regime the trailing mean is about 0.0008 with a standard deviation of about 0.001, well above -0.002. This in-market share was not measured separately. The scale 0.02 is twice the half-width of the random draw below, so a random genome's entry distance stays below 1.
- **Weights 0.4, 0.3, 0.3.** No component dominates. The horizon gets slightly more weight because it is the field the issue names as regime-dependent.
- **Pair preference per regime.** The harness market has one price path for every pair, so the pair component is purely an assumed per-regime preference. It gives the niche structure in section 5, which is keyed on the pair set, something to select between.
- **Offset 1/3.** It maps the score range onto the hidden skill range at magnitude 0.006, so a genome with score 1/3 has zero edge.

### Random genomes

`randomGenome` (used when `RunConfig.randomGenomes` is on) draws `timeHorizon` log-uniformly on [1, 200], `entryThreshold` uniformly on [-0.01, 0.01] (about one tick of market noise, 0.01), and a pair set by shuffling the three allowed pairs and keeping the first 1, 2, or 3, so the traded pair is uniform. Every other field comes from the policy genome, so risk tolerance stays 0.25 and execution frequency 1. Random genomes are drawn from a separate RNG stream (salt 3), so the market path and the agent stream (information purchase draws, skill draws) are unchanged.

### How it combines with the hidden skill

When the model is on, the hidden skill is 0 for every agent, founders and children. Its draw is still made, so the agent RNG stream is identical with the model on or off. Reasons:

- Production has no hidden skill. The point of issue #84 is to test selection on what the genome carries, and a non-heritable per-agent edge of the same size would be noise that no genome-level mechanism can select for.
- Keeping both at full size would double the cross-agent spread and make the edge range no longer comparable to the earlier runs. The model is sized to replace the hidden skill, not to add to it.
- A reduced residual skill is a reasonable later variant (some unobserved per-agent quality is realistic). It is not added here, so that a negative result cannot be blamed on residual noise.

### Off by default

`RunConfig.genomeModel` and `RunConfig.randomGenomes` are unset by default. Unset, the runner takes the hidden skill as the base edge and the starting genomes as before, and no new field appears in `RunResult` or `AgentSummary`. `protocol.ts` and `libs/` are unchanged.

## Equivalence check: the model off reproduces the published results

Every published re-run baseline was regenerated from this branch with the model unset and compared with `Object.is`, field by field, against the published JSON:

| published file set | PR | rows | fields compared | identical |
|---|---|---:|---:|---:|
| `twelve-cell-rerun/A-*.json` | #79 arm A | 12 | 180 | 180 |
| `twelve-cell-rerun/B-*.json` | #79 arm B | 12 | 180 | 180 |
| `twelve-cell-rerun/C-*.json` | #79 arm C | 12 | 180 | 180 |
| `heritability/A-h1-*.json` | #81, `h = 1` | 12 | 252 | 252 |
| `child-capital/A-h1-f0.5-m0-*.json` | #83, fraction 0.5, `m = 0` | 12 | 288 | 288 |

`test/genome-model.test.ts` repeats this check for one published cell (arm A, population 10, choppy, 50 seeds) on every test run.

## Validation in a static population

Setup: static mode (no reproduction, retirement under `EVOLUTION.md` section 6 as before), population 1,000, seeds 1 to 20, 300 ticks, risk tolerance 0.25, execution every tick, diversity on, x402 $0.01, information purchases on. That is 20,000 agents per row, every one with a principal of 10. Rows:

- "hidden skill": the current harness, identical founders and the hidden skill. This is the reference for what spread is realistic in this harness.
- "genome 0": random genomes with the model at magnitude 0, so no agent has any edge. It isolates what the market path and costs do to genomes near and far from the optimum without the model.
- "genome 0.003" to "genome 0.012": random genomes with the model at that magnitude.

Agent ROI is `(capital - principal) / principal` at tick 300, in percent, for every agent, active or retired. Quintiles are by genome distance from the regime optimum, farthest first (quintile 5 is closest), or by hidden skill, lowest first. "top-bottom quintile gap" is quintile 5 minus quintile 1 mean ROI, with a two-sided Welch test. "slope" is the OLS slope of agent ROI on the agent's edge in basis points per tick.

The acceptance test for a magnitude is that, in every regime, the closest quintile earns more than the farthest with p < 0.05, and that the spread of agent ROI is of the same order as the hidden skill model's.

| regime | model | agents | population roi | agent roi sd | agent p10 | agent p50 | agent p90 | retired % | top-bottom quintile gap pp | Welch p | correlation | slope pct per bp |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| trending | hidden skill | 20000 | -1.88 | 9.50 | -11.88 | -4.65 | 12.75 | 32.2 | 19.85 | <0.0001 | 0.779 | 0.426 |
| trending | genome 0 | 20000 | -10.20 | 4.49 | -16.98 | -9.30 | -4.46 | 27.1 | -2.06 | <0.0001 | 0.000 | 0.000 |
| trending | genome 0.003 | 20000 | -7.00 | 4.50 | -12.43 | -7.35 | -1.88 | 28.7 | 3.84 | <0.0001 | 0.337 | 0.274 |
| trending | genome 0.006 | 20000 | -2.83 | 7.46 | -9.82 | -4.55 | 7.79 | 30.8 | 12.95 | <0.0001 | 0.661 | 0.445 |
| trending | genome 0.009 | 20000 | 2.20 | 12.16 | -8.89 | -2.41 | 21.53 | 31.9 | 25.26 | <0.0001 | 0.778 | 0.569 |
| trending | genome 0.012 | 20000 | 8.09 | 17.96 | -8.24 | 0.64 | 37.92 | 33.2 | 40.92 | <0.0001 | 0.839 | 0.679 |
| mean_reverting | hidden skill | 20000 | -6.60 | 8.66 | -16.47 | -8.37 | 7.35 | 30.0 | 19.09 | <0.0001 | 0.797 | 0.398 |
| mean_reverting | genome 0 | 20000 | -13.05 | 4.96 | -18.59 | -13.21 | -6.47 | 28.1 | -3.31 | <0.0001 | 0.000 | 0.000 |
| mean_reverting | genome 0.003 | 20000 | -10.05 | 3.63 | -15.31 | -9.60 | -5.22 | 29.1 | 2.50 | <0.0001 | 0.221 | 0.144 |
| mean_reverting | genome 0.006 | 20000 | -6.27 | 5.44 | -11.97 | -7.50 | 1.97 | 30.3 | 10.62 | <0.0001 | 0.724 | 0.352 |
| mean_reverting | genome 0.009 | 20000 | -1.69 | 9.68 | -9.88 | -4.85 | 14.83 | 31.4 | 21.55 | <0.0001 | 0.829 | 0.479 |
| mean_reverting | genome 0.012 | 20000 | 3.64 | 15.11 | -9.20 | -3.15 | 29.47 | 32.9 | 35.27 | <0.0001 | 0.864 | 0.584 |
| choppy | hidden skill | 20000 | -5.80 | 7.63 | -13.92 | -7.51 | 5.72 | 29.5 | 14.40 | <0.0001 | 0.687 | 0.302 |
| choppy | genome 0 | 20000 | -12.66 | 5.51 | -20.71 | -11.45 | -6.28 | 25.0 | -4.49 | <0.0001 | 0.000 | 0.000 |
| choppy | genome 0.003 | 20000 | -9.52 | 4.49 | -15.82 | -9.04 | -3.91 | 27.2 | 0.82 | <0.0001 | 0.140 | 0.128 |
| choppy | genome 0.006 | 20000 | -5.38 | 6.06 | -11.73 | -6.29 | 2.66 | 29.5 | 9.84 | <0.0001 | 0.626 | 0.387 |
| choppy | genome 0.009 | 20000 | -0.38 | 10.08 | -9.46 | -3.61 | 15.76 | 31.1 | 21.73 | <0.0001 | 0.792 | 0.543 |
| choppy | genome 0.012 | 20000 | 5.52 | 15.43 | -8.60 | -1.06 | 31.24 | 32.2 | 36.48 | <0.0001 | 0.854 | 0.673 |
| stress_flash_crash | hidden skill | 20000 | -10.25 | 6.31 | -18.69 | -10.38 | -2.26 | 29.1 | 7.38 | <0.0001 | 0.423 | 0.154 |
| stress_flash_crash | genome 0 | 20000 | -15.48 | 8.03 | -26.79 | -13.79 | -6.30 | 24.5 | -7.00 | <0.0001 | 0.000 | 0.000 |
| stress_flash_crash | genome 0.003 | 20000 | -12.95 | 6.57 | -22.32 | -11.25 | -4.89 | 26.7 | -3.20 | <0.0001 | -0.085 | -0.115 |
| stress_flash_crash | genome 0.006 | 20000 | -9.53 | 6.29 | -18.69 | -8.80 | -2.46 | 28.3 | 4.16 | <0.0001 | 0.323 | 0.208 |
| stress_flash_crash | genome 0.009 | 20000 | -5.22 | 8.40 | -15.09 | -6.15 | 6.96 | 30.3 | 14.07 | <0.0001 | 0.663 | 0.379 |
| stress_flash_crash | genome 0.012 | 20000 | -0.11 | 12.49 | -11.63 | -3.70 | 20.45 | 30.9 | 26.78 | <0.0001 | 0.805 | 0.514 |

Quintiles for the hidden skill reference, the no-edge control, and the two validated magnitudes (the full table for every magnitude is reproduced by the report command below):

| regime | model | quintile | mean edge bp/tick | mean distance | mean agent roi | agent roi sd |
|---|---|---:|---:|---:|---:|---:|
| trending | hidden skill | 1 | -13.98 | n/a | -7.62 | 3.28 |
| trending | hidden skill | 2 | -1.93 | n/a | -9.66 | 3.27 |
| trending | hidden skill | 3 | 9.86 | n/a | -6.25 | 4.68 |
| trending | hidden skill | 4 | 22.07 | n/a | 1.89 | 6.09 |
| trending | hidden skill | 5 | 34.12 | n/a | 12.23 | 6.69 |
| trending | genome 0 | 1 | 0.00 | 0.679 | -8.85 | 4.27 |
| trending | genome 0 | 2 | 0.00 | 0.547 | -10.04 | 4.28 |
| trending | genome 0 | 3 | 0.00 | 0.445 | -10.33 | 4.49 |
| trending | genome 0 | 4 | 0.00 | 0.344 | -10.86 | 4.60 |
| trending | genome 0 | 5 | 0.00 | 0.151 | -10.91 | 4.47 |
| trending | genome 0.006 | 1 | -0.71 | 0.679 | -6.52 | 3.18 |
| trending | genome 0.006 | 2 | 7.19 | 0.547 | -7.43 | 3.68 |
| trending | genome 0.006 | 3 | 13.32 | 0.445 | -5.26 | 4.28 |
| trending | genome 0.006 | 4 | 19.34 | 0.344 | -1.37 | 5.06 |
| trending | genome 0.006 | 5 | 30.96 | 0.151 | 6.42 | 9.09 |
| trending | genome 0.009 | 1 | -1.07 | 0.679 | -5.72 | 2.73 |
| trending | genome 0.009 | 2 | 10.78 | 0.547 | -5.95 | 3.89 |
| trending | genome 0.009 | 3 | 19.98 | 0.445 | -1.90 | 5.71 |
| trending | genome 0.009 | 4 | 29.01 | 0.344 | 5.02 | 6.83 |
| trending | genome 0.009 | 5 | 46.44 | 0.151 | 19.54 | 13.53 |
| mean_reverting | hidden skill | 1 | -13.98 | n/a | -11.70 | 3.87 |
| mean_reverting | hidden skill | 2 | -1.93 | n/a | -12.51 | 4.78 |
| mean_reverting | hidden skill | 3 | 9.86 | n/a | -13.00 | 2.85 |
| mean_reverting | hidden skill | 4 | 22.07 | n/a | -3.18 | 3.22 |
| mean_reverting | hidden skill | 5 | 34.12 | n/a | 7.39 | 3.05 |
| mean_reverting | genome 0 | 1 | 0.00 | 0.681 | -10.93 | 4.02 |
| mean_reverting | genome 0 | 2 | 0.00 | 0.549 | -12.29 | 5.30 |
| mean_reverting | genome 0 | 3 | 0.00 | 0.451 | -13.28 | 4.87 |
| mean_reverting | genome 0 | 4 | 0.00 | 0.341 | -14.50 | 4.67 |
| mean_reverting | genome 0 | 5 | 0.00 | 0.153 | -14.24 | 4.97 |
| mean_reverting | genome 0.006 | 1 | -0.86 | 0.681 | -9.13 | 2.76 |
| mean_reverting | genome 0.006 | 2 | 7.06 | 0.549 | -9.33 | 3.71 |
| mean_reverting | genome 0.006 | 3 | 12.96 | 0.451 | -8.62 | 2.40 |
| mean_reverting | genome 0.006 | 4 | 19.55 | 0.341 | -5.75 | 2.64 |
| mean_reverting | genome 0.006 | 5 | 30.81 | 0.153 | 1.49 | 5.48 |
| mean_reverting | genome 0.009 | 1 | -1.29 | 0.681 | -8.24 | 2.41 |
| mean_reverting | genome 0.009 | 2 | 10.59 | 0.549 | -7.96 | 2.79 |
| mean_reverting | genome 0.009 | 3 | 19.44 | 0.451 | -5.75 | 2.60 |
| mean_reverting | genome 0.009 | 4 | 29.32 | 0.341 | 0.21 | 4.75 |
| mean_reverting | genome 0.009 | 5 | 46.22 | 0.153 | 13.31 | 9.92 |
| choppy | hidden skill | 1 | -13.98 | n/a | -9.11 | 3.55 |
| choppy | hidden skill | 2 | -1.93 | n/a | -11.24 | 3.39 |
| choppy | hidden skill | 3 | 9.86 | n/a | -10.19 | 3.70 |
| choppy | hidden skill | 4 | 22.07 | n/a | -3.76 | 5.28 |
| choppy | hidden skill | 5 | 34.12 | n/a | 5.29 | 6.22 |
| choppy | genome 0 | 1 | 0.00 | 0.589 | -9.61 | 4.06 |
| choppy | genome 0 | 2 | 0.00 | 0.498 | -12.45 | 5.48 |
| choppy | genome 0 | 3 | 0.00 | 0.424 | -14.49 | 5.46 |
| choppy | genome 0 | 4 | 0.00 | 0.303 | -12.65 | 5.43 |
| choppy | genome 0 | 5 | 0.00 | 0.136 | -14.10 | 5.60 |
| choppy | genome 0.006 | 1 | 4.67 | 0.589 | -7.46 | 2.85 |
| choppy | genome 0.006 | 2 | 10.11 | 0.498 | -8.45 | 3.85 |
| choppy | genome 0.006 | 3 | 14.54 | 0.424 | -8.18 | 4.37 |
| choppy | genome 0.006 | 4 | 21.84 | 0.303 | -5.18 | 4.41 |
| choppy | genome 0.006 | 5 | 31.85 | 0.136 | 2.38 | 6.33 |
| choppy | genome 0.009 | 1 | 7.00 | 0.589 | -6.69 | 2.84 |
| choppy | genome 0.009 | 2 | 15.17 | 0.498 | -6.54 | 3.62 |
| choppy | genome 0.009 | 3 | 21.81 | 0.424 | -4.06 | 4.79 |
| choppy | genome 0.009 | 4 | 32.76 | 0.303 | 0.36 | 6.46 |
| choppy | genome 0.009 | 5 | 47.78 | 0.136 | 15.04 | 9.61 |
| stress_flash_crash | hidden skill | 1 | -13.98 | n/a | -10.52 | 5.33 |
| stress_flash_crash | hidden skill | 2 | -1.93 | n/a | -13.52 | 5.22 |
| stress_flash_crash | hidden skill | 3 | 9.86 | n/a | -14.11 | 4.51 |
| stress_flash_crash | hidden skill | 4 | 22.07 | n/a | -9.91 | 4.58 |
| stress_flash_crash | hidden skill | 5 | 34.12 | n/a | -3.15 | 5.10 |
| stress_flash_crash | genome 0 | 1 | 0.00 | 0.589 | -10.77 | 6.07 |
| stress_flash_crash | genome 0 | 2 | 0.00 | 0.498 | -15.17 | 8.07 |
| stress_flash_crash | genome 0 | 3 | 0.00 | 0.424 | -18.28 | 7.63 |
| stress_flash_crash | genome 0 | 4 | 0.00 | 0.303 | -15.42 | 8.03 |
| stress_flash_crash | genome 0 | 5 | 0.00 | 0.136 | -17.77 | 7.92 |
| stress_flash_crash | genome 0.006 | 1 | 4.67 | 0.589 | -8.61 | 4.69 |
| stress_flash_crash | genome 0.006 | 2 | 10.11 | 0.498 | -11.73 | 6.41 |
| stress_flash_crash | genome 0.006 | 3 | 14.54 | 0.424 | -13.34 | 5.64 |
| stress_flash_crash | genome 0.006 | 4 | 21.84 | 0.303 | -9.52 | 5.23 |
| stress_flash_crash | genome 0.006 | 5 | 31.85 | 0.136 | -4.44 | 5.43 |
| stress_flash_crash | genome 0.009 | 1 | 7.00 | 0.589 | -7.62 | 4.16 |
| stress_flash_crash | genome 0.009 | 2 | 15.17 | 0.498 | -10.13 | 5.63 |
| stress_flash_crash | genome 0.009 | 3 | 21.81 | 0.424 | -9.92 | 5.12 |
| stress_flash_crash | genome 0.009 | 4 | 32.76 | 0.303 | -4.90 | 5.40 |
| stress_flash_crash | genome 0.009 | 5 | 47.78 | 0.136 | 6.45 | 7.75 |

### Reading

- **Without the model, being close to the optimum costs money.** At magnitude 0 the closest quintile earns 2 to 7 pp less than the farthest in every regime. The optimum thresholds keep a genome in the market, and being in the market pays fees, slippage, and gas, and in the stress regime takes the shock. This is the bar the model has to clear, and it is why a magnitude can be too small.
- **0.003 fails.** The closest quintile is ahead by only 0.8 pp in the choppy regime and is behind by 3.2 pp in the stress regime. At half the hidden skill range the edge does not pay for the cost of the extra market exposure, so selection on genome distance would not be selection on return. It is not used for issue #85.
- **0.006 passes.** The closest quintile earns 4.2 to 13.0 pp more than the farthest, p < 0.0001 in every regime, and the agent ROI standard deviation (5.4 to 7.5 pp) is 0.6 to 1.0 times the hidden skill model's (6.3 to 9.5 pp). Its edge range equals the hidden skill range.
- **0.009 passes.** The closest quintile earns 14.1 to 25.3 pp more, p < 0.0001 in every regime, and the standard deviation (8.4 to 12.2 pp) is 1.1 to 1.3 times the hidden skill model's. Its top-bottom gap is the closest to the hidden skill model's (7.4 to 19.9 pp).
- **0.012 passes but overshoots.** Its spread is 1.6 to 2.0 times the hidden skill model's, so it is outside the "same order, comparable" range that issue #84 asks for. It is reported, not used.
- The validated magnitudes are therefore **0.006 and 0.009**, which bracket the hidden skill model's spread from below and above (`MAGNITUDES` in `src/genome-model.ts`). Issue #85 runs at both.
- The link is monotone from the middle quintile up, not across all five. The farthest quintile often earns slightly more than the second farthest, because far genomes include high entry thresholds that keep the agent out of the market, so it pays less cost and collects less negative edge. The hidden skill model shows the same shape (its lowest-skill quintile is not its worst), because low-edge agents also trade less and are retired earlier.
- Retirement (section 6, bottom decile of the niche for 3 evaluations) removes 27 to 33 percent of agents by tick 300 in every row, with or without the model, and freezes their ROI. This compresses the lower tail in every row alike.

## Commands

From `simulation/`, after `bun run test` (which builds `dist/`):

```bash
# 4 regimes x 6 model settings = 24 jobs
for r in trending mean_reverting choppy stress_flash_crash; do for m in skill 0 0.003 0.006 0.009 0.012; do echo "$r $m"; done; done | \
  xargs -P 3 -L 1 zsh -c 'REGIMES=$0 MAGS=$1 SEEDS=20 OUT=results/genome-model/$0-$1.json node dist/src/cli-genome-validation.js'

REPORT=results/genome-model node dist/src/cli-genome-validation.js
```

Wall time on a laptop with 11 cores, 3 jobs in parallel while other runs shared the machine: 392 seconds for the first 16 jobs and 214 seconds for the 8 jobs at 0.009 and 0.012. Each 1,000-agent, 300-tick static run takes about 1.5 seconds. The per-cell JSON outputs are in `results/genome-model/`.

The equivalence check regenerated the five baselines with `cli-rerun` and the same `ARM`, `H`, `F`, and `M` settings as their original runs, 50 seeds per cell, as 60 jobs with 8 in parallel: 1,206 seconds of wall time. All 1,080 compared fields are identical, so with the model off this branch reproduces PR #79, PR #81 at `h = 1`, and PR #83 at fraction 0.5, `m = 0`, bit for bit.

## Limitations

- The functional form, the optima, the weights, the scales, and the magnitudes are all assumptions. The model guarantees that a genome-to-return link exists. It says nothing about whether a real strategy's advantage is captured by these fields, which remains the open question in `EVOLUTION.md` section 7.
- The link is static within a regime: the optimum does not move during a run, except that the stress shock is not part of it. A real regime change would move the optimum, which would make selection harder than here.
- The pair component is a pure preference, because the harness has one price path for every pair.
- The edge is linear in the score with no interaction between fields, so a genome can be close on two fields and far on the third and still score well.
- Mutation (`EVOLUTION.md` section 3.3) is multiplicative, so an `entryThreshold` never changes sign and a `timeHorizon` of 1 or 2 rounds back to itself. This limits how far mutation can move a genome toward the optimum and applies to any selection mechanism that uses section 3.3 mutation.
