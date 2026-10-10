# Pre-registration: genome-edge study on Kuru MON-USDC

This document fixes the design of the study named in `EVOLUTION.md` section 7, item 4, before any of its in-sample or held-out market data is fetched. It is committed to the repository, and copied into its GitHub issue, before the data fetch runs. Any change after this commit is a deviation and is stated before the results in `simulation/results/genome-edge.md`.

The question: does the genome space of the production trading strategy carry a net, persistent, regime-dependent edge of at least the size the simulation assumed (the issue #84 genome model at magnitude 0.006 to 0.009), on real market data from the MVP venue? The adopted mechanism (`EVOLUTION.md` section 3) converts such an edge into population return and does not create one. Issue #28's implementation on real capital is gated on this answer.

## 1. What was checked before writing this, and what was seen

Facts below were read on 2026-10-10 unless stated. FACT means read from a primary source or from chain state; ASSUMPTION means a choice or an unverified belief.

- FACT. Kuru's documentation lists two mainnet markets, MON-USDC `0x065C9d28E428A0db40191a54d33d5b7c71a9C394` and MON-AUSD `0x131a2e70a5b31a517a74b8c567149bc294470da9` (`https://docs.kuru.io/contracts/Contract-addresses`). MON-USDC is the market the issue #20 spike targets, and the settlement asset is USDC, so MON-USDC is the MVP market for this study.
- FACT. `getMarketParams()` on the mainnet MON-USDC market returns `takerFeeBps` 0 and `makerFeeBps` 0, price precision 1e8, tick size 100 (a price step of 1e-6 USDC), base MON (native, 18 decimals), quote USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (6 decimals), chain id 143.
- FACT. Kuru documents no REST or candle API. Its integration page says to index trades from the `Trade` event of each market (`https://docs.kuru.io/contracts/Integration`). GeckoTerminal lists the market under the `kuru` DEX but reports zero transactions over 24 hours while the chain shows trades, so it is not used.
- FACT. The public RPC `https://rpc2.monad.xyz` serves `eth_getLogs` over at most 5,000 blocks per call, includes `blockTimestamp` in each log, and serves logs back to the chain's first blocks (block 1 has timestamp 2025-05-14). `https://rpc.monad.xyz` is limited to 100 blocks per call. A historical `bestBidAsk()` call at block 40,000,000 returned no data, so historical spreads cannot be read from that RPC.
- FACT. In blocks 112,108,788 to 112,113,788 (2026-10-10, after both study periods) the market emitted 48 events with the topic of `Trade(uint40,address,bool,uint256,uint96,address,address,uint96)`, about 90 per hour. Their prices were not decoded or analyzed.
- FACT. Monad public mainnet and MON trading began on 2025-11-24, reported as 14:00 UTC (`https://thedefiant.io/monad-launches-mainnet-mon-tge-listing`, `https://ambcrypto.com/monad-goes-live-as-mon-lists-on-coinbase-and-other-exchanges/`).
- FACT. Coinbase Exchange (`MON-USD`, `https://api.exchange.coinbase.com/products/MON-USD/candles`), Bybit (`MONUSDT`), and Kraken (`MONUSD`) serve hourly MON candles without authentication. Binance reports `MONUSDT` as an invalid symbol.
- Disclosure. During the availability probe, the API responses printed the most recent few hourly Coinbase and Bybit candles (2026-10-10, outside both periods) and the first three hourly Kraken candles of its 720-candle window, which start at 2026-09-10 06:00 UTC and fall inside the held-out period. Their close prices were 0.02444, 0.02371, and 0.02363. Ten `eth_getLogs` calls for the `Trade` topic over blocks 90,000,000 to 90,049,999 (in the held-out period) were sent only to time the RPC; their responses were discarded without being printed. Nothing else from either period has been seen, and no analysis was run on any of it. The study does not use Kraken.
- FACT. Twelve `bestBidAsk()` reads of the mainnet MON-USDC market between 06:46:49 and 06:47:46 UTC on 2026-10-10 gave spreads of 12.8 to 20.4 bps, median 14.8 bps. The issue #20 spike recorded one read of 15.5 bps on 2026-10-08. The median half-spread paid by a small taker is therefore about 7.4 bps. These are snapshots, not a spread history.
- FACT. The issue #20 dry run estimated 389,331 gas for a router swap at a base fee of 100 gwei, 0.0437 MON if the limit (estimate plus 10 percent) is charged. At the 2026-10-08 mainnet mid of 0.0238 USDC per MON that is about $0.00104 per swap. This is an estimate from testnet, not a mainnet receipt.
- FACT. `ECONOMICS.md` section 1 still carries the 15 bps fee-and-slippage line as an assumption. This study uses the issue #20 reads above as its base cost and the 15 bps line as a sensitivity.

## 2. Data

- **Primary: Kuru MON-USDC, mainnet, on chain.** Every `Trade` event of the market, fetched with `eth_getLogs` in 5,000-block chunks from `rpc2.monad.xyz`, decoded, and aggregated into hourly bars in UTC. The bar close is the price of the last trade in the hour, after dropping any trade whose price differs from the median price of that hour's trades by more than 5 percent. An hour with no trade carries the previous close forward. The hourly close series is committed to `simulation/data/` with a SHA-256 checksum; the raw trade file is committed too if it is under 25 MB, and otherwise the fetch script, the block range, per-chunk trade counts, and the raw file's SHA-256 are committed so the fetch is reproducible.
- **Secondary, a labeled proxy: Coinbase Exchange MON-USD hourly candles**, same hours, close price. It is a centralized exchange, not the MVP venue, with different liquidity, participants, and microstructure. It is used for a data sanity check and for a robustness re-run of every metric. It cannot produce a go on its own (section 7).
- **Periods.** In-sample: 2025-11-25 00:00 UTC to 2026-05-31 23:00 UTC (188 days, 4,512 hourly bars). Held-out: 2026-06-01 00:00 UTC to 2026-09-30 23:00 UTC (122 days, 2,928 hourly bars). The launch day is excluded. The held-out period is used once, for the final run, after the harness is complete and has been run on the in-sample period.
- **Data quality gate for the primary source.** The Kuru series is valid for the primary analysis only if (a) at least 80 percent of in-sample hours and 90 percent of held-out hours contain a trade, and (b) the Pearson correlation of Kuru and Coinbase hourly returns over the in-sample period is at least 0.8. If the gate fails, the study runs on the Coinbase proxy as primary, under the restriction in section 7.

## 3. The strategy and its genome space

The production plugin (`libs/strategy/src/propose.ts`) is long or flat: it goes long `capital * riskTolerance` when its signal plus any purchased information edge is positive, and trades only every `executionFrequency` ticks. The production plugin takes `signal` as an input and does not define it. The only definition in the repository is the harness strategy (`simulation/src/strategy.ts`): long when the trailing mean of the last `timeHorizon` market returns exceeds `entryThreshold`. ASSUMPTION: the study uses that signal, because it is the one the issue #84 genome model scores and the only one documented.

Genome fields and how the study treats each:

| field | in the study | reason |
|---|---|---|
| `timeHorizon` | varied, log-uniform on [1, 200] ticks, floored to an integer by the strategy | read by the signal; the issue #84 model's largest weight |
| `entryThreshold` | varied, uniform on [-0.01, 0.01] | read by the signal; same draw as `randomGenome` |
| `executionFrequency` | varied, an integer log-uniform on [1, 50] | read by the plugin; pinned at 1 in the simulations, mutable in production |
| `riskTolerance` | fixed at 0.25 | scales position size; per-unit return and Sortino are invariant to it except through gas, so it cannot rank genomes by edge; 0.25 is the policy every simulation used |
| `assetUniverse` (pair) | not varied | the MVP venue has two markets, both MON against a dollar stablecoin, so the pair cannot carry a directional edge; this is itself a finding against the 0.3 pair weight in the issue #84 model |
| `informationSources`, `informationBudget` | off | no history of Nansen or DeFiLlama responses exists to replay; the 0.002 information edge is a hypothesis, not data |
| `exitThreshold`, `modelConfiguration` | not used | the plugin does not read the first; the second configures an LLM that cannot be replayed |

The genome sample is 1,000 genomes drawn once from a mulberry32 stream with seed 20261010, in the order horizon, threshold, frequency, pair (pair used only by the synthetic reference, uniform over the three harness pairs). The same 1,000 genomes are used on the real series and on the synthetic reference.

**Tick and execution.** ASSUMPTION: one tick is one hour. Production has no wall-clock tick length documented, and an hour is the bar at which MON's return noise is expected to be of the order of the harness's 1 percent per tick noise. The decision at the close of bar `t` uses returns up to and including bar `t` and earns the simple return of bar `t + 1`. A genome decides at ticks where the tick index since the start of the series is a multiple of its frequency, and holds its position otherwise. The series starts at the first in-sample bar, and the signal may read earlier bars of the same series once they exist, so the held-out run carries its lookback from the in-sample period (prices only, which is not leakage of held-out information).

**Cost model, per position change (one swap):**

| case | fee | half-spread | gas | total per swap |
|---|---:|---:|---:|---:|
| base | 0 bps (measured `takerFeeBps`) | 7.4 bps (median of 13 snapshots) | $0.00104 on a $2.50 notional (capital $10, risk 0.25) = 4.2 bps | 11.6 bps |
| high (sensitivity) | 10 bps | 5 bps (the `ECONOMICS.md` section 1 assumption) | 4.2 bps | 19.2 bps |
| zero (sensitivity) | 0 | 0 | 0 | 0 |

x402 costs are zero because information purchases are off. Capital is held at $10 with no compounding, so each genome's per-tick net return on its notional is `position_t * return_t - swap_t * cost`. Decisions use base costs; the other two are reported.

## 4. Regimes

The real series is cut into consecutive 14-day blocks (336 hourly bars) from the start of each period; a final partial block is kept if it has at least 7 days and dropped otherwise. With `n` the number of returns in a block, each block is labeled in this order:

1. **stress** if the standard deviation of its hourly returns exceeds 1.5 times the median block standard deviation of the in-sample period;
2. **trending** if its efficiency ratio `|sum r| / sum |r|` is at least `2 / sqrt(n)` (about twice what a random walk gives);
3. **mean_reverting** if the lag-1 autocorrelation of its hourly returns is at most `-2 / sqrt(n)`;
4. **choppy** otherwise.

The thresholds are fixed now and use no held-out information. A regime **qualifies** for H1 if it has at least 2 blocks in the in-sample period and at least 2 blocks in the held-out period.

## 5. Synthetic reference: what "the modeled size" means in the same units

The issue #84 model states its edge per tick in the harness's own units, and the harness charges costs every tick in the market, so its numbers cannot be compared to a real backtest directly. The study therefore runs the identical backtest engine, cost model, genome sample, and statistics on synthetic markets from `simulation/src/market.ts` (the four harness regimes, 1 percent noise per tick), with the issue #84 edge `magnitude * (score - 1/3)` added to the bar return while in the market and to the signal, exactly as `src/runner.ts` adds it. For each regime and magnitude in {0, 0.0015, 0.003, 0.0045, 0.006, 0.009, 0.012}, 20 seeds, each with a 2,000-tick in-sample path and an independent 1,000-tick held-out path, the statistics of section 6 are computed, and the median over seeds is the reference. The reference at **magnitude 0.006**, the smaller validated magnitude and the one at which issue #92's H3 passed, is the "modeled size" threshold. The pair component of the score is included, with each genome's pair drawn uniformly, because it is part of the modeled edge; a reference without it is reported as a secondary.

Real-regime mapping: trending to `trending`, mean_reverting to `mean_reverting`, choppy to `choppy`, stress to `stress_flash_crash`.

## 6. Hypotheses, metrics, and tests

**H1, edge size by regime.** For each qualifying regime `R`, genomes are ranked by mean net per-tick return over the in-sample ticks labeled `R`. On the held-out ticks labeled `R`, the spread is the mean net per-tick return of the top fifth (200 genomes) minus that of the bottom fifth, divided by the standard deviation of the market's per-tick returns over those held-out ticks (a noise-normalized spread; on the synthetic series the noise is about 0.01). The p-value is one-sided, spread above 0, from a moving-block bootstrap of the per-tick spread series (block 24 ticks, 2,000 resamples, seed 1).

- H1 holds in a regime if the spread is at least the regime's synthetic reference at 0.006 and the bootstrap p is below 0.05.
- H1 is below the modeled size in a regime if the bootstrap 95 percent upper bound of the spread is below that reference.
- **H1 passes** if it holds in at least 2 qualifying regimes. **H1 is negative** if it is below the modeled size in every qualifying regime, or if fewer than 2 regimes qualify and the pooled spread (all held-out ticks, ranked on all in-sample ticks) has its upper bound below the pooled reference (the median of the four synthetic regime references). Otherwise H1 is inconclusive.

**H2, rank persistence (primary for the mechanism).** On the held-out period alone, every 20 ticks (the evaluation cadence), each genome's adjusted fitness is computed from its last 100 held-out ticks with `createFitnessEngine` from `libs/fitness` (Sortino with target 0, shrinkage with `k = 20` toward the population median raw Sortino, trade count = swaps in the window). Genomes with no adjusted fitness (zero downside or no swaps) are excluded, as section 3.1 item 4 excludes them from ranking. The statistic at each evaluation is the Spearman correlation between adjusted fitness and the net return summed over the next 20 ticks. `rho` is the mean over evaluations; its confidence interval is a moving-block bootstrap over evaluations (block 5, 2,000 resamples, seed 2). The reference is the same statistic on the synthetic held-out paths at magnitude 0.006, median over seeds, then median over the four regimes.

- **H2 passes** if `rho` is at least the reference and the bootstrap 95 percent lower bound is above 0. **H2 is negative** if the 95 percent upper bound is below the reference. Otherwise inconclusive.

**H3, calibrated re-run of the issue #92 comparison.** The calibrated magnitude `m*` is found by linear interpolation of the pooled real H1 spread on the pooled synthetic spread curve over the magnitude grid in section 5, floored at 0 and capped at 0.012. The issue #92 comparison is then re-run at `m*`, unchanged except for the magnitude and the seeds: arm `Omix-RT-c0.2-x4` against `C1` and against `C2`, populations 10, 100, and 1,000, the four regimes, 300 ticks, 50 seeds per cell on **seeds 101 to 150** (none used before), under the unchanged `ECONOMICS.md` section 8 rule (`decide` in `src/rerun.ts`). **H3 passes** if the arm outperforms C1. It is reported against C2 as well.

**Reported, not used for the call:** per-regime H2; all metrics under the high and zero cost cases; all metrics on the Coinbase proxy; the share of held-out variance in per-genome mean net return explained by the three genome fields (OLS on `ln timeHorizon`, `entryThreshold`, `ln executionFrequency`); the Spearman correlation between in-sample and held-out per-genome mean net return; mean in-market share and swaps per genome.

## 7. Decision rule and what each outcome means for issue #28

- **Go.** H1 passes, H2 passes, and H3 passes, on Kuru data. The genome-edge gate in `EVOLUTION.md` section 7, item 4, is met for this strategy on MON-USDC, and issue #28 may proceed to testnet capital under its other acceptance criteria.
- **No-go.** H2 is negative, or H1 is negative, or H3 does not pass with `m*` below 0.006. Selection adds nothing measurable for this strategy, and per `EVOLUTION.md` section 7 the product rests on well-calibrated static agents with reallocation off. For issue #28 this is the outcome its gate names for closing the epic in favor of static agents, for this strategy plugin; a different strategy plugin would need its own study.
- **Inconclusive.** Anything else. Issue #28 stays on hold, and the next step is a repeat on a later held-out window, pre-registered the same way.
- **Proxy restriction.** If the data quality gate fails and the study runs on the Coinbase proxy, the outcome can be no-go or inconclusive, never go, because the proxy is not the MVP venue.
- **Insufficient data.** If neither source can produce both periods, the study stops after the harness, and the documents say so without a result.

## 8. Known limits, stated in advance

- One asset, one venue, ten months of history. Four months of held-out data hold about 8 regime blocks, so some regimes may not qualify.
- Hourly bars from last trades include bid-ask bounce, which induces negative autocorrelation that a short-horizon genome could appear to exploit; the cost model charges the half-spread on every swap, which is the first-order correction, and the Coinbase re-run is a check.
- The spread and gas inputs are snapshots from October 2026, applied to the whole history. Spreads were likely wider in the first weeks after launch.
- The signal definition is the harness's, not a production one, and information purchases are off. A production strategy with a different signal, or with information that pays, is not covered.
- A negative result says the genome space of this strategy does not carry the modeled edge. It says nothing about whether some other strategy has an edge.
