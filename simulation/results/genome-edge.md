# Genome-edge study on Kuru MON-USDC

Issue #102. This is the study named in `EVOLUTION.md` section 7, item 4: does the genome space of the production trading strategy carry a net, persistent edge of at least the size the simulation assumed, on real data from the MVP venue? The design, hypotheses, thresholds, and decision rule were fixed in `genome-edge-preregistration.md` (committed and pushed as 5c48579 before any study data was fetched; identical content as 071d271 after the branch was rebased onto main) and in issue #102 before any study data was fetched. Section numbers below of the form "pre-registration section N" refer to that document.

## Answer

**No-go under the pre-registered rule.** All three no-go conditions in pre-registration section 7 are met, each on its own:

- **H1 is negative.** The genome fields explain held-out differences in net per-tick return about one tenth the size the issue #84 model assumes. Pooled over the held-out period, the top fifth of genomes (ranked in-sample) beat the bottom fifth by 0.028 market standard deviations per tick (95 percent bounds 0.015 to 0.039), against a modeled size of 0.278 at magnitude 0.006. Only the choppy regime qualified; there it was 0.024 (upper bound 0.038) against 0.297.
- **H2 is negative.** Fitness rank barely persists. The mean Spearman correlation between adjusted fitness and the next 20 ticks' net return was 0.066 (95 percent bounds 0.027 to 0.103), against 0.416 in the model at magnitude 0.006. At zero cost it is -0.017, so the persistence that does exist comes from trading costs (genomes that swap less lose less), not from the signal.
- **H3 does not pass, with the calibrated magnitude below 0.006.** The measured spread maps to a magnitude of 0: it is below what the synthetic model produces with no genome edge at all (0.038). Re-running the issue #92 comparison at magnitude 0 on new seeds 101 to 150, owner-scoped reallocation with retirement is **inconclusive** against the static population (2 of 12 cells significant, both lower, median gap -0.24 pp).

The Coinbase MON-USD proxy gives the same answer on every hypothesis, as does every cost case (base, high, zero).

What this means for issue #28 (pre-registration section 7): for this strategy plugin, selection adds nothing measurable, and per `EVOLUTION.md` section 7 the product rests on well-calibrated static agents with reallocation off. This is the outcome issue #28's gate names for closing the epic in favor of static agents. It is a statement about this strategy's genome space on this market, not about every strategy: a different strategy plugin would need its own study.

## Deviations from the pre-registered design

Stated before the results, as the pre-registration requires. None changes a threshold, a statistic, or the decision rule.

- **The Kuru market has no trades before 2025-12-23.** The first `Trade` event of the mainnet MON-USDC market in the fetched range is at 2025-12-23 12:52 UTC (block 43,922,596); the market emitted no events of any kind at block 42,000,000 (2025-12-14). The pre-registration assumed history from 2025-11-25. The Kuru series, and with it the in-sample backtest and the in-sample regime blocks, therefore start at 2025-12-23 13:00 UTC, the first hour with a return (3,826 in-sample hours instead of 4,512). The Coinbase proxy was cut to the same hours, so both sources cover identical hours. The data quality gate was computed over the pre-registered window as written, including the empty weeks, and still passed (section "Data").
- **Regime blocks start at the first priced hour.** With the series starting on 2025-12-23, the in-sample period holds 11 full 14-day blocks; the 130-hour remainder before the held-out start is under 7 days and was dropped, as the rule says.
- **The raw trade file is not committed.** It holds 9,569,442 `Trade` events (556 MB), above the 25 MB limit in pre-registration section 2. Per that section, the fetch script, the block range, the per-chunk event counts (`data/genome-edge/kuru-chunks.csv`), and the raw file's SHA-256 (`data/genome-edge/manifest.json`) are committed instead, with the hourly series. The Coinbase raw candles are small and are committed.
- **Bootstrap bounds are one-sided.** "95 percent upper bound" and "95 percent lower bound" are the 95th and 5th percentiles of the moving-block bootstrap, matching the one-sided tests.
- **Order of work.** The synthetic reference was computed first (it uses no market data). The in-sample dry run (pre-registration section 2: in-sample first two thirds against last third) was run from the raw files with the series cut at the held-out start, so it read no held-out hour; it gave the same direction as the final run (`results/genome-edge/insample-dry-run.json`). Between the dry run and the final run the code changed only to stream the trade file (it outgrew the string size limit once the held-out blocks arrived) and to add the report printer. The held-out analysis ran once.

## Data

| item | value |
|---|---|
| Kuru market | MON-USDC `0x065C9d28E428A0db40191a54d33d5b7c71a9C394`, Monad mainnet (chain id 143) |
| Fetch | `eth_getLogs`, `Trade(uint40,address,bool,uint256,uint96,address,address,uint96)` topic, 14,378 chunks of 5,000 blocks, blocks 37,574,357 to 109,459,390, `rpc2.monad.xyz`, fetched 2026-10-10 |
| Events | 9,569,442 `Trade` events (book fills; one taker swap can fill several maker orders) |
| Price scale | 1e18, quote per base; the hourly Kuru close is within 0.15 percent of Coinbase in 90 percent of hours (median ratio 1.0001) |
| Kuru in-sample coverage (2025-11-25 to 2026-05-31, as pre-registered) | 84.5 percent of hours with a trade (gate: at least 80) |
| Kuru held-out coverage | 98.6 percent (gate: at least 90) |
| Kuru and Coinbase hourly return correlation, in-sample | 0.982 over 3,827 paired hours (gate: at least 0.8) |
| Gate | **passes**; Kuru is the primary source |
| MON-USDC close | 0.0198 at the start, 0.0239 at the held-out start, 0.0317 at the end (+33 percent over the held-out period) |
| Hourly return sd | 0.0125 in-sample, 0.0106 held-out, close to the harness's 0.01 per tick |

Files: `data/genome-edge/kuru-mon-usdc-1h.csv` and `data/genome-edge/coinbase-mon-usd-1h.csv` (hourly close and observation count; `NaN` before the first Kuru trade), `data/genome-edge/coinbase-mon-usd-1h-raw.csv`, `data/genome-edge/kuru-chunks.csv`, and `data/genome-edge/manifest.json` with SHA-256 checksums.

### Regimes

Under the pre-registered rule (pre-registration section 4), the in-sample period has 3 trending and 8 choppy blocks; the held-out period has 1 trending, 3 mean-reverting, and 5 choppy blocks. No block in either period is stress (the threshold is 1.5 times the in-sample median block sd, 0.0177). Only **choppy** qualifies for H1 (at least 2 blocks in each period). Mean-reverting appears only in the held-out period, so it cannot be ranked in-sample. The three held-out mean-reverting blocks have lag-1 autocorrelations of -0.12 to -0.17; some of that is likely bid-ask bounce in last-trade closes (pre-registration section 8), since the Coinbase series labels two of the three the same way.

## H1, H2, H3

| hypothesis | measured (Kuru, base cost) | modeled size at 0.006 | rule | call |
|---|---|---|---|---|
| H1, choppy (only qualifying regime) | normalized spread 0.024, p 0.004, upper bound 0.038 | 0.297 | holds if at least the reference and p < 0.05; below if the upper bound is under the reference | below the modeled size |
| H1, pooled (fewer than 2 regimes qualify) | 0.028, bounds 0.015 to 0.039 | 0.278 | negative if the upper bound is under the pooled reference | **negative** |
| H2, rank persistence | rho 0.066, bounds 0.027 to 0.103, 141 evaluations, about 711 genomes ranked each | 0.416 | negative if the upper bound is under the reference | **negative** |
| H3, calibrated re-run | m* = 0; arm vs C1: 2 of 12 cells significant, both lower, median -0.24 pp | outperforms C1 | passes if the arm outperforms C1 | **does not pass** (inconclusive) |

### Reading

- **The genome fields do separate genomes, but by an amount the mechanism cannot use.** The pooled spread is positive and significant (lower bound 0.015), which is a real, measurable difference between better and worse genomes out of sample. It is about a tenth of the modeled size and below what the synthetic model shows with no genome edge at all (0.038 at magnitude 0), so on the calibration curve it is magnitude 0.
- **What persists is cost, not signal.** At zero cost the pooled spread falls to 0.007 (bounds -0.006 to 0.017) and rank persistence to -0.017 (bounds -0.055 to 0.016). At the high cost case both rise (0.040 and 0.117). The ranking that persists sorts genomes by how often they swap. A static agent can be calibrated to trade less directly; it does not need selection to find that.
- **Within the held-out period the fields explain about half of the cross-genome variation** (R-squared 0.49 on log horizon, threshold, and log frequency), but it does not carry from in-sample to held-out once costs are removed (Spearman 0.35 at zero cost, against 0.70 at base cost). In a held-out period in which MON rose 33 percent, genomes that stayed long earned the market's drift; that is exposure, not a genome edge.
- **The more-than-one-regime test could not be run on this history.** Only choppy qualified. The trending regime had one held-out block, with a spread of 0.067 that is also far below its reference of 0.363 (and -0.008 on the proxy). No stress block occurred.
- **The pair field cannot carry an edge at the MVP venue.** Kuru lists two mainnet markets, both MON against a dollar stablecoin. The issue #84 model gives the pair 0.3 of the score; at this venue that component is zero by construction. The synthetic reference keeps it, as pre-registered; without it the reference is higher, not lower (0.33 instead of 0.30 in choppy), because the remaining fields then carry the full magnitude, so dropping it would not change any call.
- **H3 at magnitude 0.** With no genome edge, owner-scoped reallocation with retirement does not beat the static population (median -0.24 pp, two cells significantly lower). It beats random replacement (8 of 12 cells), but only because random replacement itself does worse than static at magnitude 0 (8 of 12 cells lower, median -1.26 pp). The mechanism converts an edge into return; given none, it adds nothing.

## H3: the issue #92 comparison at the calibrated magnitude

Arm `Omix-RT-c0.2-x4` against `C1` and `C2`, everything as in issue #92 except magnitude 0 (the calibrated `m*`) and seeds 101 to 150. Rule: `decide` in `src/rerun.ts`, unchanged.

Magnitude 0, seeds 101 to 150.

| hypothesis | comparison | cells | cells p < 0.05 | median gap pp | stress (3 cells) | call |
|---|---|---:|---|---:|---|---|
| H3 (primary) | Omix-RT-c0.2-x4 vs C1 | 12 | 2 (0 up, 2 down) | -0.24 | inconclusive (0 up, 0 down) | **inconclusive** |
| H3, reported | Omix-RT-c0.2-x4 vs C2 | 12 | 8 (8 up, 0 down) | 1.29 | outperforms (2 up, 0 down) | **outperforms** |
| context | C2 vs C1 | 12 | 8 (0 up, 8 down) | -1.26 | underperforms (0 up, 2 down) | **underperforms** |

| pop | regime | arm roi | C1 roi | gap vs C1 | Welch p vs C1 | C2 roi | gap vs C2 | Welch p vs C2 |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -10.21 | -10.20 | -0.01 | 0.9810 | -10.47 | 0.26 | 0.5716 |
| 10 | mean_reverting | -15.15 | -14.86 | -0.29 | 0.2477 | -15.20 | 0.05 | 0.8264 |
| 10 | choppy | -13.37 | -13.06 | -0.31 | 0.4429 | -13.38 | 0.01 | 0.9789 |
| 10 | stress_flash_crash | -17.17 | -16.38 | -0.79 | 0.0908 | -16.79 | -0.38 | 0.4158 |
| 100 | trending | -9.26 | -9.46 | 0.20 | 0.6190 | -10.58 | 1.32 | 0.0022 |
| 100 | mean_reverting | -13.63 | -13.39 | -0.24 | 0.0113 | -14.99 | 1.36 | <0.0001 |
| 100 | choppy | -12.18 | -12.14 | -0.04 | 0.9111 | -13.44 | 1.26 | 0.0003 |
| 100 | stress_flash_crash | -15.50 | -15.09 | -0.41 | 0.1651 | -16.75 | 1.25 | <0.0001 |
| 1000 | trending | -9.16 | -9.38 | 0.23 | 0.5769 | -10.61 | 1.46 | 0.0009 |
| 1000 | mean_reverting | -13.39 | -13.15 | -0.24 | 0.0010 | -14.91 | 1.52 | <0.0001 |
| 1000 | choppy | -12.03 | -12.05 | 0.02 | 0.9432 | -13.47 | 1.44 | <0.0001 |
| 1000 | stress_flash_crash | -15.34 | -15.01 | -0.33 | 0.2553 | -16.75 | 1.41 | <0.0001 |

## Tables

Printed by `PHASE=report node dist/src/cli-genome-edge.js`. "normalized" is the spread in market standard deviations per tick; "carry" is the Spearman correlation of per-genome mean net return, in-sample against held-out. Every source and cost case is shown; only Kuru at base cost is used for the call.

### H1 by regime

| source | cost | regime | blocks in / out | qualifies | ticks out | spread bp/tick | market sd | normalized | one-sided p | 95% upper | reference 0.006 | carry |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| kuru | base | trending | 3 / 1 | no | 336 | 8.50 | 0.0126 | 0.067 | 0.014 | 0.104 | 0.363 | 0.682 |
| kuru | base | mean_reverting | 0 / 3 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.259 | n/a |
| kuru | base | choppy | 8 / 5 | yes | 1584 | 2.63 | 0.0108 | 0.024 | 0.004 | 0.038 | 0.297 | 0.520 |
| kuru | base | stress | 0 / 0 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.192 | n/a |
| coinbase | base | trending | 2 / 1 | no | 336 | -0.96 | 0.0127 | -0.008 | 0.614 | 0.015 | 0.363 | 0.180 |
| coinbase | base | mean_reverting | 0 / 2 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.259 | n/a |
| coinbase | base | choppy | 9 / 6 | yes | 1920 | 3.24 | 0.0114 | 0.029 | 0.006 | 0.045 | 0.297 | 0.733 |
| coinbase | base | stress | 0 / 0 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.192 | n/a |
| kuru | high | trending | 3 / 1 | no | 336 | 9.23 | 0.0126 | 0.073 | 0.004 | 0.108 | 0.365 | 0.691 |
| kuru | high | mean_reverting | 0 / 3 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.264 | n/a |
| kuru | high | choppy | 8 / 5 | yes | 1584 | 3.86 | 0.0108 | 0.036 | 0.001 | 0.050 | 0.297 | 0.622 |
| kuru | high | stress | 0 / 0 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.191 | n/a |
| coinbase | high | trending | 2 / 1 | no | 336 | 0.35 | 0.0127 | 0.003 | 0.325 | 0.026 | 0.365 | 0.234 |
| coinbase | high | mean_reverting | 0 / 2 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.264 | n/a |
| coinbase | high | choppy | 9 / 6 | yes | 1920 | 4.47 | 0.0114 | 0.039 | 0.001 | 0.056 | 0.297 | 0.801 |
| coinbase | high | stress | 0 / 0 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.191 | n/a |
| kuru | zero | trending | 3 / 1 | no | 336 | 9.76 | 0.0126 | 0.077 | 0.049 | 0.132 | 0.361 | 0.696 |
| kuru | zero | mean_reverting | 0 / 3 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.255 | n/a |
| kuru | zero | choppy | 8 / 5 | yes | 1584 | 0.51 | 0.0108 | 0.005 | 0.198 | 0.013 | 0.299 | 0.239 |
| kuru | zero | stress | 0 / 0 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.193 | n/a |
| coinbase | zero | trending | 2 / 1 | no | 336 | -2.04 | 0.0127 | -0.016 | 0.926 | 0.001 | 0.361 | 0.081 |
| coinbase | zero | mean_reverting | 0 / 2 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.255 | n/a |
| coinbase | zero | choppy | 9 / 6 | yes | 1920 | 1.36 | 0.0114 | 0.012 | 0.195 | 0.031 | 0.299 | 0.461 |
| coinbase | zero | stress | 0 / 0 | no | 0 | n/a | n/a | n/a | n/a | n/a | 0.193 | n/a |

### Pooled and H2

| source | cost | H1 call | pooled normalized spread | 95% bounds | pooled reference | m* | H2 rho | 95% bounds | H2 reference | H2 call | evaluations | genomes ranked | in-market share | swaps per genome, held out | mean net bp/tick | held-out R2 on fields | in-sample to held-out carry |
|---|---|---|---:|---|---:|---:|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| kuru | base | negative | 0.028 | 0.015 to 0.039 | 0.278 | 0.0000 | 0.066 | 0.027 to 0.103 | 0.416 | negative | 141 | 711 | 0.499 | 101.7 | 0.072 | 0.495 | 0.703 |
| coinbase | base | negative | 0.029 | 0.016 to 0.040 | 0.278 | 0.0000 | 0.064 | 0.025 to 0.101 | 0.416 | negative | 141 | 714 | 0.500 | 104.2 | 0.048 | 0.490 | 0.726 |
| kuru | high | negative | 0.040 | 0.026 to 0.051 | 0.280 | 0.0000 | 0.117 | 0.076 to 0.156 | 0.433 | negative | 141 | 711 | 0.499 | 101.7 | -0.191 | 0.469 | 0.763 |
| coinbase | high | negative | 0.040 | 0.027 to 0.051 | 0.280 | 0.0000 | 0.115 | 0.074 to 0.154 | 0.433 | negative | 141 | 714 | 0.500 | 104.2 | -0.222 | 0.466 | 0.778 |
| kuru | zero | negative | 0.007 | -0.006 to 0.017 | 0.277 | 0.0000 | -0.017 | -0.055 to 0.016 | 0.390 | negative | 140 | 709 | 0.499 | 101.7 | 0.474 | 0.573 | 0.346 |
| coinbase | zero | negative | 0.009 | -0.005 to 0.021 | 0.277 | 0.0000 | -0.011 | -0.049 to 0.022 | 0.390 | negative | 141 | 712 | 0.500 | 104.2 | 0.460 | 0.558 | 0.407 |

### H2 by held-out regime (descriptive)

| source | cost | regime | evaluations | mean rho |
|---|---|---|---:|---:|
| kuru | base | trending | 17 | 0.112 |
| kuru | base | mean_reverting | 51 | 0.044 |
| kuru | base | choppy | 73 | 0.071 |
| kuru | base | stress | 0 | n/a |
| coinbase | base | trending | 17 | 0.126 |
| coinbase | base | mean_reverting | 34 | 0.026 |
| coinbase | base | choppy | 90 | 0.067 |
| coinbase | base | stress | 0 | n/a |
| kuru | high | trending | 17 | 0.162 |
| kuru | high | mean_reverting | 51 | 0.092 |
| kuru | high | choppy | 73 | 0.123 |
| kuru | high | stress | 0 | n/a |
| coinbase | high | trending | 17 | 0.172 |
| coinbase | high | mean_reverting | 34 | 0.075 |
| coinbase | high | choppy | 90 | 0.119 |
| coinbase | high | stress | 0 | n/a |
| kuru | zero | trending | 17 | 0.024 |
| kuru | zero | mean_reverting | 50 | -0.039 |
| kuru | zero | choppy | 73 | -0.012 |
| kuru | zero | stress | 0 | n/a |
| coinbase | zero | trending | 17 | 0.029 |
| coinbase | zero | mean_reverting | 34 | -0.057 |
| coinbase | zero | choppy | 90 | -0.001 |
| coinbase | zero | stress | 0 | n/a |

### Regime blocks (Kuru)

| period | from | hours | sd | efficiency | lag-1 autocorrelation | label |
|---|---|---:|---:|---:|---:|---|
| in-sample | 2025-12-23 | 336 | 0.0163 | 0.111 | -0.043 | trending |
| in-sample | 2026-01-06 | 336 | 0.0124 | 0.152 | -0.030 | trending |
| in-sample | 2026-01-20 | 336 | 0.0138 | 0.001 | 0.008 | choppy |
| in-sample | 2026-02-03 | 336 | 0.0170 | 0.065 | 0.122 | choppy |
| in-sample | 2026-02-17 | 336 | 0.0100 | 0.020 | -0.033 | choppy |
| in-sample | 2026-03-03 | 336 | 0.0079 | 0.077 | 0.014 | choppy |
| in-sample | 2026-03-17 | 336 | 0.0092 | 0.002 | 0.218 | choppy |
| in-sample | 2026-03-31 | 336 | 0.0151 | 0.132 | 0.033 | trending |
| in-sample | 2026-04-14 | 336 | 0.0118 | 0.074 | 0.013 | choppy |
| in-sample | 2026-04-28 | 336 | 0.0111 | 0.032 | 0.095 | choppy |
| in-sample | 2026-05-12 | 336 | 0.0101 | 0.054 | 0.001 | choppy |
| held-out | 2026-06-01 | 336 | 0.0133 | 0.008 | -0.055 | choppy |
| held-out | 2026-06-15 | 336 | 0.0081 | 0.090 | -0.172 | mean_reverting |
| held-out | 2026-06-29 | 336 | 0.0101 | 0.092 | -0.100 | choppy |
| held-out | 2026-07-13 | 336 | 0.0083 | 0.029 | -0.146 | mean_reverting |
| held-out | 2026-07-27 | 336 | 0.0059 | 0.009 | 0.011 | choppy |
| held-out | 2026-08-10 | 336 | 0.0126 | 0.150 | -0.108 | trending |
| held-out | 2026-08-24 | 336 | 0.0118 | 0.035 | -0.117 | mean_reverting |
| held-out | 2026-09-07 | 336 | 0.0099 | 0.027 | -0.048 | choppy |
| held-out | 2026-09-21 | 240 | 0.0141 | 0.108 | -0.040 | choppy |

### Synthetic reference (median over 20 seeds)

| cost | regime | magnitude | pair in score | normalized spread | rho |
|---|---|---:|---|---:|---:|
| base | trending | 0 | yes | 0.086 | 0.146 |
| base | trending | 0.0015 | yes | 0.149 | 0.239 |
| base | trending | 0.003 | yes | 0.219 | 0.348 |
| base | trending | 0.0045 | yes | 0.289 | 0.427 |
| base | trending | 0.006 | yes | 0.363 | 0.491 |
| base | trending | 0.006 | no | 0.407 | 0.563 |
| base | trending | 0.009 | yes | 0.517 | 0.572 |
| base | trending | 0.012 | yes | 0.683 | 0.607 |
| base | mean_reverting | 0 | yes | 0.063 | 0.244 |
| base | mean_reverting | 0.0015 | yes | 0.092 | 0.266 |
| base | mean_reverting | 0.003 | yes | 0.140 | 0.347 |
| base | mean_reverting | 0.0045 | yes | 0.198 | 0.411 |
| base | mean_reverting | 0.006 | yes | 0.259 | 0.456 |
| base | mean_reverting | 0.006 | no | 0.292 | 0.524 |
| base | mean_reverting | 0.009 | yes | 0.391 | 0.498 |
| base | mean_reverting | 0.012 | yes | 0.529 | 0.527 |
| base | choppy | 0 | yes | 0.014 | 0.058 |
| base | choppy | 0.0015 | yes | 0.067 | 0.127 |
| base | choppy | 0.003 | yes | 0.144 | 0.218 |
| base | choppy | 0.0045 | yes | 0.220 | 0.305 |
| base | choppy | 0.006 | yes | 0.297 | 0.375 |
| base | choppy | 0.006 | no | 0.330 | 0.442 |
| base | choppy | 0.009 | yes | 0.455 | 0.470 |
| base | choppy | 0.012 | yes | 0.619 | 0.524 |
| base | stress_flash_crash | 0 | yes | 0.009 | 0.046 |
| base | stress_flash_crash | 0.0015 | yes | 0.035 | 0.122 |
| base | stress_flash_crash | 0.003 | yes | 0.082 | 0.215 |
| base | stress_flash_crash | 0.0045 | yes | 0.136 | 0.301 |
| base | stress_flash_crash | 0.006 | yes | 0.192 | 0.362 |
| base | stress_flash_crash | 0.006 | no | 0.214 | 0.405 |
| base | stress_flash_crash | 0.009 | yes | 0.306 | 0.450 |
| base | stress_flash_crash | 0.012 | yes | 0.421 | 0.495 |
| high | trending | 0 | yes | 0.088 | 0.185 |
| high | trending | 0.0015 | yes | 0.151 | 0.274 |
| high | trending | 0.003 | yes | 0.221 | 0.374 |
| high | trending | 0.0045 | yes | 0.291 | 0.447 |
| high | trending | 0.006 | yes | 0.365 | 0.507 |
| high | trending | 0.009 | yes | 0.521 | 0.585 |
| high | trending | 0.012 | yes | 0.686 | 0.617 |
| high | mean_reverting | 0 | yes | 0.076 | 0.299 |
| high | mean_reverting | 0.0015 | yes | 0.103 | 0.310 |
| high | mean_reverting | 0.003 | yes | 0.148 | 0.378 |
| high | mean_reverting | 0.0045 | yes | 0.203 | 0.433 |
| high | mean_reverting | 0.006 | yes | 0.264 | 0.473 |
| high | mean_reverting | 0.009 | yes | 0.393 | 0.509 |
| high | mean_reverting | 0.012 | yes | 0.530 | 0.537 |
| high | choppy | 0 | yes | 0.024 | 0.095 |
| high | choppy | 0.0015 | yes | 0.073 | 0.161 |
| high | choppy | 0.003 | yes | 0.143 | 0.246 |
| high | choppy | 0.0045 | yes | 0.219 | 0.328 |
| high | choppy | 0.006 | yes | 0.297 | 0.393 |
| high | choppy | 0.009 | yes | 0.456 | 0.484 |
| high | choppy | 0.012 | yes | 0.621 | 0.536 |
| high | stress_flash_crash | 0 | yes | 0.019 | 0.082 |
| high | stress_flash_crash | 0.0015 | yes | 0.043 | 0.155 |
| high | stress_flash_crash | 0.003 | yes | 0.085 | 0.240 |
| high | stress_flash_crash | 0.0045 | yes | 0.136 | 0.321 |
| high | stress_flash_crash | 0.006 | yes | 0.191 | 0.381 |
| high | stress_flash_crash | 0.009 | yes | 0.306 | 0.466 |
| high | stress_flash_crash | 0.012 | yes | 0.422 | 0.508 |
| zero | trending | 0 | yes | 0.085 | 0.076 |
| zero | trending | 0.0015 | yes | 0.148 | 0.188 |
| zero | trending | 0.003 | yes | 0.217 | 0.308 |
| zero | trending | 0.0045 | yes | 0.289 | 0.396 |
| zero | trending | 0.006 | yes | 0.361 | 0.466 |
| zero | trending | 0.009 | yes | 0.515 | 0.557 |
| zero | trending | 0.012 | yes | 0.679 | 0.597 |
| zero | mean_reverting | 0 | yes | 0.043 | 0.144 |
| zero | mean_reverting | 0.0015 | yes | 0.077 | 0.197 |
| zero | mean_reverting | 0.003 | yes | 0.131 | 0.299 |
| zero | mean_reverting | 0.0045 | yes | 0.191 | 0.377 |
| zero | mean_reverting | 0.006 | yes | 0.255 | 0.431 |
| zero | mean_reverting | 0.009 | yes | 0.390 | 0.481 |
| zero | mean_reverting | 0.012 | yes | 0.529 | 0.512 |
| zero | choppy | 0 | yes | 0.006 | 0.017 |
| zero | choppy | 0.0015 | yes | 0.066 | 0.087 |
| zero | choppy | 0.003 | yes | 0.147 | 0.190 |
| zero | choppy | 0.0045 | yes | 0.222 | 0.276 |
| zero | choppy | 0.006 | yes | 0.299 | 0.350 |
| zero | choppy | 0.009 | yes | 0.455 | 0.450 |
| zero | choppy | 0.012 | yes | 0.618 | 0.508 |
| zero | stress_flash_crash | 0 | yes | 0.001 | 0.014 |
| zero | stress_flash_crash | 0.0015 | yes | 0.030 | 0.084 |
| zero | stress_flash_crash | 0.003 | yes | 0.082 | 0.185 |
| zero | stress_flash_crash | 0.0045 | yes | 0.138 | 0.274 |
| zero | stress_flash_crash | 0.006 | yes | 0.193 | 0.335 |
| zero | stress_flash_crash | 0.009 | yes | 0.305 | 0.427 |
| zero | stress_flash_crash | 0.012 | yes | 0.421 | 0.477 |

## Limitations

- One asset, one venue, nine months of usable Kuru history (2025-12-23 to 2026-09-30), and four months held out. Only one regime qualified for the per-regime test, and no stress regime occurred. The negative call rests on the pooled test and on H2, which the pre-registration specified for exactly this case.
- The signal is the harness's trailing-mean rule, because the production plugin takes `signal` as an input and defines none. Information purchases are off, because no history of Nansen or DeFiLlama responses exists. A strategy with a different signal, or with information that pays, is not covered by this result.
- Costs are October 2026 snapshots (a 7.4 bps half-spread, a 0 bps taker fee, and $0.00104 of estimated gas per swap) applied to the whole history. The conclusions hold at the high (19.2 bps per swap) and zero cost cases too.
- One tick is assumed to be one hour. The measured hourly return sd (0.011 to 0.013) is close to the harness's 0.01 per tick, which is what makes the noise-normalized comparison meaningful; a different production tick length would need its own check.
- Hourly closes are last trades, so bid-ask bounce is in the returns. The cost model charges the half-spread on every swap, and the Coinbase proxy, whose candles have the same issue in a deeper book, gives the same calls.
- The H3 re-run inherits every assumption of the issue #92 harness (the owner-size distribution, synthetic regimes, 300 ticks).

## Commands

From `simulation/`, after `bun run test` from the repository root:

```bash
SOURCE=coinbase node dist/src/cli-genome-edge-fetch.js            # 31 requests, seconds
SOURCE=kuru CONCURRENCY=3 node dist/src/cli-genome-edge-fetch.js  # resumable, about 1.5 hours on the public RPC
PHASE=bars node dist/src/cli-genome-edge.js                       # hourly series and manifest.json
# synthetic reference, one job per cost case and regime (12 jobs, about 20 minutes in parallel)
PHASE=synthetic COST_CASES=base REGIMES=choppy node dist/src/cli-genome-edge.js
PHASE=insample node dist/src/cli-genome-edge.js                   # gate and in-sample dry run
PHASE=final node dist/src/cli-genome-edge.js                      # held-out analysis, about 10 seconds
PHASE=report node dist/src/cli-genome-edge.js                     # the tables above
# H3: C1, C2, Omix-RT-c0.2-x4 at MAG=0, populations 10, 100, 1,000, four regimes, seeds 101 to 150 (36 jobs, 1,315 s)
ARM=C1 MAG=0 POPS=1000 REGIMES=choppy SEEDS=50 SEED_START=101 OUT=results/genome-edge/h3/C1-m0-1000-choppy.json node dist/src/cli-slots.js
node dist/src/cli-genome-edge-rerun-report.js results/genome-edge/h3
```

Outputs: `results/genome-edge/final.json`, `results/genome-edge/insample-dry-run.json`, `results/genome-edge/synthetic-*.json`, and `results/genome-edge/h3/`. `test/genome-edge.test.ts` covers the genome sample, the backtest timing and costs, frequency holding, a planted edge, the synthetic edge, calibration, the regime rule, trade decoding, and hourly bar construction.
