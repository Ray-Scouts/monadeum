# Pre-registered confirmation of owner-scoped reallocation with retirement

Issue #92. `reallocation-scope.md` (issue #89) narrowed the candidate mechanism in `EVOLUTION.md` section 8.5 to fixed slots, bounded reallocation within each owner's agents, and section 6 retirement of starved slots, with no genome copying. That arm was added after the first batch of issue #89 results had been read, on seeds 1 to 50. This run tests it out of sample, on seeds 51 to 100, with the hypotheses, arms, settings, and decision rule fixed in issue #92 before any run.

As with every result here, this tests a mechanism in the harness, not production. The issue #84 genome model and its magnitudes are assumptions. A positive result says that, given a genome that carries an edge of this size, the mechanism converts it into population return.

## Deviations from the pre-registered design

None for H1, H2, and H3. The primary arm, both controls, the seeds, and every setting are as issue #92 specifies, and the analysis is the issue #85 and #89 `decide` rule, unchanged. Two points of implementation, stated here so they can be checked:

- **Seeds.** The issue #85 and #89 harness always ran seeds 1 to `SEEDS`. A `SEED_START` option (default 1, so earlier runs are unchanged) was added to `cli-slots.ts`; this run uses `SEEDS=50 SEED_START=51`. The report CLI refuses any cell whose seeds are not exactly 51 to 100. Control 1 and Control 2 were therefore re-run on seeds 51 to 100 rather than read from `results/fixed-slot/`.
- **Exploratory arms.** The matched-aggressiveness arm is described in issue #92 as "population-wide reallocation using the small-pool rule's bottom-one to top-one move". In a population-wide pool of 100 or 1,000 a literal bottom one to top one would move far less capital than the decile rule, the opposite of what the arm is for. It was implemented as the reading that matches its stated purpose and the issue #89 limitation it answers: population-wide ranking with the same source and sink share that the small-pool rule gives an owner of 3 (one third) or 5 (one fifth). This affects only the exploratory section.

## Setup

- **Primary arm `Omix-RT-c0.2-x4`:** fixed slots, `refill: "retire"` (a slot that meets the section 6 starvation trigger retires and its capital stays in its own account, idle), owner-scoped reallocation at cap 0.2 and ceiling 4 times principal, the mixed owner distribution of issue #89 (sizes repeating 1, 1, 1, 2, 2, 3, 5, 10, 25, an assumption with no usage data behind it), and the issue #89 small-pool rule (the bottom one and the top one in an owner pool of 2 to 19 ranked slots, deciles from 20, nothing below 2).
- **Control 1 (`C1`):** static population, as in issue #85.
- **Control 2 (`C2`):** fixed slots refilled with random genomes, as in issue #85.
- **Everything else:** the issue #84 genome model with random founders and hidden skill 0, populations 10, 100, and 1,000, the four regimes, 300 ticks, risk tolerance 0.25, execution every tick, diversity on, x402 $0.01, information purchases on, 50 seeds per cell including population 1,000.
- **Rule:** `decide` in `src/rerun.ts`, unchanged, with a two-sided Welch test per cell. Outperforms means a strict majority of the 12 cells (7 or more) higher with p below 0.05 and a positive median gap. The 3 stress cells are reported on their own. Paired p-values are secondary and no call uses them.

### Code with the new options unset

The new options (`SEED_START`, `slots.quotaShare`, `slots.recycleRetired`) default to the previous behavior. `test/owner-confirmation.test.ts` checks that with them unset an issue #89 cell (`Omix-RT-c0.2-x4`, magnitude 0.009, population 10, choppy, seeds 1 to 50) reproduces `results/reallocation-scope/` field for field, and that seeds 51 to 53 run through `SEED_START` equal seeds 51 to 53 of a run from seed 1. The existing issue #85 reproduction test and the capital conservation and owner boundary tests in `test/reallocation-scope.test.ts` still pass and cover the primary arm.

## H1, H2, H3

| magnitude | hypothesis | comparison | cells p < 0.05 | median gap pp | stress (3 cells) | call |
|---|---|---|---|---:|---|---|
| 0.009 | **H1 (primary)** | `Omix-RT-c0.2-x4` vs C1 | 11 (11 up, 0 down) | 2.78 | outperforms (2 up, 0 down) | **outperforms** |
| 0.009 | **H2** | `Omix-RT-c0.2-x4` vs C2 | 11 (11 up, 0 down) | 2.93 | outperforms (2 up, 0 down) | **outperforms** |
| 0.006 | **H3**, against C1 | `Omix-RT-c0.2-x4` vs C1 | 8 (8 up, 0 down) | 1.59 | inconclusive (0 up, 0 down) | **outperforms** |
| 0.006 | **H3**, against C2 | `Omix-RT-c0.2-x4` vs C2 | 10 (10 up, 0 down) | 2.33 | outperforms (2 up, 0 down) | **outperforms** |

- **H1 holds.** At magnitude 0.009 the primary arm beats Control 1 in 11 of 12 cells with p below 0.05, all higher, median gap +2.78 pp. The one cell without significance is population 10, stress (+1.59 pp, p 0.084).
- **H2 holds.** At 0.009 it beats Control 2 in 11 of 12 cells, all higher, median gap +2.93 pp. The same cell, population 10 stress, is the exception (+1.71 pp, p 0.063).
- **H3 holds.** At 0.006 it beats Control 1 in 8 of 12 cells (the threshold is 7) and Control 2 in 10 of 12, every significant cell higher, median gaps +1.59 and +2.33 pp. Against Control 1 the margin is narrow: one fewer significant cell would still pass, two fewer would not.
- **No cell in any of the four comparisons is significantly below a control.** Every one of the 48 cell gaps is positive.

**Under issue #92's "What this decides", H1 and H2 hold: the candidate is confirmed in simulation.**

### Stress, reported separately

At 0.009 the stress regime passes against both controls on its own (populations 100 and 1,000 significant, population 10 positive but p above 0.05). At 0.006 stress passes against Control 2 (2 of 3) but is inconclusive against Control 1: gaps +0.43, +0.86, and +0.91 pp with p 0.52, 0.073, and 0.052. The mechanism does not lose in the stress regime at either magnitude, but at the smaller edge its stress advantage over a static population is not established.

### Context: Control 2 against Control 1

Random replacement never beats the static population: at 0.009 it is inconclusive (1 cell significant, lower, median -0.12 pp), and at 0.006 inconclusive with 4 cells significantly lower (median -0.68 pp), as in issue #85.

### Per cell, magnitude 0.009

| pop | regime | arm roi | C1 roi | gap vs C1 | Welch p vs C1 | C2 roi | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | moved % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.12 | 0.50 | 2.62 | 0.0113 | 0.51 | 2.62 | 0.0118 | <0.0001 | <0.0001 | 29.29 |
| 10 | mean_reverting | 0.03 | -2.80 | 2.83 | 0.0016 | -2.87 | 2.90 | 0.0013 | <0.0001 | <0.0001 | 29.68 |
| 10 | choppy | 2.01 | -0.49 | 2.50 | 0.0333 | -0.45 | 2.45 | 0.0366 | <0.0001 | <0.0001 | 29.79 |
| 10 | stress_flash_crash | -4.42 | -6.01 | 1.59 | 0.0844 | -6.14 | 1.71 | 0.0625 | <0.0001 | <0.0001 | 30.12 |
| 100 | trending | 5.86 | 2.61 | 3.25 | <0.0001 | 2.62 | 3.24 | <0.0001 | <0.0001 | <0.0001 | 19.13 |
| 100 | mean_reverting | 0.74 | -2.08 | 2.82 | <0.0001 | -2.47 | 3.22 | <0.0001 | <0.0001 | <0.0001 | 18.69 |
| 100 | choppy | 2.86 | 0.13 | 2.73 | 0.0003 | 0.01 | 2.85 | 0.0003 | <0.0001 | <0.0001 | 19.54 |
| 100 | stress_flash_crash | -3.13 | -5.01 | 1.88 | 0.0019 | -5.84 | 2.71 | <0.0001 | <0.0001 | <0.0001 | 19.49 |
| 1000 | trending | 6.30 | 2.86 | 3.44 | <0.0001 | 2.96 | 3.34 | <0.0001 | <0.0001 | <0.0001 | 20.46 |
| 1000 | mean_reverting | 0.96 | -1.92 | 2.89 | <0.0001 | -2.38 | 3.34 | <0.0001 | <0.0001 | <0.0001 | 19.84 |
| 1000 | choppy | 3.30 | 0.40 | 2.90 | <0.0001 | 0.20 | 3.10 | <0.0001 | <0.0001 | <0.0001 | 20.49 |
| 1000 | stress_flash_crash | -2.82 | -4.84 | 2.02 | 0.0004 | -5.76 | 2.95 | <0.0001 | <0.0001 | <0.0001 | 20.46 |

### Per cell, magnitude 0.006

| pop | regime | arm roi | C1 roi | gap vs C1 | Welch p vs C1 | C2 roi | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | moved % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.52 | -4.09 | 1.57 | 0.0426 | -4.15 | 1.63 | 0.0367 | <0.0001 | <0.0001 | 29.43 |
| 10 | mean_reverting | -6.10 | -7.69 | 1.59 | 0.0026 | -7.83 | 1.73 | 0.0011 | <0.0001 | <0.0001 | 30.72 |
| 10 | choppy | -4.66 | -5.82 | 1.16 | 0.1658 | -5.90 | 1.24 | 0.1406 | <0.0001 | <0.0001 | 29.81 |
| 10 | stress_flash_crash | -10.07 | -10.50 | 0.43 | 0.5191 | -10.64 | 0.57 | 0.3915 | 0.0065 | 0.0008 | 30.43 |
| 100 | trending | -0.44 | -2.47 | 2.02 | 0.0023 | -3.05 | 2.61 | 0.0002 | <0.0001 | <0.0001 | 19.61 |
| 100 | mean_reverting | -4.95 | -6.60 | 1.64 | <0.0001 | -7.53 | 2.58 | <0.0001 | <0.0001 | <0.0001 | 19.12 |
| 100 | choppy | -3.39 | -4.97 | 1.58 | 0.0099 | -5.74 | 2.35 | 0.0003 | <0.0001 | <0.0001 | 19.89 |
| 100 | stress_flash_crash | -8.49 | -9.36 | 0.86 | 0.0725 | -10.67 | 2.17 | <0.0001 | <0.0001 | <0.0001 | 19.98 |
| 1000 | trending | -0.12 | -2.28 | 2.15 | 0.0013 | -2.83 | 2.71 | 0.0001 | <0.0001 | <0.0001 | 20.85 |
| 1000 | mean_reverting | -4.80 | -6.45 | 1.65 | <0.0001 | -7.50 | 2.70 | <0.0001 | <0.0001 | <0.0001 | 20.14 |
| 1000 | choppy | -3.16 | -4.80 | 1.65 | 0.0066 | -5.65 | 2.49 | 0.0001 | <0.0001 | <0.0001 | 20.76 |
| 1000 | stress_flash_crash | -8.36 | -9.27 | 0.91 | 0.0523 | -10.68 | 2.32 | <0.0001 | <0.0001 | <0.0001 | 20.77 |

### Paired tests (secondary)

Every arm shares founders, the market path, and information draws on a seed, so paired p-values are below 0.01 in all 48 cell comparisons above. They show direction consistently, but they are not the pre-registered statistic and no call uses them.

### Agreement with the issue #89 post hoc result

On seeds 1 to 50, issue #89 reported this arm at 11 and 12 of 12 cells against Control 1 and Control 2 at 0.009 (median gap 2.77 and 2.97 pp) and 9 and 10 at 0.006 (1.62 and 2.33 pp). On seeds 51 to 100 the counts are 11, 11, 8, and 10, and the median gaps 2.78, 2.93, 1.59, and 2.33 pp. The effect sizes replicate to within 0.05 pp; the significant-cell counts are within one cell, with the smallest margin at 0.006 against Control 1.

## Exploratory arms

**Not pre-registered as tests and not used for H1 to H3.** The arms are those listed in issue #92, run on the same seeds 51 to 100 at both magnitudes, ceiling 4, cap 0.2, with retirement in every arm:

| arm | ranking and moves | source and sink share |
|---|---|---|
| `O3-RT`, `O5-RT`, `O10-RT` | within owners of 3, 5, or 10 slots | small-pool rule: 1 of 3, 1 of 5, 1 of 10 |
| `RT` | population-wide | decile |
| `RTs3`, `RTs5` (matched aggressiveness) | population-wide | one third, one fifth |
| `Omix-RTr` (recycling) | as the primary arm, and each retired slot's capital moves to the same owner's highest-fitness active slot, up to the ceiling 4, at every evaluation | as the primary arm |

All names end in `-c0.2-x4`. Each is compared with Control 1, Control 2, and the primary arm under the same rule, plus the comparisons that isolate pool size and intensity.

| arm | against | 0.009: cells p < 0.05, median gap, call | 0.006: cells p < 0.05, median gap, call |
|---|---|---|---|
| O3-RT | C1 / C2 | 12 up, 4.04, outperforms / 12 up, 4.09, outperforms | 10 up, 2.22, outperforms / 11 up, 2.69, outperforms |
| O5-RT | C1 / C2 | 12 up, 3.76, outperforms / 12 up, 3.85, outperforms | 10 up, 2.11, outperforms / 11 up, 2.71, outperforms |
| O10-RT | C1 / C2 | 11 up, 2.69, outperforms / 10 up, 3.03, outperforms | 9 up, 1.57, outperforms / 10 up, 2.41, outperforms |
| RT | C1 / C2 | 10 up, 2.63, outperforms / 10 up, 3.15, outperforms | 9 up, 1.51, outperforms / 9 up, 2.49, outperforms |
| RTs3 | C1 / C2 | 12 up, 5.14, outperforms / 12 up, 5.20, outperforms | 11 up, 2.86, outperforms / 11 up, 3.31, outperforms |
| RTs5 | C1 / C2 | 12 up, 4.16, outperforms / 12 up, 4.48, outperforms | 11 up, 2.42, outperforms / 11 up, 3.13, outperforms |
| Omix-RTr | C1 / C2 | 11 up, 3.62, outperforms / 11 up, 4.14, outperforms | 10 up, 2.03, outperforms / 10 up, 2.89, outperforms |
| primary (Omix-RT) | RT (owner scope, mixed sizes) | 1 down, -0.22, inconclusive | 1 down, -0.15, inconclusive |
| O10-RT | RT (owner scope at matched intensity) | 0, -0.09, inconclusive | 0, -0.05, inconclusive |
| RTs3 | O3-RT (pool size at matched share) | 2 up, 1.14, inconclusive | 2 up, 0.62, inconclusive |
| RTs5 | O5-RT (pool size at matched share) | 1 up, 0.54, inconclusive | 1 up, 0.36, inconclusive |
| RTs3 | RT (intensity, population-wide) | 10 up, 2.28, outperforms | 5 up, 1.14, inconclusive |
| RTs5 | RT (intensity, population-wide) | 6 up, 1.49, mixed | 2 up, 0.81, inconclusive |
| Omix-RTr | primary (recycling) | 4 up, 1.23, inconclusive | 2 up, 0.55, inconclusive |

No exploratory comparison has a cell significantly below a control or below the primary arm, except the single cell in primary against `RT`.

What these show, as observations from exploratory arms:

- **Every retirement arm beats both controls at both magnitudes**, at every owner size and population-wide, in 9 to 12 of 12 cells. The candidate's result does not depend on the mixed distribution.
- **Owner scope itself costs nothing measurable; the owner-size gains are reallocation intensity.** Population-wide ranking with the same source and sink share as an owner of 3 or 5 (`RTs3`, `RTs5`) does at least as well as the owner-scoped arm (median +1.14 and +0.54 pp at 0.009, at most 2 cells significant, inconclusive), and better than the decile rule (`RTs3` against `RT`: 10 of 12 cells higher at 0.009). The advantage issue #89 saw at owner sizes 3 and 5 comes from moving more capital, not from the smaller pool. At owner size 10, where the two rules agree, owner scope against population-wide is -0.09 and -0.05 pp.
- **More intensity has not yet hit a limit in this model.** The arms that move the most capital (`RTs3`, 36 to 37 percent of starting capital over the run) have the highest return and the lowest end genome distance, and also the lowest niche diversity (4.87 to 4.97 effective niches against 5.59 to 5.61 for Control 1, top niche 38 percent against 34). No arm collapsed into a monoculture, but intensity trades against diversity, and a regime change within a run, which this model does not have, is where that trade would cost.
- **Recycling a retired slot's idle capital adds a median 1.23 pp at 0.009 and 0.55 pp at 0.006 over the primary arm, not significant under the rule** (4 and 2 cells higher, none lower). It recycles about 7 percent of starting capital over a run, about 10 percent at populations 100 and 1,000 and about 1 percent at population 10, where the mixed distribution leaves 3 of 6 owners with one slot and nowhere to send capital. The direction is consistent across cells, so it is a plausible owner-policy option, but this run does not establish it.

## What this decides (issue #92)

H1 and H2 hold at 0.009, and H3 holds at 0.006. Under the issue's decision table, **the candidate is confirmed in simulation**: fixed slots, bounded reallocation within each owner's agents (cap 0.2, ceiling 4, small-pool rule) under a policy that owner approves, and section 6 retirement of starved agents, with no genome replacement and no cross-owner genome copying. The post hoc issue #89 result replicates out of sample with nearly identical effect sizes.

The remaining gate on issue #28 is the one the issue names: whether real strategies' genomes carry an edge of the assumed size (0.006 to 0.009 per tick of genome edge in the issue #84 model). The stress regime at 0.006 against a static population is not established and should be watched rather than assumed. The exploratory arms suggest two parameters worth stating as hypotheses before the mechanism is specified, not settled here: reallocation intensity (source and sink share) matters more than pool scope, and recycling retired capital within an owner may add return.

## Commands

From `simulation/`, after `bun run test` from the repository root (which builds the libraries and `dist/`). Every cell runs seeds 51 to 100:

```bash
# MAGS and ARMS per batch; 10 jobs in parallel, population 1,000 first
for mag in $MAGS; do for pop in 1000 100 10; do for arm in $ARMS; do for regime in trending mean_reverting choppy stress_flash_crash; do
  echo "$arm $mag $pop $regime"
done; done; done; done | xargs -P 10 -L 1 zsh -c \
  'ARM=$0 MAG=$1 POPS=$2 REGIMES=$3 SEEDS=50 SEED_START=51 OUT=results/owner-reallocation-confirmation/$0-m$1-$2-$3.json node dist/src/cli-slots.js'

node dist/src/cli-confirm-report.js results/owner-reallocation-confirmation
```

| batch | arms | magnitudes | jobs | wall seconds |
|---|---|---|---:|---:|
| pre-registered | `C1`, `C2`, `Omix-RT-c0.2-x4` | 0.009, 0.006 | 72 | 494 |
| exploratory | `O3-RT`, `O5-RT`, `O10-RT`, `RT`, `RTs3`, `RTs5`, `Omix-RTr` (all `-c0.2-x4`) | 0.009, 0.006 | 168 | 924 |

On a laptop with 11 cores, shared with other work during the run. The pre-registered results were committed before the exploratory batch was read. No seeds were reduced anywhere. The per-cell JSON, with per-seed ROI, capital moved, capital recycled (recycling arm only), distance trace, and niche statistics, is in `results/owner-reallocation-confirmation/`.

## Limitations

- Everything rests on the issue #84 genome model and its magnitude assumptions. The regime optimum does not move within a run, so the cost of concentrating capital when the regime changes is not measured.
- The mixed owner distribution is an assumption with no usage data. Owners are assigned by slot index, so an owner's agents are independent draws; real owners may run correlated strategies, which would make within-owner ranking less informative.
- Fitness, shrinkage, niches, and the starvation trigger are computed population-wide, as in issue #89. A product that had to compute them per owner would lose the niche-relative starvation trigger for small owners.
- Owners of one agent get nothing from reallocation or recycling. At population 10 half the mixed owners hold one slot.
- At 0.006, H3 against Control 1 passes with one cell of margin, and the stress regime there is inconclusive.
- 300 ticks. Genome distance is still falling at tick 300 in every reallocating arm.
- The exploratory arms were specified before the run but are not tests; their comparisons with each other are inconclusive in most cases, and the matched-aggressiveness arm uses the interpretation stated under "Deviations".

## Report

The full output of `node dist/src/cli-confirm-report.js results/owner-reallocation-confirmation`: the pre-registered comparisons and per-cell tables, the exploratory comparisons, capital moved and genome distance over time with niche diversity, and per-cell tables for every exploratory arm.

### Pre-registered comparisons

| magnitude | hypothesis | comparison | cells | cells p < 0.05 | median gap pp | stress (3 cells) | call |
|---|---|---|---:|---|---:|---|---|
| 0.009 | H1 | Omix-RT-c0.2-x4 vs C1 | 12 | 11 (11 up, 0 down) | 2.78 | outperforms (2 up, 0 down) | **outperforms** |
| 0.009 | H2 | Omix-RT-c0.2-x4 vs C2 | 12 | 11 (11 up, 0 down) | 2.93 | outperforms (2 up, 0 down) | **outperforms** |
| 0.009 | context | C2 vs C1 | 12 | 1 (0 up, 1 down) | -0.12 | inconclusive (0 up, 0 down) | **inconclusive** |
| 0.006 | H3 (with C1) | Omix-RT-c0.2-x4 vs C1 | 12 | 8 (8 up, 0 down) | 1.59 | inconclusive (0 up, 0 down) | **outperforms** |
| 0.006 | H3 (with C2) | Omix-RT-c0.2-x4 vs C2 | 12 | 10 (10 up, 0 down) | 2.33 | outperforms (2 up, 0 down) | **outperforms** |
| 0.006 | context | C2 vs C1 | 12 | 4 (0 up, 4 down) | -0.68 | underperforms (0 up, 2 down) | **inconclusive** |

#### Magnitude 0.009, Omix-RT-c0.2-x4 per cell

| pop | regime | Omix-RT-c0.2-x4 roi | C1 roi | gap vs C1 | Welch p vs C1 | C2 roi | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | moved % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.12 | 0.50 | 2.62 | 0.0113 | 0.51 | 2.62 | 0.0118 | <0.0001 | <0.0001 | 29.29 |
| 10 | mean_reverting | 0.03 | -2.80 | 2.83 | 0.0016 | -2.87 | 2.90 | 0.0013 | <0.0001 | <0.0001 | 29.68 |
| 10 | choppy | 2.01 | -0.49 | 2.50 | 0.0333 | -0.45 | 2.45 | 0.0366 | <0.0001 | <0.0001 | 29.79 |
| 10 | stress_flash_crash | -4.42 | -6.01 | 1.59 | 0.0844 | -6.14 | 1.71 | 0.0625 | <0.0001 | <0.0001 | 30.12 |
| 100 | trending | 5.86 | 2.61 | 3.25 | <0.0001 | 2.62 | 3.24 | <0.0001 | <0.0001 | <0.0001 | 19.13 |
| 100 | mean_reverting | 0.74 | -2.08 | 2.82 | <0.0001 | -2.47 | 3.22 | <0.0001 | <0.0001 | <0.0001 | 18.69 |
| 100 | choppy | 2.86 | 0.13 | 2.73 | 0.0003 | 0.01 | 2.85 | 0.0003 | <0.0001 | <0.0001 | 19.54 |
| 100 | stress_flash_crash | -3.13 | -5.01 | 1.88 | 0.0019 | -5.84 | 2.71 | <0.0001 | <0.0001 | <0.0001 | 19.49 |
| 1000 | trending | 6.30 | 2.86 | 3.44 | <0.0001 | 2.96 | 3.34 | <0.0001 | <0.0001 | <0.0001 | 20.46 |
| 1000 | mean_reverting | 0.96 | -1.92 | 2.89 | <0.0001 | -2.38 | 3.34 | <0.0001 | <0.0001 | <0.0001 | 19.84 |
| 1000 | choppy | 3.30 | 0.40 | 2.90 | <0.0001 | 0.20 | 3.10 | <0.0001 | <0.0001 | <0.0001 | 20.49 |
| 1000 | stress_flash_crash | -2.82 | -4.84 | 2.02 | 0.0004 | -5.76 | 2.95 | <0.0001 | <0.0001 | <0.0001 | 20.46 |

#### Magnitude 0.006, Omix-RT-c0.2-x4 per cell

| pop | regime | Omix-RT-c0.2-x4 roi | C1 roi | gap vs C1 | Welch p vs C1 | C2 roi | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | moved % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.52 | -4.09 | 1.57 | 0.0426 | -4.15 | 1.63 | 0.0367 | <0.0001 | <0.0001 | 29.43 |
| 10 | mean_reverting | -6.10 | -7.69 | 1.59 | 0.0026 | -7.83 | 1.73 | 0.0011 | <0.0001 | <0.0001 | 30.72 |
| 10 | choppy | -4.66 | -5.82 | 1.16 | 0.1658 | -5.90 | 1.24 | 0.1406 | <0.0001 | <0.0001 | 29.81 |
| 10 | stress_flash_crash | -10.07 | -10.50 | 0.43 | 0.5191 | -10.64 | 0.57 | 0.3915 | 0.0065 | 0.0008 | 30.43 |
| 100 | trending | -0.44 | -2.47 | 2.02 | 0.0023 | -3.05 | 2.61 | 0.0002 | <0.0001 | <0.0001 | 19.61 |
| 100 | mean_reverting | -4.95 | -6.60 | 1.64 | <0.0001 | -7.53 | 2.58 | <0.0001 | <0.0001 | <0.0001 | 19.12 |
| 100 | choppy | -3.39 | -4.97 | 1.58 | 0.0099 | -5.74 | 2.35 | 0.0003 | <0.0001 | <0.0001 | 19.89 |
| 100 | stress_flash_crash | -8.49 | -9.36 | 0.86 | 0.0725 | -10.67 | 2.17 | <0.0001 | <0.0001 | <0.0001 | 19.98 |
| 1000 | trending | -0.12 | -2.28 | 2.15 | 0.0013 | -2.83 | 2.71 | 0.0001 | <0.0001 | <0.0001 | 20.85 |
| 1000 | mean_reverting | -4.80 | -6.45 | 1.65 | <0.0001 | -7.50 | 2.70 | <0.0001 | <0.0001 | <0.0001 | 20.14 |
| 1000 | choppy | -3.16 | -4.80 | 1.65 | 0.0066 | -5.65 | 2.49 | 0.0001 | <0.0001 | <0.0001 | 20.76 |
| 1000 | stress_flash_crash | -8.36 | -9.27 | 0.91 | 0.0523 | -10.68 | 2.32 | <0.0001 | <0.0001 | <0.0001 | 20.77 |

### Exploratory comparisons

#### Magnitude 0.009, exploratory arms against the controls and the primary arm

| arm | against | cells | cells p < 0.05 | median gap pp | stress (3 cells) | call |
|---|---|---:|---|---:|---|---|
| O3-RT-c0.2-x4 | C1 | 12 | 12 (12 up, 0 down) | 4.04 | outperforms (3 up, 0 down) | **outperforms** |
| O3-RT-c0.2-x4 | C2 | 12 | 12 (12 up, 0 down) | 4.09 | outperforms (3 up, 0 down) | **outperforms** |
| O3-RT-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 4 (4 up, 0 down) | 1.30 | inconclusive (0 up, 0 down) | **inconclusive** |
| O5-RT-c0.2-x4 | C1 | 12 | 12 (12 up, 0 down) | 3.76 | outperforms (3 up, 0 down) | **outperforms** |
| O5-RT-c0.2-x4 | C2 | 12 | 12 (12 up, 0 down) | 3.85 | outperforms (3 up, 0 down) | **outperforms** |
| O5-RT-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 1.09 | inconclusive (0 up, 0 down) | **inconclusive** |
| O10-RT-c0.2-x4 | C1 | 12 | 11 (11 up, 0 down) | 2.69 | outperforms (2 up, 0 down) | **outperforms** |
| O10-RT-c0.2-x4 | C2 | 12 | 10 (10 up, 0 down) | 3.03 | outperforms (2 up, 0 down) | **outperforms** |
| O10-RT-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 0 (0 up, 0 down) | 0.13 | inconclusive (0 up, 0 down) | **inconclusive** |
| RT-c0.2-x4 | C1 | 12 | 10 (10 up, 0 down) | 2.63 | outperforms (2 up, 0 down) | **outperforms** |
| RT-c0.2-x4 | C2 | 12 | 10 (10 up, 0 down) | 3.15 | outperforms (2 up, 0 down) | **outperforms** |
| RT-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 1 (1 up, 0 down) | 0.22 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs3-c0.2-x4 | C1 | 12 | 12 (12 up, 0 down) | 5.14 | outperforms (3 up, 0 down) | **outperforms** |
| RTs3-c0.2-x4 | C2 | 12 | 12 (12 up, 0 down) | 5.20 | outperforms (3 up, 0 down) | **outperforms** |
| RTs3-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 9 (9 up, 0 down) | 2.42 | outperforms (2 up, 0 down) | **outperforms** |
| RTs5-c0.2-x4 | C1 | 12 | 12 (12 up, 0 down) | 4.16 | outperforms (3 up, 0 down) | **outperforms** |
| RTs5-c0.2-x4 | C2 | 12 | 12 (12 up, 0 down) | 4.48 | outperforms (3 up, 0 down) | **outperforms** |
| RTs5-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 8 (8 up, 0 down) | 1.51 | outperforms (2 up, 0 down) | **outperforms** |
| Omix-RTr-c0.2-x4 | C1 | 12 | 11 (11 up, 0 down) | 3.62 | outperforms (2 up, 0 down) | **outperforms** |
| Omix-RTr-c0.2-x4 | C2 | 12 | 11 (11 up, 0 down) | 4.14 | outperforms (2 up, 0 down) | **outperforms** |
| Omix-RTr-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 4 (4 up, 0 down) | 1.23 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs3-c0.2-x4 | O3-RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 1.14 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs5-c0.2-x4 | O5-RT-c0.2-x4 | 12 | 1 (1 up, 0 down) | 0.54 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs3-c0.2-x4 | RT-c0.2-x4 | 12 | 10 (10 up, 0 down) | 2.28 | outperforms (2 up, 0 down) | **outperforms** |
| RTs5-c0.2-x4 | RT-c0.2-x4 | 12 | 6 (6 up, 0 down) | 1.49 | inconclusive (0 up, 0 down) | **mixed** |
| O3-RT-c0.2-x4 | RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 1.11 | inconclusive (0 up, 0 down) | **inconclusive** |
| O5-RT-c0.2-x4 | RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 0.94 | inconclusive (0 up, 0 down) | **inconclusive** |
| O10-RT-c0.2-x4 | RT-c0.2-x4 | 12 | 0 (0 up, 0 down) | -0.09 | inconclusive (0 up, 0 down) | **inconclusive** |
| Omix-RT-c0.2-x4 | RT-c0.2-x4 | 12 | 1 (0 up, 1 down) | -0.22 | inconclusive (0 up, 0 down) | **inconclusive** |

#### Magnitude 0.006, exploratory arms against the controls and the primary arm

| arm | against | cells | cells p < 0.05 | median gap pp | stress (3 cells) | call |
|---|---|---:|---|---:|---|---|
| O3-RT-c0.2-x4 | C1 | 12 | 10 (10 up, 0 down) | 2.22 | inconclusive (1 up, 0 down) | **outperforms** |
| O3-RT-c0.2-x4 | C2 | 12 | 11 (11 up, 0 down) | 2.69 | outperforms (2 up, 0 down) | **outperforms** |
| O3-RT-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 0.62 | inconclusive (0 up, 0 down) | **inconclusive** |
| O5-RT-c0.2-x4 | C1 | 12 | 10 (10 up, 0 down) | 2.11 | outperforms (2 up, 0 down) | **outperforms** |
| O5-RT-c0.2-x4 | C2 | 12 | 11 (11 up, 0 down) | 2.71 | outperforms (2 up, 0 down) | **outperforms** |
| O5-RT-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 0.53 | inconclusive (0 up, 0 down) | **inconclusive** |
| O10-RT-c0.2-x4 | C1 | 12 | 9 (9 up, 0 down) | 1.57 | inconclusive (1 up, 0 down) | **outperforms** |
| O10-RT-c0.2-x4 | C2 | 12 | 10 (10 up, 0 down) | 2.41 | outperforms (2 up, 0 down) | **outperforms** |
| O10-RT-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 0 (0 up, 0 down) | 0.09 | inconclusive (0 up, 0 down) | **inconclusive** |
| RT-c0.2-x4 | C1 | 12 | 9 (9 up, 0 down) | 1.51 | outperforms (2 up, 0 down) | **outperforms** |
| RT-c0.2-x4 | C2 | 12 | 9 (9 up, 0 down) | 2.49 | outperforms (2 up, 0 down) | **outperforms** |
| RT-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 1 (1 up, 0 down) | 0.15 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs3-c0.2-x4 | C1 | 12 | 11 (11 up, 0 down) | 2.86 | outperforms (2 up, 0 down) | **outperforms** |
| RTs3-c0.2-x4 | C2 | 12 | 11 (11 up, 0 down) | 3.31 | outperforms (2 up, 0 down) | **outperforms** |
| RTs3-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 4 (4 up, 0 down) | 1.24 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs5-c0.2-x4 | C1 | 12 | 11 (11 up, 0 down) | 2.42 | outperforms (2 up, 0 down) | **outperforms** |
| RTs5-c0.2-x4 | C2 | 12 | 11 (11 up, 0 down) | 3.13 | outperforms (2 up, 0 down) | **outperforms** |
| RTs5-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 0.83 | inconclusive (0 up, 0 down) | **inconclusive** |
| Omix-RTr-c0.2-x4 | C1 | 12 | 10 (10 up, 0 down) | 2.03 | outperforms (2 up, 0 down) | **outperforms** |
| Omix-RTr-c0.2-x4 | C2 | 12 | 10 (10 up, 0 down) | 2.89 | outperforms (2 up, 0 down) | **outperforms** |
| Omix-RTr-c0.2-x4 | Omix-RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 0.55 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs3-c0.2-x4 | O3-RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 0.62 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs5-c0.2-x4 | O5-RT-c0.2-x4 | 12 | 1 (1 up, 0 down) | 0.36 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs3-c0.2-x4 | RT-c0.2-x4 | 12 | 5 (5 up, 0 down) | 1.14 | inconclusive (0 up, 0 down) | **inconclusive** |
| RTs5-c0.2-x4 | RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 0.81 | inconclusive (0 up, 0 down) | **inconclusive** |
| O3-RT-c0.2-x4 | RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 0.51 | inconclusive (0 up, 0 down) | **inconclusive** |
| O5-RT-c0.2-x4 | RT-c0.2-x4 | 12 | 2 (2 up, 0 down) | 0.44 | inconclusive (0 up, 0 down) | **inconclusive** |
| O10-RT-c0.2-x4 | RT-c0.2-x4 | 12 | 0 (0 up, 0 down) | -0.05 | inconclusive (0 up, 0 down) | **inconclusive** |
| Omix-RT-c0.2-x4 | RT-c0.2-x4 | 12 | 1 (0 up, 1 down) | -0.15 | inconclusive (0 up, 0 down) | **inconclusive** |

#### Magnitude 0.009, capital moved, genome distance, and diversity, means over the 12 cells

| arm | mean roi | moved % of start | recycled % of start | distance t0 | distance t60 | distance t120 | distance t180 | distance t240 | distance t300 | effective niches | top niche % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| C1 | -1.39 | 0.00 | 0.00 | 0.412 | 0.405 | 0.394 | 0.386 | 0.377 | 0.368 | 5.59 | 34.4 |
| C2 | -1.63 | 0.00 | 0.00 | 0.412 | 0.405 | 0.396 | 0.388 | 0.381 | 0.374 | 5.66 | 34.1 |
| Omix-RT-c0.2-x4 | 1.23 | 23.08 | 0.00 | 0.412 | 0.382 | 0.359 | 0.341 | 0.326 | 0.312 | 5.15 | 37.1 |
| O3-RT-c0.2-x4 | 2.41 | 39.98 | 0.00 | 0.412 | 0.369 | 0.340 | 0.322 | 0.308 | 0.298 | 5.04 | 37.4 |
| O5-RT-c0.2-x4 | 2.23 | 29.26 | 0.00 | 0.412 | 0.374 | 0.345 | 0.323 | 0.305 | 0.290 | 5.07 | 37.4 |
| O10-RT-c0.2-x4 | 1.27 | 16.79 | 0.00 | 0.412 | 0.384 | 0.360 | 0.339 | 0.320 | 0.303 | 5.22 | 36.8 |
| RT-c0.2-x4 | 1.29 | 14.19 | 0.00 | 0.412 | 0.383 | 0.359 | 0.340 | 0.322 | 0.306 | 5.26 | 36.3 |
| RTs3-c0.2-x4 | 3.48 | 36.17 | 0.00 | 0.412 | 0.360 | 0.324 | 0.301 | 0.283 | 0.270 | 4.87 | 38.4 |
| RTs5-c0.2-x4 | 2.71 | 25.25 | 0.00 | 0.412 | 0.369 | 0.338 | 0.316 | 0.297 | 0.280 | 4.99 | 37.4 |
| Omix-RTr-c0.2-x4 | 2.24 | 21.80 | 7.17 | 0.412 | 0.378 | 0.350 | 0.332 | 0.318 | 0.307 | 5.12 | 37.1 |

#### Magnitude 0.006, capital moved, genome distance, and diversity, means over the 12 cells

| arm | mean roi | moved % of start | recycled % of start | distance t0 | distance t60 | distance t120 | distance t180 | distance t240 | distance t300 | effective niches | top niche % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| C1 | -6.19 | 0.00 | 0.00 | 0.412 | 0.407 | 0.400 | 0.393 | 0.387 | 0.380 | 5.61 | 34.2 |
| C2 | -6.85 | 0.00 | 0.00 | 0.412 | 0.407 | 0.400 | 0.395 | 0.390 | 0.385 | 5.66 | 34.0 |
| Omix-RT-c0.2-x4 | -4.76 | 23.46 | 0.00 | 0.412 | 0.387 | 0.366 | 0.351 | 0.337 | 0.325 | 5.21 | 36.6 |
| O3-RT-c0.2-x4 | -4.18 | 40.38 | 0.00 | 0.412 | 0.375 | 0.350 | 0.333 | 0.321 | 0.312 | 5.10 | 37.2 |
| O5-RT-c0.2-x4 | -4.24 | 29.43 | 0.00 | 0.412 | 0.379 | 0.353 | 0.333 | 0.317 | 0.303 | 5.15 | 36.9 |
| O10-RT-c0.2-x4 | -4.70 | 17.02 | 0.00 | 0.412 | 0.388 | 0.367 | 0.348 | 0.331 | 0.315 | 5.28 | 36.3 |
| RT-c0.2-x4 | -4.66 | 14.44 | 0.00 | 0.412 | 0.387 | 0.366 | 0.349 | 0.333 | 0.318 | 5.31 | 35.9 |
| RTs3-c0.2-x4 | -3.62 | 36.94 | 0.00 | 0.412 | 0.367 | 0.335 | 0.314 | 0.298 | 0.285 | 4.97 | 37.9 |
| RTs5-c0.2-x4 | -3.93 | 25.66 | 0.00 | 0.412 | 0.375 | 0.347 | 0.326 | 0.308 | 0.292 | 5.05 | 37.2 |
| Omix-RTr-c0.2-x4 | -4.24 | 22.40 | 7.28 | 0.412 | 0.383 | 0.358 | 0.341 | 0.328 | 0.319 | 5.18 | 36.6 |

##### Magnitude 0.009, O3-RT-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.52 | 4.01 | 0.0002 | 4.01 | 0.0002 | 1.39 | 0.2010 | 31.56 | 0.00 |
| 10 | mean_reverting | 0.71 | 3.51 | 0.0001 | 3.58 | <0.0001 | 0.68 | 0.4856 | 32.09 | 0.00 |
| 10 | choppy | 3.04 | 3.53 | 0.0030 | 3.48 | 0.0033 | 1.03 | 0.4128 | 31.18 | 0.00 |
| 10 | stress_flash_crash | -3.70 | 2.30 | 0.0127 | 2.43 | 0.0086 | 0.72 | 0.4700 | 31.48 | 0.00 |
| 100 | trending | 7.56 | 4.95 | <0.0001 | 4.94 | <0.0001 | 1.70 | 0.0366 | 43.62 | 0.00 |
| 100 | mean_reverting | 2.07 | 4.15 | <0.0001 | 4.54 | <0.0001 | 1.32 | 0.0003 | 42.21 | 0.00 |
| 100 | choppy | 4.19 | 4.06 | <0.0001 | 4.18 | <0.0001 | 1.33 | 0.1004 | 43.34 | 0.00 |
| 100 | stress_flash_crash | -2.39 | 2.62 | <0.0001 | 3.44 | <0.0001 | 0.73 | 0.2747 | 43.07 | 0.00 |
| 1000 | trending | 7.98 | 5.12 | <0.0001 | 5.02 | <0.0001 | 1.68 | 0.0427 | 45.85 | 0.00 |
| 1000 | mean_reverting | 2.24 | 4.16 | <0.0001 | 4.62 | <0.0001 | 1.27 | <0.0001 | 44.25 | 0.00 |
| 1000 | choppy | 4.72 | 4.32 | <0.0001 | 4.52 | <0.0001 | 1.42 | 0.0666 | 45.82 | 0.00 |
| 1000 | stress_flash_crash | -2.01 | 2.82 | <0.0001 | 3.75 | <0.0001 | 0.80 | 0.1959 | 45.30 | 0.00 |

##### Magnitude 0.009, O5-RT-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.19 | 3.69 | 0.0006 | 3.68 | 0.0006 | 1.06 | 0.3197 | 23.12 | 0.00 |
| 10 | mean_reverting | 0.71 | 3.51 | <0.0001 | 3.58 | <0.0001 | 0.68 | 0.4784 | 22.70 | 0.00 |
| 10 | choppy | 2.62 | 3.11 | 0.0074 | 3.06 | 0.0083 | 0.61 | 0.6226 | 22.78 | 0.00 |
| 10 | stress_flash_crash | -3.98 | 2.03 | 0.0270 | 2.16 | 0.0189 | 0.45 | 0.6530 | 23.20 | 0.00 |
| 100 | trending | 7.34 | 4.73 | <0.0001 | 4.72 | <0.0001 | 1.48 | 0.0671 | 31.97 | 0.00 |
| 100 | mean_reverting | 1.95 | 4.03 | <0.0001 | 4.42 | <0.0001 | 1.21 | 0.0005 | 30.62 | 0.00 |
| 100 | choppy | 3.97 | 3.84 | <0.0001 | 3.96 | <0.0001 | 1.11 | 0.1605 | 32.00 | 0.00 |
| 100 | stress_flash_crash | -2.41 | 2.60 | <0.0001 | 3.42 | <0.0001 | 0.71 | 0.2761 | 31.50 | 0.00 |
| 1000 | trending | 7.74 | 4.88 | <0.0001 | 4.78 | <0.0001 | 1.44 | 0.0770 | 33.90 | 0.00 |
| 1000 | mean_reverting | 2.10 | 4.02 | <0.0001 | 4.48 | <0.0001 | 1.14 | <0.0001 | 32.61 | 0.00 |
| 1000 | choppy | 4.51 | 4.11 | <0.0001 | 4.31 | <0.0001 | 1.21 | 0.1118 | 33.76 | 0.00 |
| 1000 | stress_flash_crash | -2.03 | 2.81 | <0.0001 | 3.73 | <0.0001 | 0.78 | 0.1991 | 33.01 | 0.00 |

##### Magnitude 0.009, O10-RT-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.07 | 2.57 | 0.0127 | 2.57 | 0.0132 | -0.05 | 0.9626 | 11.92 | 0.00 |
| 10 | mean_reverting | -0.44 | 2.36 | 0.0039 | 2.43 | 0.0029 | -0.47 | 0.6001 | 11.60 | 0.00 |
| 10 | choppy | 1.72 | 2.20 | 0.0458 | 2.16 | 0.0503 | -0.29 | 0.8060 | 12.65 | 0.00 |
| 10 | stress_flash_crash | -4.43 | 1.57 | 0.0700 | 1.70 | 0.0503 | -0.01 | 0.9903 | 13.09 | 0.00 |
| 100 | trending | 6.03 | 3.42 | <0.0001 | 3.41 | <0.0001 | 0.17 | 0.8280 | 18.30 | 0.00 |
| 100 | mean_reverting | 0.91 | 2.99 | <0.0001 | 3.38 | <0.0001 | 0.17 | 0.6050 | 17.82 | 0.00 |
| 100 | choppy | 2.94 | 2.82 | 0.0002 | 2.94 | 0.0002 | 0.09 | 0.9079 | 18.50 | 0.00 |
| 100 | stress_flash_crash | -3.01 | 2.00 | 0.0009 | 2.82 | <0.0001 | 0.11 | 0.8538 | 18.31 | 0.00 |
| 1000 | trending | 6.50 | 3.64 | <0.0001 | 3.54 | <0.0001 | 0.20 | 0.7998 | 19.95 | 0.00 |
| 1000 | mean_reverting | 1.12 | 3.04 | <0.0001 | 3.50 | <0.0001 | 0.15 | 0.2936 | 19.44 | 0.00 |
| 1000 | choppy | 3.48 | 3.08 | <0.0001 | 3.28 | <0.0001 | 0.18 | 0.8089 | 20.13 | 0.00 |
| 1000 | stress_flash_crash | -2.65 | 2.19 | 0.0001 | 3.12 | <0.0001 | 0.17 | 0.7722 | 19.78 | 0.00 |

##### Magnitude 0.009, RT-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 2.82 | 2.32 | 0.0229 | 2.32 | 0.0237 | -0.30 | 0.7750 | 10.06 | 0.00 |
| 10 | mean_reverting | -0.69 | 2.11 | 0.0095 | 2.18 | 0.0073 | -0.73 | 0.4191 | 9.43 | 0.00 |
| 10 | choppy | 1.49 | 1.98 | 0.0723 | 1.93 | 0.0790 | -0.52 | 0.6642 | 10.71 | 0.00 |
| 10 | stress_flash_crash | -4.58 | 1.43 | 0.0980 | 1.56 | 0.0717 | -0.16 | 0.8676 | 11.16 | 0.00 |
| 100 | trending | 6.11 | 3.50 | <0.0001 | 3.49 | <0.0001 | 0.25 | 0.7482 | 15.01 | 0.00 |
| 100 | mean_reverting | 0.96 | 3.04 | <0.0001 | 3.43 | <0.0001 | 0.22 | 0.4961 | 14.78 | 0.00 |
| 100 | choppy | 3.06 | 2.93 | <0.0001 | 3.05 | 0.0001 | 0.21 | 0.7863 | 15.22 | 0.00 |
| 100 | stress_flash_crash | -2.91 | 2.10 | 0.0005 | 2.92 | <0.0001 | 0.21 | 0.7314 | 15.34 | 0.00 |
| 1000 | trending | 6.77 | 3.91 | <0.0001 | 3.81 | <0.0001 | 0.46 | 0.5553 | 17.09 | 0.00 |
| 1000 | mean_reverting | 1.36 | 3.28 | <0.0001 | 3.74 | <0.0001 | 0.39 | 0.0072 | 16.93 | 0.00 |
| 1000 | choppy | 3.65 | 3.25 | <0.0001 | 3.45 | <0.0001 | 0.35 | 0.6359 | 17.31 | 0.00 |
| 1000 | stress_flash_crash | -2.52 | 2.32 | <0.0001 | 3.25 | <0.0001 | 0.30 | 0.6118 | 17.19 | 0.00 |

##### Magnitude 0.009, RTs3-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.51 | 5.01 | <0.0001 | 5.00 | <0.0001 | 2.39 | 0.0340 | 32.26 | 0.00 |
| 10 | mean_reverting | 1.87 | 4.67 | <0.0001 | 4.74 | <0.0001 | 1.83 | 0.0653 | 31.23 | 0.00 |
| 10 | choppy | 3.79 | 4.28 | 0.0005 | 4.24 | 0.0006 | 1.78 | 0.1680 | 31.97 | 0.00 |
| 10 | stress_flash_crash | -3.18 | 2.83 | 0.0039 | 2.95 | 0.0026 | 1.24 | 0.2337 | 32.57 | 0.00 |
| 100 | trending | 8.97 | 6.36 | <0.0001 | 6.35 | <0.0001 | 3.11 | 0.0003 | 37.91 | 0.00 |
| 100 | mean_reverting | 3.20 | 5.28 | <0.0001 | 5.67 | <0.0001 | 2.46 | <0.0001 | 36.93 | 0.00 |
| 100 | choppy | 5.41 | 5.28 | <0.0001 | 5.40 | <0.0001 | 2.55 | 0.0025 | 38.13 | 0.00 |
| 100 | stress_flash_crash | -1.43 | 3.58 | <0.0001 | 4.41 | <0.0001 | 1.70 | 0.0145 | 38.07 | 0.00 |
| 1000 | trending | 9.40 | 6.54 | <0.0001 | 6.44 | <0.0001 | 3.10 | 0.0003 | 39.04 | 0.00 |
| 1000 | mean_reverting | 3.49 | 5.41 | <0.0001 | 5.87 | <0.0001 | 2.53 | <0.0001 | 38.25 | 0.00 |
| 1000 | choppy | 5.91 | 5.51 | <0.0001 | 5.71 | <0.0001 | 2.61 | 0.0012 | 38.96 | 0.00 |
| 1000 | stress_flash_crash | -1.14 | 3.70 | <0.0001 | 4.63 | <0.0001 | 1.68 | 0.0092 | 38.74 | 0.00 |

##### Magnitude 0.009, RTs5-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.35 | 3.85 | 0.0004 | 3.84 | 0.0004 | 1.23 | 0.2573 | 20.51 | 0.00 |
| 10 | mean_reverting | 0.89 | 3.69 | <0.0001 | 3.76 | <0.0001 | 0.85 | 0.3641 | 20.14 | 0.00 |
| 10 | choppy | 2.94 | 3.43 | 0.0033 | 3.39 | 0.0038 | 0.93 | 0.4523 | 21.85 | 0.00 |
| 10 | stress_flash_crash | -3.64 | 2.37 | 0.0109 | 2.49 | 0.0074 | 0.78 | 0.4350 | 22.27 | 0.00 |
| 100 | trending | 7.83 | 5.22 | <0.0001 | 5.21 | <0.0001 | 1.97 | 0.0164 | 26.16 | 0.00 |
| 100 | mean_reverting | 2.40 | 4.48 | <0.0001 | 4.87 | <0.0001 | 1.66 | <0.0001 | 25.84 | 0.00 |
| 100 | choppy | 4.65 | 4.52 | <0.0001 | 4.64 | <0.0001 | 1.80 | 0.0257 | 26.98 | 0.00 |
| 100 | stress_flash_crash | -1.82 | 3.19 | <0.0001 | 4.02 | <0.0001 | 1.31 | 0.0480 | 26.79 | 0.00 |
| 1000 | trending | 8.44 | 5.58 | <0.0001 | 5.48 | <0.0001 | 2.14 | 0.0099 | 28.32 | 0.00 |
| 1000 | mean_reverting | 2.74 | 4.67 | <0.0001 | 5.13 | <0.0001 | 1.78 | <0.0001 | 27.75 | 0.00 |
| 1000 | choppy | 5.19 | 4.79 | <0.0001 | 4.99 | <0.0001 | 1.89 | 0.0148 | 28.39 | 0.00 |
| 1000 | stress_flash_crash | -1.45 | 3.39 | <0.0001 | 4.32 | <0.0001 | 1.37 | 0.0271 | 28.04 | 0.00 |

##### Magnitude 0.009, Omix-RTr-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.22 | 2.72 | 0.0093 | 2.71 | 0.0097 | 0.10 | 0.9276 | 29.34 | 1.47 |
| 10 | mean_reverting | 0.16 | 2.96 | 0.0012 | 3.03 | 0.0009 | 0.13 | 0.8953 | 29.72 | 1.45 |
| 10 | choppy | 2.07 | 2.56 | 0.0299 | 2.52 | 0.0329 | 0.06 | 0.9589 | 29.79 | 0.72 |
| 10 | stress_flash_crash | -4.41 | 1.60 | 0.0831 | 1.73 | 0.0616 | 0.02 | 0.9878 | 30.12 | 0.76 |
| 100 | trending | 7.75 | 5.14 | <0.0001 | 5.13 | <0.0001 | 1.89 | 0.0213 | 17.28 | 9.81 |
| 100 | mean_reverting | 2.31 | 4.39 | <0.0001 | 4.78 | <0.0001 | 1.56 | <0.0001 | 17.02 | 9.94 |
| 100 | choppy | 4.38 | 4.25 | <0.0001 | 4.37 | <0.0001 | 1.52 | 0.0567 | 17.67 | 9.78 |
| 100 | stress_flash_crash | -2.16 | 2.85 | <0.0001 | 3.68 | <0.0001 | 0.97 | 0.1422 | 18.23 | 11.50 |
| 1000 | trending | 8.14 | 5.28 | <0.0001 | 5.18 | <0.0001 | 1.84 | 0.0252 | 17.90 | 9.69 |
| 1000 | mean_reverting | 2.45 | 4.38 | <0.0001 | 4.83 | <0.0001 | 1.49 | <0.0001 | 17.53 | 9.73 |
| 1000 | choppy | 4.82 | 4.42 | <0.0001 | 4.62 | <0.0001 | 1.52 | 0.0507 | 18.12 | 9.82 |
| 1000 | stress_flash_crash | -1.86 | 2.98 | <0.0001 | 3.91 | <0.0001 | 0.96 | 0.1217 | 18.88 | 11.41 |

##### Magnitude 0.006, O3-RT-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.78 | 2.32 | 0.0031 | 2.38 | 0.0026 | 0.74 | 0.3509 | 32.13 | 0.00 |
| 10 | mean_reverting | -5.75 | 1.94 | 0.0002 | 2.08 | <0.0001 | 0.35 | 0.5359 | 32.37 | 0.00 |
| 10 | choppy | -3.92 | 1.91 | 0.0253 | 1.98 | 0.0202 | 0.74 | 0.4101 | 31.63 | 0.00 |
| 10 | stress_flash_crash | -9.62 | 0.88 | 0.1895 | 1.02 | 0.1275 | 0.45 | 0.5373 | 32.37 | 0.00 |
| 100 | trending | 0.51 | 2.97 | <0.0001 | 3.56 | <0.0001 | 0.95 | 0.1803 | 44.18 | 0.00 |
| 100 | mean_reverting | -4.32 | 2.28 | <0.0001 | 3.21 | <0.0001 | 0.63 | 0.0065 | 42.16 | 0.00 |
| 100 | choppy | -2.80 | 2.18 | 0.0010 | 2.94 | <0.0001 | 0.60 | 0.3715 | 43.67 | 0.00 |
| 100 | stress_flash_crash | -8.43 | 0.93 | 0.0738 | 2.24 | <0.0001 | 0.06 | 0.9040 | 43.61 | 0.00 |
| 1000 | trending | 0.84 | 3.12 | <0.0001 | 3.67 | <0.0001 | 0.97 | 0.1790 | 46.12 | 0.00 |
| 1000 | mean_reverting | -4.19 | 2.26 | <0.0001 | 3.31 | <0.0001 | 0.60 | <0.0001 | 44.45 | 0.00 |
| 1000 | choppy | -2.46 | 2.34 | 0.0003 | 3.18 | <0.0001 | 0.70 | 0.2902 | 46.03 | 0.00 |
| 1000 | stress_flash_crash | -8.24 | 1.03 | 0.0370 | 2.45 | <0.0001 | 0.13 | 0.8063 | 45.85 | 0.00 |

##### Magnitude 0.006, O5-RT-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.96 | 2.13 | 0.0070 | 2.19 | 0.0059 | 0.55 | 0.4909 | 22.97 | 0.00 |
| 10 | mean_reverting | -5.72 | 1.97 | 0.0002 | 2.11 | <0.0001 | 0.38 | 0.5010 | 22.32 | 0.00 |
| 10 | choppy | -4.18 | 1.64 | 0.0519 | 1.72 | 0.0423 | 0.48 | 0.5921 | 23.07 | 0.00 |
| 10 | stress_flash_crash | -9.70 | 0.80 | 0.2272 | 0.94 | 0.1549 | 0.37 | 0.6087 | 24.27 | 0.00 |
| 100 | trending | 0.43 | 2.90 | <0.0001 | 3.49 | <0.0001 | 0.88 | 0.2160 | 32.13 | 0.00 |
| 100 | mean_reverting | -4.37 | 2.23 | <0.0001 | 3.16 | <0.0001 | 0.59 | 0.0085 | 30.70 | 0.00 |
| 100 | choppy | -2.89 | 2.08 | 0.0012 | 2.85 | <0.0001 | 0.50 | 0.4409 | 31.97 | 0.00 |
| 100 | stress_flash_crash | -8.33 | 1.03 | 0.0413 | 2.34 | <0.0001 | 0.17 | 0.7495 | 31.63 | 0.00 |
| 1000 | trending | 0.74 | 3.02 | <0.0001 | 3.57 | <0.0001 | 0.87 | 0.2225 | 34.23 | 0.00 |
| 1000 | mean_reverting | -4.21 | 2.24 | <0.0001 | 3.29 | <0.0001 | 0.59 | <0.0001 | 32.72 | 0.00 |
| 1000 | choppy | -2.54 | 2.27 | 0.0003 | 3.11 | <0.0001 | 0.62 | 0.3369 | 33.84 | 0.00 |
| 1000 | stress_flash_crash | -8.11 | 1.16 | 0.0173 | 2.57 | <0.0001 | 0.25 | 0.6210 | 33.31 | 0.00 |

##### Magnitude 0.006, O10-RT-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.56 | 1.53 | 0.0470 | 1.59 | 0.0406 | -0.04 | 0.9582 | 12.40 | 0.00 |
| 10 | mean_reverting | -6.32 | 1.38 | 0.0037 | 1.51 | 0.0014 | -0.21 | 0.6867 | 11.51 | 0.00 |
| 10 | choppy | -4.67 | 1.15 | 0.1522 | 1.22 | 0.1276 | -0.01 | 0.9887 | 12.44 | 0.00 |
| 10 | stress_flash_crash | -9.81 | 0.69 | 0.2754 | 0.82 | 0.1878 | 0.26 | 0.7106 | 13.22 | 0.00 |
| 100 | trending | -0.34 | 2.12 | 0.0014 | 2.71 | 0.0001 | 0.10 | 0.8839 | 18.85 | 0.00 |
| 100 | mean_reverting | -4.88 | 1.72 | <0.0001 | 2.65 | <0.0001 | 0.08 | 0.7212 | 17.91 | 0.00 |
| 100 | choppy | -3.36 | 1.62 | 0.0084 | 2.38 | 0.0002 | 0.03 | 0.9557 | 18.91 | 0.00 |
| 100 | stress_flash_crash | -8.42 | 0.94 | 0.0504 | 2.25 | <0.0001 | 0.07 | 0.8811 | 18.76 | 0.00 |
| 1000 | trending | 0.01 | 2.28 | 0.0007 | 2.83 | <0.0001 | 0.13 | 0.8516 | 20.35 | 0.00 |
| 1000 | mean_reverting | -4.69 | 1.76 | <0.0001 | 2.81 | <0.0001 | 0.10 | 0.3606 | 19.61 | 0.00 |
| 1000 | choppy | -3.06 | 1.74 | 0.0040 | 2.59 | <0.0001 | 0.10 | 0.8766 | 20.28 | 0.00 |
| 1000 | stress_flash_crash | -8.25 | 1.02 | 0.0285 | 2.44 | <0.0001 | 0.12 | 0.8134 | 20.06 | 0.00 |

##### Magnitude 0.006, RT-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.74 | 1.35 | 0.0771 | 1.41 | 0.0669 | -0.22 | 0.7750 | 10.26 | 0.00 |
| 10 | mean_reverting | -6.42 | 1.27 | 0.0072 | 1.41 | 0.0030 | -0.32 | 0.5479 | 10.08 | 0.00 |
| 10 | choppy | -4.77 | 1.05 | 0.1899 | 1.12 | 0.1606 | -0.11 | 0.8942 | 10.68 | 0.00 |
| 10 | stress_flash_crash | -9.88 | 0.62 | 0.3178 | 0.76 | 0.2197 | 0.19 | 0.7789 | 11.23 | 0.00 |
| 100 | trending | -0.27 | 2.20 | 0.0010 | 2.78 | <0.0001 | 0.17 | 0.7999 | 15.34 | 0.00 |
| 100 | mean_reverting | -4.83 | 1.76 | <0.0001 | 2.70 | <0.0001 | 0.12 | 0.5716 | 14.94 | 0.00 |
| 100 | choppy | -3.31 | 1.67 | 0.0067 | 2.43 | 0.0002 | 0.09 | 0.8888 | 15.39 | 0.00 |
| 100 | stress_flash_crash | -8.36 | 0.99 | 0.0373 | 2.30 | <0.0001 | 0.13 | 0.7928 | 15.62 | 0.00 |
| 1000 | trending | 0.20 | 2.48 | 0.0002 | 3.03 | <0.0001 | 0.33 | 0.6344 | 17.50 | 0.00 |
| 1000 | mean_reverting | -4.50 | 1.95 | <0.0001 | 3.00 | <0.0001 | 0.30 | 0.0092 | 17.23 | 0.00 |
| 1000 | choppy | -2.91 | 1.89 | 0.0018 | 2.73 | <0.0001 | 0.24 | 0.6959 | 17.53 | 0.00 |
| 1000 | stress_flash_crash | -8.13 | 1.14 | 0.0146 | 2.55 | <0.0001 | 0.23 | 0.6368 | 17.54 | 0.00 |

##### Magnitude 0.006, RTs3-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.14 | 2.95 | 0.0004 | 3.01 | 0.0004 | 1.38 | 0.1020 | 32.96 | 0.00 |
| 10 | mean_reverting | -5.15 | 2.54 | <0.0001 | 2.68 | <0.0001 | 0.95 | 0.1072 | 32.35 | 0.00 |
| 10 | choppy | -3.59 | 2.24 | 0.0122 | 2.31 | 0.0096 | 1.07 | 0.2521 | 33.52 | 0.00 |
| 10 | stress_flash_crash | -9.51 | 0.99 | 0.1638 | 1.12 | 0.1112 | 0.56 | 0.4662 | 34.29 | 0.00 |
| 100 | trending | 1.38 | 3.85 | <0.0001 | 4.43 | <0.0001 | 1.82 | 0.0147 | 38.43 | 0.00 |
| 100 | mean_reverting | -3.73 | 2.87 | <0.0001 | 3.80 | <0.0001 | 1.22 | <0.0001 | 37.17 | 0.00 |
| 100 | choppy | -2.13 | 2.84 | <0.0001 | 3.61 | <0.0001 | 1.26 | 0.0648 | 38.42 | 0.00 |
| 100 | stress_flash_crash | -8.02 | 1.34 | 0.0129 | 2.65 | <0.0001 | 0.47 | 0.3922 | 38.74 | 0.00 |
| 1000 | trending | 1.70 | 3.97 | <0.0001 | 4.53 | <0.0001 | 1.82 | 0.0144 | 39.65 | 0.00 |
| 1000 | mean_reverting | -3.51 | 2.94 | <0.0001 | 3.99 | <0.0001 | 1.28 | <0.0001 | 38.69 | 0.00 |
| 1000 | choppy | -1.83 | 2.97 | <0.0001 | 3.82 | <0.0001 | 1.33 | 0.0511 | 39.47 | 0.00 |
| 1000 | stress_flash_crash | -7.88 | 1.39 | 0.0070 | 2.81 | <0.0001 | 0.49 | 0.3623 | 39.54 | 0.00 |

##### Magnitude 0.006, RTs5-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.78 | 2.31 | 0.0040 | 2.37 | 0.0034 | 0.74 | 0.3662 | 21.32 | 0.00 |
| 10 | mean_reverting | -5.59 | 2.10 | <0.0001 | 2.24 | <0.0001 | 0.51 | 0.3582 | 20.70 | 0.00 |
| 10 | choppy | -4.08 | 1.74 | 0.0373 | 1.81 | 0.0300 | 0.58 | 0.5151 | 21.52 | 0.00 |
| 10 | stress_flash_crash | -9.60 | 0.90 | 0.1733 | 1.03 | 0.1145 | 0.47 | 0.5164 | 22.55 | 0.00 |
| 100 | trending | 0.75 | 3.21 | <0.0001 | 3.80 | <0.0001 | 1.19 | 0.0948 | 26.67 | 0.00 |
| 100 | mean_reverting | -4.03 | 2.57 | <0.0001 | 3.50 | <0.0001 | 0.93 | <0.0001 | 26.27 | 0.00 |
| 100 | choppy | -2.44 | 2.54 | 0.0001 | 3.30 | <0.0001 | 0.96 | 0.1457 | 27.23 | 0.00 |
| 100 | stress_flash_crash | -7.93 | 1.43 | 0.0050 | 2.74 | <0.0001 | 0.56 | 0.2817 | 27.18 | 0.00 |
| 1000 | trending | 1.16 | 3.43 | <0.0001 | 3.98 | <0.0001 | 1.28 | 0.0740 | 28.81 | 0.00 |
| 1000 | mean_reverting | -3.76 | 2.69 | <0.0001 | 3.73 | <0.0001 | 1.03 | <0.0001 | 28.25 | 0.00 |
| 1000 | choppy | -2.10 | 2.70 | <0.0001 | 3.54 | <0.0001 | 1.05 | 0.1076 | 28.81 | 0.00 |
| 1000 | stress_flash_crash | -7.73 | 1.54 | 0.0019 | 2.95 | <0.0001 | 0.63 | 0.2168 | 28.65 | 0.00 |

##### Magnitude 0.006, Omix-RTr-c0.2-x4 per cell (exploratory)

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs Omix-RT-c0.2-x4 | Welch p vs Omix-RT-c0.2-x4 | moved % of start | recycled % of start |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.44 | 1.65 | 0.0355 | 1.71 | 0.0306 | 0.08 | 0.9216 | 29.43 | 1.55 |
| 10 | mean_reverting | -6.07 | 1.62 | 0.0024 | 1.76 | 0.0010 | 0.03 | 0.9556 | 30.72 | 1.42 |
| 10 | choppy | -4.62 | 1.20 | 0.1563 | 1.27 | 0.1324 | 0.04 | 0.9675 | 29.81 | 0.98 |
| 10 | stress_flash_crash | -10.08 | 0.42 | 0.5329 | 0.55 | 0.4037 | -0.01 | 0.9862 | 30.43 | 0.97 |
| 100 | trending | 0.67 | 3.14 | <0.0001 | 3.72 | <0.0001 | 1.11 | 0.1179 | 18.14 | 9.91 |
| 100 | mean_reverting | -4.13 | 2.46 | <0.0001 | 3.40 | <0.0001 | 0.82 | 0.0005 | 17.81 | 10.00 |
| 100 | choppy | -2.56 | 2.41 | 0.0002 | 3.17 | <0.0001 | 0.83 | 0.2079 | 18.38 | 10.01 |
| 100 | stress_flash_crash | -8.19 | 1.17 | 0.0224 | 2.48 | <0.0001 | 0.30 | 0.5666 | 18.88 | 11.42 |
| 1000 | trending | 0.99 | 3.26 | <0.0001 | 3.81 | <0.0001 | 1.11 | 0.1224 | 18.70 | 9.85 |
| 1000 | mean_reverting | -4.00 | 2.45 | <0.0001 | 3.50 | <0.0001 | 0.80 | <0.0001 | 18.18 | 9.96 |
| 1000 | choppy | -2.35 | 2.46 | 0.0001 | 3.30 | <0.0001 | 0.81 | 0.2187 | 18.83 | 10.12 |
| 1000 | stress_flash_crash | -8.08 | 1.19 | 0.0163 | 2.60 | <0.0001 | 0.28 | 0.5833 | 19.45 | 11.21 |
