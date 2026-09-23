# Multi-seed sweep

50 seeds, 300 ticks, diversity on, legal policy risk 0.25 and execution every tick (the best static legal policy in `sizing.md`). ROI and Sortino are the mean and the sample standard deviation across seeds. Welch is evolving ROI against static ROI. A cell is called outside the noise of one run when the two-sided p-value is below 0.05.

| pop | regime | mode | n | roi mean | roi sd | sortino mean | sortino sd |
|---:|---|---|---:|---:|---:|---:|---:|
| 10 | trending | static | 50 | -35.64 | 4.54 | -0.6111 | 0.0658 |
| 10 | trending | evolving | 50 | -35.64 | 4.54 | -0.6111 | 0.0658 |
| 10 | mean_reverting | static | 50 | -39.24 | 3.70 | -0.6459 | 0.0446 |
| 10 | mean_reverting | evolving | 50 | -39.24 | 3.70 | -0.6459 | 0.0446 |
| 10 | choppy | static | 50 | -38.59 | 4.21 | -0.6652 | 0.0591 |
| 10 | choppy | evolving | 50 | -38.59 | 4.21 | -0.6652 | 0.0591 |
| 10 | stress_flash_crash | static | 50 | -42.42 | 3.98 | -0.5096 | 0.1013 |
| 10 | stress_flash_crash | evolving | 50 | -42.42 | 3.98 | -0.5096 | 0.1013 |
| 100 | trending | static | 50 | -35.08 | 3.05 | -0.6385 | 0.0558 |
| 100 | trending | evolving | 50 | -35.08 | 3.05 | -0.6385 | 0.0558 |
| 100 | mean_reverting | static | 50 | -39.39 | 1.03 | -0.6818 | 0.0213 |
| 100 | mean_reverting | evolving | 50 | -39.39 | 1.03 | -0.6818 | 0.0213 |
| 100 | choppy | static | 50 | -38.66 | 2.24 | -0.7063 | 0.0495 |
| 100 | choppy | evolving | 50 | -38.66 | 2.24 | -0.7063 | 0.0495 |
| 100 | stress_flash_crash | static | 50 | -42.40 | 2.20 | -0.5321 | 0.1045 |
| 100 | stress_flash_crash | evolving | 50 | -42.40 | 2.20 | -0.5321 | 0.1045 |
| 1000 | trending | static | 50 | -35.09 | 3.03 | -0.6444 | 0.0579 |
| 1000 | trending | evolving | 50 | -35.09 | 3.03 | -0.6444 | 0.0579 |
| 1000 | mean_reverting | static | 50 | -39.34 | 0.44 | -0.6879 | 0.0160 |
| 1000 | mean_reverting | evolving | 50 | -39.34 | 0.44 | -0.6879 | 0.0160 |
| 1000 | choppy | static | 50 | -38.49 | 2.31 | -0.7111 | 0.0520 |
| 1000 | choppy | evolving | 50 | -38.49 | 2.31 | -0.7111 | 0.0520 |
| 1000 | stress_flash_crash | static | 50 | -42.24 | 2.17 | -0.5349 | 0.1037 |
| 1000 | stress_flash_crash | evolving | 50 | -42.24 | 2.17 | -0.5349 | 0.1037 |

## Evolving versus static

- pop 10, trending: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 10, mean_reverting: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 10, choppy: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 10, stress_flash_crash: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 100, trending: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 100, mean_reverting: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 100, choppy: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 100, stress_flash_crash: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 1000, trending: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 1000, mean_reverting: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 1000, choppy: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
- pop 1000, stress_flash_crash: evolving mean ROI is lower by 0.00 pp (p=1.0000), inside the noise of a single run.
