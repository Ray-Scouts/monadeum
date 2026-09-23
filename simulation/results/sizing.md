# Position size and execution frequency

Seed 42 unless a test spec says otherwise. `all-in every tick` is outside the legal `riskTolerance` ceiling. It is the preliminary model's policy, kept here so the gap can be measured. Zero-cost rows turn gas, x402, fees, slippage, and the information edge off.

| pop | regime | mode | policy | legal | roi_pct | sortino | gini | repro | fees | gas | x402 | slippage |
|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | static | risk 0.05 / every 1 | yes | -42.40 | -0.8691 | 0.087 | 0 | 0.90 | 2.29 | 42.10 | 0.45 |
| 10 | trending | static | risk 0.05 / every 1 / zero cost | yes | 3.70 | 0.6520 | 0.013 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | static | risk 0.05 / every 5 | yes | -44.67 | -0.8833 | 0.053 | 0 | 0.20 | 0.53 | 44.60 | 0.10 |
| 10 | trending | static | risk 0.05 / every 5 / zero cost | yes | 0.61 | 0.2968 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | static | risk 0.05 / every 20 | yes | -41.81 | -0.8860 | 0.083 | 0 | 0.05 | 0.13 | 41.80 | 0.03 |
| 10 | trending | static | risk 0.05 / every 20 / zero cost | yes | 0.12 | 0.1171 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | static | risk 0.1 / every 1 | yes | -38.63 | -0.8115 | 0.079 | 0 | 1.81 | 2.25 | 40.60 | 0.90 |
| 10 | trending | static | risk 0.1 / every 1 / zero cost | yes | 7.60 | 0.6546 | 0.025 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | static | risk 0.1 / every 5 | yes | -41.81 | -0.8721 | 0.083 | 0 | 0.39 | 0.50 | 42.10 | 0.20 |
| 10 | trending | static | risk 0.1 / every 5 / zero cost | yes | 1.22 | 0.2965 | 0.004 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | static | risk 0.1 / every 20 | yes | -41.99 | -0.8795 | 0.082 | 0 | 0.10 | 0.13 | 42.10 | 0.05 |
| 10 | trending | static | risk 0.1 / every 20 / zero cost | yes | 0.25 | 0.1170 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | static | risk 0.25 / every 1 | yes | -30.17 | -0.5778 | 0.065 | 0 | 4.78 | 2.23 | 39.70 | 2.39 |
| 10 | trending | static | risk 0.25 / every 1 / zero cost | yes | 20.53 | 0.6623 | 0.063 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | static | risk 0.25 / every 5 | yes | -39.66 | -0.8354 | 0.097 | 0 | 0.97 | 0.49 | 41.20 | 0.49 |
| 10 | trending | static | risk 0.25 / every 5 / zero cost | yes | 3.08 | 0.2955 | 0.009 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | static | risk 0.25 / every 20 | yes | -43.02 | -0.8749 | 0.086 | 0 | 0.26 | 0.13 | 43.50 | 0.13 |
| 10 | trending | static | risk 0.25 / every 20 / zero cost | yes | 0.62 | 0.1168 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | static | all-in every tick | no | 29.52 | 0.1774 | 0.218 | 0 | 28.58 | 2.39 | 38.10 | 14.29 |
| 10 | trending | evolving | risk 0.05 / every 1 | yes | -42.40 | -0.8691 | 0.087 | 0 | 0.90 | 2.29 | 42.10 | 0.45 |
| 10 | trending | evolving | risk 0.05 / every 1 / zero cost | yes | 3.70 | 0.6520 | 0.013 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | evolving | risk 0.05 / every 5 | yes | -44.67 | -0.8833 | 0.053 | 0 | 0.20 | 0.53 | 44.60 | 0.10 |
| 10 | trending | evolving | risk 0.05 / every 5 / zero cost | yes | 0.61 | 0.2968 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | evolving | risk 0.05 / every 20 | yes | -41.81 | -0.8860 | 0.083 | 0 | 0.05 | 0.13 | 41.80 | 0.03 |
| 10 | trending | evolving | risk 0.05 / every 20 / zero cost | yes | 0.12 | 0.1171 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | evolving | risk 0.1 / every 1 | yes | -38.63 | -0.8115 | 0.079 | 0 | 1.81 | 2.25 | 40.60 | 0.90 |
| 10 | trending | evolving | risk 0.1 / every 1 / zero cost | yes | 7.60 | 0.6546 | 0.025 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | evolving | risk 0.1 / every 5 | yes | -41.81 | -0.8721 | 0.083 | 0 | 0.39 | 0.50 | 42.10 | 0.20 |
| 10 | trending | evolving | risk 0.1 / every 5 / zero cost | yes | 1.22 | 0.2965 | 0.004 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | evolving | risk 0.1 / every 20 | yes | -41.99 | -0.8795 | 0.082 | 0 | 0.10 | 0.13 | 42.10 | 0.05 |
| 10 | trending | evolving | risk 0.1 / every 20 / zero cost | yes | 0.25 | 0.1170 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | evolving | risk 0.25 / every 1 | yes | -30.17 | -0.5778 | 0.065 | 0 | 4.78 | 2.23 | 39.70 | 2.39 |
| 10 | trending | evolving | risk 0.25 / every 1 / zero cost | yes | 20.53 | 0.6623 | 0.063 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | evolving | risk 0.25 / every 5 | yes | -39.66 | -0.8354 | 0.097 | 0 | 0.97 | 0.49 | 41.20 | 0.49 |
| 10 | trending | evolving | risk 0.25 / every 5 / zero cost | yes | 3.08 | 0.2955 | 0.009 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | evolving | risk 0.25 / every 20 | yes | -43.02 | -0.8749 | 0.086 | 0 | 0.26 | 0.13 | 43.50 | 0.13 |
| 10 | trending | evolving | risk 0.25 / every 20 / zero cost | yes | 0.62 | 0.1168 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | trending | evolving | all-in every tick | no | 20.50 | 0.1120 | 0.382 | 6 | 29.30 | 2.89 | 44.60 | 14.65 |
| 10 | mean_reverting | static | risk 0.05 / every 1 | yes | -46.33 | -0.8738 | 0.056 | 0 | 0.87 | 2.28 | 44.60 | 0.43 |
| 10 | mean_reverting | static | risk 0.05 / every 1 / zero cost | yes | 1.70 | 0.2728 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | static | risk 0.05 / every 5 | yes | -45.07 | -0.8832 | 0.053 | 0 | 0.20 | 0.52 | 44.60 | 0.10 |
| 10 | mean_reverting | static | risk 0.05 / every 5 / zero cost | yes | 0.19 | 0.0874 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | static | risk 0.05 / every 20 | yes | -43.57 | -0.8870 | 0.086 | 0 | 0.05 | 0.14 | 43.50 | 0.03 |
| 10 | mean_reverting | static | risk 0.05 / every 20 / zero cost | yes | 0.02 | 0.0330 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | static | risk 0.1 / every 1 | yes | -42.12 | -0.8278 | 0.092 | 0 | 1.68 | 2.17 | 41.20 | 0.84 |
| 10 | mean_reverting | static | risk 0.1 / every 1 / zero cost | yes | 3.50 | 0.2765 | 0.027 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | static | risk 0.1 / every 5 | yes | -45.01 | -0.8767 | 0.053 | 0 | 0.40 | 0.52 | 44.60 | 0.20 |
| 10 | mean_reverting | static | risk 0.1 / every 5 / zero cost | yes | 0.37 | 0.0878 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | static | risk 0.1 / every 20 | yes | -43.50 | -0.8846 | 0.086 | 0 | 0.11 | 0.14 | 43.50 | 0.05 |
| 10 | mean_reverting | static | risk 0.1 / every 20 / zero cost | yes | 0.04 | 0.0330 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | static | risk 0.25 / every 1 | yes | -40.08 | -0.6532 | 0.084 | 0 | 4.31 | 2.15 | 41.55 | 2.16 |
| 10 | mean_reverting | static | risk 0.25 / every 1 / zero cost | yes | 9.45 | 0.2873 | 0.068 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | static | risk 0.25 / every 5 | yes | -42.88 | -0.8546 | 0.077 | 0 | 0.97 | 0.50 | 42.65 | 0.49 |
| 10 | mean_reverting | static | risk 0.25 / every 5 / zero cost | yes | 0.95 | 0.0889 | 0.016 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | static | risk 0.25 / every 20 | yes | -40.97 | -0.8665 | 0.096 | 0 | 0.26 | 0.13 | 41.20 | 0.13 |
| 10 | mean_reverting | static | risk 0.25 / every 20 / zero cost | yes | 0.11 | 0.0330 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | static | all-in every tick | no | -15.42 | -0.0786 | 0.191 | 0 | 22.60 | 2.39 | 38.10 | 11.30 |
| 10 | mean_reverting | evolving | risk 0.05 / every 1 | yes | -46.33 | -0.8738 | 0.056 | 0 | 0.87 | 2.28 | 44.60 | 0.43 |
| 10 | mean_reverting | evolving | risk 0.05 / every 1 / zero cost | yes | 1.70 | 0.2728 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | evolving | risk 0.05 / every 5 | yes | -45.07 | -0.8832 | 0.053 | 0 | 0.20 | 0.52 | 44.60 | 0.10 |
| 10 | mean_reverting | evolving | risk 0.05 / every 5 / zero cost | yes | 0.19 | 0.0874 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | evolving | risk 0.05 / every 20 | yes | -43.57 | -0.8870 | 0.086 | 0 | 0.05 | 0.14 | 43.50 | 0.03 |
| 10 | mean_reverting | evolving | risk 0.05 / every 20 / zero cost | yes | 0.02 | 0.0330 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | evolving | risk 0.1 / every 1 | yes | -42.12 | -0.8278 | 0.092 | 0 | 1.68 | 2.17 | 41.20 | 0.84 |
| 10 | mean_reverting | evolving | risk 0.1 / every 1 / zero cost | yes | 3.50 | 0.2765 | 0.027 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | evolving | risk 0.1 / every 5 | yes | -45.01 | -0.8767 | 0.053 | 0 | 0.40 | 0.52 | 44.60 | 0.20 |
| 10 | mean_reverting | evolving | risk 0.1 / every 5 / zero cost | yes | 0.37 | 0.0878 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | evolving | risk 0.1 / every 20 | yes | -43.50 | -0.8846 | 0.086 | 0 | 0.11 | 0.14 | 43.50 | 0.05 |
| 10 | mean_reverting | evolving | risk 0.1 / every 20 / zero cost | yes | 0.04 | 0.0330 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | evolving | risk 0.25 / every 1 | yes | -40.08 | -0.6532 | 0.084 | 0 | 4.31 | 2.15 | 41.55 | 2.16 |
| 10 | mean_reverting | evolving | risk 0.25 / every 1 / zero cost | yes | 9.45 | 0.2873 | 0.068 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | evolving | risk 0.25 / every 5 | yes | -42.88 | -0.8546 | 0.077 | 0 | 0.97 | 0.50 | 42.65 | 0.49 |
| 10 | mean_reverting | evolving | risk 0.25 / every 5 / zero cost | yes | 0.95 | 0.0889 | 0.016 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | evolving | risk 0.25 / every 20 | yes | -40.97 | -0.8665 | 0.096 | 0 | 0.26 | 0.13 | 41.20 | 0.13 |
| 10 | mean_reverting | evolving | risk 0.25 / every 20 / zero cost | yes | 0.11 | 0.0330 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | mean_reverting | evolving | all-in every tick | no | -15.42 | -0.0786 | 0.191 | 0 | 22.60 | 2.39 | 38.10 | 11.30 |
| 10 | choppy | static | risk 0.05 / every 1 | yes | -45.56 | -0.8709 | 0.055 | 0 | 0.88 | 2.27 | 44.60 | 0.44 |
| 10 | choppy | static | risk 0.05 / every 1 / zero cost | yes | 2.65 | 0.4297 | 0.011 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | static | risk 0.05 / every 5 | yes | -44.85 | -0.8836 | 0.053 | 0 | 0.19 | 0.50 | 44.60 | 0.10 |
| 10 | choppy | static | risk 0.05 / every 5 / zero cost | yes | 0.58 | 0.3162 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | static | risk 0.05 / every 20 | yes | -42.17 | -0.8834 | 0.082 | 0 | 0.05 | 0.13 | 42.10 | 0.03 |
| 10 | choppy | static | risk 0.05 / every 20 / zero cost | yes | 0.06 | 0.0610 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | static | risk 0.1 / every 1 | yes | -39.99 | -0.8244 | 0.083 | 0 | 1.67 | 2.11 | 40.60 | 0.84 |
| 10 | choppy | static | risk 0.1 / every 1 / zero cost | yes | 5.41 | 0.4330 | 0.023 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | static | risk 0.1 / every 5 | yes | -44.59 | -0.8775 | 0.053 | 0 | 0.39 | 0.50 | 44.60 | 0.19 |
| 10 | choppy | static | risk 0.1 / every 5 / zero cost | yes | 1.16 | 0.3164 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | static | risk 0.1 / every 20 | yes | -42.12 | -0.8820 | 0.082 | 0 | 0.10 | 0.13 | 42.10 | 0.05 |
| 10 | choppy | static | risk 0.1 / every 20 / zero cost | yes | 0.13 | 0.0610 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | static | risk 0.25 / every 1 | yes | -33.36 | -0.6363 | 0.079 | 0 | 4.27 | 2.04 | 38.85 | 2.13 |
| 10 | choppy | static | risk 0.25 / every 1 / zero cost | yes | 14.42 | 0.4425 | 0.057 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | static | risk 0.25 / every 5 | yes | -39.21 | -0.8453 | 0.078 | 0 | 0.92 | 0.46 | 40.40 | 0.46 |
| 10 | choppy | static | risk 0.25 / every 5 / zero cost | yes | 2.93 | 0.3171 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | static | risk 0.25 / every 20 | yes | -43.41 | -0.8801 | 0.086 | 0 | 0.26 | 0.13 | 43.50 | 0.13 |
| 10 | choppy | static | risk 0.25 / every 20 / zero cost | yes | 0.32 | 0.0611 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | static | all-in every tick | no | 0.64 | 0.0129 | 0.199 | 0 | 25.12 | 2.39 | 38.10 | 12.56 |
| 10 | choppy | evolving | risk 0.05 / every 1 | yes | -45.56 | -0.8709 | 0.055 | 0 | 0.88 | 2.27 | 44.60 | 0.44 |
| 10 | choppy | evolving | risk 0.05 / every 1 / zero cost | yes | 2.65 | 0.4297 | 0.011 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | evolving | risk 0.05 / every 5 | yes | -44.85 | -0.8836 | 0.053 | 0 | 0.19 | 0.50 | 44.60 | 0.10 |
| 10 | choppy | evolving | risk 0.05 / every 5 / zero cost | yes | 0.58 | 0.3162 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | evolving | risk 0.05 / every 20 | yes | -42.17 | -0.8834 | 0.082 | 0 | 0.05 | 0.13 | 42.10 | 0.03 |
| 10 | choppy | evolving | risk 0.05 / every 20 / zero cost | yes | 0.06 | 0.0610 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | evolving | risk 0.1 / every 1 | yes | -39.99 | -0.8244 | 0.083 | 0 | 1.67 | 2.11 | 40.60 | 0.84 |
| 10 | choppy | evolving | risk 0.1 / every 1 / zero cost | yes | 5.41 | 0.4330 | 0.023 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | evolving | risk 0.1 / every 5 | yes | -44.59 | -0.8775 | 0.053 | 0 | 0.39 | 0.50 | 44.60 | 0.19 |
| 10 | choppy | evolving | risk 0.1 / every 5 / zero cost | yes | 1.16 | 0.3164 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | evolving | risk 0.1 / every 20 | yes | -42.12 | -0.8820 | 0.082 | 0 | 0.10 | 0.13 | 42.10 | 0.05 |
| 10 | choppy | evolving | risk 0.1 / every 20 / zero cost | yes | 0.13 | 0.0610 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | evolving | risk 0.25 / every 1 | yes | -33.36 | -0.6363 | 0.079 | 0 | 4.27 | 2.04 | 38.85 | 2.13 |
| 10 | choppy | evolving | risk 0.25 / every 1 / zero cost | yes | 14.42 | 0.4425 | 0.057 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | evolving | risk 0.25 / every 5 | yes | -39.21 | -0.8453 | 0.078 | 0 | 0.92 | 0.46 | 40.40 | 0.46 |
| 10 | choppy | evolving | risk 0.25 / every 5 / zero cost | yes | 2.93 | 0.3171 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | evolving | risk 0.25 / every 20 | yes | -43.41 | -0.8801 | 0.086 | 0 | 0.26 | 0.13 | 43.50 | 0.13 |
| 10 | choppy | evolving | risk 0.25 / every 20 / zero cost | yes | 0.32 | 0.0611 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | choppy | evolving | all-in every tick | no | 0.64 | 0.0129 | 0.232 | 1 | 25.12 | 2.39 | 38.10 | 12.56 |
| 10 | stress_flash_crash | static | risk 0.05 / every 1 | yes | -43.55 | -0.8733 | 0.069 | 0 | 0.80 | 2.04 | 42.30 | 0.40 |
| 10 | stress_flash_crash | static | risk 0.05 / every 1 / zero cost | yes | 2.09 | 0.1622 | 0.008 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | static | risk 0.05 / every 5 | yes | -44.77 | -0.8841 | 0.053 | 0 | 0.18 | 0.48 | 44.60 | 0.09 |
| 10 | stress_flash_crash | static | risk 0.05 / every 5 / zero cost | yes | 0.64 | 0.3883 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | static | risk 0.05 / every 20 | yes | -41.83 | -0.8874 | 0.084 | 0 | 0.05 | 0.12 | 41.80 | 0.02 |
| 10 | stress_flash_crash | static | risk 0.05 / every 20 / zero cost | yes | 0.14 | 0.1701 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | static | risk 0.1 / every 1 | yes | -40.65 | -0.7953 | 0.089 | 0 | 1.58 | 2.00 | 40.60 | 0.79 |
| 10 | stress_flash_crash | static | risk 0.1 / every 1 / zero cost | yes | 4.23 | 0.1616 | 0.016 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | static | risk 0.1 / every 5 | yes | -44.47 | -0.8787 | 0.052 | 0 | 0.37 | 0.48 | 44.60 | 0.19 |
| 10 | stress_flash_crash | static | risk 0.1 / every 5 / zero cost | yes | 1.28 | 0.3886 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | static | risk 0.1 / every 20 | yes | -41.74 | -0.8860 | 0.084 | 0 | 0.10 | 0.12 | 41.80 | 0.05 |
| 10 | stress_flash_crash | static | risk 0.1 / every 20 / zero cost | yes | 0.29 | 0.1702 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | static | risk 0.25 / every 1 | yes | -36.40 | -0.4825 | 0.088 | 0 | 3.96 | 1.94 | 38.85 | 1.98 |
| 10 | stress_flash_crash | static | risk 0.25 / every 1 / zero cost | yes | 10.98 | 0.1598 | 0.041 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | static | risk 0.25 / every 5 | yes | -40.70 | -0.8471 | 0.084 | 0 | 0.89 | 0.45 | 42.10 | 0.44 |
| 10 | stress_flash_crash | static | risk 0.25 / every 5 / zero cost | yes | 3.25 | 0.3897 | 0.015 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | static | risk 0.25 / every 20 | yes | -41.65 | -0.8758 | 0.083 | 0 | 0.24 | 0.12 | 42.10 | 0.12 |
| 10 | stress_flash_crash | static | risk 0.25 / every 20 / zero cost | yes | 0.72 | 0.1707 | 0.007 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | static | all-in every tick | no | -30.49 | -0.0715 | 0.180 | 0 | 21.47 | 2.39 | 38.10 | 10.74 |
| 10 | stress_flash_crash | evolving | risk 0.05 / every 1 | yes | -43.55 | -0.8733 | 0.069 | 0 | 0.80 | 2.04 | 42.30 | 0.40 |
| 10 | stress_flash_crash | evolving | risk 0.05 / every 1 / zero cost | yes | 2.09 | 0.1622 | 0.008 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | evolving | risk 0.05 / every 5 | yes | -44.77 | -0.8841 | 0.053 | 0 | 0.18 | 0.48 | 44.60 | 0.09 |
| 10 | stress_flash_crash | evolving | risk 0.05 / every 5 / zero cost | yes | 0.64 | 0.3883 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | evolving | risk 0.05 / every 20 | yes | -41.83 | -0.8874 | 0.084 | 0 | 0.05 | 0.12 | 41.80 | 0.02 |
| 10 | stress_flash_crash | evolving | risk 0.05 / every 20 / zero cost | yes | 0.14 | 0.1701 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | evolving | risk 0.1 / every 1 | yes | -40.65 | -0.7953 | 0.089 | 0 | 1.58 | 2.00 | 40.60 | 0.79 |
| 10 | stress_flash_crash | evolving | risk 0.1 / every 1 / zero cost | yes | 4.23 | 0.1616 | 0.016 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | evolving | risk 0.1 / every 5 | yes | -44.47 | -0.8787 | 0.052 | 0 | 0.37 | 0.48 | 44.60 | 0.19 |
| 10 | stress_flash_crash | evolving | risk 0.1 / every 5 / zero cost | yes | 1.28 | 0.3886 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | evolving | risk 0.1 / every 20 | yes | -41.74 | -0.8860 | 0.084 | 0 | 0.10 | 0.12 | 41.80 | 0.05 |
| 10 | stress_flash_crash | evolving | risk 0.1 / every 20 / zero cost | yes | 0.29 | 0.1702 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | evolving | risk 0.25 / every 1 | yes | -36.40 | -0.4825 | 0.088 | 0 | 3.96 | 1.94 | 38.85 | 1.98 |
| 10 | stress_flash_crash | evolving | risk 0.25 / every 1 / zero cost | yes | 10.98 | 0.1598 | 0.041 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | evolving | risk 0.25 / every 5 | yes | -40.70 | -0.8471 | 0.084 | 0 | 0.89 | 0.45 | 42.10 | 0.44 |
| 10 | stress_flash_crash | evolving | risk 0.25 / every 5 / zero cost | yes | 3.25 | 0.3897 | 0.015 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | evolving | risk 0.25 / every 20 | yes | -41.65 | -0.8758 | 0.083 | 0 | 0.24 | 0.12 | 42.10 | 0.12 |
| 10 | stress_flash_crash | evolving | risk 0.25 / every 20 / zero cost | yes | 0.72 | 0.1707 | 0.007 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 10 | stress_flash_crash | evolving | all-in every tick | no | -30.49 | -0.0715 | 0.180 | 0 | 21.47 | 2.39 | 38.10 | 10.74 |
| 100 | trending | static | risk 0.05 / every 1 | yes | -41.99 | -0.9519 | 0.081 | 0 | 8.94 | 22.74 | 415.90 | 4.47 |
| 100 | trending | static | risk 0.05 / every 1 / zero cost | yes | 3.47 | 0.5931 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | static | risk 0.05 / every 5 | yes | -41.87 | -0.9678 | 0.073 | 0 | 1.93 | 4.91 | 417.30 | 0.96 |
| 100 | trending | static | risk 0.05 / every 5 / zero cost | yes | 0.61 | 0.3458 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | static | risk 0.05 / every 20 | yes | -40.37 | -0.9713 | 0.083 | 0 | 0.50 | 1.26 | 403.15 | 0.25 |
| 100 | trending | static | risk 0.05 / every 20 / zero cost | yes | 0.10 | 0.1216 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | static | risk 0.1 / every 1 | yes | -39.58 | -0.8965 | 0.078 | 0 | 18.16 | 22.67 | 412.20 | 9.08 |
| 100 | trending | static | risk 0.1 / every 1 / zero cost | yes | 7.12 | 0.5964 | 0.027 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | static | risk 0.1 / every 5 | yes | -40.82 | -0.9628 | 0.077 | 0 | 3.81 | 4.82 | 410.70 | 1.91 |
| 100 | trending | static | risk 0.1 / every 5 / zero cost | yes | 1.23 | 0.3459 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | static | risk 0.1 / every 20 | yes | -40.30 | -0.9703 | 0.083 | 0 | 1.00 | 1.26 | 403.15 | 0.50 |
| 100 | trending | static | risk 0.1 / every 20 / zero cost | yes | 0.21 | 0.1216 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | static | risk 0.25 / every 1 | yes | -31.92 | -0.6036 | 0.084 | 0 | 47.76 | 22.60 | 403.15 | 23.88 |
| 100 | trending | static | risk 0.25 / every 1 / zero cost | yes | 19.22 | 0.6065 | 0.068 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | static | risk 0.25 / every 5 | yes | -39.19 | -0.9351 | 0.079 | 0 | 9.62 | 4.81 | 405.95 | 4.81 |
| 100 | trending | static | risk 0.25 / every 5 / zero cost | yes | 3.12 | 0.3462 | 0.013 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | static | risk 0.25 / every 20 | yes | -40.84 | -0.9651 | 0.080 | 0 | 2.57 | 1.29 | 410.50 | 1.28 |
| 100 | trending | static | risk 0.25 / every 20 / zero cost | yes | 0.52 | 0.1215 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | static | all-in every tick | no | 24.66 | 0.1457 | 0.247 | 0 | 286.25 | 24.70 | 383.25 | 143.13 |
| 100 | trending | evolving | risk 0.05 / every 1 | yes | -41.99 | -0.9519 | 0.081 | 0 | 8.94 | 22.74 | 415.90 | 4.47 |
| 100 | trending | evolving | risk 0.05 / every 1 / zero cost | yes | 3.47 | 0.5931 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | evolving | risk 0.05 / every 5 | yes | -41.87 | -0.9678 | 0.073 | 0 | 1.93 | 4.91 | 417.30 | 0.96 |
| 100 | trending | evolving | risk 0.05 / every 5 / zero cost | yes | 0.61 | 0.3458 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | evolving | risk 0.05 / every 20 | yes | -40.37 | -0.9713 | 0.083 | 0 | 0.50 | 1.26 | 403.15 | 0.25 |
| 100 | trending | evolving | risk 0.05 / every 20 / zero cost | yes | 0.10 | 0.1216 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | evolving | risk 0.1 / every 1 | yes | -39.58 | -0.8965 | 0.078 | 0 | 18.16 | 22.67 | 412.20 | 9.08 |
| 100 | trending | evolving | risk 0.1 / every 1 / zero cost | yes | 7.12 | 0.5964 | 0.027 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | evolving | risk 0.1 / every 5 | yes | -40.82 | -0.9628 | 0.077 | 0 | 3.81 | 4.82 | 410.70 | 1.91 |
| 100 | trending | evolving | risk 0.1 / every 5 / zero cost | yes | 1.23 | 0.3459 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | evolving | risk 0.1 / every 20 | yes | -40.30 | -0.9703 | 0.083 | 0 | 1.00 | 1.26 | 403.15 | 0.50 |
| 100 | trending | evolving | risk 0.1 / every 20 / zero cost | yes | 0.21 | 0.1216 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | evolving | risk 0.25 / every 1 | yes | -31.92 | -0.6036 | 0.084 | 0 | 47.76 | 22.60 | 403.15 | 23.88 |
| 100 | trending | evolving | risk 0.25 / every 1 / zero cost | yes | 19.22 | 0.6065 | 0.068 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | evolving | risk 0.25 / every 5 | yes | -39.19 | -0.9351 | 0.079 | 0 | 9.62 | 4.81 | 405.95 | 4.81 |
| 100 | trending | evolving | risk 0.25 / every 5 / zero cost | yes | 3.12 | 0.3462 | 0.013 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | evolving | risk 0.25 / every 20 | yes | -40.84 | -0.9651 | 0.080 | 0 | 2.57 | 1.29 | 410.50 | 1.28 |
| 100 | trending | evolving | risk 0.25 / every 20 / zero cost | yes | 0.52 | 0.1215 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | trending | evolving | all-in every tick | no | 14.20 | 0.0804 | 0.356 | 54 | 286.98 | 28.64 | 441.40 | 143.49 |
| 100 | mean_reverting | static | risk 0.05 / every 1 | yes | -43.82 | -0.9565 | 0.077 | 0 | 8.04 | 20.81 | 421.30 | 4.02 |
| 100 | mean_reverting | static | risk 0.05 / every 1 / zero cost | yes | 1.44 | 0.2320 | 0.013 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | static | risk 0.05 / every 5 | yes | -41.58 | -0.9709 | 0.078 | 0 | 1.86 | 4.76 | 411.85 | 0.93 |
| 100 | mean_reverting | static | risk 0.05 / every 5 / zero cost | yes | 0.25 | 0.1290 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | static | risk 0.05 / every 20 | yes | -40.50 | -0.9702 | 0.085 | 0 | 0.50 | 1.27 | 403.80 | 0.25 |
| 100 | mean_reverting | static | risk 0.05 / every 20 / zero cost | yes | 0.01 | 0.0166 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | static | risk 0.1 / every 1 | yes | -42.73 | -0.9136 | 0.086 | 0 | 16.00 | 20.53 | 414.90 | 8.00 |
| 100 | mean_reverting | static | risk 0.1 / every 1 / zero cost | yes | 2.94 | 0.2356 | 0.026 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | static | risk 0.1 / every 5 | yes | -41.42 | -0.9655 | 0.082 | 0 | 3.72 | 4.76 | 411.00 | 1.86 |
| 100 | mean_reverting | static | risk 0.1 / every 5 / zero cost | yes | 0.49 | 0.1293 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | static | risk 0.1 / every 20 | yes | -40.52 | -0.9695 | 0.086 | 0 | 1.01 | 1.27 | 404.05 | 0.50 |
| 100 | mean_reverting | static | risk 0.1 / every 20 / zero cost | yes | 0.03 | 0.0167 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | static | risk 0.25 / every 1 | yes | -39.24 | -0.6966 | 0.097 | 0 | 41.40 | 20.75 | 400.10 | 20.70 |
| 100 | mean_reverting | static | risk 0.25 / every 1 / zero cost | yes | 7.94 | 0.2465 | 0.065 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | static | risk 0.25 / every 5 | yes | -40.33 | -0.9346 | 0.087 | 0 | 9.21 | 4.66 | 402.75 | 4.61 |
| 100 | mean_reverting | static | risk 0.25 / every 5 / zero cost | yes | 1.25 | 0.1302 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | static | risk 0.25 / every 20 | yes | -41.27 | -0.9641 | 0.081 | 0 | 2.56 | 1.30 | 412.20 | 1.28 |
| 100 | mean_reverting | static | risk 0.25 / every 20 / zero cost | yes | 0.07 | 0.0170 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | static | all-in every tick | no | -19.39 | -0.1031 | 0.234 | 0 | 225.65 | 24.70 | 383.25 | 112.82 |
| 100 | mean_reverting | evolving | risk 0.05 / every 1 | yes | -43.82 | -0.9565 | 0.077 | 0 | 8.04 | 20.81 | 421.30 | 4.02 |
| 100 | mean_reverting | evolving | risk 0.05 / every 1 / zero cost | yes | 1.44 | 0.2320 | 0.013 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | evolving | risk 0.05 / every 5 | yes | -41.58 | -0.9709 | 0.078 | 0 | 1.86 | 4.76 | 411.85 | 0.93 |
| 100 | mean_reverting | evolving | risk 0.05 / every 5 / zero cost | yes | 0.25 | 0.1290 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | evolving | risk 0.05 / every 20 | yes | -40.50 | -0.9702 | 0.085 | 0 | 0.50 | 1.27 | 403.80 | 0.25 |
| 100 | mean_reverting | evolving | risk 0.05 / every 20 / zero cost | yes | 0.01 | 0.0166 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | evolving | risk 0.1 / every 1 | yes | -42.73 | -0.9136 | 0.086 | 0 | 16.00 | 20.53 | 414.90 | 8.00 |
| 100 | mean_reverting | evolving | risk 0.1 / every 1 / zero cost | yes | 2.94 | 0.2356 | 0.026 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | evolving | risk 0.1 / every 5 | yes | -41.42 | -0.9655 | 0.082 | 0 | 3.72 | 4.76 | 411.00 | 1.86 |
| 100 | mean_reverting | evolving | risk 0.1 / every 5 / zero cost | yes | 0.49 | 0.1293 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | evolving | risk 0.1 / every 20 | yes | -40.52 | -0.9695 | 0.086 | 0 | 1.01 | 1.27 | 404.05 | 0.50 |
| 100 | mean_reverting | evolving | risk 0.1 / every 20 / zero cost | yes | 0.03 | 0.0167 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | evolving | risk 0.25 / every 1 | yes | -39.24 | -0.6966 | 0.097 | 0 | 41.40 | 20.75 | 400.10 | 20.70 |
| 100 | mean_reverting | evolving | risk 0.25 / every 1 / zero cost | yes | 7.94 | 0.2465 | 0.065 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | evolving | risk 0.25 / every 5 | yes | -40.33 | -0.9346 | 0.087 | 0 | 9.21 | 4.66 | 402.75 | 4.61 |
| 100 | mean_reverting | evolving | risk 0.25 / every 5 / zero cost | yes | 1.25 | 0.1302 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | evolving | risk 0.25 / every 20 | yes | -41.27 | -0.9641 | 0.081 | 0 | 2.56 | 1.30 | 412.20 | 1.28 |
| 100 | mean_reverting | evolving | risk 0.25 / every 20 / zero cost | yes | 0.07 | 0.0170 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | mean_reverting | evolving | all-in every tick | no | -19.70 | -0.1054 | 0.242 | 5 | 225.58 | 24.84 | 385.00 | 112.79 |
| 100 | choppy | static | risk 0.05 / every 1 | yes | -41.98 | -0.9554 | 0.081 | 0 | 8.03 | 20.39 | 410.70 | 4.02 |
| 100 | choppy | static | risk 0.05 / every 1 / zero cost | yes | 2.44 | 0.4117 | 0.012 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | static | risk 0.05 / every 5 | yes | -41.22 | -0.9698 | 0.081 | 0 | 1.79 | 4.55 | 410.30 | 0.90 |
| 100 | choppy | static | risk 0.05 / every 5 / zero cost | yes | 0.41 | 0.2474 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | static | risk 0.05 / every 20 | yes | -40.53 | -0.9721 | 0.082 | 0 | 0.49 | 1.24 | 404.45 | 0.25 |
| 100 | choppy | static | risk 0.05 / every 20 / zero cost | yes | 0.05 | 0.0638 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | static | risk 0.1 / every 1 | yes | -40.43 | -0.9102 | 0.086 | 0 | 16.36 | 20.58 | 407.70 | 8.18 |
| 100 | choppy | static | risk 0.1 / every 1 / zero cost | yes | 4.98 | 0.4146 | 0.024 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | static | risk 0.1 / every 5 | yes | -42.20 | -0.9677 | 0.070 | 0 | 3.68 | 4.67 | 422.40 | 1.84 |
| 100 | choppy | static | risk 0.1 / every 5 / zero cost | yes | 0.83 | 0.2477 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | static | risk 0.1 / every 20 | yes | -40.87 | -0.9710 | 0.083 | 0 | 0.99 | 1.24 | 408.30 | 0.49 |
| 100 | choppy | static | risk 0.1 / every 20 / zero cost | yes | 0.10 | 0.0637 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | static | risk 0.25 / every 1 | yes | -35.97 | -0.6770 | 0.086 | 0 | 43.22 | 20.91 | 405.70 | 21.61 |
| 100 | choppy | static | risk 0.25 / every 1 / zero cost | yes | 13.27 | 0.4235 | 0.060 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | static | risk 0.25 / every 5 | yes | -40.55 | -0.9411 | 0.074 | 0 | 9.11 | 4.58 | 413.90 | 4.56 |
| 100 | choppy | static | risk 0.25 / every 5 / zero cost | yes | 2.10 | 0.2486 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | static | risk 0.25 / every 20 | yes | -40.66 | -0.9667 | 0.083 | 0 | 2.46 | 1.24 | 407.50 | 1.23 |
| 100 | choppy | static | risk 0.25 / every 20 / zero cost | yes | 0.24 | 0.0636 | 0.004 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | static | all-in every tick | no | -3.53 | -0.0139 | 0.231 | 0 | 250.99 | 24.66 | 382.75 | 125.50 |
| 100 | choppy | evolving | risk 0.05 / every 1 | yes | -41.98 | -0.9554 | 0.081 | 0 | 8.03 | 20.39 | 410.70 | 4.02 |
| 100 | choppy | evolving | risk 0.05 / every 1 / zero cost | yes | 2.44 | 0.4117 | 0.012 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | evolving | risk 0.05 / every 5 | yes | -41.22 | -0.9698 | 0.081 | 0 | 1.79 | 4.55 | 410.30 | 0.90 |
| 100 | choppy | evolving | risk 0.05 / every 5 / zero cost | yes | 0.41 | 0.2474 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | evolving | risk 0.05 / every 20 | yes | -40.53 | -0.9721 | 0.082 | 0 | 0.49 | 1.24 | 404.45 | 0.25 |
| 100 | choppy | evolving | risk 0.05 / every 20 / zero cost | yes | 0.05 | 0.0638 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | evolving | risk 0.1 / every 1 | yes | -40.43 | -0.9102 | 0.086 | 0 | 16.36 | 20.58 | 407.70 | 8.18 |
| 100 | choppy | evolving | risk 0.1 / every 1 / zero cost | yes | 4.98 | 0.4146 | 0.024 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | evolving | risk 0.1 / every 5 | yes | -42.20 | -0.9677 | 0.070 | 0 | 3.68 | 4.67 | 422.40 | 1.84 |
| 100 | choppy | evolving | risk 0.1 / every 5 / zero cost | yes | 0.83 | 0.2477 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | evolving | risk 0.1 / every 20 | yes | -40.87 | -0.9710 | 0.083 | 0 | 0.99 | 1.24 | 408.30 | 0.49 |
| 100 | choppy | evolving | risk 0.1 / every 20 / zero cost | yes | 0.10 | 0.0637 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | evolving | risk 0.25 / every 1 | yes | -35.97 | -0.6770 | 0.086 | 0 | 43.22 | 20.91 | 405.70 | 21.61 |
| 100 | choppy | evolving | risk 0.25 / every 1 / zero cost | yes | 13.27 | 0.4235 | 0.060 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | evolving | risk 0.25 / every 5 | yes | -40.55 | -0.9411 | 0.074 | 0 | 9.11 | 4.58 | 413.90 | 4.56 |
| 100 | choppy | evolving | risk 0.25 / every 5 / zero cost | yes | 2.10 | 0.2486 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | evolving | risk 0.25 / every 20 | yes | -40.66 | -0.9667 | 0.083 | 0 | 2.46 | 1.24 | 407.50 | 1.23 |
| 100 | choppy | evolving | risk 0.25 / every 20 / zero cost | yes | 0.24 | 0.0636 | 0.004 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | choppy | evolving | all-in every tick | no | -5.31 | -0.0257 | 0.273 | 20 | 250.42 | 25.30 | 391.95 | 125.21 |
| 100 | stress_flash_crash | static | risk 0.05 / every 1 | yes | -42.21 | -0.9459 | 0.084 | 0 | 7.65 | 19.46 | 410.50 | 3.83 |
| 100 | stress_flash_crash | static | risk 0.05 / every 1 / zero cost | yes | 1.95 | 0.2004 | 0.009 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | static | risk 0.05 / every 5 | yes | -41.20 | -0.9697 | 0.081 | 0 | 1.70 | 4.31 | 410.30 | 0.85 |
| 100 | stress_flash_crash | static | risk 0.05 / every 5 / zero cost | yes | 0.45 | 0.3045 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | static | risk 0.05 / every 20 | yes | -40.91 | -0.9716 | 0.085 | 0 | 0.48 | 1.21 | 408.50 | 0.24 |
| 100 | stress_flash_crash | static | risk 0.05 / every 20 / zero cost | yes | 0.10 | 0.1457 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | static | risk 0.1 / every 1 | yes | -41.17 | -0.8722 | 0.089 | 0 | 15.54 | 19.64 | 408.30 | 7.77 |
| 100 | stress_flash_crash | static | risk 0.1 / every 1 / zero cost | yes | 3.96 | 0.1996 | 0.018 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | static | risk 0.1 / every 5 | yes | -42.03 | -0.9658 | 0.069 | 0 | 3.49 | 4.42 | 420.70 | 1.74 |
| 100 | stress_flash_crash | static | risk 0.1 / every 5 / zero cost | yes | 0.91 | 0.3050 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | static | risk 0.1 / every 20 | yes | -40.94 | -0.9713 | 0.084 | 0 | 0.96 | 1.21 | 409.50 | 0.48 |
| 100 | stress_flash_crash | static | risk 0.1 / every 20 / zero cost | yes | 0.20 | 0.1459 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | static | risk 0.25 / every 1 | yes | -37.97 | -0.5612 | 0.081 | 0 | 40.19 | 19.70 | 402.75 | 20.09 |
| 100 | stress_flash_crash | static | risk 0.25 / every 1 / zero cost | yes | 10.30 | 0.1974 | 0.044 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | static | risk 0.25 / every 5 | yes | -40.88 | -0.9374 | 0.079 | 0 | 8.67 | 4.36 | 415.90 | 4.34 |
| 100 | stress_flash_crash | static | risk 0.25 / every 5 / zero cost | yes | 2.29 | 0.3064 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | static | risk 0.25 / every 20 | yes | -40.73 | -0.9675 | 0.085 | 0 | 2.41 | 1.21 | 409.00 | 1.20 |
| 100 | stress_flash_crash | static | risk 0.25 / every 20 / zero cost | yes | 0.49 | 0.1463 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | static | all-in every tick | no | -33.97 | -0.0816 | 0.244 | 0 | 214.01 | 24.64 | 382.30 | 107.01 |
| 100 | stress_flash_crash | evolving | risk 0.05 / every 1 | yes | -42.21 | -0.9459 | 0.084 | 0 | 7.65 | 19.46 | 410.50 | 3.83 |
| 100 | stress_flash_crash | evolving | risk 0.05 / every 1 / zero cost | yes | 1.95 | 0.2004 | 0.009 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | evolving | risk 0.05 / every 5 | yes | -41.20 | -0.9697 | 0.081 | 0 | 1.70 | 4.31 | 410.30 | 0.85 |
| 100 | stress_flash_crash | evolving | risk 0.05 / every 5 / zero cost | yes | 0.45 | 0.3045 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | evolving | risk 0.05 / every 20 | yes | -40.91 | -0.9716 | 0.085 | 0 | 0.48 | 1.21 | 408.50 | 0.24 |
| 100 | stress_flash_crash | evolving | risk 0.05 / every 20 / zero cost | yes | 0.10 | 0.1457 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | evolving | risk 0.1 / every 1 | yes | -41.17 | -0.8722 | 0.089 | 0 | 15.54 | 19.64 | 408.30 | 7.77 |
| 100 | stress_flash_crash | evolving | risk 0.1 / every 1 / zero cost | yes | 3.96 | 0.1996 | 0.018 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | evolving | risk 0.1 / every 5 | yes | -42.03 | -0.9658 | 0.069 | 0 | 3.49 | 4.42 | 420.70 | 1.74 |
| 100 | stress_flash_crash | evolving | risk 0.1 / every 5 / zero cost | yes | 0.91 | 0.3050 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | evolving | risk 0.1 / every 20 | yes | -40.94 | -0.9713 | 0.084 | 0 | 0.96 | 1.21 | 409.50 | 0.48 |
| 100 | stress_flash_crash | evolving | risk 0.1 / every 20 / zero cost | yes | 0.20 | 0.1459 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | evolving | risk 0.25 / every 1 | yes | -37.97 | -0.5612 | 0.081 | 0 | 40.19 | 19.70 | 402.75 | 20.09 |
| 100 | stress_flash_crash | evolving | risk 0.25 / every 1 / zero cost | yes | 10.30 | 0.1974 | 0.044 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | evolving | risk 0.25 / every 5 | yes | -40.88 | -0.9374 | 0.079 | 0 | 8.67 | 4.36 | 415.90 | 4.34 |
| 100 | stress_flash_crash | evolving | risk 0.25 / every 5 / zero cost | yes | 2.29 | 0.3064 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | evolving | risk 0.25 / every 20 | yes | -40.73 | -0.9675 | 0.085 | 0 | 2.41 | 1.21 | 409.00 | 1.20 |
| 100 | stress_flash_crash | evolving | risk 0.25 / every 20 / zero cost | yes | 0.49 | 0.1463 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 100 | stress_flash_crash | evolving | all-in every tick | no | -34.39 | -0.0832 | 0.251 | 1 | 214.23 | 24.84 | 385.30 | 107.11 |
| 1000 | trending | static | risk 0.05 / every 1 | yes | -41.06 | -0.9662 | 0.076 | 0 | 87.40 | 220.79 | 4057.95 | 43.70 |
| 1000 | trending | static | risk 0.05 / every 1 / zero cost | yes | 3.28 | 0.5638 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | static | risk 0.05 / every 5 | yes | -40.96 | -0.9835 | 0.073 | 0 | 19.04 | 48.20 | 4080.90 | 9.52 |
| 1000 | trending | static | risk 0.05 / every 5 / zero cost | yes | 0.57 | 0.3198 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | static | risk 0.05 / every 20 | yes | -40.95 | -0.9852 | 0.071 | 0 | 5.16 | 12.99 | 4090.10 | 2.58 |
| 1000 | trending | static | risk 0.05 / every 20 / zero cost | yes | 0.09 | 0.1028 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | static | risk 0.1 / every 1 | yes | -39.07 | -0.9113 | 0.076 | 0 | 178.65 | 222.19 | 4045.05 | 89.32 |
| 1000 | trending | static | risk 0.1 / every 1 / zero cost | yes | 6.72 | 0.5674 | 0.028 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | static | risk 0.1 / every 5 | yes | -40.35 | -0.9792 | 0.075 | 0 | 38.07 | 47.97 | 4052.35 | 19.03 |
| 1000 | trending | static | risk 0.1 / every 5 / zero cost | yes | 1.13 | 0.3200 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | static | risk 0.1 / every 20 | yes | -40.78 | -0.9845 | 0.072 | 0 | 10.30 | 12.94 | 4082.00 | 5.15 |
| 1000 | trending | static | risk 0.1 / every 20 / zero cost | yes | 0.17 | 0.1028 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | static | risk 0.25 / every 1 | yes | -31.98 | -0.6201 | 0.084 | 0 | 468.96 | 221.41 | 3968.35 | 234.48 |
| 1000 | trending | static | risk 0.25 / every 1 / zero cost | yes | 18.12 | 0.5783 | 0.069 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | static | risk 0.25 / every 5 | yes | -39.24 | -0.9478 | 0.074 | 0 | 96.38 | 48.14 | 4050.05 | 48.19 |
| 1000 | trending | static | risk 0.25 / every 5 / zero cost | yes | 2.87 | 0.3205 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | static | risk 0.25 / every 20 | yes | -40.71 | -0.9787 | 0.071 | 0 | 25.91 | 13.01 | 4098.05 | 12.96 |
| 1000 | trending | static | risk 0.25 / every 20 / zero cost | yes | 0.43 | 0.1027 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | static | all-in every tick | no | 20.39 | 0.1226 | 0.260 | 0 | 2817.30 | 247.80 | 3756.00 | 1408.65 |
| 1000 | trending | evolving | risk 0.05 / every 1 | yes | -41.06 | -0.9662 | 0.076 | 0 | 87.40 | 220.79 | 4057.95 | 43.70 |
| 1000 | trending | evolving | risk 0.05 / every 1 / zero cost | yes | 3.28 | 0.5638 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | evolving | risk 0.05 / every 5 | yes | -40.96 | -0.9835 | 0.073 | 0 | 19.04 | 48.20 | 4080.90 | 9.52 |
| 1000 | trending | evolving | risk 0.05 / every 5 / zero cost | yes | 0.57 | 0.3198 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | evolving | risk 0.05 / every 20 | yes | -40.95 | -0.9852 | 0.071 | 0 | 5.16 | 12.99 | 4090.10 | 2.58 |
| 1000 | trending | evolving | risk 0.05 / every 20 / zero cost | yes | 0.09 | 0.1028 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | evolving | risk 0.1 / every 1 | yes | -39.07 | -0.9113 | 0.076 | 0 | 178.65 | 222.19 | 4045.05 | 89.32 |
| 1000 | trending | evolving | risk 0.1 / every 1 / zero cost | yes | 6.72 | 0.5674 | 0.028 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | evolving | risk 0.1 / every 5 | yes | -40.35 | -0.9792 | 0.075 | 0 | 38.07 | 47.97 | 4052.35 | 19.03 |
| 1000 | trending | evolving | risk 0.1 / every 5 / zero cost | yes | 1.13 | 0.3200 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | evolving | risk 0.1 / every 20 | yes | -40.78 | -0.9845 | 0.072 | 0 | 10.30 | 12.94 | 4082.00 | 5.15 |
| 1000 | trending | evolving | risk 0.1 / every 20 / zero cost | yes | 0.17 | 0.1028 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | evolving | risk 0.25 / every 1 | yes | -31.98 | -0.6201 | 0.084 | 0 | 468.96 | 221.41 | 3968.35 | 234.48 |
| 1000 | trending | evolving | risk 0.25 / every 1 / zero cost | yes | 18.12 | 0.5783 | 0.069 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | evolving | risk 0.25 / every 5 | yes | -39.24 | -0.9478 | 0.074 | 0 | 96.38 | 48.14 | 4050.05 | 48.19 |
| 1000 | trending | evolving | risk 0.25 / every 5 / zero cost | yes | 2.87 | 0.3205 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | evolving | risk 0.25 / every 20 | yes | -40.71 | -0.9787 | 0.071 | 0 | 25.91 | 13.01 | 4098.05 | 12.96 |
| 1000 | trending | evolving | risk 0.25 / every 20 / zero cost | yes | 0.43 | 0.1027 | 0.005 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | trending | evolving | all-in every tick | no | 10.52 | 0.0610 | 0.353 | 508 | 2822.23 | 285.17 | 4265.95 | 1411.11 |
| 1000 | mean_reverting | static | risk 0.05 / every 1 | yes | -42.47 | -0.9680 | 0.080 | 0 | 76.26 | 196.00 | 4078.90 | 38.13 |
| 1000 | mean_reverting | static | risk 0.05 / every 1 / zero cost | yes | 1.30 | 0.2202 | 0.013 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | static | risk 0.05 / every 5 | yes | -41.00 | -0.9836 | 0.077 | 0 | 18.17 | 46.19 | 4058.40 | 9.08 |
| 1000 | mean_reverting | static | risk 0.05 / every 5 / zero cost | yes | 0.21 | 0.1133 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | static | risk 0.05 / every 20 | yes | -41.06 | -0.9852 | 0.073 | 0 | 5.14 | 12.97 | 4093.40 | 2.57 |
| 1000 | mean_reverting | static | risk 0.05 / every 20 / zero cost | yes | 0.00 | 0.0061 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | static | risk 0.1 / every 1 | yes | -41.58 | -0.9247 | 0.084 | 0 | 154.16 | 196.75 | 4033.40 | 77.08 |
| 1000 | mean_reverting | static | risk 0.1 / every 1 / zero cost | yes | 2.68 | 0.2240 | 0.025 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | static | risk 0.1 / every 5 | yes | -41.19 | -0.9792 | 0.075 | 0 | 36.60 | 46.52 | 4081.45 | 18.30 |
| 1000 | mean_reverting | static | risk 0.1 / every 5 / zero cost | yes | 0.41 | 0.1136 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | static | risk 0.1 / every 20 | yes | -41.11 | -0.9842 | 0.071 | 0 | 10.30 | 13.00 | 4097.80 | 5.15 |
| 1000 | mean_reverting | static | risk 0.1 / every 20 / zero cost | yes | 0.01 | 0.0062 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | static | risk 0.25 / every 1 | yes | -39.19 | -0.7180 | 0.103 | 0 | 393.79 | 196.81 | 3952.75 | 196.90 |
| 1000 | mean_reverting | static | risk 0.25 / every 1 / zero cost | yes | 7.24 | 0.2353 | 0.064 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | static | risk 0.25 / every 5 | yes | -40.51 | -0.9501 | 0.081 | 0 | 91.25 | 46.15 | 4033.40 | 45.63 |
| 1000 | mean_reverting | static | risk 0.25 / every 5 / zero cost | yes | 1.05 | 0.1147 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | static | risk 0.25 / every 20 | yes | -40.78 | -0.9783 | 0.074 | 0 | 25.62 | 12.91 | 4069.30 | 12.81 |
| 1000 | mean_reverting | static | risk 0.25 / every 20 / zero cost | yes | 0.02 | 0.0065 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | static | all-in every tick | no | -22.48 | -0.1209 | 0.251 | 0 | 2228.25 | 248.60 | 3769.25 | 1114.13 |
| 1000 | mean_reverting | evolving | risk 0.05 / every 1 | yes | -42.47 | -0.9680 | 0.080 | 0 | 76.26 | 196.00 | 4078.90 | 38.13 |
| 1000 | mean_reverting | evolving | risk 0.05 / every 1 / zero cost | yes | 1.30 | 0.2202 | 0.013 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | evolving | risk 0.05 / every 5 | yes | -41.00 | -0.9836 | 0.077 | 0 | 18.17 | 46.19 | 4058.40 | 9.08 |
| 1000 | mean_reverting | evolving | risk 0.05 / every 5 / zero cost | yes | 0.21 | 0.1133 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | evolving | risk 0.05 / every 20 | yes | -41.06 | -0.9852 | 0.073 | 0 | 5.14 | 12.97 | 4093.40 | 2.57 |
| 1000 | mean_reverting | evolving | risk 0.05 / every 20 / zero cost | yes | 0.00 | 0.0061 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | evolving | risk 0.1 / every 1 | yes | -41.58 | -0.9247 | 0.084 | 0 | 154.16 | 196.75 | 4033.40 | 77.08 |
| 1000 | mean_reverting | evolving | risk 0.1 / every 1 / zero cost | yes | 2.68 | 0.2240 | 0.025 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | evolving | risk 0.1 / every 5 | yes | -41.19 | -0.9792 | 0.075 | 0 | 36.60 | 46.52 | 4081.45 | 18.30 |
| 1000 | mean_reverting | evolving | risk 0.1 / every 5 / zero cost | yes | 0.41 | 0.1136 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | evolving | risk 0.1 / every 20 | yes | -41.11 | -0.9842 | 0.071 | 0 | 10.30 | 13.00 | 4097.80 | 5.15 |
| 1000 | mean_reverting | evolving | risk 0.1 / every 20 / zero cost | yes | 0.01 | 0.0062 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | evolving | risk 0.25 / every 1 | yes | -39.19 | -0.7180 | 0.103 | 0 | 393.79 | 196.81 | 3952.75 | 196.90 |
| 1000 | mean_reverting | evolving | risk 0.25 / every 1 / zero cost | yes | 7.24 | 0.2353 | 0.064 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | evolving | risk 0.25 / every 5 | yes | -40.51 | -0.9501 | 0.081 | 0 | 91.25 | 46.15 | 4033.40 | 45.63 |
| 1000 | mean_reverting | evolving | risk 0.25 / every 5 / zero cost | yes | 1.05 | 0.1147 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | evolving | risk 0.25 / every 20 | yes | -40.78 | -0.9783 | 0.074 | 0 | 25.62 | 12.91 | 4069.30 | 12.81 |
| 1000 | mean_reverting | evolving | risk 0.25 / every 20 / zero cost | yes | 0.02 | 0.0065 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | mean_reverting | evolving | all-in every tick | no | -22.84 | -0.1235 | 0.257 | 64 | 2227.37 | 250.22 | 3790.75 | 1113.68 |
| 1000 | choppy | static | risk 0.05 / every 1 | yes | -41.51 | -0.9698 | 0.078 | 0 | 79.20 | 200.35 | 4053.20 | 39.60 |
| 1000 | choppy | static | risk 0.05 / every 1 / zero cost | yes | 2.27 | 0.3877 | 0.012 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | static | risk 0.05 / every 5 | yes | -40.84 | -0.9841 | 0.073 | 0 | 17.75 | 44.77 | 4059.05 | 8.87 |
| 1000 | choppy | static | risk 0.05 / every 5 / zero cost | yes | 0.38 | 0.2303 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | static | risk 0.05 / every 20 | yes | -40.78 | -0.9854 | 0.072 | 0 | 4.96 | 12.46 | 4069.85 | 2.48 |
| 1000 | choppy | static | risk 0.05 / every 20 / zero cost | yes | 0.05 | 0.0682 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | static | risk 0.1 / every 1 | yes | -40.44 | -0.9242 | 0.077 | 0 | 162.05 | 203.09 | 4058.40 | 81.03 |
| 1000 | choppy | static | risk 0.1 / every 1 / zero cost | yes | 4.63 | 0.3909 | 0.024 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | static | risk 0.1 / every 5 | yes | -40.67 | -0.9806 | 0.075 | 0 | 35.74 | 45.06 | 4061.55 | 17.87 |
| 1000 | choppy | static | risk 0.1 / every 5 / zero cost | yes | 0.75 | 0.2307 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | static | risk 0.1 / every 20 | yes | -40.60 | -0.9850 | 0.073 | 0 | 9.90 | 12.43 | 4055.85 | 4.95 |
| 1000 | choppy | static | risk 0.1 / every 20 / zero cost | yes | 0.10 | 0.0682 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | static | risk 0.25 / every 1 | yes | -36.09 | -0.6903 | 0.086 | 0 | 421.47 | 203.77 | 4004.20 | 210.74 |
| 1000 | choppy | static | risk 0.25 / every 1 / zero cost | yes | 12.35 | 0.4005 | 0.062 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | static | risk 0.25 / every 5 | yes | -40.02 | -0.9574 | 0.074 | 0 | 90.18 | 45.17 | 4058.50 | 45.09 |
| 1000 | choppy | static | risk 0.25 / every 5 / zero cost | yes | 1.91 | 0.2320 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | static | risk 0.25 / every 20 | yes | -40.73 | -0.9819 | 0.073 | 0 | 24.88 | 12.50 | 4083.40 | 12.44 |
| 1000 | choppy | static | risk 0.25 / every 20 / zero cost | yes | 0.25 | 0.0681 | 0.004 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | static | all-in every tick | no | -7.10 | -0.0344 | 0.250 | 0 | 2479.02 | 248.28 | 3764.45 | 1239.51 |
| 1000 | choppy | evolving | risk 0.05 / every 1 | yes | -41.51 | -0.9698 | 0.078 | 0 | 79.20 | 200.35 | 4053.20 | 39.60 |
| 1000 | choppy | evolving | risk 0.05 / every 1 / zero cost | yes | 2.27 | 0.3877 | 0.012 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | evolving | risk 0.05 / every 5 | yes | -40.84 | -0.9841 | 0.073 | 0 | 17.75 | 44.77 | 4059.05 | 8.87 |
| 1000 | choppy | evolving | risk 0.05 / every 5 / zero cost | yes | 0.38 | 0.2303 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | evolving | risk 0.05 / every 20 | yes | -40.78 | -0.9854 | 0.072 | 0 | 4.96 | 12.46 | 4069.85 | 2.48 |
| 1000 | choppy | evolving | risk 0.05 / every 20 / zero cost | yes | 0.05 | 0.0682 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | evolving | risk 0.1 / every 1 | yes | -40.44 | -0.9242 | 0.077 | 0 | 162.05 | 203.09 | 4058.40 | 81.03 |
| 1000 | choppy | evolving | risk 0.1 / every 1 / zero cost | yes | 4.63 | 0.3909 | 0.024 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | evolving | risk 0.1 / every 5 | yes | -40.67 | -0.9806 | 0.075 | 0 | 35.74 | 45.06 | 4061.55 | 17.87 |
| 1000 | choppy | evolving | risk 0.1 / every 5 / zero cost | yes | 0.75 | 0.2307 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | evolving | risk 0.1 / every 20 | yes | -40.60 | -0.9850 | 0.073 | 0 | 9.90 | 12.43 | 4055.85 | 4.95 |
| 1000 | choppy | evolving | risk 0.1 / every 20 / zero cost | yes | 0.10 | 0.0682 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | evolving | risk 0.25 / every 1 | yes | -36.09 | -0.6903 | 0.086 | 0 | 421.47 | 203.77 | 4004.20 | 210.74 |
| 1000 | choppy | evolving | risk 0.25 / every 1 / zero cost | yes | 12.35 | 0.4005 | 0.062 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | evolving | risk 0.25 / every 5 | yes | -40.02 | -0.9574 | 0.074 | 0 | 90.18 | 45.17 | 4058.50 | 45.09 |
| 1000 | choppy | evolving | risk 0.25 / every 5 / zero cost | yes | 1.91 | 0.2320 | 0.014 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | evolving | risk 0.25 / every 20 | yes | -40.73 | -0.9819 | 0.073 | 0 | 24.88 | 12.50 | 4083.40 | 12.44 |
| 1000 | choppy | evolving | risk 0.25 / every 20 / zero cost | yes | 0.25 | 0.0681 | 0.004 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | choppy | evolving | all-in every tick | no | -9.38 | -0.0501 | 0.285 | 199 | 2478.20 | 257.30 | 3893.25 | 1239.10 |
| 1000 | stress_flash_crash | static | risk 0.05 / every 1 | yes | -41.83 | -0.9593 | 0.078 | 0 | 75.73 | 191.80 | 4061.40 | 37.86 |
| 1000 | stress_flash_crash | static | risk 0.05 / every 1 / zero cost | yes | 1.87 | 0.2093 | 0.009 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | static | risk 0.05 / every 5 | yes | -40.77 | -0.9841 | 0.074 | 0 | 16.88 | 42.49 | 4051.90 | 8.44 |
| 1000 | stress_flash_crash | static | risk 0.05 / every 5 / zero cost | yes | 0.41 | 0.2711 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | static | risk 0.05 / every 20 | yes | -40.79 | -0.9854 | 0.073 | 0 | 4.80 | 12.08 | 4071.25 | 2.40 |
| 1000 | stress_flash_crash | static | risk 0.05 / every 20 / zero cost | yes | 0.09 | 0.1390 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | static | risk 0.1 / every 1 | yes | -41.06 | -0.8855 | 0.081 | 0 | 154.14 | 194.02 | 4059.60 | 77.07 |
| 1000 | stress_flash_crash | static | risk 0.1 / every 1 / zero cost | yes | 3.78 | 0.2086 | 0.019 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | static | risk 0.1 / every 5 | yes | -40.66 | -0.9805 | 0.075 | 0 | 33.99 | 42.77 | 4060.85 | 16.99 |
| 1000 | stress_flash_crash | static | risk 0.1 / every 5 / zero cost | yes | 0.81 | 0.2717 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | static | risk 0.1 / every 20 | yes | -40.64 | -0.9849 | 0.074 | 0 | 9.60 | 12.05 | 4062.20 | 4.80 |
| 1000 | stress_flash_crash | static | risk 0.1 / every 20 / zero cost | yes | 0.19 | 0.1392 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | static | risk 0.25 / every 1 | yes | -38.03 | -0.5891 | 0.083 | 0 | 396.10 | 194.21 | 4004.55 | 198.05 |
| 1000 | stress_flash_crash | static | risk 0.25 / every 1 / zero cost | yes | 9.87 | 0.2066 | 0.047 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | static | risk 0.25 / every 5 | yes | -39.98 | -0.9574 | 0.074 | 0 | 85.88 | 42.96 | 4056.45 | 42.94 |
| 1000 | stress_flash_crash | static | risk 0.25 / every 5 / zero cost | yes | 2.06 | 0.2736 | 0.015 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | static | risk 0.25 / every 20 | yes | -40.56 | -0.9804 | 0.073 | 0 | 24.06 | 12.08 | 4070.95 | 12.03 |
| 1000 | stress_flash_crash | static | risk 0.25 / every 20 / zero cost | yes | 0.47 | 0.1397 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | static | all-in every tick | no | -36.73 | -0.0888 | 0.265 | 0 | 2121.71 | 248.82 | 3772.60 | 1060.86 |
| 1000 | stress_flash_crash | evolving | risk 0.05 / every 1 | yes | -41.83 | -0.9593 | 0.078 | 0 | 75.73 | 191.80 | 4061.40 | 37.86 |
| 1000 | stress_flash_crash | evolving | risk 0.05 / every 1 / zero cost | yes | 1.87 | 0.2093 | 0.009 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | evolving | risk 0.05 / every 5 | yes | -40.77 | -0.9841 | 0.074 | 0 | 16.88 | 42.49 | 4051.90 | 8.44 |
| 1000 | stress_flash_crash | evolving | risk 0.05 / every 5 / zero cost | yes | 0.41 | 0.2711 | 0.003 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | evolving | risk 0.05 / every 20 | yes | -40.79 | -0.9854 | 0.073 | 0 | 4.80 | 12.08 | 4071.25 | 2.40 |
| 1000 | stress_flash_crash | evolving | risk 0.05 / every 20 / zero cost | yes | 0.09 | 0.1390 | 0.001 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | evolving | risk 0.1 / every 1 | yes | -41.06 | -0.8855 | 0.081 | 0 | 154.14 | 194.02 | 4059.60 | 77.07 |
| 1000 | stress_flash_crash | evolving | risk 0.1 / every 1 / zero cost | yes | 3.78 | 0.2086 | 0.019 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | evolving | risk 0.1 / every 5 | yes | -40.66 | -0.9805 | 0.075 | 0 | 33.99 | 42.77 | 4060.85 | 16.99 |
| 1000 | stress_flash_crash | evolving | risk 0.1 / every 5 / zero cost | yes | 0.81 | 0.2717 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | evolving | risk 0.1 / every 20 | yes | -40.64 | -0.9849 | 0.074 | 0 | 9.60 | 12.05 | 4062.20 | 4.80 |
| 1000 | stress_flash_crash | evolving | risk 0.1 / every 20 / zero cost | yes | 0.19 | 0.1392 | 0.002 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | evolving | risk 0.25 / every 1 | yes | -38.03 | -0.5891 | 0.083 | 0 | 396.10 | 194.21 | 4004.55 | 198.05 |
| 1000 | stress_flash_crash | evolving | risk 0.25 / every 1 / zero cost | yes | 9.87 | 0.2066 | 0.047 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | evolving | risk 0.25 / every 5 | yes | -39.98 | -0.9574 | 0.074 | 0 | 85.88 | 42.96 | 4056.45 | 42.94 |
| 1000 | stress_flash_crash | evolving | risk 0.25 / every 5 / zero cost | yes | 2.06 | 0.2736 | 0.015 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | evolving | risk 0.25 / every 20 | yes | -40.56 | -0.9804 | 0.073 | 0 | 24.06 | 12.08 | 4070.95 | 12.03 |
| 1000 | stress_flash_crash | evolving | risk 0.25 / every 20 / zero cost | yes | 0.47 | 0.1397 | 0.006 | 0 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1000 | stress_flash_crash | evolving | all-in every tick | no | -37.53 | -0.0918 | 0.276 | 21 | 2121.58 | 252.22 | 3821.60 | 1060.79 |

## Attribution

For each population and regime, sizing-and-frequency is the static legal ROI minus the static all-in ROI, in percentage points. A positive number means the legal policy lost less than all-in. Other costs are the static zero-cost ROI of that same legal policy minus its with-cost ROI. The legal policy in the comparison is the one with the best static ROI.

- pop 10, trending: all-in ROI 29.52%, best legal (risk 0.25 / every 1) ROI -30.17%, sizing-and-frequency -59.68 pp, other costs 50.70 pp (zero-cost ROI 20.53%).
- pop 10, mean_reverting: all-in ROI -15.42%, best legal (risk 0.25 / every 1) ROI -40.08%, sizing-and-frequency -24.66 pp, other costs 49.54 pp (zero-cost ROI 9.45%).
- pop 10, choppy: all-in ROI 0.64%, best legal (risk 0.25 / every 1) ROI -33.36%, sizing-and-frequency -34.00 pp, other costs 47.77 pp (zero-cost ROI 14.42%).
- pop 10, stress_flash_crash: all-in ROI -30.49%, best legal (risk 0.25 / every 1) ROI -36.40%, sizing-and-frequency -5.90 pp, other costs 47.38 pp (zero-cost ROI 10.98%).
- pop 100, trending: all-in ROI 24.66%, best legal (risk 0.25 / every 1) ROI -31.92%, sizing-and-frequency -56.58 pp, other costs 51.13 pp (zero-cost ROI 19.22%).
- pop 100, mean_reverting: all-in ROI -19.39%, best legal (risk 0.25 / every 1) ROI -39.24%, sizing-and-frequency -19.86 pp, other costs 47.18 pp (zero-cost ROI 7.94%).
- pop 100, choppy: all-in ROI -3.53%, best legal (risk 0.25 / every 1) ROI -35.97%, sizing-and-frequency -32.44 pp, other costs 49.23 pp (zero-cost ROI 13.27%).
- pop 100, stress_flash_crash: all-in ROI -33.97%, best legal (risk 0.25 / every 1) ROI -37.97%, sizing-and-frequency -3.99 pp, other costs 48.26 pp (zero-cost ROI 10.30%).
- pop 1000, trending: all-in ROI 20.39%, best legal (risk 0.25 / every 1) ROI -31.98%, sizing-and-frequency -52.37 pp, other costs 50.10 pp (zero-cost ROI 18.12%).
- pop 1000, mean_reverting: all-in ROI -22.48%, best legal (risk 0.25 / every 1) ROI -39.19%, sizing-and-frequency -16.71 pp, other costs 46.42 pp (zero-cost ROI 7.24%).
- pop 1000, choppy: all-in ROI -7.10%, best legal (risk 0.25 / every 1) ROI -36.09%, sizing-and-frequency -29.00 pp, other costs 48.44 pp (zero-cost ROI 12.35%).
- pop 1000, stress_flash_crash: all-in ROI -36.73%, best legal (risk 0.25 / every 1) ROI -38.03%, sizing-and-frequency -1.31 pp, other costs 47.90 pp (zero-cost ROI 9.87%).

## What this says about the preliminary 45 to 60 percent

This engine does not reproduce that loss on the all-in policy. On seed 42, static all-in ROI is positive in the trending regime (about +20 to +30 percent at the three population sizes) and between about -15 and -37 percent in the other three regimes. The 45 to 60 percent figure was produced by `prelim_sim.py`, which is not in this repository. The numbers were not tuned to match it.

Inside this engine, moving from all-in to the best legal policy (risk tolerance 0.25, trade every tick) does not remove loss. Static ROI gets worse, by about 1 percentage point in the stress regime at 1,000 agents and by about 50 to 60 percentage points in the trending regime. A smaller position earns less gross pnl while the information purchase is a fixed cost: default probability 0.30 and 0.05 per purchase. On the legal rows, the x402 column is larger than fees, gas, or slippage. The zero-cost run of that same legal policy is positive in every regime (about +7 to +21 percent). The gap between zero-cost and with-cost is about 46 to 51 percentage points. That gap is the "other costs" column above. The sizing-and-frequency column is negative throughout: in this synthetic market, capping size does not explain the preliminary loss, and it currently makes the cost drag worse because the fixed x402 charge is large relative to a capped position.
