# Reproduction threshold and x402 price

Issue #74. `ECONOMICS.md` section 8 found zero reproductions in every cell of the 12-cell comparison and asked for one experiment before any further implementation: vary the profit threshold and the x402 price inside the ranges the documents already state, and see whether a reproducing population exists at all. This file is that experiment.

## Setup

Everything is the section 8 baseline except the two varied parameters: evolving mode, diversity on, legal policy risk tolerance 0.25 and execution every tick, 300 ticks, all starting genomes in one niche, every other cost and protocol constant at its `src/protocol.ts` and `src/execution.ts` default. The `protocol.ts` defaults are not changed. The profit threshold is overridden per run through `createReproductionModule({ profitThresholdFraction })`.

- `profitThresholdFraction`: 0, 0.1, 0.25, 0.5. 0.5 is the `EVOLUTION.md` section 3.1 default.
- x402 price per call: 0.01, 0.02, 0.03, 0.05, 0.10, 7.50. 0.01 is the DeFiLlama flat price and the Nansen low end, 7.50 is the Nansen high end, and 0.05 is the section 8 baseline (`ECONOMICS.md` section 1).
- Populations 10 and 100, all four regimes, seeds 1 to 50. Population 1,000 is a confirmation subset: trending and stress, fractions 0, 0.1, 0.5, prices 0.01, 0.05, 0.10, seeds 1 to 10, because one 1,000-agent run takes several seconds.

Gate accounting: at every evaluation the runner records, for each active parent, which gates failed (`RunResult.gates`). "fail %" is the share of evaluations that failed a gate. "sole %" is the share where that gate was the only failure, so lowering that gate alone would have opened eligibility. `allocation` would count an eligible parent with no profit to transfer. It never appeared.

**One harness interaction decides the x402 axis.** An agent buys information only when the price is at or below its genome `informationBudget`, which is 0.05 in the harness default genome. At any price above 0.05 no agent buys, x402 spend is zero, and the information edge is never applied. That is why the 0.10 and 7.50 rows are identical. Above 0.05 the price does not matter in this harness. Those rows are the no-information case, not a cheap-information case.

## Command

From `simulation/`:

```bash
bun run threshold
POPS=1000 SEEDS=10 REGIMES=trending,stress_flash_crash FRACTIONS=0,0.1,0.5 X402=0.01,0.05,0.1 node dist/src/cli-threshold.js
```

The first command builds and prints the population 10 and 100 table. The second prints the population 1,000 subset. Both print to standard output. Runtime on a laptop was about 3 minutes and 11 minutes.

## Summary, population 100, 50 seeds

Each entry is the share of seeds with at least one reproduction, the mean reproduction count per run, and the mean child starting capital against a $10 parent principal. "0.10+" covers 0.10 and 7.50, which are identical.

| profit_frac | x402 | trending | mean_reverting | choppy | stress_flash_crash |
|---:|---:|---|---|---|---|
| 0.5 | any | 0%, 0 | 0%, 0 | 0%, 0 | 0%, 0 |
| 0.25 | 0.01 | 18%, 0.64, $1.29 | 0%, 0 | 0%, 0 | 0%, 0 |
| 0.25 | 0.05 | 0%, 0 | 0%, 0 | 0%, 0 | 0%, 0 |
| 0.25 | 0.10+ | 40%, 2.64, $1.33 | 0%, 0 | 2%, 0.10, $1.26 | 0%, 0 |
| 0.1 | 0.01 | 94%, 23.7, $0.55 | 100%, 5.1, $0.53 | 58%, 6.7, $0.55 | 6%, 0.32, $0.53 |
| 0.1 | 0.05 | 0%, 0 | 0%, 0 | 0%, 0 | 0%, 0 |
| 0.1 | 0.10+ | 100%, 42.0, $0.56 | 100%, 17.2, $0.53 | 84%, 17.3, $0.55 | 34%, 2.4, $0.55 |
| 0 | 0.01 | 100%, 97.8, $0.13 | 100%, 98.0, $0.07 | 100%, 84.6, $0.09 | 100%, 56.7, $0.09 |
| 0 | 0.05 | 40%, 1.3, $0.04 | 2%, 0.02, $0.02 | 20%, 0.30, $0.03 | 20%, 0.30, $0.03 |
| 0 | 0.10+ | 100%, 99.5, $0.15 | 100%, 100, $0.10 | 100%, 97.0, $0.11 | 100%, 83.5, $0.10 |

## Findings

1. The section 8 baseline reproduces the section 8 result. At fraction 0.5 the reproduction count is zero in every regime, at every price in the researched range, at populations 10, 100, and 1,000. Lowering the x402 price alone, even to $0.01, does not open reproduction at the documented threshold.
2. A reproducing population exists inside the documented price range once the threshold is lowered. At fraction 0.1 and x402 $0.01, population 100 reproduces in 94 percent of trending seeds, 100 percent of mean-reverting seeds, 58 percent of choppy seeds, and 6 percent of stress seeds. At population 1,000 the same cell reproduces in 100 percent of trending seeds (257 reproductions per run) and 20 percent of stress seeds.
3. At the section 8 baseline price, $0.05, reproduction is zero at every fraction from 0.1 up, and rare at 0. The baseline price is a binding cost, not a detail.
4. The profit gate is the gate that binds. It fails on 54 to 100 percent of evaluations across the grid, and where reproduction is zero it is the only failed gate on about 23 to 25 percent of evaluations. No other gate is the sole blocker on more than 16 percent of evaluations anywhere. `n_min` is never the sole blocker. The percentile gate fails on about 70 to 75 percent of evaluations everywhere: all agents start in one niche, which is over the 40 percent share threshold, so the bar is the 75th percentile. That is the designed behavior, not a new problem. Cooldown and the descendant cap only bind once agents are already reproducing.
5. Fraction 0 is not a useful operating point. It reproduces almost everywhere, and at population 1,000 it fills the experiment cap of 2,000 agents, but the mean child starts with $0.01 to $0.17, and 63 to 100 percent of children are retired by the end of the run. Most children start near the $0.06 capital floor. This is not a reproducing population in any useful sense.
6. Fraction 0.1 produces children with about $0.52 to $0.56 of starting capital. The share retired by the end of the run ranges from 0 to 100 percent by cell, with most cells between 25 and 55 percent. Fraction 0.25 produces children with about $1.30, but only in trending, and rarely.
7. In this harness information never pays for itself. At risk 0.25 and $10 capital, a 0.002 edge on a $2.50 position is worth about $0.005 per purchase, below even the $0.01 low end, so every row with x402 spend has a lower mean ROI than the matching no-purchase row. This is arithmetic from the harness constants, not a measured property of a real data feed.

## Limitations

- The information edge (0.002 per purchase) and the purchase probability (0.3) are harness assumptions from `ECONOMICS.md` section 3, not measured values. Finding 7 depends on them entirely.
- The `informationBudget` of 0.05 is a harness default genome value, not a documented protocol constant. Prices above it are equivalent to having no information. A run with a higher budget would make agents pay the higher prices, which was not measured here.
- Kuru fees and slippage are still the 15 basis point assumption from `ECONOMICS.md` section 1.
- Population 1,000 used 10 seeds and a subset of the grid. Its numbers are directionally consistent with population 100 but carry wider uncertainty.
- Reproduction count is the only outcome measured. This experiment does not compare evolving and static populations, so it says nothing yet about whether reproduction improves returns. That is the 12-cell comparison, which this result unblocks but does not replace.
- Hypothesis, not measured: at fraction 0.1, children start with about 5 percent of a parent principal and pay the same fixed gas per trade, so any gap between evolving and static populations may come more from capital moved into small children than from selection. The re-run should report child survival alongside ROI to test this.

## Full table, populations 10 and 100, 50 seeds

| pop | regime | profit_frac | x402 | repro mean | seeds repro % | roi mean | x402/agent | child principal | child retired % | fail n_min % | fail cooldown % | fail percentile % | fail profit % | sole profit % | sole percentile % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 0 | 0.01 | 13.28 | 100.0 | -3.15 | 0.94 | 0.140 | 97.0 | 11.2 | 19.5 | 71.9 | 65.4 | 3.8 | 11.1 |
| 10 | trending | 0 | 0.02 | 7.34 | 84.0 | -9.92 | 1.63 | 0.094 | 97.5 | 10.3 | 14.0 | 72.8 | 84.2 | 12.2 | 3.0 |
| 10 | trending | 0 | 0.03 | 3.00 | 58.0 | -18.07 | 2.40 | 0.056 | 98.0 | 10.2 | 10.0 | 72.8 | 95.3 | 20.2 | 0.3 |
| 10 | trending | 0 | 0.05 | 0.18 | 16.0 | -35.39 | 4.04 | 0.036 | 100.0 | 10.0 | 7.7 | 73.0 | 99.6 | 24.3 | 0.0 |
| 10 | trending | 0 | 0.1 | 18.72 | 100.0 | 1.67 | 0.00 | 0.163 | 63.0 | 14.8 | 19.8 | 70.6 | 67.4 | 5.0 | 8.7 |
| 10 | trending | 0 | 7.5 | 18.72 | 100.0 | 1.67 | 0.00 | 0.163 | 63.0 | 14.8 | 19.8 | 70.6 | 67.4 | 5.0 | 8.7 |
| 10 | trending | 0.1 | 0.01 | 2.48 | 72.0 | -1.70 | 0.84 | 0.551 | 42.7 | 10.4 | 10.5 | 72.0 | 97.6 | 22.1 | 0.6 |
| 10 | trending | 0.1 | 0.02 | 0.34 | 24.0 | -9.55 | 1.59 | 0.559 | 41.2 | 10.0 | 8.2 | 72.8 | 99.7 | 24.2 | 0.1 |
| 10 | trending | 0.1 | 0.03 | 0.00 | 0.0 | -17.92 | 2.39 | 0.000 | 0.0 | 10.2 | 7.7 | 72.6 | 100.0 | 25.0 | 0.0 |
| 10 | trending | 0.1 | 0.05 | 0.00 | 0.0 | -35.64 | 4.07 | 0.000 | 0.0 | 10.0 | 7.5 | 72.9 | 100.0 | 24.7 | 0.0 |
| 10 | trending | 0.1 | 0.1 | 4.28 | 90.0 | 3.17 | 0.00 | 0.560 | 28.5 | 13.3 | 11.9 | 71.8 | 95.5 | 20.2 | 1.5 |
| 10 | trending | 0.1 | 7.5 | 4.28 | 90.0 | 3.17 | 0.00 | 0.560 | 28.5 | 13.3 | 11.9 | 71.8 | 95.5 | 20.2 | 1.5 |
| 10 | trending | 0.25 | 0.01 | 0.08 | 6.0 | -0.86 | 0.78 | 1.293 | 0.0 | 10.4 | 8.0 | 72.4 | 99.9 | 25.1 | 0.0 |
| 10 | trending | 0.25 | 0.02 | 0.00 | 0.0 | -9.36 | 1.58 | 0.000 | 0.0 | 10.0 | 7.8 | 72.8 | 100.0 | 24.8 | 0.0 |
| 10 | trending | 0.25 | 0.03 | 0.00 | 0.0 | -17.92 | 2.39 | 0.000 | 0.0 | 10.2 | 7.7 | 72.6 | 100.0 | 25.0 | 0.0 |
| 10 | trending | 0.25 | 0.05 | 0.00 | 0.0 | -35.64 | 4.07 | 0.000 | 0.0 | 10.0 | 7.5 | 72.9 | 100.0 | 24.7 | 0.0 |
| 10 | trending | 0.25 | 0.1 | 0.34 | 24.0 | 3.65 | 0.00 | 1.322 | 0.0 | 13.2 | 8.2 | 72.8 | 99.7 | 24.3 | 0.0 |
| 10 | trending | 0.25 | 7.5 | 0.34 | 24.0 | 3.65 | 0.00 | 1.322 | 0.0 | 13.2 | 8.2 | 72.8 | 99.7 | 24.3 | 0.0 |
| 10 | trending | 0.5 | 0.01 | 0.00 | 0.0 | -0.86 | 0.78 | 0.000 | 0.0 | 10.3 | 7.9 | 72.4 | 100.0 | 25.2 | 0.0 |
| 10 | trending | 0.5 | 0.02 | 0.00 | 0.0 | -9.36 | 1.58 | 0.000 | 0.0 | 10.0 | 7.8 | 72.8 | 100.0 | 24.8 | 0.0 |
| 10 | trending | 0.5 | 0.03 | 0.00 | 0.0 | -17.92 | 2.39 | 0.000 | 0.0 | 10.2 | 7.7 | 72.6 | 100.0 | 25.0 | 0.0 |
| 10 | trending | 0.5 | 0.05 | 0.00 | 0.0 | -35.64 | 4.07 | 0.000 | 0.0 | 10.0 | 7.5 | 72.9 | 100.0 | 24.7 | 0.0 |
| 10 | trending | 0.5 | 0.1 | 0.00 | 0.0 | 3.66 | 0.00 | 0.000 | 0.0 | 13.1 | 7.9 | 72.7 | 100.0 | 24.8 | 0.0 |
| 10 | trending | 0.5 | 7.5 | 0.00 | 0.0 | 3.66 | 0.00 | 0.000 | 0.0 | 13.1 | 7.9 | 72.7 | 100.0 | 24.8 | 0.0 |
| 10 | mean_reverting | 0 | 0.01 | 10.60 | 98.0 | -6.94 | 0.84 | 0.078 | 99.8 | 12.9 | 16.7 | 72.8 | 72.9 | 4.7 | 5.2 |
| 10 | mean_reverting | 0 | 0.02 | 3.96 | 70.0 | -14.72 | 1.61 | 0.025 | 96.0 | 12.2 | 10.5 | 72.9 | 94.5 | 18.3 | 0.0 |
| 10 | mean_reverting | 0 | 0.03 | 0.16 | 14.0 | -22.42 | 2.37 | 0.025 | 100.0 | 12.6 | 7.9 | 72.7 | 99.7 | 24.6 | 0.0 |
| 10 | mean_reverting | 0 | 0.05 | 0.04 | 4.0 | -39.22 | 4.00 | 0.009 | 100.0 | 12.3 | 7.7 | 73.1 | 99.9 | 24.4 | 0.0 |
| 10 | mean_reverting | 0 | 0.1 | 15.24 | 100.0 | -2.74 | 0.00 | 0.107 | 76.6 | 28.1 | 18.9 | 71.6 | 72.1 | 4.2 | 4.3 |
| 10 | mean_reverting | 0 | 7.5 | 15.24 | 100.0 | -2.74 | 0.00 | 0.107 | 76.6 | 28.1 | 18.9 | 71.6 | 72.1 | 4.2 | 4.3 |
| 10 | mean_reverting | 0.1 | 0.01 | 0.74 | 52.0 | -6.18 | 0.79 | 0.528 | 0.0 | 12.5 | 8.5 | 72.7 | 99.4 | 23.9 | 0.0 |
| 10 | mean_reverting | 0.1 | 0.02 | 0.00 | 0.0 | -14.52 | 1.60 | 0.000 | 0.0 | 12.5 | 7.7 | 72.8 | 100.0 | 24.9 | 0.0 |
| 10 | mean_reverting | 0.1 | 0.03 | 0.00 | 0.0 | -22.37 | 2.37 | 0.000 | 0.0 | 12.6 | 7.8 | 72.6 | 100.0 | 25.0 | 0.0 |
| 10 | mean_reverting | 0.1 | 0.05 | 0.00 | 0.0 | -39.24 | 4.00 | 0.000 | 0.0 | 12.3 | 7.7 | 73.0 | 100.0 | 24.5 | 0.0 |
| 10 | mean_reverting | 0.1 | 0.1 | 1.94 | 80.0 | -1.15 | 0.00 | 0.528 | 26.8 | 26.0 | 10.0 | 72.6 | 98.1 | 22.2 | 0.4 |
| 10 | mean_reverting | 0.1 | 7.5 | 1.94 | 80.0 | -1.15 | 0.00 | 0.528 | 26.8 | 26.0 | 10.0 | 72.6 | 98.1 | 22.2 | 0.4 |
| 10 | mean_reverting | 0.25 | 0.01 | 0.00 | 0.0 | -6.13 | 0.78 | 0.000 | 0.0 | 12.3 | 7.9 | 72.7 | 100.0 | 24.9 | 0.0 |
| 10 | mean_reverting | 0.25 | 0.02 | 0.00 | 0.0 | -14.52 | 1.60 | 0.000 | 0.0 | 12.5 | 7.7 | 72.8 | 100.0 | 24.9 | 0.0 |
| 10 | mean_reverting | 0.25 | 0.03 | 0.00 | 0.0 | -22.37 | 2.37 | 0.000 | 0.0 | 12.6 | 7.8 | 72.6 | 100.0 | 25.0 | 0.0 |
| 10 | mean_reverting | 0.25 | 0.05 | 0.00 | 0.0 | -39.24 | 4.00 | 0.000 | 0.0 | 12.3 | 7.7 | 73.0 | 100.0 | 24.5 | 0.0 |
| 10 | mean_reverting | 0.25 | 0.1 | 0.00 | 0.0 | -0.99 | 0.00 | 0.000 | 0.0 | 25.2 | 8.0 | 72.6 | 100.0 | 25.1 | 0.0 |
| 10 | mean_reverting | 0.25 | 7.5 | 0.00 | 0.0 | -0.99 | 0.00 | 0.000 | 0.0 | 25.2 | 8.0 | 72.6 | 100.0 | 25.1 | 0.0 |
| 10 | mean_reverting | 0.5 | 0.01 | 0.00 | 0.0 | -6.13 | 0.78 | 0.000 | 0.0 | 12.3 | 7.9 | 72.7 | 100.0 | 24.9 | 0.0 |
| 10 | mean_reverting | 0.5 | 0.02 | 0.00 | 0.0 | -14.52 | 1.60 | 0.000 | 0.0 | 12.5 | 7.7 | 72.8 | 100.0 | 24.9 | 0.0 |
| 10 | mean_reverting | 0.5 | 0.03 | 0.00 | 0.0 | -22.37 | 2.37 | 0.000 | 0.0 | 12.6 | 7.8 | 72.6 | 100.0 | 25.0 | 0.0 |
| 10 | mean_reverting | 0.5 | 0.05 | 0.00 | 0.0 | -39.24 | 4.00 | 0.000 | 0.0 | 12.3 | 7.7 | 73.0 | 100.0 | 24.5 | 0.0 |
| 10 | mean_reverting | 0.5 | 0.1 | 0.00 | 0.0 | -0.99 | 0.00 | 0.000 | 0.0 | 25.2 | 8.0 | 72.6 | 100.0 | 25.1 | 0.0 |
| 10 | mean_reverting | 0.5 | 7.5 | 0.00 | 0.0 | -0.99 | 0.00 | 0.000 | 0.0 | 25.2 | 8.0 | 72.6 | 100.0 | 25.1 | 0.0 |
| 10 | choppy | 0 | 0.01 | 10.12 | 100.0 | -5.98 | 0.86 | 0.097 | 96.2 | 13.9 | 16.6 | 72.6 | 77.6 | 7.9 | 5.2 |
| 10 | choppy | 0 | 0.02 | 4.22 | 70.0 | -13.26 | 1.58 | 0.060 | 99.1 | 13.1 | 11.1 | 72.6 | 92.6 | 18.0 | 0.8 |
| 10 | choppy | 0 | 0.03 | 0.96 | 40.0 | -21.88 | 2.42 | 0.034 | 100.0 | 13.2 | 8.3 | 72.6 | 98.4 | 23.4 | 0.0 |
| 10 | choppy | 0 | 0.05 | 0.04 | 4.0 | -38.60 | 4.04 | 0.027 | 100.0 | 13.5 | 7.6 | 73.0 | 99.9 | 24.2 | 0.0 |
| 10 | choppy | 0 | 0.1 | 15.04 | 100.0 | -1.19 | 0.00 | 0.119 | 73.7 | 21.6 | 18.6 | 71.5 | 72.3 | 5.7 | 5.4 |
| 10 | choppy | 0 | 7.5 | 15.04 | 100.0 | -1.19 | 0.00 | 0.119 | 73.7 | 21.6 | 18.6 | 71.5 | 72.3 | 5.7 | 5.4 |
| 10 | choppy | 0.1 | 0.01 | 0.72 | 34.0 | -5.28 | 0.81 | 0.550 | 36.1 | 12.8 | 8.6 | 72.5 | 99.4 | 24.0 | 0.1 |
| 10 | choppy | 0.1 | 0.02 | 0.02 | 2.0 | -13.30 | 1.59 | 0.509 | 0.0 | 13.1 | 7.8 | 72.5 | 100.0 | 25.0 | 0.0 |
| 10 | choppy | 0.1 | 0.03 | 0.00 | 0.0 | -21.80 | 2.41 | 0.000 | 0.0 | 13.3 | 7.6 | 72.9 | 100.0 | 24.6 | 0.0 |
| 10 | choppy | 0.1 | 0.05 | 0.00 | 0.0 | -38.59 | 4.04 | 0.000 | 0.0 | 13.5 | 7.6 | 73.0 | 100.0 | 24.3 | 0.0 |
| 10 | choppy | 0.1 | 0.1 | 1.74 | 64.0 | -0.13 | 0.00 | 0.550 | 31.0 | 19.5 | 9.7 | 73.1 | 98.4 | 21.5 | 0.3 |
| 10 | choppy | 0.1 | 7.5 | 1.74 | 64.0 | -0.13 | 0.00 | 0.550 | 31.0 | 19.5 | 9.7 | 73.1 | 98.4 | 21.5 | 0.3 |
| 10 | choppy | 0.25 | 0.01 | 0.00 | 0.0 | -5.07 | 0.79 | 0.000 | 0.0 | 12.7 | 7.8 | 72.6 | 100.0 | 24.9 | 0.0 |
| 10 | choppy | 0.25 | 0.02 | 0.00 | 0.0 | -13.29 | 1.59 | 0.000 | 0.0 | 13.1 | 7.8 | 72.5 | 100.0 | 25.0 | 0.0 |
| 10 | choppy | 0.25 | 0.03 | 0.00 | 0.0 | -21.80 | 2.41 | 0.000 | 0.0 | 13.3 | 7.6 | 72.9 | 100.0 | 24.6 | 0.0 |
| 10 | choppy | 0.25 | 0.05 | 0.00 | 0.0 | -38.59 | 4.04 | 0.000 | 0.0 | 13.5 | 7.6 | 73.0 | 100.0 | 24.3 | 0.0 |
| 10 | choppy | 0.25 | 0.1 | 0.00 | 0.0 | 0.03 | 0.00 | 0.000 | 0.0 | 18.8 | 7.8 | 73.2 | 100.0 | 24.0 | 0.0 |
| 10 | choppy | 0.25 | 7.5 | 0.00 | 0.0 | 0.03 | 0.00 | 0.000 | 0.0 | 18.8 | 7.8 | 73.2 | 100.0 | 24.0 | 0.0 |
| 10 | choppy | 0.5 | 0.01 | 0.00 | 0.0 | -5.07 | 0.79 | 0.000 | 0.0 | 12.7 | 7.8 | 72.6 | 100.0 | 24.9 | 0.0 |
| 10 | choppy | 0.5 | 0.02 | 0.00 | 0.0 | -13.29 | 1.59 | 0.000 | 0.0 | 13.1 | 7.8 | 72.5 | 100.0 | 25.0 | 0.0 |
| 10 | choppy | 0.5 | 0.03 | 0.00 | 0.0 | -21.80 | 2.41 | 0.000 | 0.0 | 13.3 | 7.6 | 72.9 | 100.0 | 24.6 | 0.0 |
| 10 | choppy | 0.5 | 0.05 | 0.00 | 0.0 | -38.59 | 4.04 | 0.000 | 0.0 | 13.5 | 7.6 | 73.0 | 100.0 | 24.3 | 0.0 |
| 10 | choppy | 0.5 | 0.1 | 0.00 | 0.0 | 0.03 | 0.00 | 0.000 | 0.0 | 18.8 | 7.8 | 73.2 | 100.0 | 24.0 | 0.0 |
| 10 | choppy | 0.5 | 7.5 | 0.00 | 0.0 | 0.03 | 0.00 | 0.000 | 0.0 | 18.8 | 7.8 | 73.2 | 100.0 | 24.0 | 0.0 |
| 10 | stress_flash_crash | 0 | 0.01 | 6.44 | 98.0 | -10.41 | 0.83 | 0.083 | 97.2 | 14.1 | 13.3 | 72.7 | 87.6 | 15.5 | 2.7 |
| 10 | stress_flash_crash | 0 | 0.02 | 2.62 | 60.0 | -17.78 | 1.59 | 0.056 | 99.2 | 13.6 | 9.8 | 72.7 | 95.4 | 20.9 | 0.5 |
| 10 | stress_flash_crash | 0 | 0.03 | 0.84 | 38.0 | -26.35 | 2.43 | 0.032 | 100.0 | 13.8 | 8.2 | 72.9 | 98.6 | 23.3 | 0.0 |
| 10 | stress_flash_crash | 0 | 0.05 | 0.04 | 4.0 | -42.41 | 4.03 | 0.027 | 100.0 | 14.2 | 7.6 | 73.0 | 99.9 | 24.2 | 0.0 |
| 10 | stress_flash_crash | 0 | 0.1 | 9.58 | 100.0 | -5.13 | 0.00 | 0.103 | 82.3 | 21.5 | 14.6 | 71.8 | 82.4 | 14.0 | 4.1 |
| 10 | stress_flash_crash | 0 | 7.5 | 9.58 | 100.0 | -5.13 | 0.00 | 0.103 | 82.3 | 21.5 | 14.6 | 71.8 | 82.4 | 14.0 | 4.1 |
| 10 | stress_flash_crash | 0.1 | 0.01 | 0.02 | 2.0 | -9.80 | 0.79 | 0.556 | 100.0 | 13.3 | 7.8 | 72.7 | 100.0 | 24.9 | 0.0 |
| 10 | stress_flash_crash | 0.1 | 0.02 | 0.00 | 0.0 | -17.98 | 1.60 | 0.000 | 0.0 | 13.4 | 7.7 | 72.7 | 100.0 | 24.8 | 0.0 |
| 10 | stress_flash_crash | 0.1 | 0.03 | 0.00 | 0.0 | -26.27 | 2.42 | 0.000 | 0.0 | 14.1 | 7.6 | 73.1 | 100.0 | 24.5 | 0.0 |
| 10 | stress_flash_crash | 0.1 | 0.05 | 0.00 | 0.0 | -42.42 | 4.03 | 0.000 | 0.0 | 14.2 | 7.6 | 73.0 | 100.0 | 24.3 | 0.0 |
| 10 | stress_flash_crash | 0.1 | 0.1 | 0.24 | 16.0 | -4.19 | 0.00 | 0.544 | 33.3 | 19.6 | 7.9 | 73.4 | 99.8 | 23.5 | 0.0 |
| 10 | stress_flash_crash | 0.1 | 7.5 | 0.24 | 16.0 | -4.19 | 0.00 | 0.544 | 33.3 | 19.6 | 7.9 | 73.4 | 99.8 | 23.5 | 0.0 |
| 10 | stress_flash_crash | 0.25 | 0.01 | 0.00 | 0.0 | -9.79 | 0.79 | 0.000 | 0.0 | 13.3 | 7.8 | 72.7 | 100.0 | 24.9 | 0.0 |
| 10 | stress_flash_crash | 0.25 | 0.02 | 0.00 | 0.0 | -17.98 | 1.60 | 0.000 | 0.0 | 13.4 | 7.7 | 72.7 | 100.0 | 24.8 | 0.0 |
| 10 | stress_flash_crash | 0.25 | 0.03 | 0.00 | 0.0 | -26.27 | 2.42 | 0.000 | 0.0 | 14.1 | 7.6 | 73.1 | 100.0 | 24.5 | 0.0 |
| 10 | stress_flash_crash | 0.25 | 0.05 | 0.00 | 0.0 | -42.42 | 4.03 | 0.000 | 0.0 | 14.2 | 7.6 | 73.0 | 100.0 | 24.3 | 0.0 |
| 10 | stress_flash_crash | 0.25 | 0.1 | 0.00 | 0.0 | -4.16 | 0.00 | 0.000 | 0.0 | 19.6 | 7.7 | 73.5 | 100.0 | 23.7 | 0.0 |
| 10 | stress_flash_crash | 0.25 | 7.5 | 0.00 | 0.0 | -4.16 | 0.00 | 0.000 | 0.0 | 19.6 | 7.7 | 73.5 | 100.0 | 23.7 | 0.0 |
| 10 | stress_flash_crash | 0.5 | 0.01 | 0.00 | 0.0 | -9.79 | 0.79 | 0.000 | 0.0 | 13.3 | 7.8 | 72.7 | 100.0 | 24.9 | 0.0 |
| 10 | stress_flash_crash | 0.5 | 0.02 | 0.00 | 0.0 | -17.98 | 1.60 | 0.000 | 0.0 | 13.4 | 7.7 | 72.7 | 100.0 | 24.8 | 0.0 |
| 10 | stress_flash_crash | 0.5 | 0.03 | 0.00 | 0.0 | -26.27 | 2.42 | 0.000 | 0.0 | 14.1 | 7.6 | 73.1 | 100.0 | 24.5 | 0.0 |
| 10 | stress_flash_crash | 0.5 | 0.05 | 0.00 | 0.0 | -42.42 | 4.03 | 0.000 | 0.0 | 14.2 | 7.6 | 73.0 | 100.0 | 24.3 | 0.0 |
| 10 | stress_flash_crash | 0.5 | 0.1 | 0.00 | 0.0 | -4.16 | 0.00 | 0.000 | 0.0 | 19.6 | 7.7 | 73.5 | 100.0 | 23.7 | 0.0 |
| 10 | stress_flash_crash | 0.5 | 7.5 | 0.00 | 0.0 | -4.16 | 0.00 | 0.000 | 0.0 | 19.6 | 7.7 | 73.5 | 100.0 | 23.7 | 0.0 |
| 100 | trending | 0 | 0.01 | 97.80 | 100.0 | -2.92 | 0.89 | 0.129 | 99.2 | 15.9 | 23.7 | 73.1 | 67.7 | 3.6 | 9.4 |
| 100 | trending | 0 | 0.02 | 70.04 | 100.0 | -9.95 | 1.60 | 0.081 | 97.7 | 11.3 | 14.7 | 74.0 | 85.7 | 11.7 | 2.0 |
| 100 | trending | 0 | 0.03 | 25.16 | 88.0 | -17.98 | 2.36 | 0.052 | 98.0 | 10.3 | 9.8 | 74.3 | 96.0 | 19.8 | 0.2 |
| 100 | trending | 0 | 0.05 | 1.30 | 40.0 | -35.05 | 3.98 | 0.036 | 100.0 | 10.2 | 7.8 | 74.4 | 99.7 | 23.4 | 0.0 |
| 100 | trending | 0 | 0.1 | 99.48 | 100.0 | 1.77 | 0.00 | 0.151 | 86.6 | 23.2 | 28.3 | 72.3 | 60.3 | 2.2 | 12.5 |
| 100 | trending | 0 | 7.5 | 99.48 | 100.0 | 1.77 | 0.00 | 0.151 | 86.6 | 23.2 | 28.3 | 72.3 | 60.3 | 2.2 | 12.5 |
| 100 | trending | 0.1 | 0.01 | 23.70 | 94.0 | -1.91 | 0.83 | 0.553 | 41.3 | 10.4 | 10.4 | 73.9 | 98.0 | 20.7 | 0.2 |
| 100 | trending | 0.1 | 0.02 | 3.50 | 46.0 | -9.57 | 1.57 | 0.543 | 36.0 | 10.3 | 8.3 | 74.2 | 99.7 | 23.3 | 0.0 |
| 100 | trending | 0.1 | 0.03 | 0.08 | 2.0 | -17.87 | 2.35 | 0.552 | 25.0 | 10.3 | 7.9 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | trending | 0.1 | 0.05 | 0.00 | 0.0 | -35.08 | 3.98 | 0.000 | 0.0 | 10.2 | 7.7 | 74.4 | 100.0 | 23.6 | 0.0 |
| 100 | trending | 0.1 | 0.1 | 41.96 | 100.0 | 2.82 | 0.00 | 0.557 | 34.7 | 13.1 | 12.0 | 73.8 | 96.4 | 18.6 | 0.6 |
| 100 | trending | 0.1 | 7.5 | 41.96 | 100.0 | 2.82 | 0.00 | 0.557 | 34.7 | 13.1 | 12.0 | 73.8 | 96.4 | 18.6 | 0.6 |
| 100 | trending | 0.25 | 0.01 | 0.64 | 18.0 | -1.15 | 0.78 | 1.293 | 0.0 | 10.3 | 8.0 | 74.2 | 99.9 | 23.7 | 0.0 |
| 100 | trending | 0.25 | 0.02 | 0.00 | 0.0 | -9.44 | 1.56 | 0.000 | 0.0 | 10.3 | 7.9 | 74.2 | 100.0 | 23.7 | 0.0 |
| 100 | trending | 0.25 | 0.03 | 0.00 | 0.0 | -17.87 | 2.35 | 0.000 | 0.0 | 10.3 | 7.8 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | trending | 0.25 | 0.05 | 0.00 | 0.0 | -35.08 | 3.98 | 0.000 | 0.0 | 10.2 | 7.7 | 74.4 | 100.0 | 23.6 | 0.0 |
| 100 | trending | 0.25 | 0.1 | 2.64 | 40.0 | 3.28 | 0.00 | 1.325 | 4.5 | 12.7 | 8.0 | 74.4 | 99.8 | 23.3 | 0.0 |
| 100 | trending | 0.25 | 7.5 | 2.64 | 40.0 | 3.28 | 0.00 | 1.325 | 4.5 | 12.7 | 8.0 | 74.4 | 99.8 | 23.3 | 0.0 |
| 100 | trending | 0.5 | 0.01 | 0.00 | 0.0 | -1.15 | 0.78 | 0.000 | 0.0 | 10.3 | 7.9 | 74.2 | 100.0 | 23.7 | 0.0 |
| 100 | trending | 0.5 | 0.02 | 0.00 | 0.0 | -9.44 | 1.56 | 0.000 | 0.0 | 10.3 | 7.9 | 74.2 | 100.0 | 23.7 | 0.0 |
| 100 | trending | 0.5 | 0.03 | 0.00 | 0.0 | -17.87 | 2.35 | 0.000 | 0.0 | 10.3 | 7.8 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | trending | 0.5 | 0.05 | 0.00 | 0.0 | -35.08 | 3.98 | 0.000 | 0.0 | 10.2 | 7.7 | 74.4 | 100.0 | 23.6 | 0.0 |
| 100 | trending | 0.5 | 0.1 | 0.00 | 0.0 | 3.29 | 0.00 | 0.000 | 0.0 | 12.6 | 7.8 | 74.4 | 100.0 | 23.6 | 0.0 |
| 100 | trending | 0.5 | 7.5 | 0.00 | 0.0 | 3.29 | 0.00 | 0.000 | 0.0 | 12.6 | 7.8 | 74.4 | 100.0 | 23.6 | 0.0 |
| 100 | mean_reverting | 0 | 0.01 | 98.04 | 100.0 | -6.98 | 0.81 | 0.068 | 99.9 | 16.3 | 21.1 | 73.7 | 76.3 | 2.6 | 1.6 |
| 100 | mean_reverting | 0 | 0.02 | 29.74 | 100.0 | -14.62 | 1.57 | 0.024 | 97.4 | 12.1 | 10.1 | 74.3 | 95.8 | 18.7 | 0.0 |
| 100 | mean_reverting | 0 | 0.03 | 0.90 | 48.0 | -22.85 | 2.38 | 0.014 | 100.0 | 12.3 | 7.8 | 74.3 | 99.8 | 23.6 | 0.0 |
| 100 | mean_reverting | 0 | 0.05 | 0.02 | 2.0 | -39.39 | 3.99 | 0.020 | 100.0 | 12.2 | 7.7 | 74.4 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0 | 0.1 | 100.00 | 100.0 | -3.04 | 0.00 | 0.097 | 92.3 | 33.0 | 27.7 | 73.0 | 69.5 | 1.3 | 4.2 |
| 100 | mean_reverting | 0 | 7.5 | 100.00 | 100.0 | -3.04 | 0.00 | 0.097 | 92.3 | 33.0 | 27.7 | 73.0 | 69.5 | 1.3 | 4.2 |
| 100 | mean_reverting | 0.1 | 0.01 | 5.10 | 100.0 | -6.56 | 0.79 | 0.530 | 4.7 | 12.3 | 8.4 | 74.3 | 99.6 | 23.1 | 0.0 |
| 100 | mean_reverting | 0.1 | 0.02 | 0.00 | 0.0 | -14.55 | 1.57 | 0.000 | 0.0 | 12.2 | 7.8 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.1 | 0.03 | 0.00 | 0.0 | -22.88 | 2.38 | 0.000 | 0.0 | 12.2 | 7.7 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.1 | 0.05 | 0.00 | 0.0 | -39.39 | 3.99 | 0.000 | 0.0 | 12.2 | 7.7 | 74.4 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.1 | 0.1 | 17.22 | 100.0 | -1.63 | 0.00 | 0.530 | 33.2 | 26.0 | 9.6 | 74.2 | 98.7 | 21.5 | 0.0 |
| 100 | mean_reverting | 0.1 | 7.5 | 17.22 | 100.0 | -1.63 | 0.00 | 0.530 | 33.2 | 26.0 | 9.6 | 74.2 | 98.7 | 21.5 | 0.0 |
| 100 | mean_reverting | 0.25 | 0.01 | 0.00 | 0.0 | -6.52 | 0.79 | 0.000 | 0.0 | 12.2 | 7.8 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.25 | 0.02 | 0.00 | 0.0 | -14.55 | 1.57 | 0.000 | 0.0 | 12.2 | 7.8 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.25 | 0.03 | 0.00 | 0.0 | -22.88 | 2.38 | 0.000 | 0.0 | 12.2 | 7.7 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.25 | 0.05 | 0.00 | 0.0 | -39.39 | 3.99 | 0.000 | 0.0 | 12.2 | 7.7 | 74.4 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.25 | 0.1 | 0.00 | 0.0 | -1.51 | 0.00 | 0.000 | 0.0 | 25.4 | 7.8 | 74.4 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.25 | 7.5 | 0.00 | 0.0 | -1.51 | 0.00 | 0.000 | 0.0 | 25.4 | 7.8 | 74.4 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.5 | 0.01 | 0.00 | 0.0 | -6.52 | 0.79 | 0.000 | 0.0 | 12.2 | 7.8 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.5 | 0.02 | 0.00 | 0.0 | -14.55 | 1.57 | 0.000 | 0.0 | 12.2 | 7.8 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.5 | 0.03 | 0.00 | 0.0 | -22.88 | 2.38 | 0.000 | 0.0 | 12.2 | 7.7 | 74.3 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.5 | 0.05 | 0.00 | 0.0 | -39.39 | 3.99 | 0.000 | 0.0 | 12.2 | 7.7 | 74.4 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.5 | 0.1 | 0.00 | 0.0 | -1.51 | 0.00 | 0.000 | 0.0 | 25.4 | 7.8 | 74.4 | 100.0 | 23.7 | 0.0 |
| 100 | mean_reverting | 0.5 | 7.5 | 0.00 | 0.0 | -1.51 | 0.00 | 0.000 | 0.0 | 25.4 | 7.8 | 74.4 | 100.0 | 23.7 | 0.0 |
| 100 | choppy | 0 | 0.01 | 84.58 | 100.0 | -6.15 | 0.84 | 0.093 | 97.2 | 16.3 | 17.9 | 73.8 | 80.4 | 8.4 | 3.8 |
| 100 | choppy | 0 | 0.02 | 36.88 | 92.0 | -13.66 | 1.59 | 0.056 | 98.2 | 13.2 | 10.8 | 74.3 | 94.0 | 17.8 | 0.4 |
| 100 | choppy | 0 | 0.03 | 6.96 | 56.0 | -21.81 | 2.38 | 0.035 | 99.4 | 13.2 | 8.3 | 74.4 | 98.9 | 22.5 | 0.0 |
| 100 | choppy | 0 | 0.05 | 0.30 | 20.0 | -38.61 | 4.01 | 0.025 | 100.0 | 13.4 | 7.7 | 74.4 | 99.9 | 23.3 | 0.0 |
| 100 | choppy | 0 | 0.1 | 97.02 | 100.0 | -1.30 | 0.00 | 0.109 | 89.7 | 27.9 | 23.5 | 73.5 | 71.0 | 4.2 | 6.3 |
| 100 | choppy | 0 | 7.5 | 97.02 | 100.0 | -1.30 | 0.00 | 0.109 | 89.7 | 27.9 | 23.5 | 73.5 | 71.0 | 4.2 | 6.3 |
| 100 | choppy | 0.1 | 0.01 | 6.70 | 58.0 | -5.49 | 0.80 | 0.548 | 35.8 | 13.1 | 8.5 | 74.2 | 99.5 | 22.8 | 0.0 |
| 100 | choppy | 0.1 | 0.02 | 0.26 | 6.0 | -13.52 | 1.58 | 0.543 | 23.1 | 13.1 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | choppy | 0.1 | 0.03 | 0.00 | 0.0 | -21.82 | 2.38 | 0.000 | 0.0 | 13.1 | 7.7 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | choppy | 0.1 | 0.05 | 0.00 | 0.0 | -38.66 | 4.01 | 0.000 | 0.0 | 13.4 | 7.6 | 74.4 | 100.0 | 23.3 | 0.0 |
| 100 | choppy | 0.1 | 0.1 | 17.30 | 84.0 | -0.48 | 0.00 | 0.547 | 37.5 | 19.0 | 9.5 | 74.5 | 98.7 | 21.0 | 0.1 |
| 100 | choppy | 0.1 | 7.5 | 17.30 | 84.0 | -0.48 | 0.00 | 0.547 | 37.5 | 19.0 | 9.5 | 74.5 | 98.7 | 21.0 | 0.1 |
| 100 | choppy | 0.25 | 0.01 | 0.00 | 0.0 | -5.32 | 0.79 | 0.000 | 0.0 | 13.0 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | choppy | 0.25 | 0.02 | 0.00 | 0.0 | -13.51 | 1.58 | 0.000 | 0.0 | 13.1 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | choppy | 0.25 | 0.03 | 0.00 | 0.0 | -21.82 | 2.38 | 0.000 | 0.0 | 13.1 | 7.7 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | choppy | 0.25 | 0.05 | 0.00 | 0.0 | -38.66 | 4.01 | 0.000 | 0.0 | 13.4 | 7.6 | 74.4 | 100.0 | 23.3 | 0.0 |
| 100 | choppy | 0.25 | 0.1 | 0.10 | 2.0 | -0.33 | 0.00 | 1.264 | 0.0 | 18.6 | 7.7 | 74.7 | 100.0 | 23.2 | 0.0 |
| 100 | choppy | 0.25 | 7.5 | 0.10 | 2.0 | -0.33 | 0.00 | 1.264 | 0.0 | 18.6 | 7.7 | 74.7 | 100.0 | 23.2 | 0.0 |
| 100 | choppy | 0.5 | 0.01 | 0.00 | 0.0 | -5.32 | 0.79 | 0.000 | 0.0 | 13.0 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | choppy | 0.5 | 0.02 | 0.00 | 0.0 | -13.51 | 1.58 | 0.000 | 0.0 | 13.1 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | choppy | 0.5 | 0.03 | 0.00 | 0.0 | -21.82 | 2.38 | 0.000 | 0.0 | 13.1 | 7.7 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | choppy | 0.5 | 0.05 | 0.00 | 0.0 | -38.66 | 4.01 | 0.000 | 0.0 | 13.4 | 7.6 | 74.4 | 100.0 | 23.3 | 0.0 |
| 100 | choppy | 0.5 | 0.1 | 0.00 | 0.0 | -0.33 | 0.00 | 0.000 | 0.0 | 18.6 | 7.6 | 74.7 | 100.0 | 23.2 | 0.0 |
| 100 | choppy | 0.5 | 7.5 | 0.00 | 0.0 | -0.33 | 0.00 | 0.000 | 0.0 | 18.6 | 7.6 | 74.7 | 100.0 | 23.2 | 0.0 |
| 100 | stress_flash_crash | 0 | 0.01 | 56.66 | 100.0 | -10.65 | 0.82 | 0.086 | 97.9 | 13.5 | 12.6 | 74.3 | 88.5 | 15.4 | 2.6 |
| 100 | stress_flash_crash | 0 | 0.02 | 24.62 | 86.0 | -18.19 | 1.59 | 0.054 | 100.0 | 13.4 | 9.7 | 74.3 | 95.8 | 19.9 | 0.3 |
| 100 | stress_flash_crash | 0 | 0.03 | 6.34 | 54.0 | -26.09 | 2.38 | 0.034 | 100.0 | 13.6 | 8.2 | 74.4 | 98.9 | 22.6 | 0.0 |
| 100 | stress_flash_crash | 0 | 0.05 | 0.30 | 20.0 | -42.40 | 4.01 | 0.025 | 100.0 | 14.0 | 7.7 | 74.4 | 99.9 | 23.3 | 0.0 |
| 100 | stress_flash_crash | 0 | 0.1 | 83.46 | 100.0 | -5.43 | 0.00 | 0.103 | 89.4 | 24.3 | 16.4 | 73.9 | 81.3 | 11.6 | 4.3 |
| 100 | stress_flash_crash | 0 | 7.5 | 83.46 | 100.0 | -5.43 | 0.00 | 0.103 | 89.4 | 24.3 | 16.4 | 73.9 | 81.3 | 11.6 | 4.3 |
| 100 | stress_flash_crash | 0.1 | 0.01 | 0.32 | 6.0 | -10.11 | 0.79 | 0.526 | 81.3 | 13.4 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | stress_flash_crash | 0.1 | 0.02 | 0.00 | 0.0 | -18.10 | 1.59 | 0.000 | 0.0 | 13.5 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | stress_flash_crash | 0.1 | 0.03 | 0.00 | 0.0 | -26.12 | 2.39 | 0.000 | 0.0 | 13.6 | 7.7 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | stress_flash_crash | 0.1 | 0.05 | 0.00 | 0.0 | -42.40 | 4.01 | 0.000 | 0.0 | 14.0 | 7.6 | 74.4 | 100.0 | 23.4 | 0.0 |
| 100 | stress_flash_crash | 0.1 | 0.1 | 2.42 | 34.0 | -4.53 | 0.00 | 0.552 | 55.4 | 19.3 | 7.9 | 74.7 | 99.8 | 22.9 | 0.0 |
| 100 | stress_flash_crash | 0.1 | 7.5 | 2.42 | 34.0 | -4.53 | 0.00 | 0.552 | 55.4 | 19.3 | 7.9 | 74.7 | 99.8 | 22.9 | 0.0 |
| 100 | stress_flash_crash | 0.25 | 0.01 | 0.00 | 0.0 | -10.10 | 0.79 | 0.000 | 0.0 | 13.4 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | stress_flash_crash | 0.25 | 0.02 | 0.00 | 0.0 | -18.10 | 1.59 | 0.000 | 0.0 | 13.5 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | stress_flash_crash | 0.25 | 0.03 | 0.00 | 0.0 | -26.12 | 2.39 | 0.000 | 0.0 | 13.6 | 7.7 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | stress_flash_crash | 0.25 | 0.05 | 0.00 | 0.0 | -42.40 | 4.01 | 0.000 | 0.0 | 14.0 | 7.6 | 74.4 | 100.0 | 23.4 | 0.0 |
| 100 | stress_flash_crash | 0.25 | 0.1 | 0.00 | 0.0 | -4.49 | 0.00 | 0.000 | 0.0 | 19.2 | 7.6 | 74.8 | 100.0 | 23.1 | 0.0 |
| 100 | stress_flash_crash | 0.25 | 7.5 | 0.00 | 0.0 | -4.49 | 0.00 | 0.000 | 0.0 | 19.2 | 7.6 | 74.8 | 100.0 | 23.1 | 0.0 |
| 100 | stress_flash_crash | 0.5 | 0.01 | 0.00 | 0.0 | -10.10 | 0.79 | 0.000 | 0.0 | 13.4 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | stress_flash_crash | 0.5 | 0.02 | 0.00 | 0.0 | -18.10 | 1.59 | 0.000 | 0.0 | 13.5 | 7.8 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | stress_flash_crash | 0.5 | 0.03 | 0.00 | 0.0 | -26.12 | 2.39 | 0.000 | 0.0 | 13.6 | 7.7 | 74.3 | 100.0 | 23.6 | 0.0 |
| 100 | stress_flash_crash | 0.5 | 0.05 | 0.00 | 0.0 | -42.40 | 4.01 | 0.000 | 0.0 | 14.0 | 7.6 | 74.4 | 100.0 | 23.4 | 0.0 |
| 100 | stress_flash_crash | 0.5 | 0.1 | 0.00 | 0.0 | -4.49 | 0.00 | 0.000 | 0.0 | 19.2 | 7.6 | 74.8 | 100.0 | 23.1 | 0.0 |
| 100 | stress_flash_crash | 0.5 | 7.5 | 0.00 | 0.0 | -4.49 | 0.00 | 0.000 | 0.0 | 19.2 | 7.6 | 74.8 | 100.0 | 23.1 | 0.0 |

Every gate seen, maximum over cells of the share of evaluations it failed and of the share where it was the only failure:

- n_min: 33.0 percent failed, 0.0 percent sole
- cooldown: 28.3 percent failed, 9.5 percent sole
- percentile: 74.8 percent failed, 12.5 percent sole
- profit: 100.0 percent failed, 25.2 percent sole
- zero_downside_flag: 0.1 percent failed, 0.0 percent sole
- no_fitness: 2.1 percent failed, 0.0 percent sole
- descendants: 6.7 percent failed, 5.3 percent sole

## Full table, population 1,000, 10 seeds

| pop | regime | profit_frac | x402 | repro mean | seeds repro % | roi mean | x402/agent | child principal | child retired % | fail n_min % | fail cooldown % | fail percentile % | fail profit % | sole profit % | sole percentile % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1000 | trending | 0 | 0.01 | 1000.00 | 100.0 | -3.17 | 0.92 | 0.141 | 100.0 | 14.8 | 26.9 | 73.3 | 59.7 | 1.4 | 13.3 |
| 1000 | trending | 0 | 0.05 | 24.90 | 80.0 | -34.34 | 3.94 | 0.031 | 100.0 | 8.1 | 8.0 | 74.4 | 99.3 | 23.2 | 0.0 |
| 1000 | trending | 0 | 0.1 | 1000.00 | 100.0 | 1.69 | 0.00 | 0.170 | 84.6 | 20.8 | 30.4 | 72.0 | 54.4 | 1.3 | 15.8 |
| 1000 | trending | 0.1 | 0.01 | 257.30 | 100.0 | -1.87 | 0.84 | 0.558 | 48.5 | 8.7 | 10.8 | 74.1 | 97.7 | 20.2 | 0.4 |
| 1000 | trending | 0.1 | 0.05 | 0.00 | 0.0 | -34.43 | 3.95 | 0.000 | 0.0 | 8.1 | 7.8 | 74.5 | 100.0 | 23.6 | 0.0 |
| 1000 | trending | 0.1 | 0.1 | 423.00 | 100.0 | 2.86 | 0.00 | 0.566 | 44.2 | 10.7 | 12.2 | 73.8 | 96.1 | 18.4 | 0.9 |
| 1000 | trending | 0.5 | 0.01 | 0.00 | 0.0 | -0.93 | 0.77 | 0.000 | 0.0 | 8.3 | 8.0 | 74.3 | 100.0 | 23.7 | 0.0 |
| 1000 | trending | 0.5 | 0.05 | 0.00 | 0.0 | -34.43 | 3.95 | 0.000 | 0.0 | 8.1 | 7.8 | 74.5 | 100.0 | 23.6 | 0.0 |
| 1000 | trending | 0.5 | 0.1 | 0.00 | 0.0 | 3.41 | 0.00 | 0.000 | 0.0 | 9.6 | 7.9 | 74.4 | 100.0 | 23.6 | 0.0 |
| 1000 | stress_flash_crash | 0 | 0.01 | 697.00 | 100.0 | -10.96 | 0.85 | 0.102 | 98.8 | 10.8 | 14.0 | 74.4 | 83.9 | 13.5 | 4.3 |
| 1000 | stress_flash_crash | 0 | 0.05 | 6.80 | 70.0 | -41.90 | 3.98 | 0.025 | 100.0 | 10.8 | 7.8 | 74.5 | 99.7 | 23.4 | 0.0 |
| 1000 | stress_flash_crash | 0 | 0.1 | 915.90 | 100.0 | -5.91 | 0.00 | 0.119 | 89.6 | 22.4 | 19.1 | 73.3 | 76.4 | 9.6 | 6.1 |
| 1000 | stress_flash_crash | 0.1 | 0.01 | 4.60 | 20.0 | -10.03 | 0.78 | 0.524 | 13.0 | 10.2 | 7.9 | 74.4 | 100.0 | 23.6 | 0.0 |
| 1000 | stress_flash_crash | 0.1 | 0.05 | 0.00 | 0.0 | -42.01 | 3.98 | 0.000 | 0.0 | 10.7 | 7.7 | 74.5 | 100.0 | 23.5 | 0.0 |
| 1000 | stress_flash_crash | 0.1 | 0.1 | 39.90 | 50.0 | -4.71 | 0.00 | 0.550 | 47.1 | 15.3 | 8.0 | 74.5 | 99.7 | 22.9 | 0.0 |
| 1000 | stress_flash_crash | 0.5 | 0.01 | 0.00 | 0.0 | -10.02 | 0.78 | 0.000 | 0.0 | 10.2 | 7.8 | 74.4 | 100.0 | 23.6 | 0.0 |
| 1000 | stress_flash_crash | 0.5 | 0.05 | 0.00 | 0.0 | -42.01 | 3.98 | 0.000 | 0.0 | 10.7 | 7.7 | 74.5 | 100.0 | 23.5 | 0.0 |
| 1000 | stress_flash_crash | 0.5 | 0.1 | 0.00 | 0.0 | -4.67 | 0.00 | 0.000 | 0.0 | 14.9 | 7.6 | 74.5 | 100.0 | 23.4 | 0.0 |

Every gate seen, maximum over cells of the share of evaluations it failed and of the share where it was the only failure:

- n_min: 22.4 percent failed, 0.0 percent sole
- cooldown: 30.4 percent failed, 9.9 percent sole
- percentile: 74.5 percent failed, 15.8 percent sole
- profit: 100.0 percent failed, 23.7 percent sole
- zero_downside_flag: 0.0 percent failed, 0.0 percent sole
- no_fitness: 0.9 percent failed, 0.0 percent sole
- descendants: 0.1 percent failed, 0.0 percent sole
