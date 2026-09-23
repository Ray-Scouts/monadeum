# Niche sharing and diversity-responsive mutation

Seed 42, 300 ticks, evolving only. Starting genomes are spread across pair sets and the five risk bands, so the run does not begin as a single niche by construction. The off column is the same setup with diversity disabled, which is the no-mechanism baseline.

| pop | regime | diversity | end_pop | niches | gini | repro |
|---:|---|---|---:|---:|---:|---:|
| 10 | trending | off | 10 | 5 | 0.090 | 0 |
| 10 | trending | on | 10 | 5 | 0.051 | 0 |
| 10 | mean_reverting | off | 10 | 3 | 0.089 | 0 |
| 10 | mean_reverting | on | 10 | 5 | 0.068 | 0 |
| 10 | choppy | off | 10 | 5 | 0.094 | 0 |
| 10 | choppy | on | 10 | 5 | 0.051 | 0 |
| 10 | stress_flash_crash | off | 10 | 4 | 0.104 | 0 |
| 10 | stress_flash_crash | on | 10 | 5 | 0.042 | 0 |
| 100 | trending | off | 100 | 5 | 0.086 | 0 |
| 100 | trending | on | 100 | 5 | 0.087 | 0 |
| 100 | mean_reverting | off | 100 | 5 | 0.093 | 0 |
| 100 | mean_reverting | on | 100 | 5 | 0.093 | 0 |
| 100 | choppy | off | 100 | 5 | 0.090 | 0 |
| 100 | choppy | on | 100 | 5 | 0.086 | 0 |
| 100 | stress_flash_crash | off | 100 | 5 | 0.085 | 0 |
| 100 | stress_flash_crash | on | 100 | 5 | 0.087 | 0 |
| 1000 | trending | off | 1000 | 5 | 0.085 | 0 |
| 1000 | trending | on | 1000 | 5 | 0.086 | 0 |
| 1000 | mean_reverting | off | 1000 | 5 | 0.091 | 0 |
| 1000 | mean_reverting | on | 1000 | 5 | 0.090 | 0 |
| 1000 | choppy | off | 1000 | 5 | 0.083 | 0 |
| 1000 | choppy | on | 1000 | 5 | 0.085 | 0 |
| 1000 | stress_flash_crash | off | 1000 | 5 | 0.082 | 0 |
| 1000 | stress_flash_crash | on | 1000 | 5 | 0.083 | 0 |

## Conclusion

Reproduction count is zero in every cell. The eligibility gates (minimum trades, cooldown, profit above principal, and the niche percentile) never opened, so the penalty and the doubled mutation rate did not change who reproduced. They had nobody to act on.

Niche count at 100 and 1,000 agents stays at the five starting niches with the mechanism on or off. At 10 agents, mean-reversion and the stress regime drop to 3 and 4 niches with the mechanism off, and stay at 5 with it on, because retirement removed niches and the on/off capital paths are not identical (the crowded percentile changes fitness ranking's downstream retirement only when ranks differ, and here the Gini gap at population 10 is visible). That is not a reproductive monoculture.

A minimum niche floor is not justified by this run. Niche sharing is also not shown to be sufficient against collapse, because there was no collapse through reproduction to measure. The question in `EVOLUTION.md` section 5 stays open until a scenario that actually reproduces is run.
