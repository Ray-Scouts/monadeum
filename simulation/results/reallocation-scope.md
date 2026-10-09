# Reallocation alone, and reallocation scoped to one owner

Issue #89. `fixed-slot.md` (issue #85) found that arm B, fixed slots with mutant replacement and bounded reallocation, beats both a static population (Control 1) and random replacement (Control 2) at genome edge magnitude 0.009 and reallocation cap 0.2, and that most of that advantage appears to come from reallocation. This file asks two questions from `EVOLUTION.md` section 8.5:

1. Does reallocation alone, with no genome replacement, match arm B? If it does, replacement and its consent question can be dropped.
2. Does reallocation still beat both controls when it can only rank and move capital among one owner's agents, as `EVOLUTION.md` section 8.3 requires?

As with every result here, this tests mechanisms in the harness, not production. The issue #84 genome model, its optimum, and its magnitudes are assumptions. A positive result says that, given a genome that carries an edge of this size, the mechanism converts it into population return.

## Setup

Unchanged from `fixed-slot.md`: the issue #84 genome model with random founders and hidden skill 0, populations 10, 100, and 1,000, the four regimes, seeds 1 to 50 in every cell including population 1,000, 300 ticks, risk tolerance 0.25, execution every tick, diversity on, x402 $0.01, information purchases on, and the `decide` rule in `src/rerun.ts` with a two-sided Welch test. An arm outperforms a control only if at least 7 of 12 cells have the arm's mean ROI higher with p below 0.05 and the median gap is positive; fewer than 6 cells with p below 0.05 in either direction is inconclusive. The stress regime is reported on its own. Paired t-tests on per-seed differences are secondary observations only and are not used for any call.

Magnitude 0.009, where arm B passed, is the primary run, with every arm. Magnitude 0.006 was run for a subset of arms, because runtime allowed it.

Control 1 (C1), Control 2 (C2), and arm B (`B-c0.2-x2`, `B-c0.2-x4`) are not re-run: their per-cell JSON is read from `results/fixed-slot/`. That is valid because the code with every new option unset reproduces those files exactly (see "Equivalence" below), and every arm shares founders, market path, and information draws on a seed.

### Arms

Reallocation is always the issue #85 rule at cap 0.2 (each source offers 20 percent of its capital, never below the 0.06 floor), at per-slot ceilings of 2 and 4 times principal, named `-x2` and `-x4`. Each new arm is compared with arm B at the same ceiling.

| arm | replacement on a starvation trigger | reallocation pool | run at |
|---|---|---|---|
| `N` (diagnostic) | none: the slot keeps its genome and keeps trading | none | 0.009, 0.006 |
| `RO-c0.2-x<c>` (reallocation only) | none: the slot keeps its genome and keeps trading | population-wide, as in issue #85 | 0.009, 0.006 |
| `O<k>-N-c0.2-x<c>` | none: the slot keeps its genome and keeps trading | each owner's slots | 0.009 (x2, x4), 0.006 (x4) |
| `O<k>-Mo-c0.2-x<c>` | mutant of a donor from the same owner | each owner's slots | 0.009 (x2, x4) |
| `O<k>-Mp-c0.2-x<c>` | mutant of a donor from the whole population, as in arm B | each owner's slots | 0.009 (x2, x4), 0.006 (x4) |
| `RT-c0.2-x4` (diagnostic, added later) | none: the slot retires as in Control 1, and its capital stays in it, idle | population-wide | 0.009, 0.006 |
| `O<k>-RT-c0.2-x4` (diagnostic, added later) | as `RT` | each owner's slots | 0.009, 0.006 |

`k` is 3, 5, 10, or `mix`. The issue specifies reallocation only as "a bottom-of-niche slot keeps its genome", which is what `RO` and `O<k>-N` do. `N` was added with the first batch to separate the effect of not retiring a starved slot from the effect of reallocation. The `RT` arms were added after the first batch had been read, because `N` showed that a starved slot that keeps trading costs about 1.1 pp against Control 1, and the product already has a non-replacing way to stop such a slot: section 6 retirement, which never seizes capital. `RT` is therefore a diagnostic chosen after seeing data, not a pre-registered arm, and its results are reported as such.

### Owners

Owners hold consecutive slots in index order. Founders are drawn independently, so the assignment is random with respect to genome.

- **`k` = 3, 5, 10:** every owner holds `k` slots; when `k` does not divide the population, one last owner holds the remainder (at population 10, `k` = 3 gives owners of 3, 3, 3, and 1).
- **`mix` (assumption):** owner sizes repeat the cycle 1, 1, 1, 2, 2, 3, 5, 10, 25 (9 owners, 50 slots), cut short at the population (population 10 gives 1, 1, 1, 2, 2, 3). Two thirds of owners hold 3 or fewer agents and half of all slots belong to owners of 25. This is an assumed shape, a few heavy users and many light ones, not a measured distribution: no usage data exists yet. Owners of one slot can never reallocate.

What is scoped and what is not:

- **Scoped:** which slots are ranked against each other for reallocation, and which slots capital moves between. No capital ever leaves an owner.
- **Not scoped:** fitness, the population median used by shrinkage, niche membership, and the section 6 starvation trigger are computed population-wide, as before. Reading other agents' public performance moves no capital, so section 8.3 does not restrict it. This is a modeling choice stated here, not a product decision.

### Small-pool ranking rule

A decile does not exist in a pool of 3 or 5. In an owner pool, among the active slots that have a fitness:

- 0 or 1 ranked slots: no reallocation.
- 2 to 19 ranked slots: the bottom one is the source and the top one is the sink.
- 20 or more: the bottom and top decile, as in issue #85.

This is `reallocationQuota(ranked, true)` in `src/reallocation.ts`, tested on its own (`test/reallocation-scope.test.ts`) and in the runner (an owner of 2 moves capital; an owner of 1 and a population-wide pool of 3 move none). The population-wide rule is unchanged: the bottom and top decile, and nothing below 10 ranked slots. The two rules agree from 10 ranked slots up, so `k` = 10 is the one owner size where the share of slots that give and take capital matches the population-wide rule.

The rule has a consequence that shapes every result below: in a pool of 3, one slot in three is a source at every evaluation, against one in ten population-wide. Owner-scoped arms at `k` = 3 and 5 therefore move two to three times as much capital as arm B. Their results measure a more aggressive reallocation as much as a narrower pool. The `k` = 10 arms isolate scope.

### Donor scope

Whether a genome may be copied across owners is open (section 8.3), so both were run. `Mo` draws the donor uniformly from eligible slots of the same owner, under the unchanged section 3.1 and section 5 eligibility gates; if the owner has no eligible slot, the trigger is counted under "no donor" and the slot keeps its genome. `Mp` draws from every eligible slot, as arm B does. At `k` = 3, `Mo` finds no donor on 36 to 41 percent of triggers at population 1,000.

### Capital conservation and the owner boundary

`test/reallocation-scope.test.ts` adds, for every owner-scoped arm in a trending and a stress run at population 100: total capital changes only by trading flows (to 1e-6); for every slot, end capital equals principal plus that slot's own trading flows plus its net reallocation (to 1e-9); and every owner's net reallocation is zero (to 1e-9). Together these say each owner ends with exactly its principal plus its own slots' trading results, so no capital crossed an owner boundary. The same checks repeat with every cost and edge at zero, the tests require that capital actually moved, and a separate test checks that `Mo` donors always share the recipient's owner while `Mp` donors sometimes do not. The issue #85 conservation tests in `test/slots.test.ts` iterate over every arm in the registry, so they cover the new arms too.

### Equivalence

With `refill: "none" | "retire"`, `owners`, and `donorScope` unset, the code reproduces issue #85 field for field. All 9 issue #85 arms (C1, C2, A, the four B arms, R, and S3) were regenerated at magnitude 0.009 in every population and regime, 108 cell files with 50 seeds each, and compared with `results/fixed-slot/`: all 87,276 leaf fields (per-seed ROI, replacements, no-donor events, capital moved, reproductions, end population, the 6-point distance trace, and the niche statistics) are identical, and the 108 files are byte-identical. Magnitude 0.006 was not regenerated; the code paths it uses are the same. `test/reallocation-scope.test.ts` repeats the check for one cell (B-c0.2-x4, 0.009, population 10, choppy, 50 seeds) on every test run, and checks that one owner holding all 100 slots reproduces the population-wide run.

## Summary

Per arm, the call against Control 1, Control 2, and arm B at the same ceiling. "cells" counts cells with Welch p below 0.05, split by the direction of the gap. "stress" is the call on the 3 stress cells alone. "moved" is total capital moved by reallocation over the run as a percent of starting capital, mean of the 12 cells. Arm B's own rows are from `fixed-slot.md`.

### Magnitude 0.009

| arm | vs C1: cells, median gap, call | vs C2: cells, median gap, call | vs arm B: cells, median gap, call | stress vs C1 / C2 / B | moved % |
|---|---|---|---|---|---:|
| B-c0.2-x2 | 10 (10 up), 2.31, **outperforms** | 11 (11 up), 2.46, **outperforms** | n/a | inconclusive / outperforms / n/a | 10.6 |
| B-c0.2-x4 | 11 (11 up), 2.64, **outperforms** | 12 (12 up), 2.75, **outperforms** | n/a | outperforms / outperforms / n/a | 14.1 |
| N | 4 (4 down), -1.13, inconclusive | 3 (3 down), -0.77, inconclusive | 12 (12 down), -3.32, underperforms | underperforms / inconclusive / underperforms | 0 |
| RO-c0.2-x2 | 5 (5 up), 1.23, inconclusive | 3 (3 up), 1.30, inconclusive | 4 (4 down), -1.09, inconclusive | inconclusive / inconclusive / inconclusive | 9.4 |
| RO-c0.2-x4 | 7 (7 up), 1.42, **outperforms** | 10 (10 up), 1.55, **outperforms** | 5 (5 down), -1.14, inconclusive | inconclusive / outperforms / inconclusive | 11.3 |
| O3-N-c0.2-x2 | 10 (10 up), 2.43, **outperforms** | 12 (12 up), 2.56, **outperforms** | 1 (1 down), -0.13, inconclusive | inconclusive / outperforms / inconclusive | 29.6 |
| O3-N-c0.2-x4 | 10 (10 up), 2.63, **outperforms** | 12 (12 up), 2.75, **outperforms** | 1 (1 down), -0.18, inconclusive | inconclusive / outperforms / inconclusive | 33.0 |
| O5-N-c0.2-x2 | 10 (10 up), 1.98, **outperforms** | 12 (12 up), 2.07, **outperforms** | 2 (2 down), -0.55, inconclusive | inconclusive / outperforms / inconclusive | 18.3 |
| O5-N-c0.2-x4 | 10 (10 up), 2.19, **outperforms** | 12 (12 up), 2.33, **outperforms** | 2 (2 down), -0.57, inconclusive | inconclusive / outperforms / inconclusive | 21.7 |
| O10-N-c0.2-x2 | 3 (3 up), 0.97, inconclusive | 3 (3 up), 0.99, inconclusive | 6 (6 down), -1.39, mixed | inconclusive / inconclusive / inconclusive | 9.0 |
| O10-N-c0.2-x4 | 5 (5 up), 1.23, inconclusive | 4 (4 up), 1.22, inconclusive | 6 (6 down), -1.42, mixed | inconclusive / inconclusive / inconclusive | 11.4 |
| Omix-N-c0.2-x2 | 5 (5 up), 1.10, inconclusive | 5 (5 up), 1.09, inconclusive | 5 (5 down), -1.31, inconclusive | inconclusive / inconclusive / inconclusive | 18.0 |
| Omix-N-c0.2-x4 | 7 (7 up), 1.29, **outperforms** | 5 (5 up), 1.30, inconclusive | 6 (6 down), -1.36, mixed | inconclusive / inconclusive / inconclusive | 19.9 |
| O3-Mo-c0.2-x2 | 12 (12 up), 2.88, **outperforms** | 12 (12 up), 3.01, **outperforms** | 0, 0.35, inconclusive | outperforms / outperforms / inconclusive | 31.0 |
| O3-Mo-c0.2-x4 | 12 (12 up), 3.18, **outperforms** | 12 (12 up), 3.30, **outperforms** | 0, 0.33, inconclusive | outperforms / outperforms / inconclusive | 36.7 |
| O5-Mo-c0.2-x2 | 10 (10 up), 2.71, **outperforms** | 12 (12 up), 2.88, **outperforms** | 0, 0.21, inconclusive | inconclusive / outperforms / inconclusive | 19.4 |
| O5-Mo-c0.2-x4 | 12 (12 up), 3.10, **outperforms** | 12 (12 up), 3.32, **outperforms** | 0, 0.35, inconclusive | outperforms / outperforms / inconclusive | 25.7 |
| O10-Mo-c0.2-x2 | 9 (9 up), 2.11, **outperforms** | 11 (11 up), 2.32, **outperforms** | 1 (1 down), -0.28, inconclusive | inconclusive / outperforms / inconclusive | 9.9 |
| O10-Mo-c0.2-x4 | 9 (9 up), 2.54, **outperforms** | 12 (12 up), 2.71, **outperforms** | 1 (1 down), -0.15, inconclusive | inconclusive / outperforms / inconclusive | 15.0 |
| Omix-Mo-c0.2-x2 | 9 (9 up), 1.87, **outperforms** | 11 (11 up), 2.06, **outperforms** | 2 (2 down), -0.59, inconclusive | inconclusive / outperforms / inconclusive | 18.8 |
| Omix-Mo-c0.2-x4 | 9 (9 up), 2.19, **outperforms** | 11 (11 up), 2.37, **outperforms** | 2 (2 down), -0.51, inconclusive | inconclusive / outperforms / inconclusive | 22.7 |
| O3-Mp-c0.2-x2 | 12 (12 up), 3.21, **outperforms** | 12 (12 up), 3.43, **outperforms** | 2 (2 up), 0.78, inconclusive | outperforms / outperforms / inconclusive | 32.2 |
| O3-Mp-c0.2-x4 | 12 (12 up), 3.48, **outperforms** | 12 (12 up), 3.74, **outperforms** | 1 (1 up), 0.77, inconclusive | outperforms / outperforms / inconclusive | 37.9 |
| O5-Mp-c0.2-x2 | 12 (12 up), 2.87, **outperforms** | 12 (12 up), 3.08, **outperforms** | 1 (1 up), 0.45, inconclusive | outperforms / outperforms / inconclusive | 20.0 |
| O5-Mp-c0.2-x4 | 12 (12 up), 3.29, **outperforms** | 12 (12 up), 3.54, **outperforms** | 1 (1 up), 0.57, inconclusive | outperforms / outperforms / inconclusive | 26.0 |
| O10-Mp-c0.2-x2 | 9 (9 up), 2.12, **outperforms** | 11 (11 up), 2.37, **outperforms** | 0, -0.24, inconclusive | inconclusive / outperforms / inconclusive | 10.2 |
| O10-Mp-c0.2-x4 | 9 (9 up), 2.56, **outperforms** | 12 (12 up), 2.75, **outperforms** | 0, -0.12, inconclusive | inconclusive / outperforms / inconclusive | 15.1 |
| Omix-Mp-c0.2-x2 | 9 (9 up), 2.18, **outperforms** | 11 (11 up), 2.37, **outperforms** | 1 (1 down), -0.29, inconclusive | inconclusive / outperforms / inconclusive | 19.6 |
| Omix-Mp-c0.2-x4 | 9 (9 up), 2.39, **outperforms** | 11 (11 up), 2.67, **outperforms** | 1 (1 down), -0.25, inconclusive | inconclusive / outperforms / inconclusive | 23.4 |
| RT-c0.2-x4 (diagnostic) | 11 (11 up), 2.66, **outperforms** | 12 (12 up), 3.15, **outperforms** | 1 (1 up), 0.06, inconclusive | outperforms / outperforms / inconclusive | 14.0 |
| O3-RT-c0.2-x4 (diagnostic) | 12 (12 up), 4.05, **outperforms** | 12 (12 up), 4.28, **outperforms** | 4 (4 up), 1.35, inconclusive | outperforms / outperforms / outperforms | 40.4 |
| O5-RT-c0.2-x4 (diagnostic) | 12 (12 up), 3.92, **outperforms** | 12 (12 up), 4.07, **outperforms** | 4 (4 up), 1.18, inconclusive | outperforms / outperforms / outperforms | 29.0 |
| O10-RT-c0.2-x4 (diagnostic) | 12 (12 up), 2.75, **outperforms** | 12 (12 up), 3.07, **outperforms** | 0, 0.15, inconclusive | outperforms / outperforms / inconclusive | 16.6 |
| Omix-RT-c0.2-x4 (diagnostic) | 11 (11 up), 2.77, **outperforms** | 12 (12 up), 2.97, **outperforms** | 0, 0.06, inconclusive | outperforms / outperforms / inconclusive | 23.2 |

Owner scope against population-wide ranking with the same replacement setting and ceiling, magnitude 0.009 (for `Mp` the population-wide counterpart is arm B itself, in the table above):

| arm | counterpart | cells p < 0.05 | median gap pp | call |
|---|---|---|---:|---|
| O3-N-c0.2-x4 | RO-c0.2-x4 | 2 (2 up) | 1.24 | inconclusive |
| O5-N-c0.2-x4 | RO-c0.2-x4 | 2 (2 up) | 0.77 | inconclusive |
| O10-N-c0.2-x4 | RO-c0.2-x4 | 1 (1 down) | -0.28 | inconclusive |
| Omix-N-c0.2-x4 | RO-c0.2-x4 | 1 (1 down) | -0.23 | inconclusive |
| O3-RT-c0.2-x4 | RT-c0.2-x4 | 2 (2 up) | 1.14 | inconclusive |
| O5-RT-c0.2-x4 | RT-c0.2-x4 | 2 (2 up) | 0.98 | inconclusive |
| O10-RT-c0.2-x4 | RT-c0.2-x4 | 0 | -0.03 | inconclusive |
| Omix-RT-c0.2-x4 | RT-c0.2-x4 | 1 (1 down) | -0.17 | inconclusive |

The ceiling-2 rows of this comparison are in the report below and agree in direction.

### Magnitude 0.006

A subset of arms, ceiling 4 except `RO-c0.2-x2`. Arm B's rows are from `fixed-slot.md`.

| arm | vs C1: cells, median gap, call | vs C2: cells, median gap, call | vs arm B: cells, median gap, call | stress vs C1 / C2 / B | moved % |
|---|---|---|---|---|---:|
| B-c0.2-x2 | 5 (5 up), 0.67, inconclusive | 7 (7 up), 1.40, **outperforms** | n/a | inconclusive / inconclusive / n/a | 11.2 |
| B-c0.2-x4 | 5 (5 up), 0.80, inconclusive | 7 (7 up), 1.52, **outperforms** | n/a | inconclusive / inconclusive / n/a | 13.9 |
| N | 6 (6 down), -1.17, mixed | 2 (2 down), -0.32, inconclusive | 9 (9 down), -1.77, underperforms | underperforms / inconclusive / underperforms | 0 |
| RO-c0.2-x2 | 2 (1 up, 1 down), 0.34, inconclusive | 3 (3 up), 0.88, inconclusive | 2 (2 down), -0.35, inconclusive | inconclusive / inconclusive / inconclusive | 10.4 |
| RO-c0.2-x4 | 1 (1 up), 0.43, inconclusive | 3 (3 up), 0.95, inconclusive | 2 (2 down), -0.38, inconclusive | inconclusive / inconclusive / inconclusive | 11.7 |
| O3-N-c0.2-x4 | 7 (7 up), 0.88, **outperforms** | 9 (9 up), 1.51, **outperforms** | 1 (1 down), -0.05, inconclusive | inconclusive / inconclusive / inconclusive | 33.7 |
| O5-N-c0.2-x4 | 4 (4 up), 0.75, inconclusive | 9 (9 up), 1.29, **outperforms** | 2 (2 down), -0.19, inconclusive | inconclusive / inconclusive / inconclusive | 22.3 |
| O10-N-c0.2-x4 | 2 (1 up, 1 down), 0.21, inconclusive | 3 (3 up), 0.80, inconclusive | 3 (3 down), -0.55, inconclusive | inconclusive / inconclusive / inconclusive | 11.8 |
| Omix-N-c0.2-x4 | 2 (1 up, 1 down), 0.25, inconclusive | 4 (4 up), 0.79, inconclusive | 2 (2 down), -0.54, inconclusive | inconclusive / inconclusive / inconclusive | 20.5 |
| O3-Mp-c0.2-x4 | 7 (7 up), 1.17, **outperforms** | 9 (9 up), 1.91, **outperforms** | 1 (1 up), 0.37, inconclusive | inconclusive / inconclusive / inconclusive | 38.0 |
| O5-Mp-c0.2-x4 | 7 (7 up), 1.10, **outperforms** | 9 (9 up), 1.86, **outperforms** | 0, 0.29, inconclusive | inconclusive / inconclusive / inconclusive | 26.2 |
| O10-Mp-c0.2-x4 | 5 (5 up), 0.73, inconclusive | 7 (7 up), 1.45, **outperforms** | 0, -0.10, inconclusive | inconclusive / inconclusive / inconclusive | 15.0 |
| Omix-Mp-c0.2-x4 | 5 (5 up), 0.63, inconclusive | 8 (8 up), 1.40, **outperforms** | 1 (1 down), -0.19, inconclusive | inconclusive / inconclusive / inconclusive | 23.6 |
| RT-c0.2-x4 (diagnostic) | 9 (9 up), 1.55, **outperforms** | 9 (9 up), 2.48, **outperforms** | 4 (4 up), 0.84, inconclusive | outperforms / outperforms / outperforms | 14.4 |
| O3-RT-c0.2-x4 (diagnostic) | 11 (11 up), 2.18, **outperforms** | 12 (12 up), 2.76, **outperforms** | 6 (6 up), 1.43, mixed | outperforms / outperforms / outperforms | 40.7 |
| O5-RT-c0.2-x4 (diagnostic) | 11 (11 up), 2.21, **outperforms** | 12 (12 up), 2.78, **outperforms** | 6 (6 up), 1.39, mixed | outperforms / outperforms / outperforms | 29.5 |
| O10-RT-c0.2-x4 (diagnostic) | 9 (9 up), 1.63, **outperforms** | 10 (10 up), 2.41, **outperforms** | 4 (4 up), 0.74, inconclusive | outperforms / outperforms / outperforms | 17.0 |
| Omix-RT-c0.2-x4 (diagnostic) | 9 (9 up), 1.62, **outperforms** | 10 (10 up), 2.33, **outperforms** | 4 (4 up), 0.67, inconclusive | inconclusive / outperforms / outperforms | 23.7 |

Owner scope against the population-wide counterpart at 0.006: `O3-N` +0.57, `O5-N` +0.35, `O10-N` -0.17, `Omix-N` -0.17 pp against `RO-c0.2-x4`; `O3-RT` +0.52, `O5-RT` +0.48, `O10-RT` -0.03, `Omix-RT` -0.15 pp against `RT-c0.2-x4`; at most 2 cells significant in any comparison, every call inconclusive.

### Capital moved, genome distance, and diversity

Population 1,000, trending regime, magnitude 0.009, means over 50 seeds. "distance" is the capital-weighted genome distance from the regime optimum over active slots. For the `RT` arms, retired slots are excluded from that average, so part of their lower distance is the exclusion of the worst genomes, not a change in any genome. Arm B and the controls are from `fixed-slot.md`.

| arm | replacements per run | no donor per run | moved % of start | distance t0 | distance t300 | effective niches t300 | top niche share % |
|---|---:|---:|---:|---:|---:|---:|---:|
| C1 | 0 | 0 | 0 | 0.433 | 0.349 | 6.25 | 32.9 |
| B-c0.2-x4 | 397 | 0 | 16.4 | 0.433 | 0.286 | 5.98 | 33.3 |
| N | 0 | 0 | 0 | 0.433 | 0.413 | 6.24 | 32.9 |
| RO-c0.2-x4 | 0 | 0 | 10.8 | 0.433 | 0.348 | 6.12 | 32.8 |
| O3-N-c0.2-x4 | 0 | 0 | 33.4 | 0.433 | 0.324 | 6.06 | 32.5 |
| O5-N-c0.2-x4 | 0 | 0 | 21.0 | 0.433 | 0.333 | 6.08 | 32.7 |
| O10-N-c0.2-x4 | 0 | 0 | 10.9 | 0.433 | 0.357 | 6.14 | 32.8 |
| Omix-N-c0.2-x4 | 0 | 0 | 14.6 | 0.433 | 0.355 | 6.15 | 32.7 |
| O3-Mo-c0.2-x4 | 318 | 182 | 39.6 | 0.433 | 0.308 | 6.00 | 32.6 |
| O10-Mo-c0.2-x4 | 391 | 4 | 17.4 | 0.433 | 0.295 | 6.02 | 33.1 |
| O3-Mp-c0.2-x4 | 392 | 0 | 42.0 | 0.433 | 0.294 | 5.94 | 32.7 |
| O10-Mp-c0.2-x4 | 394 | 0 | 17.5 | 0.433 | 0.292 | 6.01 | 33.2 |
| Omix-Mp-c0.2-x4 | 399 | 0 | 20.6 | 0.433 | 0.302 | 6.03 | 33.0 |
| RT-c0.2-x4 | 0 | 0 | 17.0 | 0.433 | 0.273 | 5.92 | 33.4 |
| O3-RT-c0.2-x4 | 0 | 0 | 45.9 | 0.433 | 0.291 | 5.91 | 33.0 |
| O10-RT-c0.2-x4 | 0 | 0 | 19.9 | 0.433 | 0.279 | 5.92 | 33.3 |
| Omix-RT-c0.2-x4 | 0 | 0 | 20.3 | 0.433 | 0.295 | 6.02 | 33.1 |

The distance over time for every arm, averaged over the 12 cells, is in the report below. No arm collapsed into a monoculture: at population 1,000 the effective number of niches stays between 5.85 and 6.25 in every arm, and the largest niche holds 32.5 to 33.5 percent of active capital. The more capital an arm moves, the slightly lower its niche diversity, as in issue #85.

## What the result says

**Does reallocation alone match arm B? Not as specified.** With no replacement, a starved slot keeps its genome and keeps trading. Population-wide (`RO`), that arm beats both controls at ceiling 4 (7 and 10 of 12 cells, median gap 1.4 and 1.6 pp) but not at ceiling 2, and it sits below arm B by a median 1.1 pp at both ceilings, with every significant cell lower (4 and 5 cells). The call against arm B is inconclusive, which is not the same as a match: the direction is consistently against reallocation alone. At magnitude 0.006 it is inconclusive against everything. The `N` diagnostic shows where the gap comes from: fixed slots with neither replacement nor reallocation sit a median 1.1 pp below Control 1, significantly so in 4 cells including 2 stress cells. A static run retires a starved agent; a slot that is neither retired nor replaced keeps trading a genome that has been in the bottom decile of its niche for three evaluations, and that costs about as much as reallocation gains.

**What replacement was actually buying.** The `RT` diagnostic keeps reallocation and replaces nothing, but retires a starved slot as Control 1 does, leaving its capital idle in its own account. Population-wide, it beats both controls (11 and 12 of 12 cells, median gap 2.7 and 3.2 pp, stress passing on its own against both) and is indistinguishable from arm B (1 cell with p below 0.05, arm `RT` higher; median gap 0.06 pp). At magnitude 0.006, where arm B does not pass against Control 1, `RT` does: 9 of 12 cells higher than each control, stress passing against both, and 0.84 pp above arm B (4 cells significant, all `RT` higher; inconclusive). In this model, then, the value of replacement in arm B is almost entirely that it stops a failing genome from trading, and section 6 retirement does that without copying anyone's genome. Because `RT` was chosen after the first batch was read, this is a strong, consistent observation, not a pre-registered result, and it should be confirmed as a pre-registered arm before it is relied on.

**Owner-scoped reallocation, by owner size.** With mutant replacement (`Mo` or `Mp`) or with retirement (`RT`), owner-scoped reallocation beats both controls at every owner size tested, 3, 5, 10, and the mixed distribution, at both ceilings, with no cell significantly below either control. Against arm B every such arm is inconclusive, with a median gap between -0.6 and +1.4 pp. With no replacement and no retirement (`O<k>-N`), it beats both controls only at `k` = 3 and 5; at `k` = 10 and with the mixed distribution it does not (inconclusive against Control 2 in both, and against Control 1 except mix at ceiling 4).

**Scope itself costs little; the small-pool rule adds aggressiveness.** At `k` = 10, the one size where the small-pool rule equals the population-wide decile rule, owner scope against population-wide ranking with the same replacement setting gives median gaps of -0.28 pp (`N`), -0.03 pp (`RT`), and -0.12 pp (`Mp` against arm B), with at most one significant cell in any comparison. The mixed distribution behaves the same way. Owner pools of 3 and 5 do better than population-wide ranking (median +0.8 to +1.2 pp, 2 cells significant), but they also move two to three times as much capital (21 to 46 percent of starting capital at population 1,000 trending, against 11 to 17 percent), because the small-pool rule makes a third or a fifth of each owner's slots a source at every evaluation. That is a more aggressive reallocation policy, not a benefit of a smaller pool, and the run does not separate the two. A population-wide arm with a larger source and sink share would; it was not run.

**Donor scope.** Drawing the donor within the owner (`Mo`) instead of population-wide (`Mp`) lowers the median gap against Control 1 by 0.02 to 0.33 pp, least at `k` = 10, and at `k` = 3 leaves 36 to 41 percent of starvation triggers at population 1,000 without a donor. Neither scope changes any call, and with `RT` available, neither is needed.

**Magnitude 0.006.** The same pattern at the smaller edge, where arm B itself passes only against Control 2. Reallocation with failing slots left trading (`RO`) is inconclusive against both controls. Every `RT` arm, population-wide and owner-scoped at every size, beats both controls (9 to 12 of 12 cells) and is at or above arm B (median 0.67 to 1.43 pp; mixed at `k` = 3 and 5 with 6 cells higher, inconclusive otherwise). Owner-scoped `Mp` passes both controls at `k` = 3 and 5 and only Control 2 at `k` = 10 and mix; owner-scoped `N` passes both only at `k` = 3. At this edge size, then, retirement rather than replacement is the only setting that passes both controls at every owner size.

**Paired tests (secondary).** Every arm shares the market path and founders on a seed, so paired p-values are small almost everywhere and are reported per cell only in the report below. They show direction, not significance under the rule, and no call above uses them.

## What this decides (issue #89)

The issue's two questions, answered plainly:

1. **Does reallocation alone match arm B?** No, if "alone" means a failing slot keeps trading: it is about 1.1 pp below arm B and passes both controls only at ceiling 4. Yes, in this model, if a failing slot is retired under section 6 instead of replaced: that diagnostic matches arm B at 0.009, beats both controls at 0.009 and 0.006, and at 0.006 sits 0.84 pp above arm B. Under "What this decides" in the issue, the first outcome then holds in its useful form: **genome replacement can be dropped from the candidate, provided starvation retires the slot**, which removes the genome consent question. This is a recommendation resting on a diagnostic arm, not a settled decision.
2. **At which owner size does owner-scoped reallocation still beat both controls?** At magnitude 0.009, at every size tested, 3, 5, 10, and the assumed mixed distribution, when starvation either retires or replaces the slot. Without either, only at 3 and 5, and there only through the more aggressive small-pool rule. At 0.006, only the retirement setting passes at every size. The second outcome of the issue therefore holds: **the candidate is shippable within section 8.3's ownership constraint in this model**, and the product needs a per-owner pool with an owner-approved policy. Owners with a single agent get no benefit from reallocation at all.

For issue #28 this narrows the candidate mechanism to fixed slots with owner-scoped bounded reallocation and section 6 retirement of starved agents, with no genome copying. In this model that candidate passes at both validated edge sizes, 0.006 and 0.009, where arm B passed only at 0.009, but whether real genomes carry an edge of either size (section 7) remains the gating unknown.

## Commands

From `simulation/`, after `bun run test` (which builds `dist/`). `run-scope.zsh` is this loop, writing to `results/reallocation-scope/` and skipping files that already exist:

```bash
# MAG and ARMS per batch; 10 jobs in parallel, population 1,000 first
for pop in 1000 100 10; do for arm in $ARMS; do for regime in trending mean_reverting choppy stress_flash_crash; do
  echo "$arm $MAG $pop $regime"
done; done; done | xargs -P 10 -L 1 zsh -c \
  'ARM=$0 MAG=$1 POPS=$2 REGIMES=$3 SEEDS=50 OUT=results/reallocation-scope/$0-m$1-$2-$3.json node dist/src/cli-slots.js'

node dist/src/cli-scope-report.js results/reallocation-scope results/fixed-slot
```

| batch | arms | jobs | wall seconds |
|---|---|---:|---:|
| magnitude 0.009 | `N`, `RO` x2 and x4, `O<k>-{N,Mo,Mp}` x2 and x4 for `k` in 3, 5, 10, mix | 324 | 3,102 |
| magnitude 0.006 | `N`, `RO` x2 and x4, `O<k>-N-c0.2-x4`, `O<k>-Mp-c0.2-x4` | 132 | 1,200 |
| magnitude 0.009, diagnostic | `RT-c0.2-x4`, `O<k>-RT-c0.2-x4` | 60 | 305 |
| magnitude 0.006, diagnostic | `RT-c0.2-x4`, `O<k>-RT-c0.2-x4` | 60 | 325 |
| equivalence | every issue #85 arm at magnitude 0.009, into a scratch directory, compared with `results/fixed-slot/` | 108 | 1,187 |

On a laptop with 11 cores. No seeds were reduced anywhere. The per-cell JSON outputs, with per-seed ROI, replacements, "no donor" events, capital moved, distance trace, and niche statistics, are in `results/reallocation-scope/`.

## Limitations

- Everything rests on the issue #84 model and its 0.009 magnitude assumption, as in `fixed-slot.md`. The optimum does not move within a run.
- The `RT` arms were added after the first batch had been read. Their result is large and consistent across all 12 cells, but it is a post hoc diagnostic.
- At `k` = 3 and 5 the small-pool rule confounds pool size with reallocation intensity. A population-wide arm with a matched source and sink share was not run.
- A retired slot's capital stays idle, as in Control 1. Letting an owner's policy reallocate it to that owner's active slots is a plausible product choice that was not tested.
- The mixed owner-size distribution is an assumption with no usage data behind it. Owners are assigned by slot index, so an owner's agents are an independent draw of genomes; real owners may run correlated strategies, which would make within-owner ranking less informative.
- Fitness, shrinkage, niches, and the starvation trigger use population-wide information. If the product had to compute any of them per owner, small owners would lose the niche-relative starvation trigger entirely (it needs a niche of at least five agents).
- 300 ticks. The genome distance of the replacement arms is still falling at tick 300.

## Report

The full output of `node dist/src/cli-scope-report.js results/reallocation-scope results/fixed-slot`. Per magnitude: the summary against Control 1, Control 2, and arm B; owner scope against the population-wide counterpart; distance over time with niche diversity; then per arm and cell: mean ROI, gap and Welch p against Control 1, Control 2, and arm B at the same ceiling (`N` against `B-c0.2-x4`), the secondary paired p-values, replacements, "no donor" events, capital moved (absolute and as a percent of starting capital), distance at tick 0 and tick 300, active niches, effective niches, and the top niche's share of active capital, all means over 50 seeds.

### Magnitude 0.006

| arm | vs C1: cells p < 0.05 | vs C1: median gap pp | vs C1: stress | vs C1: call | vs C2: cells p < 0.05 | vs C2: median gap pp | vs C2: stress | vs C2: call | arm B | vs B: cells p < 0.05 | vs B: median gap pp | vs B: stress | vs B: call | moved % of start, mean of 12 cells |
|---|---|---:|---|---|---|---:|---|---|---|---|---:|---|---|---:|
| C2 | 4 (0 up, 4 down) | -0.59 | underperforms (0 up, 2 down) | **inconclusive** | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0.00 |
| B-c0.2-x2 | 5 (5 up, 0 down) | 0.67 | inconclusive (0 up, 0 down) | **inconclusive** | 7 (7 up, 0 down) | 1.40 | inconclusive (0 up, 0 down) | **outperforms** | n/a | n/a | n/a | n/a | n/a | 11.24 |
| B-c0.2-x4 | 5 (5 up, 0 down) | 0.80 | inconclusive (0 up, 0 down) | **inconclusive** | 7 (7 up, 0 down) | 1.52 | inconclusive (0 up, 0 down) | **outperforms** | n/a | n/a | n/a | n/a | n/a | 13.91 |
| N | 6 (0 up, 6 down) | -1.17 | underperforms (0 up, 2 down) | **mixed** | 2 (0 up, 2 down) | -0.32 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x4 | 9 (0 up, 9 down) | -1.77 | underperforms (0 up, 2 down) | **underperforms** | 0.00 |
| RO-c0.2-x2 | 2 (1 up, 1 down) | 0.34 | inconclusive (0 up, 0 down) | **inconclusive** | 3 (3 up, 0 down) | 0.88 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x2 | 2 (0 up, 2 down) | -0.35 | inconclusive (0 up, 0 down) | **inconclusive** | 10.36 |
| RO-c0.2-x4 | 1 (1 up, 0 down) | 0.43 | inconclusive (0 up, 0 down) | **inconclusive** | 3 (3 up, 0 down) | 0.95 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x4 | 2 (0 up, 2 down) | -0.38 | inconclusive (0 up, 0 down) | **inconclusive** | 11.73 |
| O3-N-c0.2-x4 | 7 (7 up, 0 down) | 0.88 | inconclusive (0 up, 0 down) | **outperforms** | 9 (9 up, 0 down) | 1.51 | inconclusive (0 up, 0 down) | **outperforms** | B-c0.2-x4 | 1 (0 up, 1 down) | -0.05 | inconclusive (0 up, 0 down) | **inconclusive** | 33.73 |
| O3-Mp-c0.2-x4 | 7 (7 up, 0 down) | 1.17 | inconclusive (0 up, 0 down) | **outperforms** | 9 (9 up, 0 down) | 1.91 | inconclusive (0 up, 0 down) | **outperforms** | B-c0.2-x4 | 1 (1 up, 0 down) | 0.37 | inconclusive (0 up, 0 down) | **inconclusive** | 37.98 |
| O5-N-c0.2-x4 | 4 (4 up, 0 down) | 0.75 | inconclusive (0 up, 0 down) | **inconclusive** | 9 (9 up, 0 down) | 1.29 | inconclusive (0 up, 0 down) | **outperforms** | B-c0.2-x4 | 2 (0 up, 2 down) | -0.19 | inconclusive (0 up, 0 down) | **inconclusive** | 22.29 |
| O5-Mp-c0.2-x4 | 7 (7 up, 0 down) | 1.10 | inconclusive (0 up, 0 down) | **outperforms** | 9 (9 up, 0 down) | 1.86 | inconclusive (0 up, 0 down) | **outperforms** | B-c0.2-x4 | 0 (0 up, 0 down) | 0.29 | inconclusive (0 up, 0 down) | **inconclusive** | 26.19 |
| O10-N-c0.2-x4 | 2 (1 up, 1 down) | 0.21 | inconclusive (0 up, 0 down) | **inconclusive** | 3 (3 up, 0 down) | 0.80 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x4 | 3 (0 up, 3 down) | -0.55 | inconclusive (0 up, 0 down) | **inconclusive** | 11.78 |
| O10-Mp-c0.2-x4 | 5 (5 up, 0 down) | 0.73 | inconclusive (0 up, 0 down) | **inconclusive** | 7 (7 up, 0 down) | 1.45 | inconclusive (0 up, 0 down) | **outperforms** | B-c0.2-x4 | 0 (0 up, 0 down) | -0.10 | inconclusive (0 up, 0 down) | **inconclusive** | 14.97 |
| Omix-N-c0.2-x4 | 2 (1 up, 1 down) | 0.25 | inconclusive (0 up, 0 down) | **inconclusive** | 4 (4 up, 0 down) | 0.79 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x4 | 2 (0 up, 2 down) | -0.54 | inconclusive (0 up, 0 down) | **inconclusive** | 20.51 |
| Omix-Mp-c0.2-x4 | 5 (5 up, 0 down) | 0.63 | inconclusive (0 up, 0 down) | **inconclusive** | 8 (8 up, 0 down) | 1.40 | inconclusive (0 up, 0 down) | **outperforms** | B-c0.2-x4 | 1 (0 up, 1 down) | -0.19 | inconclusive (0 up, 0 down) | **inconclusive** | 23.58 |
| RT-c0.2-x4 | 9 (9 up, 0 down) | 1.55 | outperforms (2 up, 0 down) | **outperforms** | 9 (9 up, 0 down) | 2.48 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x4 | 4 (4 up, 0 down) | 0.84 | outperforms (2 up, 0 down) | **inconclusive** | 14.35 |
| O3-RT-c0.2-x4 | 11 (11 up, 0 down) | 2.18 | outperforms (2 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.76 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 6 (6 up, 0 down) | 1.43 | outperforms (2 up, 0 down) | **mixed** | 40.74 |
| O5-RT-c0.2-x4 | 11 (11 up, 0 down) | 2.21 | outperforms (2 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.78 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 6 (6 up, 0 down) | 1.39 | outperforms (2 up, 0 down) | **mixed** | 29.47 |
| O10-RT-c0.2-x4 | 9 (9 up, 0 down) | 1.63 | outperforms (2 up, 0 down) | **outperforms** | 10 (10 up, 0 down) | 2.41 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x4 | 4 (4 up, 0 down) | 0.74 | outperforms (2 up, 0 down) | **inconclusive** | 16.95 |
| Omix-RT-c0.2-x4 | 9 (9 up, 0 down) | 1.62 | inconclusive (1 up, 0 down) | **outperforms** | 10 (10 up, 0 down) | 2.33 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x4 | 4 (4 up, 0 down) | 0.67 | outperforms (2 up, 0 down) | **inconclusive** | 23.68 |

Owner scope against population-wide ranking with the same replacement setting and ceiling (no-replacement and retire arms; for mutant arms the counterpart is arm B, above):

| arm | counterpart | cells p < 0.05 | median gap pp | stress | call |
|---|---|---|---:|---|---|
| O3-N-c0.2-x4 | RO-c0.2-x4 | 2 (2 up, 0 down) | 0.57 | inconclusive (0 up, 0 down) | **inconclusive** |
| O5-N-c0.2-x4 | RO-c0.2-x4 | 1 (1 up, 0 down) | 0.35 | inconclusive (0 up, 0 down) | **inconclusive** |
| O10-N-c0.2-x4 | RO-c0.2-x4 | 1 (0 up, 1 down) | -0.17 | inconclusive (0 up, 0 down) | **inconclusive** |
| Omix-N-c0.2-x4 | RO-c0.2-x4 | 0 (0 up, 0 down) | -0.17 | inconclusive (0 up, 0 down) | **inconclusive** |
| O3-RT-c0.2-x4 | RT-c0.2-x4 | 1 (1 up, 0 down) | 0.52 | inconclusive (0 up, 0 down) | **inconclusive** |
| O5-RT-c0.2-x4 | RT-c0.2-x4 | 2 (2 up, 0 down) | 0.48 | inconclusive (0 up, 0 down) | **inconclusive** |
| O10-RT-c0.2-x4 | RT-c0.2-x4 | 0 (0 up, 0 down) | -0.03 | inconclusive (0 up, 0 down) | **inconclusive** |
| Omix-RT-c0.2-x4 | RT-c0.2-x4 | 1 (0 up, 1 down) | -0.15 | inconclusive (0 up, 0 down) | **inconclusive** |

Capital-weighted genome distance from the regime optimum, mean over the 12 cells and over seeds, at each trace tick, with the mean effective number of niches and the top niche's share of active capital at the end:

| arm | t0 | t60 | t120 | t180 | t240 | t300 | effective niches | top niche % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| C1 | 0.410 | 0.406 | 0.398 | 0.392 | 0.385 | 0.378 | 5.58 | 34.0 |
| C2 | 0.410 | 0.405 | 0.399 | 0.394 | 0.388 | 0.383 | 5.66 | 33.2 |
| B-c0.2-x2 | 0.410 | 0.384 | 0.362 | 0.349 | 0.340 | 0.333 | 5.44 | 34.5 |
| B-c0.2-x4 | 0.410 | 0.384 | 0.361 | 0.345 | 0.333 | 0.325 | 5.36 | 35.1 |
| N | 0.410 | 0.409 | 0.407 | 0.406 | 0.404 | 0.402 | 5.57 | 34.7 |
| RO-c0.2-x2 | 0.410 | 0.389 | 0.374 | 0.365 | 0.360 | 0.356 | 5.42 | 35.3 |
| RO-c0.2-x4 | 0.410 | 0.389 | 0.374 | 0.363 | 0.356 | 0.350 | 5.38 | 35.6 |
| O3-N-c0.2-x4 | 0.410 | 0.378 | 0.357 | 0.345 | 0.337 | 0.330 | 5.19 | 36.6 |
| O3-Mp-c0.2-x4 | 0.410 | 0.373 | 0.347 | 0.332 | 0.322 | 0.315 | 5.15 | 36.3 |
| O5-N-c0.2-x4 | 0.410 | 0.382 | 0.363 | 0.351 | 0.343 | 0.335 | 5.27 | 36.2 |
| O5-Mp-c0.2-x4 | 0.410 | 0.377 | 0.350 | 0.334 | 0.322 | 0.314 | 5.22 | 35.8 |
| O10-N-c0.2-x4 | 0.410 | 0.391 | 0.377 | 0.367 | 0.360 | 0.354 | 5.39 | 35.6 |
| O10-Mp-c0.2-x4 | 0.410 | 0.385 | 0.363 | 0.347 | 0.335 | 0.326 | 5.37 | 35.1 |
| Omix-N-c0.2-x4 | 0.410 | 0.389 | 0.375 | 0.367 | 0.360 | 0.355 | 5.29 | 36.0 |
| Omix-Mp-c0.2-x4 | 0.410 | 0.384 | 0.363 | 0.349 | 0.338 | 0.331 | 5.27 | 35.7 |
| RT-c0.2-x4 | 0.410 | 0.386 | 0.365 | 0.347 | 0.332 | 0.317 | 5.28 | 35.6 |
| O3-RT-c0.2-x4 | 0.410 | 0.374 | 0.349 | 0.332 | 0.320 | 0.311 | 5.10 | 36.8 |
| O5-RT-c0.2-x4 | 0.410 | 0.378 | 0.352 | 0.332 | 0.315 | 0.301 | 5.13 | 36.4 |
| O10-RT-c0.2-x4 | 0.410 | 0.387 | 0.365 | 0.347 | 0.329 | 0.314 | 5.26 | 35.7 |
| Omix-RT-c0.2-x4 | 0.410 | 0.386 | 0.365 | 0.350 | 0.336 | 0.324 | 5.21 | 36.2 |

#### Magnitude 0.006, arm N

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -3.73 | -0.22 | 0.7834 | -0.08 | 0.9152 | -1.62 | 0.0548 | 0.0020 | 0.0069 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.423 | 5.0 | 4.37 | 38.2 |
| 10 | mean_reverting | -8.01 | -0.25 | 0.5714 | -0.10 | 0.8155 | -1.39 | 0.0032 | 0.0014 | 0.0466 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.445 | 0.437 | 5.0 | 4.35 | 38.7 |
| 10 | choppy | -5.89 | -0.17 | 0.7893 | -0.09 | 0.8853 | -1.34 | 0.0644 | 0.0023 | 0.0294 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.370 | 5.0 | 4.36 | 38.6 |
| 10 | stress_flash_crash | -10.89 | -0.26 | 0.6677 | -0.03 | 0.9587 | -0.92 | 0.1500 | 0.0032 | 0.3865 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.372 | 5.0 | 4.35 | 38.8 |
| 100 | trending | -3.62 | -1.12 | 0.0843 | -0.62 | 0.3545 | -2.73 | 0.0002 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.431 | 0.419 | 7.0 | 6.11 | 32.6 |
| 100 | mean_reverting | -8.05 | -1.48 | <0.0001 | -0.53 | 0.0005 | -2.19 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.439 | 0.430 | 7.0 | 6.09 | 32.7 |
| 100 | choppy | -6.16 | -1.11 | 0.0523 | -0.43 | 0.4641 | -1.93 | 0.0024 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.379 | 7.0 | 6.10 | 32.6 |
| 100 | stress_flash_crash | -10.85 | -1.39 | 0.0065 | -0.20 | 0.7045 | -1.10 | 0.0462 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.382 | 7.0 | 6.10 | 32.7 |
| 1000 | trending | -3.66 | -1.27 | 0.0415 | -0.78 | 0.2370 | -3.03 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.421 | 7.0 | 6.25 | 32.9 |
| 1000 | mean_reverting | -8.11 | -1.67 | <0.0001 | -0.59 | <0.0001 | -2.32 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.436 | 0.427 | 7.0 | 6.24 | 33.0 |
| 1000 | choppy | -6.17 | -1.23 | 0.0274 | -0.44 | 0.4458 | -2.01 | 0.0015 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.380 | 7.0 | 6.24 | 33.0 |
| 1000 | stress_flash_crash | -10.89 | -1.51 | 0.0029 | -0.16 | 0.7624 | -1.14 | 0.0378 | <0.0001 | 0.0003 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.383 | 7.0 | 6.24 | 33.0 |

#### Magnitude 0.006, arm RO-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.34 | 1.17 | 0.1541 | 1.30 | 0.1134 | -0.10 | 0.9073 | <0.0001 | <0.0001 | 0.0212 | 0.0 | 0.0 | 9.25 | 9.25 | 0.433 | 0.382 | 5.0 | 4.15 | 39.8 |
| 10 | mean_reverting | -6.79 | 0.97 | 0.0375 | 1.12 | 0.0156 | -0.07 | 0.8815 | <0.0001 | <0.0001 | 0.1181 | 0.0 | 0.0 | 9.64 | 9.64 | 0.445 | 0.401 | 4.9 | 4.11 | 41.1 |
| 10 | choppy | -4.81 | 0.91 | 0.1892 | 0.99 | 0.1548 | -0.13 | 0.8560 | <0.0001 | <0.0001 | 0.0473 | 0.0 | 0.0 | 9.62 | 9.62 | 0.379 | 0.334 | 4.9 | 4.17 | 39.5 |
| 10 | stress_flash_crash | -10.09 | 0.53 | 0.3971 | 0.76 | 0.2189 | -0.06 | 0.9331 | <0.0001 | <0.0001 | 0.3162 | 0.0 | 0.0 | 10.82 | 10.82 | 0.379 | 0.332 | 4.9 | 4.15 | 39.5 |
| 100 | trending | -1.91 | 0.59 | 0.3729 | 1.09 | 0.1175 | -0.81 | 0.2676 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 97.78 | 9.78 | 0.431 | 0.366 | 7.0 | 6.03 | 32.3 |
| 100 | mean_reverting | -6.63 | -0.05 | 0.7470 | 0.90 | <0.0001 | -0.61 | 0.0005 | 0.1683 | <0.0001 | <0.0001 | 0.0 | 0.0 | 101.26 | 10.13 | 0.439 | 0.384 | 7.0 | 5.96 | 33.2 |
| 100 | choppy | -4.87 | 0.19 | 0.7488 | 0.86 | 0.1615 | -0.54 | 0.3987 | 0.0134 | <0.0001 | <0.0001 | 0.0 | 0.0 | 103.27 | 10.33 | 0.387 | 0.334 | 7.0 | 5.96 | 33.0 |
| 100 | stress_flash_crash | -9.95 | -0.49 | 0.3359 | 0.70 | 0.1960 | -0.16 | 0.7796 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 121.82 | 12.18 | 0.387 | 0.330 | 7.0 | 5.93 | 33.2 |
| 1000 | trending | -1.90 | 0.49 | 0.4430 | 0.99 | 0.1448 | -1.01 | 0.1538 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 965.24 | 9.65 | 0.433 | 0.366 | 7.0 | 6.17 | 32.9 |
| 1000 | mean_reverting | -6.65 | -0.21 | 0.0323 | 0.87 | <0.0001 | -0.66 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1010.20 | 10.10 | 0.436 | 0.380 | 7.0 | 6.16 | 32.9 |
| 1000 | choppy | -4.86 | 0.09 | 0.8808 | 0.87 | 0.1498 | -0.53 | 0.4013 | 0.2269 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1049.42 | 10.49 | 0.388 | 0.333 | 7.0 | 6.15 | 32.9 |
| 1000 | stress_flash_crash | -9.98 | -0.60 | 0.2395 | 0.75 | 0.1603 | -0.16 | 0.7670 | <0.0001 | <0.0001 | 0.0001 | 0.0 | 0.0 | 1233.11 | 12.33 | 0.388 | 0.330 | 7.0 | 6.13 | 32.9 |

#### Magnitude 0.006, arm RO-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.21 | 1.31 | 0.1145 | 1.44 | 0.0829 | -0.09 | 0.9134 | <0.0001 | <0.0001 | 0.0251 | 0.0 | 0.0 | 11.25 | 11.25 | 0.433 | 0.374 | 4.9 | 4.05 | 40.9 |
| 10 | mean_reverting | -6.71 | 1.06 | 0.0235 | 1.21 | 0.0092 | -0.08 | 0.8646 | <0.0001 | <0.0001 | 0.0930 | 0.0 | 0.0 | 11.17 | 11.17 | 0.445 | 0.395 | 4.9 | 4.06 | 41.9 |
| 10 | choppy | -4.70 | 1.02 | 0.1432 | 1.10 | 0.1159 | -0.14 | 0.8553 | <0.0001 | <0.0001 | 0.0417 | 0.0 | 0.0 | 11.98 | 11.98 | 0.379 | 0.324 | 4.9 | 4.08 | 40.5 |
| 10 | stress_flash_crash | -10.02 | 0.61 | 0.3373 | 0.84 | 0.1799 | -0.05 | 0.9362 | <0.0001 | <0.0001 | 0.3334 | 0.0 | 0.0 | 13.01 | 13.01 | 0.379 | 0.323 | 4.9 | 4.07 | 40.4 |
| 100 | trending | -1.79 | 0.71 | 0.2885 | 1.21 | 0.0849 | -0.90 | 0.2234 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 112.68 | 11.27 | 0.431 | 0.357 | 7.0 | 6.01 | 32.2 |
| 100 | mean_reverting | -6.56 | 0.02 | 0.8987 | 0.96 | <0.0001 | -0.70 | <0.0001 | 0.6186 | <0.0001 | <0.0001 | 0.0 | 0.0 | 111.98 | 11.20 | 0.439 | 0.379 | 7.0 | 5.94 | 33.2 |
| 100 | choppy | -4.79 | 0.26 | 0.6595 | 0.93 | 0.1314 | -0.56 | 0.3825 | 0.0015 | <0.0001 | <0.0001 | 0.0 | 0.0 | 115.77 | 11.58 | 0.387 | 0.328 | 7.0 | 5.93 | 33.2 |
| 100 | stress_flash_crash | -9.92 | -0.46 | 0.3710 | 0.73 | 0.1763 | -0.17 | 0.7601 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 127.33 | 12.73 | 0.387 | 0.327 | 7.0 | 5.91 | 33.3 |
| 1000 | trending | -1.78 | 0.61 | 0.3446 | 1.11 | 0.1051 | -1.15 | 0.1112 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1121.20 | 11.21 | 0.433 | 0.357 | 7.0 | 6.15 | 32.8 |
| 1000 | mean_reverting | -6.59 | -0.15 | 0.1215 | 0.93 | <0.0001 | -0.80 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1111.51 | 11.12 | 0.436 | 0.375 | 7.0 | 6.14 | 32.9 |
| 1000 | choppy | -4.80 | 0.14 | 0.8021 | 0.93 | 0.1263 | -0.63 | 0.3217 | 0.0539 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1154.75 | 11.55 | 0.388 | 0.328 | 7.0 | 6.14 | 32.9 |
| 1000 | stress_flash_crash | -9.95 | -0.57 | 0.2673 | 0.79 | 0.1435 | -0.20 | 0.7225 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1267.98 | 12.68 | 0.388 | 0.327 | 7.0 | 6.12 | 33.0 |

#### Magnitude 0.006, arm O3-N-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.27 | 2.24 | 0.0108 | 2.37 | 0.0071 | 0.84 | 0.3576 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 31.50 | 31.50 | 0.433 | 0.350 | 4.9 | 3.67 | 42.4 |
| 10 | mean_reverting | -6.17 | 1.60 | 0.0024 | 1.74 | 0.0009 | 0.45 | 0.3969 | <0.0001 | <0.0001 | 0.0006 | 0.0 | 0.0 | 31.57 | 31.57 | 0.445 | 0.369 | 4.8 | 3.57 | 44.0 |
| 10 | choppy | -4.03 | 1.69 | 0.0299 | 1.77 | 0.0235 | 0.53 | 0.5207 | <0.0001 | <0.0001 | 0.0002 | 0.0 | 0.0 | 32.73 | 32.73 | 0.379 | 0.305 | 4.9 | 3.59 | 44.5 |
| 10 | stress_flash_crash | -9.70 | 0.93 | 0.1757 | 1.16 | 0.0879 | 0.27 | 0.7035 | <0.0001 | <0.0001 | 0.0457 | 0.0 | 0.0 | 33.91 | 33.91 | 0.379 | 0.303 | 4.8 | 3.59 | 44.5 |
| 100 | trending | -0.94 | 1.56 | 0.0269 | 2.06 | 0.0052 | -0.05 | 0.9436 | <0.0001 | <0.0001 | 0.1966 | 0.0 | 0.0 | 336.75 | 33.67 | 0.431 | 0.339 | 7.0 | 5.88 | 32.6 |
| 100 | mean_reverting | -6.02 | 0.55 | 0.0014 | 1.50 | <0.0001 | -0.16 | 0.3759 | <0.0001 | <0.0001 | 0.0001 | 0.0 | 0.0 | 335.79 | 33.58 | 0.439 | 0.357 | 7.0 | 5.85 | 33.0 |
| 100 | choppy | -4.22 | 0.83 | 0.1812 | 1.51 | 0.0211 | 0.01 | 0.9903 | <0.0001 | <0.0001 | 0.8602 | 0.0 | 0.0 | 343.31 | 34.33 | 0.387 | 0.311 | 7.0 | 5.83 | 33.6 |
| 100 | stress_flash_crash | -9.86 | -0.40 | 0.4620 | 0.79 | 0.1623 | -0.11 | 0.8522 | 0.0005 | <0.0001 | 0.0281 | 0.0 | 0.0 | 355.80 | 35.58 | 0.387 | 0.312 | 7.0 | 5.83 | 33.5 |
| 1000 | trending | -0.90 | 1.49 | 0.0290 | 1.98 | 0.0058 | -0.27 | 0.7139 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3402.41 | 34.02 | 0.433 | 0.339 | 7.0 | 6.12 | 32.6 |
| 1000 | mean_reverting | -6.02 | 0.42 | 0.0001 | 1.50 | <0.0001 | -0.23 | 0.0483 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3373.05 | 33.73 | 0.436 | 0.354 | 7.0 | 6.14 | 32.7 |
| 1000 | choppy | -4.21 | 0.73 | 0.2243 | 1.52 | 0.0174 | -0.04 | 0.9491 | <0.0001 | <0.0001 | 0.0846 | 0.0 | 0.0 | 3452.26 | 34.52 | 0.388 | 0.311 | 7.0 | 6.10 | 32.7 |
| 1000 | stress_flash_crash | -9.89 | -0.50 | 0.3463 | 0.85 | 0.1286 | -0.13 | 0.8176 | <0.0001 | <0.0001 | 0.0002 | 0.0 | 0.0 | 3561.60 | 35.62 | 0.388 | 0.312 | 7.0 | 6.10 | 32.7 |

#### Magnitude 0.006, arm O3-Mp-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.18 | 2.34 | 0.0084 | 2.47 | 0.0055 | 0.93 | 0.3086 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 32.03 | 32.03 | 0.433 | 0.345 | 5.0 | 3.73 | 41.4 |
| 10 | mean_reverting | -6.08 | 1.69 | 0.0015 | 1.84 | 0.0005 | 0.55 | 0.3096 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 32.09 | 32.09 | 0.445 | 0.363 | 4.9 | 3.61 | 43.3 |
| 10 | choppy | -3.91 | 1.81 | 0.0232 | 1.89 | 0.0182 | 0.65 | 0.4383 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 33.51 | 33.51 | 0.379 | 0.298 | 5.0 | 3.59 | 44.0 |
| 10 | stress_flash_crash | -9.63 | 0.99 | 0.1561 | 1.22 | 0.0776 | 0.33 | 0.6460 | <0.0001 | <0.0001 | 0.0136 | 0.4 | 0.0 | 34.70 | 34.70 | 0.379 | 0.297 | 4.9 | 3.60 | 43.7 |
| 100 | trending | -0.37 | 2.13 | 0.0035 | 2.63 | 0.0006 | 0.52 | 0.5075 | <0.0001 | <0.0001 | <0.0001 | 34.4 | 0.0 | 399.86 | 39.99 | 0.431 | 0.320 | 7.0 | 5.82 | 32.8 |
| 100 | mean_reverting | -5.57 | 1.00 | <0.0001 | 1.95 | <0.0001 | 0.28 | 0.1616 | <0.0001 | <0.0001 | <0.0001 | 34.7 | 0.0 | 393.75 | 39.38 | 0.439 | 0.336 | 7.0 | 5.80 | 32.8 |
| 100 | choppy | -3.86 | 1.20 | 0.0617 | 1.87 | 0.0054 | 0.37 | 0.5872 | <0.0001 | <0.0001 | <0.0001 | 33.1 | 0.0 | 397.12 | 39.71 | 0.387 | 0.293 | 7.0 | 5.73 | 33.6 |
| 100 | stress_flash_crash | -9.76 | -0.30 | 0.5841 | 0.89 | 0.1261 | -0.01 | 0.9818 | 0.0218 | <0.0001 | 0.8212 | 30.6 | 0.0 | 400.79 | 40.08 | 0.387 | 0.295 | 7.0 | 5.73 | 33.6 |
| 1000 | trending | -0.22 | 2.17 | 0.0022 | 2.66 | 0.0004 | 0.41 | 0.5889 | <0.0001 | <0.0001 | <0.0001 | 378.9 | 0.0 | 4150.70 | 41.51 | 0.433 | 0.315 | 7.0 | 6.04 | 32.6 |
| 1000 | mean_reverting | -5.55 | 0.89 | <0.0001 | 1.97 | <0.0001 | 0.24 | 0.0412 | <0.0001 | <0.0001 | <0.0001 | 385.4 | 0.0 | 4030.45 | 40.30 | 0.436 | 0.331 | 7.0 | 6.07 | 32.6 |
| 1000 | choppy | -3.81 | 1.14 | 0.0667 | 1.92 | 0.0034 | 0.36 | 0.5914 | <0.0001 | <0.0001 | <0.0001 | 372.9 | 0.0 | 4117.08 | 41.17 | 0.388 | 0.292 | 7.1 | 6.02 | 32.8 |
| 1000 | stress_flash_crash | -9.80 | -0.41 | 0.4460 | 0.94 | 0.0980 | -0.04 | 0.9410 | 0.0008 | <0.0001 | 0.2355 | 343.5 | 0.0 | 4124.01 | 41.24 | 0.388 | 0.294 | 7.1 | 6.04 | 32.8 |

#### Magnitude 0.006, arm O5-N-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.39 | 2.12 | 0.0155 | 2.26 | 0.0103 | 0.72 | 0.4285 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 22.57 | 22.57 | 0.433 | 0.350 | 4.9 | 3.82 | 40.9 |
| 10 | mean_reverting | -6.26 | 1.51 | 0.0030 | 1.66 | 0.0011 | 0.37 | 0.4818 | <0.0001 | <0.0001 | 0.0006 | 0.0 | 0.0 | 21.88 | 21.88 | 0.445 | 0.377 | 4.9 | 3.80 | 43.2 |
| 10 | choppy | -4.07 | 1.65 | 0.0257 | 1.73 | 0.0199 | 0.49 | 0.5309 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 23.04 | 23.04 | 0.379 | 0.304 | 4.9 | 3.80 | 43.3 |
| 10 | stress_flash_crash | -9.73 | 0.89 | 0.1751 | 1.12 | 0.0844 | 0.23 | 0.7341 | <0.0001 | <0.0001 | 0.0227 | 0.0 | 0.0 | 24.07 | 24.07 | 0.379 | 0.306 | 4.9 | 3.78 | 43.6 |
| 100 | trending | -1.27 | 1.23 | 0.0775 | 1.72 | 0.0176 | -0.39 | 0.6103 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 214.88 | 21.49 | 0.431 | 0.345 | 7.0 | 5.94 | 32.4 |
| 100 | mean_reverting | -6.23 | 0.35 | 0.0358 | 1.29 | <0.0001 | -0.37 | 0.0384 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 213.24 | 21.32 | 0.439 | 0.366 | 7.0 | 5.92 | 32.9 |
| 100 | choppy | -4.44 | 0.61 | 0.3205 | 1.28 | 0.0460 | -0.21 | 0.7471 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 220.51 | 22.05 | 0.387 | 0.317 | 7.0 | 5.86 | 33.3 |
| 100 | stress_flash_crash | -9.90 | -0.44 | 0.4127 | 0.75 | 0.1784 | -0.15 | 0.7975 | <0.0001 | <0.0001 | 0.0004 | 0.0 | 0.0 | 230.86 | 23.09 | 0.387 | 0.317 | 7.0 | 5.84 | 33.3 |
| 1000 | trending | -1.29 | 1.10 | 0.0981 | 1.60 | 0.0231 | -0.66 | 0.3671 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2152.90 | 21.53 | 0.433 | 0.346 | 7.0 | 6.12 | 32.7 |
| 1000 | mean_reverting | -6.26 | 0.18 | 0.0733 | 1.26 | <0.0001 | -0.47 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2132.77 | 21.33 | 0.436 | 0.362 | 7.0 | 6.14 | 32.8 |
| 1000 | choppy | -4.46 | 0.49 | 0.4091 | 1.27 | 0.0418 | -0.29 | 0.6578 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2204.99 | 22.05 | 0.388 | 0.317 | 7.0 | 6.10 | 32.9 |
| 1000 | stress_flash_crash | -9.92 | -0.54 | 0.3055 | 0.82 | 0.1383 | -0.17 | 0.7678 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2303.04 | 23.03 | 0.388 | 0.317 | 7.0 | 6.10 | 32.9 |

#### Magnitude 0.006, arm O5-Mp-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.31 | 2.20 | 0.0125 | 2.33 | 0.0083 | 0.80 | 0.3820 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 22.80 | 22.80 | 0.433 | 0.347 | 5.0 | 3.90 | 39.6 |
| 10 | mean_reverting | -6.15 | 1.62 | 0.0017 | 1.77 | 0.0006 | 0.48 | 0.3619 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 22.49 | 22.49 | 0.445 | 0.372 | 4.9 | 3.85 | 42.0 |
| 10 | choppy | -3.91 | 1.81 | 0.0177 | 1.89 | 0.0136 | 0.65 | 0.4205 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 23.75 | 23.75 | 0.379 | 0.297 | 5.0 | 3.84 | 42.2 |
| 10 | stress_flash_crash | -9.66 | 0.97 | 0.1505 | 1.20 | 0.0719 | 0.31 | 0.6603 | <0.0001 | <0.0001 | 0.0009 | 0.4 | 0.0 | 24.66 | 24.66 | 0.379 | 0.298 | 5.0 | 3.83 | 42.1 |
| 100 | trending | -0.45 | 2.05 | 0.0049 | 2.55 | 0.0008 | 0.44 | 0.5732 | <0.0001 | <0.0001 | <0.0001 | 35.0 | 0.0 | 270.22 | 27.02 | 0.431 | 0.313 | 7.1 | 5.87 | 32.3 |
| 100 | mean_reverting | -5.61 | 0.96 | <0.0001 | 1.91 | <0.0001 | 0.25 | 0.2076 | <0.0001 | <0.0001 | <0.0001 | 35.4 | 0.0 | 268.27 | 26.83 | 0.439 | 0.335 | 7.0 | 5.81 | 32.7 |
| 100 | choppy | -3.89 | 1.16 | 0.0708 | 1.84 | 0.0065 | 0.34 | 0.6241 | <0.0001 | <0.0001 | <0.0001 | 34.3 | 0.0 | 269.59 | 26.96 | 0.387 | 0.291 | 7.0 | 5.76 | 33.4 |
| 100 | stress_flash_crash | -9.74 | -0.28 | 0.6164 | 0.91 | 0.1127 | 0.01 | 0.9811 | 0.0283 | <0.0001 | 0.7829 | 32.8 | 0.0 | 273.03 | 27.30 | 0.387 | 0.292 | 7.0 | 5.78 | 33.1 |
| 1000 | trending | -0.35 | 2.04 | 0.0035 | 2.53 | 0.0006 | 0.28 | 0.7112 | <0.0001 | <0.0001 | <0.0001 | 388.3 | 0.0 | 2839.95 | 28.40 | 0.433 | 0.309 | 7.1 | 6.02 | 32.8 |
| 1000 | mean_reverting | -5.59 | 0.84 | <0.0001 | 1.92 | <0.0001 | 0.20 | 0.0916 | <0.0001 | <0.0001 | <0.0001 | 396.6 | 0.0 | 2758.67 | 27.59 | 0.436 | 0.331 | 7.1 | 6.03 | 32.9 |
| 1000 | choppy | -3.90 | 1.04 | 0.0885 | 1.83 | 0.0048 | 0.27 | 0.6891 | <0.0001 | <0.0001 | <0.0001 | 383.1 | 0.0 | 2820.05 | 28.20 | 0.388 | 0.289 | 7.1 | 6.00 | 33.1 |
| 1000 | stress_flash_crash | -9.75 | -0.37 | 0.4879 | 0.98 | 0.0807 | -0.00 | 0.9980 | 0.0014 | <0.0001 | 0.9541 | 360.0 | 0.0 | 2829.08 | 28.29 | 0.388 | 0.292 | 7.0 | 6.01 | 33.0 |

#### Magnitude 0.006, arm O10-N-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.21 | 1.31 | 0.1145 | 1.44 | 0.0829 | -0.09 | 0.9134 | <0.0001 | <0.0001 | 0.0251 | 0.0 | 0.0 | 11.51 | 11.51 | 0.433 | 0.373 | 4.9 | 4.05 | 41.0 |
| 10 | mean_reverting | -6.71 | 1.06 | 0.0235 | 1.21 | 0.0092 | -0.08 | 0.8646 | <0.0001 | <0.0001 | 0.0930 | 0.0 | 0.0 | 11.38 | 11.38 | 0.445 | 0.395 | 4.9 | 4.06 | 41.9 |
| 10 | choppy | -4.70 | 1.02 | 0.1429 | 1.10 | 0.1157 | -0.14 | 0.8557 | <0.0001 | <0.0001 | 0.0426 | 0.0 | 0.0 | 12.15 | 12.15 | 0.379 | 0.324 | 4.9 | 4.07 | 40.6 |
| 10 | stress_flash_crash | -10.02 | 0.61 | 0.3373 | 0.84 | 0.1799 | -0.05 | 0.9362 | <0.0001 | <0.0001 | 0.3334 | 0.0 | 0.0 | 13.11 | 13.11 | 0.379 | 0.323 | 4.9 | 4.07 | 40.5 |
| 100 | trending | -2.00 | 0.50 | 0.4582 | 0.99 | 0.1559 | -1.12 | 0.1326 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 113.15 | 11.32 | 0.431 | 0.365 | 7.0 | 6.00 | 32.2 |
| 100 | mean_reverting | -6.76 | -0.18 | 0.2498 | 0.77 | <0.0001 | -0.90 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 111.35 | 11.13 | 0.439 | 0.385 | 7.0 | 5.95 | 33.3 |
| 100 | choppy | -4.96 | 0.09 | 0.8791 | 0.76 | 0.2175 | -0.73 | 0.2573 | 0.2595 | <0.0001 | <0.0001 | 0.0 | 0.0 | 116.54 | 11.65 | 0.387 | 0.334 | 7.0 | 5.94 | 33.3 |
| 100 | stress_flash_crash | -10.08 | -0.62 | 0.2329 | 0.57 | 0.2913 | -0.33 | 0.5582 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 126.40 | 12.64 | 0.387 | 0.334 | 7.0 | 5.93 | 33.3 |
| 1000 | trending | -2.06 | 0.33 | 0.6045 | 0.83 | 0.2217 | -1.43 | 0.0482 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1123.39 | 11.23 | 0.433 | 0.367 | 7.0 | 6.16 | 32.9 |
| 1000 | mean_reverting | -6.82 | -0.38 | 0.0001 | 0.70 | <0.0001 | -1.03 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1107.00 | 11.07 | 0.436 | 0.383 | 7.0 | 6.17 | 32.9 |
| 1000 | choppy | -4.99 | -0.04 | 0.9388 | 0.74 | 0.2207 | -0.82 | 0.1983 | 0.5375 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1157.16 | 11.57 | 0.388 | 0.335 | 7.0 | 6.16 | 32.9 |
| 1000 | stress_flash_crash | -10.13 | -0.74 | 0.1476 | 0.61 | 0.2558 | -0.37 | 0.5027 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1255.48 | 12.55 | 0.388 | 0.335 | 7.0 | 6.15 | 33.0 |

#### Magnitude 0.006, arm O10-Mp-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.06 | 1.45 | 0.0840 | 1.58 | 0.0599 | 0.05 | 0.9576 | <0.0001 | <0.0001 | 0.0265 | 0.4 | 0.0 | 11.55 | 11.55 | 0.433 | 0.369 | 5.0 | 4.17 | 38.9 |
| 10 | mean_reverting | -6.59 | 1.18 | 0.0138 | 1.32 | 0.0052 | 0.03 | 0.9478 | <0.0001 | <0.0001 | 0.0050 | 0.4 | 0.0 | 11.96 | 11.96 | 0.445 | 0.387 | 5.0 | 4.10 | 40.9 |
| 10 | choppy | -4.53 | 1.19 | 0.1004 | 1.27 | 0.0807 | 0.03 | 0.9719 | <0.0001 | <0.0001 | 0.0156 | 0.4 | 0.0 | 12.47 | 12.47 | 0.379 | 0.316 | 5.0 | 4.16 | 38.7 |
| 10 | stress_flash_crash | -9.95 | 0.68 | 0.2972 | 0.91 | 0.1574 | 0.02 | 0.9788 | <0.0001 | <0.0001 | 0.0236 | 0.4 | 0.0 | 13.16 | 13.16 | 0.379 | 0.316 | 5.0 | 4.16 | 38.7 |
| 100 | trending | -0.99 | 1.51 | 0.0323 | 2.01 | 0.0064 | -0.10 | 0.8909 | <0.0001 | <0.0001 | 0.0008 | 34.2 | 0.0 | 159.16 | 15.92 | 0.431 | 0.320 | 7.0 | 5.92 | 32.3 |
| 100 | mean_reverting | -5.96 | 0.62 | 0.0005 | 1.56 | <0.0001 | -0.10 | 0.5905 | <0.0001 | <0.0001 | 0.0007 | 35.4 | 0.0 | 155.48 | 15.55 | 0.439 | 0.345 | 7.0 | 5.87 | 33.1 |
| 100 | choppy | -4.27 | 0.78 | 0.2076 | 1.45 | 0.0251 | -0.05 | 0.9462 | <0.0001 | <0.0001 | 0.2389 | 33.4 | 0.0 | 155.84 | 15.58 | 0.387 | 0.299 | 7.0 | 5.87 | 33.1 |
| 100 | stress_flash_crash | -9.84 | -0.38 | 0.4727 | 0.81 | 0.1473 | -0.09 | 0.8724 | 0.0004 | <0.0001 | 0.0019 | 31.8 | 0.0 | 160.04 | 16.00 | 0.387 | 0.302 | 7.0 | 5.89 | 32.9 |
| 1000 | trending | -0.83 | 1.56 | 0.0217 | 2.05 | 0.0042 | -0.20 | 0.7849 | <0.0001 | <0.0001 | <0.0001 | 380.9 | 0.0 | 1713.61 | 17.14 | 0.433 | 0.313 | 7.1 | 6.06 | 33.1 |
| 1000 | mean_reverting | -5.94 | 0.50 | <0.0001 | 1.58 | <0.0001 | -0.15 | 0.1937 | <0.0001 | <0.0001 | <0.0001 | 391.1 | 0.0 | 1648.63 | 16.49 | 0.436 | 0.341 | 7.1 | 6.06 | 33.1 |
| 1000 | choppy | -4.27 | 0.67 | 0.2616 | 1.46 | 0.0213 | -0.11 | 0.8712 | <0.0001 | <0.0001 | <0.0001 | 371.7 | 0.0 | 1683.26 | 16.83 | 0.388 | 0.297 | 7.1 | 6.07 | 32.9 |
| 1000 | stress_flash_crash | -9.89 | -0.51 | 0.3299 | 0.84 | 0.1243 | -0.14 | 0.8054 | <0.0001 | <0.0001 | <0.0001 | 353.9 | 0.0 | 1693.45 | 16.93 | 0.388 | 0.300 | 7.1 | 6.08 | 32.9 |

#### Magnitude 0.006, arm Omix-N-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.87 | 1.65 | 0.0636 | 1.78 | 0.0455 | 0.24 | 0.7922 | <0.0001 | <0.0001 | 0.1203 | 0.0 | 0.0 | 29.66 | 29.66 | 0.433 | 0.374 | 4.8 | 3.74 | 42.4 |
| 10 | mean_reverting | -6.57 | 1.20 | 0.0139 | 1.35 | 0.0054 | 0.06 | 0.9078 | <0.0001 | <0.0001 | 0.6194 | 0.0 | 0.0 | 30.85 | 30.85 | 0.445 | 0.390 | 4.8 | 3.79 | 41.5 |
| 10 | choppy | -4.68 | 1.04 | 0.1356 | 1.12 | 0.1095 | -0.12 | 0.8710 | <0.0001 | <0.0001 | 0.3643 | 0.0 | 0.0 | 30.98 | 30.98 | 0.379 | 0.329 | 4.8 | 3.76 | 42.4 |
| 10 | stress_flash_crash | -10.24 | 0.39 | 0.5372 | 0.62 | 0.3209 | -0.27 | 0.6866 | 0.0132 | 0.0001 | 0.0510 | 0.0 | 0.0 | 31.64 | 31.64 | 0.379 | 0.331 | 4.7 | 3.76 | 42.3 |
| 100 | trending | -1.95 | 0.55 | 0.4131 | 1.05 | 0.1361 | -1.06 | 0.1524 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 149.14 | 14.91 | 0.431 | 0.364 | 7.0 | 5.99 | 32.3 |
| 100 | mean_reverting | -6.73 | -0.15 | 0.3415 | 0.79 | <0.0001 | -0.87 | <0.0001 | 0.0004 | <0.0001 | <0.0001 | 0.0 | 0.0 | 149.00 | 14.90 | 0.439 | 0.383 | 7.0 | 5.94 | 33.4 |
| 100 | choppy | -4.94 | 0.11 | 0.8540 | 0.78 | 0.2041 | -0.72 | 0.2666 | 0.1519 | <0.0001 | <0.0001 | 0.0 | 0.0 | 154.97 | 15.50 | 0.387 | 0.335 | 7.0 | 5.95 | 33.1 |
| 100 | stress_flash_crash | -10.10 | -0.64 | 0.2178 | 0.55 | 0.3050 | -0.35 | 0.5353 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 163.58 | 16.36 | 0.387 | 0.335 | 7.0 | 5.94 | 33.1 |
| 1000 | trending | -1.98 | 0.41 | 0.5295 | 0.90 | 0.1859 | -1.35 | 0.0619 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1502.28 | 15.02 | 0.433 | 0.365 | 7.0 | 6.18 | 32.7 |
| 1000 | mean_reverting | -6.77 | -0.33 | 0.0009 | 0.75 | <0.0001 | -0.98 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1483.45 | 14.83 | 0.436 | 0.381 | 7.0 | 6.16 | 33.1 |
| 1000 | choppy | -4.95 | -0.01 | 0.9908 | 0.78 | 0.1988 | -0.78 | 0.2197 | 0.9266 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1530.91 | 15.31 | 0.388 | 0.335 | 7.0 | 6.16 | 32.9 |
| 1000 | stress_flash_crash | -10.13 | -0.74 | 0.1480 | 0.61 | 0.2545 | -0.37 | 0.5039 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1618.34 | 16.18 | 0.388 | 0.335 | 7.0 | 6.15 | 32.9 |

#### Magnitude 0.006, arm Omix-Mp-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.80 | 1.71 | 0.0546 | 1.85 | 0.0388 | 0.31 | 0.7377 | <0.0001 | <0.0001 | 0.0529 | 0.4 | 0.0 | 29.97 | 29.97 | 0.433 | 0.370 | 5.0 | 3.78 | 41.5 |
| 10 | mean_reverting | -6.47 | 1.30 | 0.0084 | 1.45 | 0.0031 | 0.16 | 0.7554 | <0.0001 | <0.0001 | 0.1145 | 0.4 | 0.0 | 31.05 | 31.05 | 0.445 | 0.383 | 4.9 | 3.86 | 40.1 |
| 10 | choppy | -4.57 | 1.15 | 0.1061 | 1.23 | 0.0853 | -0.01 | 0.9918 | <0.0001 | <0.0001 | 0.9482 | 0.4 | 0.0 | 32.58 | 32.58 | 0.379 | 0.322 | 4.9 | 3.85 | 40.9 |
| 10 | stress_flash_crash | -10.22 | 0.41 | 0.5332 | 0.64 | 0.3220 | -0.26 | 0.7061 | 0.0145 | 0.0002 | 0.0527 | 0.4 | 0.0 | 33.02 | 33.02 | 0.379 | 0.324 | 4.8 | 3.86 | 40.8 |
| 100 | trending | -1.00 | 1.50 | 0.0346 | 1.99 | 0.0070 | -0.12 | 0.8770 | <0.0001 | <0.0001 | 0.0018 | 36.1 | 0.0 | 192.77 | 19.28 | 0.431 | 0.324 | 7.0 | 5.94 | 32.2 |
| 100 | mean_reverting | -6.05 | 0.53 | 0.0029 | 1.47 | <0.0001 | -0.19 | 0.3048 | <0.0001 | <0.0001 | <0.0001 | 35.5 | 0.0 | 187.56 | 18.76 | 0.439 | 0.352 | 7.0 | 5.85 | 33.5 |
| 100 | choppy | -4.37 | 0.68 | 0.2620 | 1.35 | 0.0333 | -0.15 | 0.8252 | <0.0001 | <0.0001 | 0.0001 | 34.3 | 0.0 | 189.57 | 18.96 | 0.387 | 0.304 | 7.0 | 5.87 | 33.1 |
| 100 | stress_flash_crash | -9.93 | -0.47 | 0.3688 | 0.72 | 0.1892 | -0.18 | 0.7498 | <0.0001 | <0.0001 | <0.0001 | 32.4 | 0.0 | 193.62 | 19.36 | 0.387 | 0.308 | 7.0 | 5.89 | 32.9 |
| 1000 | trending | -0.96 | 1.43 | 0.0345 | 1.93 | 0.0070 | -0.33 | 0.6571 | <0.0001 | <0.0001 | <0.0001 | 387.1 | 0.0 | 2027.27 | 20.27 | 0.433 | 0.323 | 7.1 | 6.09 | 33.0 |
| 1000 | mean_reverting | -6.04 | 0.40 | 0.0001 | 1.48 | <0.0001 | -0.24 | 0.0326 | <0.0001 | <0.0001 | <0.0001 | 396.7 | 0.0 | 1951.76 | 19.52 | 0.436 | 0.348 | 7.0 | 6.09 | 33.1 |
| 1000 | choppy | -4.37 | 0.57 | 0.3357 | 1.36 | 0.0309 | -0.20 | 0.7542 | <0.0001 | <0.0001 | <0.0001 | 382.8 | 0.0 | 1993.93 | 19.94 | 0.388 | 0.305 | 7.1 | 6.07 | 33.3 |
| 1000 | stress_flash_crash | -9.95 | -0.57 | 0.2744 | 0.78 | 0.1520 | -0.20 | 0.7233 | <0.0001 | <0.0001 | <0.0001 | 362.4 | 0.0 | 2023.89 | 20.24 | 0.388 | 0.307 | 7.1 | 6.08 | 33.3 |

#### Magnitude 0.006, arm RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.13 | 1.38 | 0.0933 | 1.51 | 0.0665 | -0.02 | 0.9808 | <0.0001 | <0.0001 | 0.6735 | 0.0 | 0.0 | 9.81 | 9.81 | 0.433 | 0.375 | 4.9 | 4.13 | 39.4 |
| 10 | mean_reverting | -6.60 | 1.17 | 0.0125 | 1.32 | 0.0046 | 0.03 | 0.9542 | <0.0001 | <0.0001 | 0.5999 | 0.0 | 0.0 | 9.89 | 9.89 | 0.445 | 0.396 | 4.9 | 4.10 | 40.9 |
| 10 | choppy | -4.63 | 1.09 | 0.1149 | 1.17 | 0.0920 | -0.07 | 0.9274 | <0.0001 | <0.0001 | 0.3537 | 0.0 | 0.0 | 10.85 | 10.85 | 0.379 | 0.326 | 4.9 | 4.13 | 39.5 |
| 10 | stress_flash_crash | -9.86 | 0.77 | 0.2300 | 1.00 | 0.1139 | 0.11 | 0.8729 | <0.0001 | <0.0001 | 0.0908 | 0.0 | 0.0 | 11.27 | 11.27 | 0.379 | 0.327 | 4.9 | 4.13 | 39.4 |
| 100 | trending | -0.26 | 2.24 | 0.0010 | 2.73 | 0.0001 | 0.62 | 0.3943 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 152.70 | 15.27 | 0.431 | 0.301 | 7.0 | 5.85 | 32.6 |
| 100 | mean_reverting | -4.79 | 1.79 | <0.0001 | 2.73 | <0.0001 | 1.07 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 150.46 | 15.05 | 0.439 | 0.339 | 7.0 | 5.70 | 34.8 |
| 100 | choppy | -3.34 | 1.71 | 0.0037 | 2.38 | 0.0001 | 0.88 | 0.1645 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 152.06 | 15.21 | 0.387 | 0.287 | 7.0 | 5.76 | 33.9 |
| 100 | stress_flash_crash | -8.39 | 1.07 | 0.0354 | 2.26 | <0.0001 | 1.36 | 0.0145 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 154.00 | 15.40 | 0.387 | 0.292 | 7.0 | 5.76 | 33.9 |
| 1000 | trending | 0.16 | 2.55 | 0.0001 | 3.05 | <0.0001 | 0.80 | 0.2625 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1734.97 | 17.35 | 0.433 | 0.286 | 7.0 | 5.97 | 33.2 |
| 1000 | mean_reverting | -4.49 | 1.95 | <0.0001 | 3.03 | <0.0001 | 1.31 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1727.21 | 17.27 | 0.436 | 0.321 | 7.0 | 5.96 | 33.2 |
| 1000 | choppy | -3.02 | 1.93 | 0.0010 | 2.71 | <0.0001 | 1.15 | 0.0694 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1742.39 | 17.42 | 0.388 | 0.276 | 7.0 | 5.95 | 33.4 |
| 1000 | stress_flash_crash | -8.16 | 1.22 | 0.0158 | 2.58 | <0.0001 | 1.59 | 0.0043 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1737.99 | 17.38 | 0.388 | 0.282 | 7.0 | 5.97 | 33.3 |

#### Magnitude 0.006, arm O3-RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.08 | 2.43 | 0.0057 | 2.57 | 0.0037 | 1.03 | 0.2576 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 32.23 | 32.23 | 0.433 | 0.345 | 4.9 | 3.65 | 42.6 |
| 10 | mean_reverting | -5.88 | 1.89 | 0.0005 | 2.03 | 0.0002 | 0.74 | 0.1728 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 32.00 | 32.00 | 0.445 | 0.362 | 4.9 | 3.57 | 44.1 |
| 10 | choppy | -3.81 | 1.91 | 0.0145 | 1.99 | 0.0112 | 0.75 | 0.3618 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 33.82 | 33.82 | 0.379 | 0.301 | 4.9 | 3.55 | 44.6 |
| 10 | stress_flash_crash | -9.43 | 1.20 | 0.0857 | 1.43 | 0.0386 | 0.54 | 0.4551 | <0.0001 | <0.0001 | 0.0004 | 0.0 | 0.0 | 34.93 | 34.93 | 0.379 | 0.300 | 4.8 | 3.56 | 44.8 |
| 100 | trending | 0.55 | 3.06 | <0.0001 | 3.55 | <0.0001 | 1.44 | 0.0613 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 437.97 | 43.80 | 0.431 | 0.314 | 7.0 | 5.74 | 32.8 |
| 100 | mean_reverting | -4.43 | 2.14 | <0.0001 | 3.09 | <0.0001 | 1.43 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 428.28 | 42.83 | 0.439 | 0.329 | 7.0 | 5.73 | 33.4 |
| 100 | choppy | -2.77 | 2.28 | 0.0004 | 2.95 | <0.0001 | 1.46 | 0.0320 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 435.30 | 43.53 | 0.387 | 0.286 | 7.0 | 5.63 | 34.0 |
| 100 | stress_flash_crash | -8.38 | 1.08 | 0.0483 | 2.27 | 0.0001 | 1.37 | 0.0205 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 439.32 | 43.93 | 0.387 | 0.289 | 7.0 | 5.66 | 33.9 |
| 1000 | trending | 0.82 | 3.21 | <0.0001 | 3.71 | <0.0001 | 1.45 | 0.0510 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 4605.82 | 46.06 | 0.433 | 0.309 | 7.0 | 6.01 | 32.8 |
| 1000 | mean_reverting | -4.22 | 2.22 | <0.0001 | 3.30 | <0.0001 | 1.57 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 4449.64 | 44.50 | 0.436 | 0.322 | 7.0 | 6.04 | 32.7 |
| 1000 | choppy | -2.56 | 2.39 | 0.0001 | 3.17 | <0.0001 | 1.61 | 0.0155 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 4576.32 | 45.76 | 0.388 | 0.283 | 7.0 | 6.00 | 32.8 |
| 1000 | stress_flash_crash | -8.24 | 1.15 | 0.0318 | 2.50 | <0.0001 | 1.52 | 0.0092 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 4554.53 | 45.55 | 0.388 | 0.287 | 7.0 | 6.03 | 32.8 |

#### Magnitude 0.006, arm O5-RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.17 | 2.35 | 0.0073 | 2.48 | 0.0047 | 0.95 | 0.2971 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 23.01 | 23.01 | 0.433 | 0.344 | 4.9 | 3.82 | 41.0 |
| 10 | mean_reverting | -6.00 | 1.76 | 0.0007 | 1.91 | 0.0002 | 0.62 | 0.2406 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 22.56 | 22.56 | 0.445 | 0.371 | 4.9 | 3.77 | 43.0 |
| 10 | choppy | -3.81 | 1.91 | 0.0105 | 1.99 | 0.0079 | 0.75 | 0.3423 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 23.79 | 23.79 | 0.379 | 0.297 | 4.9 | 3.78 | 43.6 |
| 10 | stress_flash_crash | -9.45 | 1.18 | 0.0771 | 1.41 | 0.0326 | 0.52 | 0.4526 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 24.67 | 24.67 | 0.379 | 0.300 | 4.9 | 3.77 | 43.7 |
| 100 | trending | 0.47 | 2.97 | <0.0001 | 3.47 | <0.0001 | 1.36 | 0.0761 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 321.44 | 32.14 | 0.431 | 0.296 | 7.0 | 5.71 | 33.0 |
| 100 | mean_reverting | -4.40 | 2.18 | <0.0001 | 3.12 | <0.0001 | 1.46 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 309.90 | 30.99 | 0.439 | 0.317 | 7.0 | 5.68 | 33.7 |
| 100 | choppy | -2.81 | 2.25 | 0.0004 | 2.92 | <0.0001 | 1.42 | 0.0340 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 316.36 | 31.64 | 0.387 | 0.275 | 7.0 | 5.65 | 33.6 |
| 100 | stress_flash_crash | -8.24 | 1.22 | 0.0242 | 2.42 | <0.0001 | 1.51 | 0.0101 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 314.56 | 31.46 | 0.387 | 0.278 | 7.0 | 5.67 | 33.2 |
| 1000 | trending | 0.73 | 3.12 | <0.0001 | 3.62 | <0.0001 | 1.36 | 0.0637 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3389.12 | 33.89 | 0.433 | 0.290 | 7.0 | 5.94 | 33.0 |
| 1000 | mean_reverting | -4.20 | 2.24 | <0.0001 | 3.32 | <0.0001 | 1.59 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3270.18 | 32.70 | 0.436 | 0.307 | 7.0 | 5.95 | 33.1 |
| 1000 | choppy | -2.59 | 2.35 | 0.0001 | 3.14 | <0.0001 | 1.57 | 0.0168 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3371.68 | 33.72 | 0.388 | 0.268 | 7.0 | 5.90 | 33.2 |
| 1000 | stress_flash_crash | -8.10 | 1.29 | 0.0150 | 2.64 | <0.0001 | 1.66 | 0.0042 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3312.75 | 33.13 | 0.388 | 0.272 | 7.0 | 5.94 | 33.0 |

#### Magnitude 0.006, arm O10-RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.96 | 1.56 | 0.0598 | 1.69 | 0.0416 | 0.15 | 0.8582 | <0.0001 | <0.0001 | 0.0276 | 0.0 | 0.0 | 11.74 | 11.74 | 0.433 | 0.366 | 4.9 | 4.07 | 40.2 |
| 10 | mean_reverting | -6.43 | 1.33 | 0.0055 | 1.48 | 0.0019 | 0.19 | 0.7015 | <0.0001 | <0.0001 | 0.0095 | 0.0 | 0.0 | 12.03 | 12.03 | 0.445 | 0.388 | 4.9 | 4.03 | 41.9 |
| 10 | choppy | -4.49 | 1.23 | 0.0810 | 1.31 | 0.0642 | 0.07 | 0.9270 | <0.0001 | <0.0001 | 0.2481 | 0.0 | 0.0 | 12.67 | 12.67 | 0.379 | 0.317 | 4.9 | 4.10 | 39.4 |
| 10 | stress_flash_crash | -9.78 | 0.85 | 0.1896 | 1.08 | 0.0913 | 0.19 | 0.7791 | <0.0001 | <0.0001 | 0.0121 | 0.0 | 0.0 | 13.03 | 13.03 | 0.379 | 0.319 | 4.9 | 4.10 | 39.3 |
| 100 | trending | -0.29 | 2.22 | 0.0013 | 2.71 | 0.0002 | 0.60 | 0.4160 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 187.18 | 18.72 | 0.431 | 0.301 | 7.0 | 5.79 | 32.4 |
| 100 | mean_reverting | -4.87 | 1.71 | <0.0001 | 2.65 | <0.0001 | 0.99 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 182.08 | 18.21 | 0.439 | 0.331 | 7.0 | 5.69 | 34.4 |
| 100 | choppy | -3.36 | 1.70 | 0.0046 | 2.37 | 0.0002 | 0.87 | 0.1763 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 185.18 | 18.52 | 0.387 | 0.284 | 7.0 | 5.72 | 34.0 |
| 100 | stress_flash_crash | -8.43 | 1.03 | 0.0460 | 2.22 | <0.0001 | 1.32 | 0.0190 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 185.43 | 18.54 | 0.387 | 0.288 | 7.0 | 5.75 | 33.5 |
| 1000 | trending | -0.04 | 2.35 | 0.0003 | 2.85 | <0.0001 | 0.59 | 0.4055 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2022.30 | 20.22 | 0.433 | 0.292 | 7.0 | 5.97 | 33.3 |
| 1000 | mean_reverting | -4.68 | 1.76 | <0.0001 | 2.84 | <0.0001 | 1.11 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1968.40 | 19.68 | 0.436 | 0.320 | 7.0 | 5.98 | 33.1 |
| 1000 | choppy | -3.15 | 1.79 | 0.0021 | 2.58 | <0.0001 | 1.01 | 0.1094 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2017.22 | 20.17 | 0.388 | 0.276 | 7.0 | 5.95 | 33.3 |
| 1000 | stress_flash_crash | -8.29 | 1.10 | 0.0312 | 2.45 | <0.0001 | 1.47 | 0.0088 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1989.45 | 19.89 | 0.388 | 0.281 | 7.0 | 5.97 | 33.3 |

#### Magnitude 0.006, arm Omix-RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -1.65 | 1.87 | 0.0361 | 2.00 | 0.0252 | 0.46 | 0.6171 | <0.0001 | <0.0001 | 0.0050 | 0.0 | 0.0 | 30.11 | 30.11 | 0.433 | 0.371 | 4.8 | 3.75 | 42.0 |
| 10 | mean_reverting | -6.32 | 1.45 | 0.0034 | 1.59 | 0.0012 | 0.30 | 0.5474 | <0.0001 | <0.0001 | 0.0165 | 0.0 | 0.0 | 30.34 | 30.34 | 0.445 | 0.385 | 4.8 | 3.81 | 41.3 |
| 10 | choppy | -4.46 | 1.26 | 0.0721 | 1.34 | 0.0569 | 0.10 | 0.8920 | <0.0001 | <0.0001 | 0.4631 | 0.0 | 0.0 | 30.75 | 30.75 | 0.379 | 0.326 | 4.8 | 3.77 | 42.2 |
| 10 | stress_flash_crash | -9.99 | 0.63 | 0.3260 | 0.86 | 0.1748 | -0.03 | 0.9675 | <0.0001 | <0.0001 | 0.8537 | 0.0 | 0.0 | 31.75 | 31.75 | 0.379 | 0.328 | 4.7 | 3.78 | 42.1 |
| 100 | trending | -0.35 | 2.16 | 0.0017 | 2.65 | 0.0002 | 0.54 | 0.4643 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 198.01 | 19.80 | 0.431 | 0.314 | 7.0 | 5.87 | 32.5 |
| 100 | mean_reverting | -4.97 | 1.61 | <0.0001 | 2.55 | <0.0001 | 0.89 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 192.08 | 19.21 | 0.439 | 0.343 | 7.0 | 5.74 | 34.5 |
| 100 | choppy | -3.42 | 1.63 | 0.0057 | 2.30 | 0.0002 | 0.81 | 0.2056 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 199.60 | 19.96 | 0.387 | 0.295 | 7.0 | 5.77 | 33.7 |
| 100 | stress_flash_crash | -8.55 | 0.91 | 0.0741 | 2.10 | 0.0001 | 1.20 | 0.0311 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 199.20 | 19.92 | 0.387 | 0.300 | 7.0 | 5.80 | 33.4 |
| 1000 | trending | -0.15 | 2.24 | 0.0006 | 2.74 | <0.0001 | 0.48 | 0.4983 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2069.31 | 20.69 | 0.433 | 0.308 | 7.0 | 6.07 | 32.9 |
| 1000 | mean_reverting | -4.78 | 1.66 | <0.0001 | 2.73 | <0.0001 | 1.01 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2019.87 | 20.20 | 0.436 | 0.335 | 7.0 | 6.05 | 33.2 |
| 1000 | choppy | -3.24 | 1.70 | 0.0033 | 2.49 | <0.0001 | 0.93 | 0.1430 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2071.09 | 20.71 | 0.388 | 0.290 | 7.0 | 6.04 | 33.3 |
| 1000 | stress_flash_crash | -8.38 | 1.00 | 0.0474 | 2.36 | <0.0001 | 1.37 | 0.0137 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2067.49 | 20.67 | 0.388 | 0.295 | 7.0 | 6.04 | 33.3 |

### Magnitude 0.009

| arm | vs C1: cells p < 0.05 | vs C1: median gap pp | vs C1: stress | vs C1: call | vs C2: cells p < 0.05 | vs C2: median gap pp | vs C2: stress | vs C2: call | arm B | vs B: cells p < 0.05 | vs B: median gap pp | vs B: stress | vs B: call | moved % of start, mean of 12 cells |
|---|---|---:|---|---|---|---:|---|---|---|---|---:|---|---|---:|
| C2 | 1 (0 up, 1 down) | -0.12 | inconclusive (0 up, 0 down) | **inconclusive** | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0.00 |
| B-c0.2-x2 | 10 (10 up, 0 down) | 2.31 | inconclusive (1 up, 0 down) | **outperforms** | 11 (11 up, 0 down) | 2.46 | outperforms (2 up, 0 down) | **outperforms** | n/a | n/a | n/a | n/a | n/a | 10.60 |
| B-c0.2-x4 | 11 (11 up, 0 down) | 2.64 | outperforms (2 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.75 | outperforms (3 up, 0 down) | **outperforms** | n/a | n/a | n/a | n/a | n/a | 14.06 |
| N | 4 (0 up, 4 down) | -1.13 | underperforms (0 up, 2 down) | **inconclusive** | 3 (0 up, 3 down) | -0.77 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x4 | 12 (0 up, 12 down) | -3.32 | underperforms (0 up, 3 down) | **underperforms** | 0.00 |
| RO-c0.2-x2 | 5 (5 up, 0 down) | 1.23 | inconclusive (0 up, 0 down) | **inconclusive** | 3 (3 up, 0 down) | 1.30 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x2 | 4 (0 up, 4 down) | -1.09 | inconclusive (0 up, 0 down) | **inconclusive** | 9.40 |
| O3-N-c0.2-x2 | 10 (10 up, 0 down) | 2.43 | inconclusive (1 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.56 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x2 | 1 (0 up, 1 down) | -0.13 | inconclusive (0 up, 0 down) | **inconclusive** | 29.64 |
| O3-Mo-c0.2-x2 | 12 (12 up, 0 down) | 2.88 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 3.01 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x2 | 0 (0 up, 0 down) | 0.35 | inconclusive (0 up, 0 down) | **inconclusive** | 31.01 |
| O3-Mp-c0.2-x2 | 12 (12 up, 0 down) | 3.21 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 3.43 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x2 | 2 (2 up, 0 down) | 0.78 | inconclusive (0 up, 0 down) | **inconclusive** | 32.17 |
| O5-N-c0.2-x2 | 10 (10 up, 0 down) | 1.98 | inconclusive (1 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.07 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x2 | 2 (0 up, 2 down) | -0.55 | inconclusive (0 up, 0 down) | **inconclusive** | 18.25 |
| O5-Mo-c0.2-x2 | 10 (10 up, 0 down) | 2.71 | inconclusive (1 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.88 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x2 | 0 (0 up, 0 down) | 0.21 | inconclusive (0 up, 0 down) | **inconclusive** | 19.37 |
| O5-Mp-c0.2-x2 | 12 (12 up, 0 down) | 2.87 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 3.08 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x2 | 1 (1 up, 0 down) | 0.45 | inconclusive (0 up, 0 down) | **inconclusive** | 19.99 |
| O10-N-c0.2-x2 | 3 (3 up, 0 down) | 0.97 | inconclusive (0 up, 0 down) | **inconclusive** | 3 (3 up, 0 down) | 0.99 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x2 | 6 (0 up, 6 down) | -1.39 | inconclusive (0 up, 0 down) | **mixed** | 9.03 |
| O10-Mo-c0.2-x2 | 9 (9 up, 0 down) | 2.11 | inconclusive (0 up, 0 down) | **outperforms** | 11 (11 up, 0 down) | 2.32 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x2 | 1 (0 up, 1 down) | -0.28 | inconclusive (0 up, 0 down) | **inconclusive** | 9.89 |
| O10-Mp-c0.2-x2 | 9 (9 up, 0 down) | 2.12 | inconclusive (0 up, 0 down) | **outperforms** | 11 (11 up, 0 down) | 2.37 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x2 | 0 (0 up, 0 down) | -0.24 | inconclusive (0 up, 0 down) | **inconclusive** | 10.21 |
| Omix-N-c0.2-x2 | 5 (5 up, 0 down) | 1.10 | inconclusive (0 up, 0 down) | **inconclusive** | 5 (5 up, 0 down) | 1.09 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x2 | 5 (0 up, 5 down) | -1.31 | inconclusive (0 up, 0 down) | **inconclusive** | 17.98 |
| Omix-Mo-c0.2-x2 | 9 (9 up, 0 down) | 1.87 | inconclusive (0 up, 0 down) | **outperforms** | 11 (11 up, 0 down) | 2.06 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x2 | 2 (0 up, 2 down) | -0.59 | inconclusive (0 up, 0 down) | **inconclusive** | 18.82 |
| Omix-Mp-c0.2-x2 | 9 (9 up, 0 down) | 2.18 | inconclusive (0 up, 0 down) | **outperforms** | 11 (11 up, 0 down) | 2.37 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x2 | 1 (0 up, 1 down) | -0.29 | inconclusive (0 up, 0 down) | **inconclusive** | 19.58 |
| RO-c0.2-x4 | 7 (7 up, 0 down) | 1.42 | inconclusive (0 up, 0 down) | **outperforms** | 10 (10 up, 0 down) | 1.55 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x4 | 5 (0 up, 5 down) | -1.14 | inconclusive (0 up, 0 down) | **inconclusive** | 11.32 |
| O3-N-c0.2-x4 | 10 (10 up, 0 down) | 2.63 | inconclusive (1 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.75 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 1 (0 up, 1 down) | -0.18 | inconclusive (0 up, 0 down) | **inconclusive** | 33.03 |
| O3-Mo-c0.2-x4 | 12 (12 up, 0 down) | 3.18 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 3.30 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 0 (0 up, 0 down) | 0.33 | inconclusive (0 up, 0 down) | **inconclusive** | 36.66 |
| O3-Mp-c0.2-x4 | 12 (12 up, 0 down) | 3.48 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 3.74 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 1 (1 up, 0 down) | 0.77 | inconclusive (0 up, 0 down) | **inconclusive** | 37.91 |
| O5-N-c0.2-x4 | 10 (10 up, 0 down) | 2.19 | inconclusive (1 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.33 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 2 (0 up, 2 down) | -0.57 | inconclusive (0 up, 0 down) | **inconclusive** | 21.68 |
| O5-Mo-c0.2-x4 | 12 (12 up, 0 down) | 3.10 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 3.32 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 0 (0 up, 0 down) | 0.35 | inconclusive (0 up, 0 down) | **inconclusive** | 25.71 |
| O5-Mp-c0.2-x4 | 12 (12 up, 0 down) | 3.29 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 3.54 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 1 (1 up, 0 down) | 0.57 | inconclusive (0 up, 0 down) | **inconclusive** | 26.02 |
| O10-N-c0.2-x4 | 5 (5 up, 0 down) | 1.23 | inconclusive (0 up, 0 down) | **inconclusive** | 4 (4 up, 0 down) | 1.22 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x4 | 6 (0 up, 6 down) | -1.42 | inconclusive (0 up, 0 down) | **mixed** | 11.38 |
| O10-Mo-c0.2-x4 | 9 (9 up, 0 down) | 2.54 | inconclusive (0 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.71 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 1 (0 up, 1 down) | -0.15 | inconclusive (0 up, 0 down) | **inconclusive** | 15.00 |
| O10-Mp-c0.2-x4 | 9 (9 up, 0 down) | 2.56 | inconclusive (0 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.75 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 0 (0 up, 0 down) | -0.12 | inconclusive (0 up, 0 down) | **inconclusive** | 15.07 |
| Omix-N-c0.2-x4 | 7 (7 up, 0 down) | 1.29 | inconclusive (0 up, 0 down) | **outperforms** | 5 (5 up, 0 down) | 1.30 | inconclusive (0 up, 0 down) | **inconclusive** | B-c0.2-x4 | 6 (0 up, 6 down) | -1.36 | inconclusive (0 up, 0 down) | **mixed** | 19.91 |
| Omix-Mo-c0.2-x4 | 9 (9 up, 0 down) | 2.19 | inconclusive (0 up, 0 down) | **outperforms** | 11 (11 up, 0 down) | 2.37 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x4 | 2 (0 up, 2 down) | -0.51 | inconclusive (0 up, 0 down) | **inconclusive** | 22.74 |
| Omix-Mp-c0.2-x4 | 9 (9 up, 0 down) | 2.39 | inconclusive (0 up, 0 down) | **outperforms** | 11 (11 up, 0 down) | 2.67 | outperforms (2 up, 0 down) | **outperforms** | B-c0.2-x4 | 1 (0 up, 1 down) | -0.25 | inconclusive (0 up, 0 down) | **inconclusive** | 23.35 |
| RT-c0.2-x4 | 11 (11 up, 0 down) | 2.66 | outperforms (2 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 3.15 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 1 (1 up, 0 down) | 0.06 | inconclusive (0 up, 0 down) | **inconclusive** | 13.95 |
| O3-RT-c0.2-x4 | 12 (12 up, 0 down) | 4.05 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 4.28 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 4 (4 up, 0 down) | 1.35 | outperforms (2 up, 0 down) | **inconclusive** | 40.39 |
| O5-RT-c0.2-x4 | 12 (12 up, 0 down) | 3.92 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 4.07 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 4 (4 up, 0 down) | 1.18 | outperforms (2 up, 0 down) | **inconclusive** | 29.03 |
| O10-RT-c0.2-x4 | 12 (12 up, 0 down) | 2.75 | outperforms (3 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 3.07 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 0 (0 up, 0 down) | 0.15 | inconclusive (0 up, 0 down) | **inconclusive** | 16.63 |
| Omix-RT-c0.2-x4 | 11 (11 up, 0 down) | 2.77 | outperforms (2 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.97 | outperforms (3 up, 0 down) | **outperforms** | B-c0.2-x4 | 0 (0 up, 0 down) | 0.06 | inconclusive (0 up, 0 down) | **inconclusive** | 23.18 |

Owner scope against population-wide ranking with the same replacement setting and ceiling (no-replacement and retire arms; for mutant arms the counterpart is arm B, above):

| arm | counterpart | cells p < 0.05 | median gap pp | stress | call |
|---|---|---|---:|---|---|
| O3-N-c0.2-x2 | RO-c0.2-x2 | 3 (3 up, 0 down) | 1.27 | inconclusive (0 up, 0 down) | **inconclusive** |
| O5-N-c0.2-x2 | RO-c0.2-x2 | 2 (2 up, 0 down) | 0.75 | inconclusive (0 up, 0 down) | **inconclusive** |
| O10-N-c0.2-x2 | RO-c0.2-x2 | 1 (0 up, 1 down) | -0.31 | inconclusive (0 up, 0 down) | **inconclusive** |
| Omix-N-c0.2-x2 | RO-c0.2-x2 | 0 (0 up, 0 down) | -0.21 | inconclusive (0 up, 0 down) | **inconclusive** |
| O3-N-c0.2-x4 | RO-c0.2-x4 | 2 (2 up, 0 down) | 1.24 | inconclusive (0 up, 0 down) | **inconclusive** |
| O5-N-c0.2-x4 | RO-c0.2-x4 | 2 (2 up, 0 down) | 0.77 | inconclusive (0 up, 0 down) | **inconclusive** |
| O10-N-c0.2-x4 | RO-c0.2-x4 | 1 (0 up, 1 down) | -0.28 | inconclusive (0 up, 0 down) | **inconclusive** |
| Omix-N-c0.2-x4 | RO-c0.2-x4 | 1 (0 up, 1 down) | -0.23 | inconclusive (0 up, 0 down) | **inconclusive** |
| O3-RT-c0.2-x4 | RT-c0.2-x4 | 2 (2 up, 0 down) | 1.14 | inconclusive (0 up, 0 down) | **inconclusive** |
| O5-RT-c0.2-x4 | RT-c0.2-x4 | 2 (2 up, 0 down) | 0.98 | inconclusive (0 up, 0 down) | **inconclusive** |
| O10-RT-c0.2-x4 | RT-c0.2-x4 | 0 (0 up, 0 down) | -0.03 | inconclusive (0 up, 0 down) | **inconclusive** |
| Omix-RT-c0.2-x4 | RT-c0.2-x4 | 1 (0 up, 1 down) | -0.17 | inconclusive (0 up, 0 down) | **inconclusive** |

Capital-weighted genome distance from the regime optimum, mean over the 12 cells and over seeds, at each trace tick, with the mean effective number of niches and the top niche's share of active capital at the end:

| arm | t0 | t60 | t120 | t180 | t240 | t300 | effective niches | top niche % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| C1 | 0.410 | 0.403 | 0.392 | 0.384 | 0.374 | 0.365 | 5.57 | 34.1 |
| C2 | 0.410 | 0.403 | 0.394 | 0.387 | 0.379 | 0.372 | 5.65 | 33.4 |
| B-c0.2-x2 | 0.410 | 0.380 | 0.354 | 0.340 | 0.328 | 0.318 | 5.42 | 34.5 |
| B-c0.2-x4 | 0.410 | 0.380 | 0.353 | 0.334 | 0.319 | 0.308 | 5.30 | 35.4 |
| N | 0.410 | 0.408 | 0.404 | 0.402 | 0.398 | 0.395 | 5.56 | 34.7 |
| RO-c0.2-x2 | 0.410 | 0.386 | 0.369 | 0.361 | 0.355 | 0.350 | 5.40 | 35.3 |
| O3-N-c0.2-x2 | 0.410 | 0.372 | 0.349 | 0.338 | 0.331 | 0.326 | 5.22 | 36.3 |
| O3-Mo-c0.2-x2 | 0.410 | 0.368 | 0.341 | 0.330 | 0.323 | 0.318 | 5.21 | 36.2 |
| O3-Mp-c0.2-x2 | 0.410 | 0.366 | 0.336 | 0.323 | 0.315 | 0.309 | 5.20 | 36.0 |
| O5-N-c0.2-x2 | 0.410 | 0.377 | 0.356 | 0.347 | 0.341 | 0.335 | 5.31 | 36.1 |
| O5-Mo-c0.2-x2 | 0.410 | 0.371 | 0.344 | 0.333 | 0.325 | 0.319 | 5.32 | 35.6 |
| O5-Mp-c0.2-x2 | 0.410 | 0.371 | 0.342 | 0.329 | 0.320 | 0.313 | 5.31 | 35.6 |
| O10-N-c0.2-x2 | 0.410 | 0.388 | 0.372 | 0.366 | 0.360 | 0.355 | 5.42 | 35.4 |
| O10-Mo-c0.2-x2 | 0.410 | 0.381 | 0.356 | 0.344 | 0.333 | 0.324 | 5.45 | 34.3 |
| O10-Mp-c0.2-x2 | 0.410 | 0.381 | 0.356 | 0.343 | 0.332 | 0.322 | 5.44 | 34.3 |
| Omix-N-c0.2-x2 | 0.410 | 0.386 | 0.370 | 0.362 | 0.357 | 0.352 | 5.32 | 35.8 |
| Omix-Mo-c0.2-x2 | 0.410 | 0.381 | 0.359 | 0.349 | 0.340 | 0.334 | 5.31 | 35.7 |
| Omix-Mp-c0.2-x2 | 0.410 | 0.380 | 0.356 | 0.343 | 0.333 | 0.325 | 5.33 | 35.3 |
| RO-c0.2-x4 | 0.410 | 0.386 | 0.369 | 0.357 | 0.348 | 0.341 | 5.34 | 35.7 |
| O3-N-c0.2-x4 | 0.410 | 0.372 | 0.348 | 0.335 | 0.325 | 0.317 | 5.15 | 36.7 |
| O3-Mo-c0.2-x4 | 0.410 | 0.368 | 0.341 | 0.325 | 0.315 | 0.307 | 5.11 | 36.6 |
| O3-Mp-c0.2-x4 | 0.410 | 0.366 | 0.336 | 0.318 | 0.307 | 0.298 | 5.08 | 36.5 |
| O5-N-c0.2-x4 | 0.410 | 0.377 | 0.356 | 0.342 | 0.333 | 0.324 | 5.22 | 36.6 |
| O5-Mo-c0.2-x4 | 0.410 | 0.371 | 0.343 | 0.325 | 0.312 | 0.303 | 5.17 | 36.3 |
| O5-Mp-c0.2-x4 | 0.410 | 0.371 | 0.341 | 0.322 | 0.308 | 0.298 | 5.15 | 36.3 |
| O10-N-c0.2-x4 | 0.410 | 0.388 | 0.372 | 0.361 | 0.353 | 0.345 | 5.36 | 35.8 |
| O10-Mo-c0.2-x4 | 0.410 | 0.381 | 0.354 | 0.336 | 0.322 | 0.310 | 5.31 | 35.3 |
| O10-Mp-c0.2-x4 | 0.410 | 0.381 | 0.354 | 0.335 | 0.321 | 0.309 | 5.31 | 35.3 |
| Omix-N-c0.2-x4 | 0.410 | 0.386 | 0.370 | 0.360 | 0.351 | 0.345 | 5.27 | 36.0 |
| Omix-Mo-c0.2-x4 | 0.410 | 0.381 | 0.358 | 0.343 | 0.332 | 0.323 | 5.22 | 36.1 |
| Omix-Mp-c0.2-x4 | 0.410 | 0.380 | 0.354 | 0.338 | 0.325 | 0.316 | 5.23 | 35.7 |
| RT-c0.2-x4 | 0.410 | 0.382 | 0.358 | 0.339 | 0.321 | 0.305 | 5.24 | 35.9 |
| O3-RT-c0.2-x4 | 0.410 | 0.368 | 0.339 | 0.320 | 0.306 | 0.296 | 5.03 | 37.1 |
| O5-RT-c0.2-x4 | 0.410 | 0.373 | 0.343 | 0.321 | 0.303 | 0.287 | 5.05 | 37.0 |
| O10-RT-c0.2-x4 | 0.410 | 0.383 | 0.358 | 0.337 | 0.319 | 0.301 | 5.20 | 36.0 |
| Omix-RT-c0.2-x4 | 0.410 | 0.382 | 0.358 | 0.341 | 0.326 | 0.312 | 5.17 | 36.3 |

#### Magnitude 0.009, arm N

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 1.33 | -0.24 | 0.8279 | -0.20 | 0.8529 | -2.80 | 0.0160 | 0.0013 | 0.0026 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.416 | 5.0 | 4.37 | 38.2 |
| 10 | mean_reverting | -3.46 | -0.27 | 0.7244 | -0.20 | 0.7948 | -2.43 | 0.0035 | 0.0010 | 0.0171 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.445 | 0.430 | 5.0 | 4.34 | 38.8 |
| 10 | choppy | -0.44 | -0.18 | 0.8422 | -0.21 | 0.8173 | -2.42 | 0.0173 | 0.0040 | 0.0061 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.364 | 5.0 | 4.35 | 38.7 |
| 10 | stress_flash_crash | -6.27 | -0.31 | 0.6915 | -0.14 | 0.8618 | -1.89 | 0.0264 | 0.0051 | 0.0158 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.367 | 5.0 | 4.35 | 38.8 |
| 100 | trending | 1.52 | -1.13 | 0.1325 | -1.19 | 0.1330 | -4.98 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.431 | 0.411 | 7.0 | 6.10 | 32.6 |
| 100 | mean_reverting | -3.47 | -1.48 | <0.0001 | -1.04 | <0.0001 | -4.19 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.439 | 0.422 | 7.0 | 6.09 | 32.7 |
| 100 | choppy | -0.92 | -1.01 | 0.1437 | -0.91 | 0.2104 | -3.81 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.372 | 7.0 | 6.09 | 32.6 |
| 100 | stress_flash_crash | -6.43 | -1.34 | 0.0300 | -0.63 | 0.3236 | -2.74 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.375 | 7.0 | 6.09 | 32.7 |
| 1000 | trending | 1.40 | -1.32 | 0.0644 | -1.50 | 0.0487 | -5.47 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.413 | 7.0 | 6.24 | 32.9 |
| 1000 | mean_reverting | -3.54 | -1.67 | <0.0001 | -1.17 | <0.0001 | -4.45 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.436 | 0.419 | 7.0 | 6.24 | 32.9 |
| 1000 | choppy | -0.92 | -1.13 | 0.0842 | -1.00 | 0.1488 | -4.04 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.373 | 7.0 | 6.24 | 32.9 |
| 1000 | stress_flash_crash | -6.44 | -1.49 | 0.0121 | -0.62 | 0.3175 | -2.83 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.376 | 7.0 | 6.24 | 33.0 |

#### Magnitude 0.009, arm RO-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.61 | 2.04 | 0.0747 | 2.08 | 0.0696 | -0.23 | 0.8419 | <0.0001 | <0.0001 | 0.0086 | 0.0 | 0.0 | 8.71 | 8.71 | 0.433 | 0.374 | 5.0 | 4.16 | 39.4 |
| 10 | mean_reverting | -1.47 | 1.73 | 0.0343 | 1.79 | 0.0291 | -0.15 | 0.8613 | <0.0001 | <0.0001 | 0.0202 | 0.0 | 0.0 | 8.83 | 8.83 | 0.445 | 0.394 | 5.0 | 4.12 | 41.3 |
| 10 | choppy | 1.48 | 1.74 | 0.0749 | 1.71 | 0.0810 | -0.29 | 0.7831 | <0.0001 | <0.0001 | 0.0103 | 0.0 | 0.0 | 8.76 | 8.76 | 0.379 | 0.329 | 4.9 | 4.11 | 40.1 |
| 10 | stress_flash_crash | -4.68 | 1.28 | 0.1200 | 1.46 | 0.0774 | -0.15 | 0.8624 | <0.0001 | <0.0001 | 0.0668 | 0.0 | 0.0 | 9.98 | 9.98 | 0.379 | 0.327 | 4.9 | 4.08 | 40.0 |
| 100 | trending | 4.24 | 1.59 | 0.0413 | 1.53 | 0.0601 | -1.82 | 0.0330 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 86.61 | 8.66 | 0.431 | 0.359 | 7.0 | 6.03 | 32.2 |
| 100 | mean_reverting | -1.12 | 0.87 | 0.0003 | 1.31 | <0.0001 | -1.46 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 90.15 | 9.02 | 0.439 | 0.376 | 7.0 | 5.93 | 33.5 |
| 100 | choppy | 1.28 | 1.19 | 0.0996 | 1.29 | 0.0872 | -1.33 | 0.0940 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 91.11 | 9.11 | 0.387 | 0.329 | 7.0 | 5.96 | 32.8 |
| 100 | stress_flash_crash | -4.62 | 0.48 | 0.4476 | 1.18 | 0.0745 | -0.82 | 0.2337 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 113.15 | 11.32 | 0.387 | 0.325 | 7.0 | 5.92 | 33.0 |
| 1000 | trending | 4.18 | 1.46 | 0.0460 | 1.28 | 0.0994 | -2.19 | 0.0081 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 863.95 | 8.64 | 0.433 | 0.360 | 7.0 | 6.15 | 32.8 |
| 1000 | mean_reverting | -1.16 | 0.71 | <0.0001 | 1.22 | <0.0001 | -1.66 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 904.78 | 9.05 | 0.436 | 0.372 | 7.0 | 6.14 | 32.9 |
| 1000 | choppy | 1.32 | 1.12 | 0.0990 | 1.24 | 0.0825 | -1.43 | 0.0575 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 922.92 | 9.23 | 0.388 | 0.329 | 7.0 | 6.14 | 33.0 |
| 1000 | stress_flash_crash | -4.62 | 0.34 | 0.5684 | 1.21 | 0.0583 | -0.85 | 0.1988 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1144.26 | 11.44 | 0.388 | 0.324 | 7.0 | 6.11 | 33.0 |

#### Magnitude 0.009, arm O3-N-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.35 | 3.78 | 0.0021 | 3.82 | 0.0019 | 1.50 | 0.2244 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 26.95 | 26.95 | 0.433 | 0.347 | 4.9 | 3.82 | 41.2 |
| 10 | mean_reverting | -0.22 | 2.97 | 0.0009 | 3.04 | 0.0008 | 1.10 | 0.2315 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 27.34 | 27.34 | 0.445 | 0.365 | 4.9 | 3.69 | 43.7 |
| 10 | choppy | 2.92 | 3.18 | 0.0036 | 3.15 | 0.0040 | 1.15 | 0.3088 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 27.58 | 27.58 | 0.379 | 0.303 | 4.9 | 3.78 | 43.3 |
| 10 | stress_flash_crash | -3.65 | 2.31 | 0.0126 | 2.48 | 0.0074 | 0.88 | 0.3601 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 30.01 | 30.01 | 0.379 | 0.300 | 4.7 | 3.70 | 44.1 |
| 100 | trending | 5.83 | 3.17 | 0.0001 | 3.12 | 0.0003 | -0.23 | 0.7878 | <0.0001 | <0.0001 | 0.0017 | 0.0 | 0.0 | 292.20 | 29.22 | 0.431 | 0.335 | 7.0 | 5.88 | 32.5 |
| 100 | mean_reverting | 0.11 | 2.10 | <0.0001 | 2.54 | <0.0001 | -0.24 | 0.4216 | <0.0001 | <0.0001 | 0.0101 | 0.0 | 0.0 | 299.81 | 29.98 | 0.439 | 0.352 | 7.0 | 5.87 | 32.8 |
| 100 | choppy | 2.56 | 2.47 | 0.0014 | 2.57 | 0.0014 | -0.04 | 0.9568 | <0.0001 | <0.0001 | 0.4820 | 0.0 | 0.0 | 300.07 | 30.01 | 0.387 | 0.307 | 7.0 | 5.82 | 33.4 |
| 100 | stress_flash_crash | -3.92 | 1.17 | 0.0806 | 1.88 | 0.0080 | -0.12 | 0.8683 | <0.0001 | <0.0001 | 0.0607 | 0.0 | 0.0 | 322.48 | 32.25 | 0.387 | 0.305 | 7.0 | 5.80 | 33.5 |
| 1000 | trending | 5.81 | 3.09 | <0.0001 | 2.91 | 0.0004 | -0.57 | 0.5001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2945.76 | 29.46 | 0.433 | 0.335 | 7.0 | 6.10 | 32.6 |
| 1000 | mean_reverting | 0.11 | 1.98 | <0.0001 | 2.48 | <0.0001 | -0.40 | 0.0059 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3020.72 | 30.21 | 0.436 | 0.348 | 7.0 | 6.10 | 32.8 |
| 1000 | choppy | 2.59 | 2.38 | 0.0009 | 2.51 | 0.0009 | -0.16 | 0.8366 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3030.78 | 30.31 | 0.388 | 0.307 | 7.0 | 6.07 | 32.8 |
| 1000 | stress_flash_crash | -3.92 | 1.04 | 0.1003 | 1.90 | 0.0047 | -0.15 | 0.8264 | <0.0001 | <0.0001 | 0.0008 | 0.0 | 0.0 | 3234.47 | 32.34 | 0.388 | 0.305 | 7.0 | 6.06 | 32.8 |

#### Magnitude 0.009, arm O3-Mo-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.48 | 3.92 | 0.0016 | 3.95 | 0.0014 | 1.64 | 0.1892 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.2 | 27.16 | 27.16 | 0.433 | 0.344 | 5.0 | 3.83 | 41.0 |
| 10 | mean_reverting | -0.17 | 3.02 | 0.0008 | 3.09 | 0.0006 | 1.14 | 0.2115 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.9 | 27.49 | 27.49 | 0.445 | 0.363 | 5.0 | 3.72 | 42.9 |
| 10 | choppy | 3.00 | 3.26 | 0.0031 | 3.23 | 0.0035 | 1.24 | 0.2802 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.6 | 27.93 | 27.93 | 0.379 | 0.301 | 5.0 | 3.81 | 42.8 |
| 10 | stress_flash_crash | -3.61 | 2.36 | 0.0116 | 2.53 | 0.0068 | 0.92 | 0.3389 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.4 | 30.37 | 30.37 | 0.379 | 0.298 | 4.8 | 3.72 | 43.9 |
| 100 | trending | 6.51 | 3.86 | <0.0001 | 3.80 | <0.0001 | 0.45 | 0.6076 | <0.0001 | <0.0001 | <0.0001 | 29.3 | 16.8 | 309.39 | 30.94 | 0.431 | 0.322 | 7.0 | 5.85 | 32.6 |
| 100 | mean_reverting | 0.59 | 2.58 | <0.0001 | 3.01 | <0.0001 | 0.24 | 0.4299 | <0.0001 | <0.0001 | 0.0191 | 28.4 | 18.0 | 316.90 | 31.69 | 0.439 | 0.342 | 7.0 | 5.84 | 33.0 |
| 100 | choppy | 2.99 | 2.90 | 0.0002 | 3.00 | 0.0003 | 0.39 | 0.6421 | <0.0001 | <0.0001 | <0.0001 | 28.9 | 13.4 | 317.44 | 31.74 | 0.387 | 0.297 | 7.0 | 5.79 | 33.4 |
| 100 | stress_flash_crash | -3.68 | 1.41 | 0.0388 | 2.12 | 0.0033 | 0.12 | 0.8687 | <0.0001 | <0.0001 | 0.1128 | 27.9 | 11.4 | 344.48 | 34.45 | 0.387 | 0.296 | 7.0 | 5.76 | 33.6 |
| 1000 | trending | 6.50 | 3.78 | <0.0001 | 3.59 | <0.0001 | 0.12 | 0.8868 | <0.0001 | <0.0001 | 0.0089 | 308.9 | 215.5 | 3130.80 | 31.31 | 0.433 | 0.323 | 7.0 | 6.08 | 32.7 |
| 1000 | mean_reverting | 0.62 | 2.49 | <0.0001 | 3.00 | <0.0001 | 0.12 | 0.3991 | <0.0001 | <0.0001 | <0.0001 | 313.9 | 203.3 | 3187.97 | 31.88 | 0.436 | 0.337 | 7.0 | 6.07 | 32.9 |
| 1000 | choppy | 3.06 | 2.85 | 0.0001 | 2.98 | 0.0001 | 0.31 | 0.6917 | <0.0001 | <0.0001 | <0.0001 | 320.5 | 155.2 | 3222.45 | 32.22 | 0.388 | 0.298 | 7.1 | 6.04 | 33.0 |
| 1000 | stress_flash_crash | -3.69 | 1.27 | 0.0467 | 2.14 | 0.0017 | 0.09 | 0.9004 | <0.0001 | <0.0001 | 0.0277 | 300.5 | 132.6 | 3491.82 | 34.92 | 0.388 | 0.296 | 7.1 | 6.03 | 33.0 |

#### Magnitude 0.009, arm O3-Mp-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.48 | 3.92 | 0.0015 | 3.95 | 0.0014 | 1.64 | 0.1868 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 27.14 | 27.14 | 0.433 | 0.343 | 5.0 | 3.87 | 40.0 |
| 10 | mean_reverting | -0.05 | 3.14 | 0.0005 | 3.21 | 0.0004 | 1.26 | 0.1685 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.0 | 27.77 | 27.77 | 0.445 | 0.359 | 5.0 | 3.76 | 42.0 |
| 10 | choppy | 3.13 | 3.38 | 0.0025 | 3.35 | 0.0027 | 1.36 | 0.2391 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 27.99 | 27.99 | 0.379 | 0.299 | 5.0 | 3.81 | 42.4 |
| 10 | stress_flash_crash | -3.51 | 2.45 | 0.0096 | 2.63 | 0.0056 | 1.02 | 0.2972 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 30.37 | 30.37 | 0.379 | 0.294 | 4.8 | 3.73 | 43.1 |
| 100 | trending | 6.99 | 4.33 | <0.0001 | 4.28 | <0.0001 | 0.93 | 0.3000 | <0.0001 | <0.0001 | <0.0001 | 36.0 | 0.0 | 327.11 | 32.71 | 0.431 | 0.311 | 7.0 | 5.86 | 32.0 |
| 100 | mean_reverting | 1.03 | 3.02 | <0.0001 | 3.46 | <0.0001 | 0.69 | 0.0283 | <0.0001 | <0.0001 | <0.0001 | 35.4 | 0.0 | 333.25 | 33.33 | 0.439 | 0.329 | 7.0 | 5.80 | 33.2 |
| 100 | choppy | 3.44 | 3.35 | <0.0001 | 3.45 | <0.0001 | 0.83 | 0.3237 | <0.0001 | <0.0001 | <0.0001 | 35.5 | 0.0 | 333.19 | 33.32 | 0.387 | 0.287 | 7.0 | 5.75 | 33.4 |
| 100 | stress_flash_crash | -3.40 | 1.70 | 0.0147 | 2.40 | 0.0010 | 0.40 | 0.5849 | <0.0001 | <0.0001 | <0.0001 | 32.5 | 0.0 | 355.46 | 35.55 | 0.387 | 0.286 | 7.0 | 5.72 | 33.6 |
| 1000 | trending | 7.11 | 4.39 | <0.0001 | 4.21 | <0.0001 | 0.74 | 0.3938 | <0.0001 | <0.0001 | <0.0001 | 393.0 | 0.0 | 3348.63 | 33.49 | 0.433 | 0.309 | 7.1 | 6.04 | 32.8 |
| 1000 | mean_reverting | 1.14 | 3.01 | <0.0001 | 3.51 | <0.0001 | 0.64 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 398.7 | 0.0 | 3394.92 | 33.95 | 0.436 | 0.324 | 7.1 | 6.04 | 32.8 |
| 1000 | choppy | 3.48 | 3.27 | <0.0001 | 3.40 | <0.0001 | 0.73 | 0.3524 | <0.0001 | <0.0001 | <0.0001 | 384.9 | 0.0 | 3399.45 | 33.99 | 0.388 | 0.287 | 7.1 | 6.00 | 33.0 |
| 1000 | stress_flash_crash | -3.42 | 1.54 | 0.0175 | 2.41 | 0.0005 | 0.36 | 0.6080 | <0.0001 | <0.0001 | <0.0001 | 359.5 | 0.0 | 3642.66 | 36.43 | 0.388 | 0.286 | 7.1 | 5.99 | 33.1 |

#### Magnitude 0.009, arm O5-N-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.93 | 3.36 | 0.0055 | 3.40 | 0.0050 | 1.09 | 0.3753 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 17.61 | 17.61 | 0.433 | 0.353 | 5.0 | 4.01 | 40.4 |
| 10 | mean_reverting | -0.53 | 2.66 | 0.0022 | 2.73 | 0.0019 | 0.79 | 0.3784 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 18.41 | 18.41 | 0.445 | 0.374 | 5.0 | 3.95 | 42.6 |
| 10 | choppy | 2.60 | 2.86 | 0.0061 | 2.83 | 0.0068 | 0.83 | 0.4437 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 17.95 | 17.95 | 0.379 | 0.309 | 4.9 | 3.93 | 42.9 |
| 10 | stress_flash_crash | -3.89 | 2.07 | 0.0188 | 2.25 | 0.0110 | 0.64 | 0.4866 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 19.64 | 19.64 | 0.379 | 0.306 | 4.9 | 3.86 | 43.9 |
| 100 | trending | 5.15 | 2.50 | 0.0021 | 2.44 | 0.0039 | -0.91 | 0.2934 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 173.10 | 17.31 | 0.431 | 0.346 | 7.0 | 5.95 | 32.4 |
| 100 | mean_reverting | -0.44 | 1.55 | <0.0001 | 1.99 | <0.0001 | -0.78 | 0.0066 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 178.57 | 17.86 | 0.439 | 0.363 | 7.0 | 5.90 | 33.3 |
| 100 | choppy | 1.99 | 1.90 | 0.0114 | 2.00 | 0.0105 | -0.62 | 0.4471 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 179.45 | 17.94 | 0.387 | 0.317 | 7.0 | 5.88 | 33.2 |
| 100 | stress_flash_crash | -4.26 | 0.84 | 0.2004 | 1.54 | 0.0252 | -0.46 | 0.5170 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 196.54 | 19.65 | 0.387 | 0.315 | 7.0 | 5.86 | 33.3 |
| 1000 | trending | 5.04 | 2.32 | 0.0023 | 2.14 | 0.0077 | -1.33 | 0.1102 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1735.31 | 17.35 | 0.433 | 0.347 | 7.0 | 6.12 | 32.8 |
| 1000 | mean_reverting | -0.49 | 1.38 | <0.0001 | 1.89 | <0.0001 | -0.99 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1779.23 | 17.79 | 0.436 | 0.359 | 7.0 | 6.12 | 32.9 |
| 1000 | choppy | 2.01 | 1.81 | 0.0100 | 1.93 | 0.0089 | -0.74 | 0.3325 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1792.79 | 17.93 | 0.388 | 0.317 | 7.0 | 6.09 | 33.0 |
| 1000 | stress_flash_crash | -4.26 | 0.70 | 0.2598 | 1.56 | 0.0176 | -0.49 | 0.4645 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1957.01 | 19.57 | 0.388 | 0.316 | 7.0 | 6.08 | 33.0 |

#### Magnitude 0.009, arm O5-Mo-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.17 | 3.60 | 0.0036 | 3.64 | 0.0033 | 1.33 | 0.2882 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 17.73 | 17.73 | 0.433 | 0.349 | 5.0 | 4.09 | 38.7 |
| 10 | mean_reverting | -0.40 | 2.79 | 0.0014 | 2.86 | 0.0012 | 0.91 | 0.3077 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 18.48 | 18.48 | 0.445 | 0.369 | 5.0 | 4.03 | 40.9 |
| 10 | choppy | 2.72 | 2.98 | 0.0049 | 2.95 | 0.0054 | 0.95 | 0.3872 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.2 | 18.11 | 18.11 | 0.379 | 0.306 | 5.0 | 4.00 | 41.7 |
| 10 | stress_flash_crash | -3.84 | 2.12 | 0.0176 | 2.30 | 0.0103 | 0.69 | 0.4570 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.2 | 19.80 | 19.80 | 0.379 | 0.304 | 4.9 | 3.90 | 42.9 |
| 100 | trending | 6.36 | 3.70 | <0.0001 | 3.65 | <0.0001 | 0.30 | 0.7384 | <0.0001 | <0.0001 | 0.0003 | 33.7 | 5.3 | 187.38 | 18.74 | 0.431 | 0.319 | 7.0 | 5.90 | 32.6 |
| 100 | mean_reverting | 0.56 | 2.55 | <0.0001 | 2.98 | <0.0001 | 0.21 | 0.4836 | <0.0001 | <0.0001 | 0.0085 | 34.3 | 5.8 | 190.48 | 19.05 | 0.439 | 0.339 | 7.0 | 5.88 | 32.8 |
| 100 | choppy | 2.81 | 2.72 | 0.0006 | 2.82 | 0.0006 | 0.20 | 0.8071 | <0.0001 | <0.0001 | 0.0045 | 33.4 | 3.3 | 194.04 | 19.40 | 0.387 | 0.297 | 7.0 | 5.87 | 32.8 |
| 100 | stress_flash_crash | -3.78 | 1.31 | 0.0526 | 2.02 | 0.0047 | 0.02 | 0.9767 | <0.0001 | <0.0001 | 0.7560 | 32.7 | 2.7 | 216.10 | 21.61 | 0.387 | 0.296 | 7.0 | 5.82 | 33.4 |
| 1000 | trending | 6.37 | 3.65 | <0.0001 | 3.47 | <0.0001 | -0.01 | 0.9950 | <0.0001 | <0.0001 | 0.8610 | 363.2 | 82.9 | 1894.77 | 18.95 | 0.433 | 0.319 | 7.0 | 6.11 | 32.7 |
| 1000 | mean_reverting | 0.53 | 2.40 | <0.0001 | 2.90 | <0.0001 | 0.02 | 0.8695 | <0.0001 | <0.0001 | 0.3833 | 367.7 | 85.8 | 1916.78 | 19.17 | 0.436 | 0.337 | 7.0 | 6.09 | 33.0 |
| 1000 | choppy | 2.91 | 2.70 | 0.0002 | 2.83 | 0.0002 | 0.16 | 0.8373 | <0.0001 | <0.0001 | <0.0001 | 364.6 | 57.7 | 1951.21 | 19.51 | 0.388 | 0.297 | 7.0 | 6.08 | 32.9 |
| 1000 | stress_flash_crash | -3.74 | 1.22 | 0.0556 | 2.08 | 0.0021 | 0.03 | 0.9676 | <0.0001 | <0.0001 | 0.3433 | 349.8 | 45.4 | 2188.43 | 21.88 | 0.388 | 0.295 | 7.0 | 6.06 | 33.0 |

#### Magnitude 0.009, arm O5-Mp-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.13 | 3.56 | 0.0035 | 3.60 | 0.0032 | 1.29 | 0.2969 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 17.71 | 17.71 | 0.433 | 0.349 | 5.0 | 4.09 | 38.9 |
| 10 | mean_reverting | -0.36 | 2.83 | 0.0012 | 2.90 | 0.0010 | 0.96 | 0.2870 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 18.67 | 18.67 | 0.445 | 0.369 | 5.0 | 4.01 | 41.2 |
| 10 | choppy | 2.83 | 3.09 | 0.0038 | 3.06 | 0.0042 | 1.07 | 0.3367 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 18.24 | 18.24 | 0.379 | 0.303 | 5.0 | 4.01 | 41.2 |
| 10 | stress_flash_crash | -3.75 | 2.21 | 0.0140 | 2.38 | 0.0081 | 0.78 | 0.4054 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 19.94 | 19.94 | 0.379 | 0.299 | 5.0 | 3.93 | 42.0 |
| 100 | trending | 6.58 | 3.93 | <0.0001 | 3.87 | <0.0001 | 0.52 | 0.5564 | <0.0001 | <0.0001 | <0.0001 | 35.7 | 0.0 | 196.09 | 19.61 | 0.431 | 0.311 | 7.0 | 5.93 | 31.9 |
| 100 | mean_reverting | 0.77 | 2.77 | <0.0001 | 3.20 | <0.0001 | 0.43 | 0.1627 | <0.0001 | <0.0001 | <0.0001 | 36.5 | 0.0 | 200.00 | 20.00 | 0.439 | 0.331 | 7.0 | 5.87 | 32.9 |
| 100 | choppy | 3.08 | 2.99 | 0.0002 | 3.09 | 0.0002 | 0.47 | 0.5713 | <0.0001 | <0.0001 | <0.0001 | 34.4 | 0.0 | 201.68 | 20.17 | 0.387 | 0.289 | 7.0 | 5.83 | 33.2 |
| 100 | stress_flash_crash | -3.61 | 1.48 | 0.0299 | 2.19 | 0.0024 | 0.19 | 0.7944 | <0.0001 | <0.0001 | 0.0033 | 33.8 | 0.0 | 220.72 | 22.07 | 0.387 | 0.290 | 7.0 | 5.80 | 33.2 |
| 1000 | trending | 6.71 | 3.99 | <0.0001 | 3.81 | <0.0001 | 0.34 | 0.6906 | <0.0001 | <0.0001 | <0.0001 | 395.2 | 0.0 | 2017.66 | 20.18 | 0.433 | 0.308 | 7.1 | 6.09 | 32.9 |
| 1000 | mean_reverting | 0.81 | 2.68 | <0.0001 | 3.19 | <0.0001 | 0.31 | 0.0313 | <0.0001 | <0.0001 | <0.0001 | 400.4 | 0.0 | 2033.36 | 20.33 | 0.436 | 0.328 | 7.2 | 6.06 | 33.1 |
| 1000 | choppy | 3.12 | 2.91 | <0.0001 | 3.04 | <0.0001 | 0.37 | 0.6350 | <0.0001 | <0.0001 | <0.0001 | 386.8 | 0.0 | 2043.44 | 20.43 | 0.388 | 0.290 | 7.1 | 6.05 | 33.2 |
| 1000 | stress_flash_crash | -3.61 | 1.35 | 0.0350 | 2.21 | 0.0012 | 0.16 | 0.8161 | <0.0001 | <0.0001 | <0.0001 | 367.9 | 0.0 | 2251.63 | 22.52 | 0.388 | 0.289 | 7.1 | 6.02 | 33.3 |

#### Magnitude 0.009, arm O10-N-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.61 | 2.04 | 0.0747 | 2.08 | 0.0696 | -0.23 | 0.8419 | <0.0001 | <0.0001 | 0.0086 | 0.0 | 0.0 | 8.71 | 8.71 | 0.433 | 0.374 | 5.0 | 4.16 | 39.4 |
| 10 | mean_reverting | -1.47 | 1.73 | 0.0343 | 1.79 | 0.0291 | -0.15 | 0.8613 | <0.0001 | <0.0001 | 0.0202 | 0.0 | 0.0 | 8.85 | 8.85 | 0.445 | 0.394 | 5.0 | 4.12 | 41.3 |
| 10 | choppy | 1.48 | 1.74 | 0.0749 | 1.71 | 0.0810 | -0.29 | 0.7831 | <0.0001 | <0.0001 | 0.0103 | 0.0 | 0.0 | 8.81 | 8.81 | 0.379 | 0.328 | 4.9 | 4.11 | 40.1 |
| 10 | stress_flash_crash | -4.68 | 1.28 | 0.1197 | 1.46 | 0.0772 | -0.15 | 0.8630 | <0.0001 | <0.0001 | 0.0685 | 0.0 | 0.0 | 10.08 | 10.08 | 0.379 | 0.327 | 4.9 | 4.08 | 40.1 |
| 100 | trending | 3.87 | 1.22 | 0.1157 | 1.16 | 0.1518 | -2.19 | 0.0109 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 84.37 | 8.44 | 0.431 | 0.367 | 7.0 | 6.03 | 32.3 |
| 100 | mean_reverting | -1.44 | 0.55 | 0.0191 | 0.99 | <0.0001 | -1.78 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 87.17 | 8.72 | 0.439 | 0.382 | 7.0 | 5.96 | 33.2 |
| 100 | choppy | 0.98 | 0.89 | 0.2143 | 0.99 | 0.1856 | -1.62 | 0.0412 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 87.81 | 8.78 | 0.387 | 0.335 | 7.0 | 5.97 | 33.0 |
| 100 | stress_flash_crash | -4.92 | 0.17 | 0.7841 | 0.88 | 0.1848 | -1.12 | 0.1037 | 0.0304 | <0.0001 | <0.0001 | 0.0 | 0.0 | 99.59 | 9.96 | 0.387 | 0.334 | 7.0 | 5.95 | 33.1 |
| 1000 | trending | 3.77 | 1.05 | 0.1523 | 0.86 | 0.2656 | -2.61 | 0.0017 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 846.18 | 8.46 | 0.433 | 0.369 | 7.0 | 6.18 | 32.8 |
| 1000 | mean_reverting | -1.53 | 0.34 | 0.0045 | 0.84 | <0.0001 | -2.03 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 871.92 | 8.72 | 0.436 | 0.380 | 7.0 | 6.17 | 33.0 |
| 1000 | choppy | 1.00 | 0.79 | 0.2390 | 0.92 | 0.1966 | -1.75 | 0.0203 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 881.46 | 8.81 | 0.388 | 0.336 | 7.0 | 6.16 | 33.0 |
| 1000 | stress_flash_crash | -4.94 | 0.02 | 0.9698 | 0.89 | 0.1619 | -1.16 | 0.0782 | 0.7445 | <0.0001 | <0.0001 | 0.0 | 0.0 | 997.97 | 9.98 | 0.388 | 0.335 | 7.0 | 6.15 | 33.0 |

#### Magnitude 0.009, arm O10-Mo-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.88 | 2.32 | 0.0450 | 2.35 | 0.0417 | 0.04 | 0.9712 | <0.0001 | <0.0001 | 0.0032 | 0.4 | 0.0 | 8.80 | 8.80 | 0.433 | 0.368 | 5.0 | 4.24 | 37.4 |
| 10 | mean_reverting | -1.29 | 1.90 | 0.0211 | 1.97 | 0.0178 | 0.03 | 0.9756 | <0.0001 | <0.0001 | 0.0301 | 0.4 | 0.0 | 8.95 | 8.95 | 0.445 | 0.388 | 5.0 | 4.21 | 39.4 |
| 10 | choppy | 1.79 | 2.05 | 0.0417 | 2.02 | 0.0454 | 0.03 | 0.9809 | <0.0001 | <0.0001 | 0.0117 | 0.4 | 0.0 | 8.94 | 8.94 | 0.379 | 0.321 | 5.0 | 4.22 | 37.9 |
| 10 | stress_flash_crash | -4.52 | 1.45 | 0.0867 | 1.62 | 0.0550 | 0.02 | 0.9863 | <0.0001 | <0.0001 | 0.0699 | 0.4 | 0.0 | 10.26 | 10.26 | 0.379 | 0.320 | 5.0 | 4.19 | 38.0 |
| 100 | trending | 5.77 | 3.11 | 0.0002 | 3.05 | 0.0005 | -0.30 | 0.7375 | <0.0001 | <0.0001 | 0.0006 | 34.8 | 0.1 | 94.93 | 9.49 | 0.431 | 0.317 | 7.0 | 6.04 | 31.5 |
| 100 | mean_reverting | 0.17 | 2.16 | <0.0001 | 2.60 | <0.0001 | -0.17 | 0.5566 | <0.0001 | <0.0001 | 0.0242 | 36.7 | 0.4 | 95.15 | 9.51 | 0.439 | 0.338 | 7.0 | 5.96 | 32.1 |
| 100 | choppy | 2.31 | 2.22 | 0.0037 | 2.32 | 0.0036 | -0.30 | 0.7172 | <0.0001 | <0.0001 | 0.0001 | 34.5 | 0.0 | 97.69 | 9.77 | 0.387 | 0.297 | 7.0 | 5.98 | 32.1 |
| 100 | stress_flash_crash | -4.07 | 1.02 | 0.1172 | 1.73 | 0.0122 | -0.27 | 0.7040 | <0.0001 | <0.0001 | <0.0001 | 33.2 | 0.0 | 117.66 | 11.77 | 0.387 | 0.298 | 7.0 | 5.96 | 32.2 |
| 1000 | trending | 5.85 | 3.13 | <0.0001 | 2.95 | 0.0004 | -0.53 | 0.5308 | <0.0001 | <0.0001 | <0.0001 | 382.0 | 6.4 | 968.09 | 9.68 | 0.433 | 0.311 | 7.1 | 6.19 | 32.6 |
| 1000 | mean_reverting | 0.10 | 1.97 | <0.0001 | 2.47 | <0.0001 | -0.40 | 0.0057 | <0.0001 | <0.0001 | <0.0001 | 393.3 | 6.8 | 962.99 | 9.63 | 0.436 | 0.334 | 7.2 | 6.17 | 32.7 |
| 1000 | choppy | 2.40 | 2.19 | 0.0023 | 2.32 | 0.0022 | -0.35 | 0.6480 | <0.0001 | <0.0001 | <0.0001 | 370.1 | 3.9 | 992.50 | 9.93 | 0.388 | 0.295 | 7.1 | 6.15 | 32.8 |
| 1000 | stress_flash_crash | -4.10 | 0.86 | 0.1664 | 1.73 | 0.0093 | -0.33 | 0.6298 | <0.0001 | <0.0001 | <0.0001 | 356.3 | 2.4 | 1197.96 | 11.98 | 0.388 | 0.297 | 7.1 | 6.11 | 33.1 |

#### Magnitude 0.009, arm O10-Mp-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.88 | 2.32 | 0.0450 | 2.35 | 0.0417 | 0.04 | 0.9712 | <0.0001 | <0.0001 | 0.0032 | 0.4 | 0.0 | 8.80 | 8.80 | 0.433 | 0.368 | 5.0 | 4.24 | 37.4 |
| 10 | mean_reverting | -1.29 | 1.90 | 0.0211 | 1.97 | 0.0178 | 0.03 | 0.9756 | <0.0001 | <0.0001 | 0.0301 | 0.4 | 0.0 | 8.95 | 8.95 | 0.445 | 0.388 | 5.0 | 4.21 | 39.4 |
| 10 | choppy | 1.79 | 2.05 | 0.0417 | 2.02 | 0.0454 | 0.03 | 0.9809 | <0.0001 | <0.0001 | 0.0117 | 0.4 | 0.0 | 8.94 | 8.94 | 0.379 | 0.321 | 5.0 | 4.22 | 37.9 |
| 10 | stress_flash_crash | -4.52 | 1.45 | 0.0867 | 1.62 | 0.0550 | 0.02 | 0.9863 | <0.0001 | <0.0001 | 0.0699 | 0.4 | 0.0 | 10.26 | 10.26 | 0.379 | 0.320 | 5.0 | 4.19 | 38.0 |
| 100 | trending | 5.79 | 3.13 | 0.0002 | 3.08 | 0.0004 | -0.27 | 0.7557 | <0.0001 | <0.0001 | <0.0001 | 35.6 | 0.0 | 100.40 | 10.04 | 0.431 | 0.313 | 7.0 | 6.04 | 31.1 |
| 100 | mean_reverting | 0.15 | 2.15 | <0.0001 | 2.58 | <0.0001 | -0.19 | 0.5089 | <0.0001 | <0.0001 | 0.0004 | 36.5 | 0.0 | 101.19 | 10.12 | 0.439 | 0.336 | 7.0 | 5.95 | 32.6 |
| 100 | choppy | 2.39 | 2.29 | 0.0030 | 2.40 | 0.0029 | -0.22 | 0.7886 | <0.0001 | <0.0001 | 0.0001 | 34.2 | 0.0 | 101.03 | 10.10 | 0.387 | 0.295 | 7.0 | 5.98 | 32.0 |
| 100 | stress_flash_crash | -4.06 | 1.03 | 0.1174 | 1.73 | 0.0124 | -0.26 | 0.7113 | <0.0001 | <0.0001 | <0.0001 | 33.2 | 0.0 | 118.76 | 11.88 | 0.387 | 0.298 | 7.0 | 5.96 | 32.1 |
| 1000 | trending | 5.99 | 3.27 | <0.0001 | 3.09 | 0.0002 | -0.39 | 0.6475 | <0.0001 | <0.0001 | <0.0001 | 386.8 | 0.0 | 1037.63 | 10.38 | 0.433 | 0.306 | 7.1 | 6.15 | 33.0 |
| 1000 | mean_reverting | 0.22 | 2.09 | <0.0001 | 2.59 | <0.0001 | -0.28 | 0.0504 | <0.0001 | <0.0001 | <0.0001 | 395.6 | 0.0 | 1036.92 | 10.37 | 0.436 | 0.329 | 7.2 | 6.14 | 32.7 |
| 1000 | choppy | 2.46 | 2.25 | 0.0017 | 2.38 | 0.0017 | -0.29 | 0.7075 | <0.0001 | <0.0001 | <0.0001 | 373.5 | 0.0 | 1043.85 | 10.44 | 0.388 | 0.292 | 7.1 | 6.13 | 33.0 |
| 1000 | stress_flash_crash | -4.06 | 0.90 | 0.1500 | 1.76 | 0.0080 | -0.29 | 0.6662 | <0.0001 | <0.0001 | <0.0001 | 359.2 | 0.0 | 1229.93 | 12.30 | 0.388 | 0.295 | 7.2 | 6.12 | 33.0 |

#### Magnitude 0.009, arm Omix-N-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.24 | 2.68 | 0.0305 | 2.71 | 0.0283 | 0.40 | 0.7493 | <0.0001 | <0.0001 | 0.1095 | 0.0 | 0.0 | 26.93 | 26.93 | 0.433 | 0.367 | 4.9 | 3.85 | 41.5 |
| 10 | mean_reverting | -1.03 | 2.17 | 0.0107 | 2.23 | 0.0090 | 0.29 | 0.7407 | <0.0001 | <0.0001 | 0.0841 | 0.0 | 0.0 | 28.25 | 28.25 | 0.445 | 0.381 | 4.8 | 3.84 | 41.3 |
| 10 | choppy | 1.79 | 2.05 | 0.0380 | 2.02 | 0.0415 | 0.03 | 0.9799 | <0.0001 | <0.0001 | 0.8841 | 0.0 | 0.0 | 27.90 | 27.90 | 0.379 | 0.326 | 4.9 | 3.85 | 41.4 |
| 10 | stress_flash_crash | -4.61 | 1.35 | 0.1087 | 1.53 | 0.0702 | -0.08 | 0.9280 | <0.0001 | <0.0001 | 0.6167 | 0.0 | 0.0 | 29.37 | 29.37 | 0.379 | 0.326 | 4.8 | 3.79 | 41.9 |
| 100 | trending | 4.02 | 1.36 | 0.0806 | 1.31 | 0.1095 | -2.04 | 0.0174 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 123.07 | 12.31 | 0.431 | 0.365 | 7.0 | 6.02 | 32.2 |
| 100 | mean_reverting | -1.33 | 0.66 | 0.0058 | 1.10 | <0.0001 | -1.68 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 125.93 | 12.59 | 0.439 | 0.380 | 7.0 | 5.94 | 33.3 |
| 100 | choppy | 1.08 | 0.99 | 0.1664 | 1.09 | 0.1445 | -1.52 | 0.0543 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 126.53 | 12.65 | 0.387 | 0.334 | 7.0 | 5.96 | 33.0 |
| 100 | stress_flash_crash | -4.85 | 0.24 | 0.6989 | 0.95 | 0.1517 | -1.05 | 0.1267 | 0.0032 | <0.0001 | <0.0001 | 0.0 | 0.0 | 139.85 | 13.98 | 0.387 | 0.333 | 7.0 | 5.94 | 33.2 |
| 1000 | trending | 3.93 | 1.21 | 0.1005 | 1.02 | 0.1885 | -2.45 | 0.0033 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1227.68 | 12.28 | 0.433 | 0.366 | 7.0 | 6.18 | 32.7 |
| 1000 | mean_reverting | -1.39 | 0.48 | <0.0001 | 0.99 | <0.0001 | -1.89 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1262.45 | 12.62 | 0.436 | 0.377 | 7.0 | 6.16 | 33.0 |
| 1000 | choppy | 1.12 | 0.91 | 0.1785 | 1.04 | 0.1472 | -1.63 | 0.0299 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1275.97 | 12.76 | 0.388 | 0.334 | 7.0 | 6.15 | 33.0 |
| 1000 | stress_flash_crash | -4.86 | 0.10 | 0.8709 | 0.96 | 0.1304 | -1.09 | 0.0995 | 0.1722 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1409.75 | 14.10 | 0.388 | 0.332 | 7.0 | 6.14 | 33.0 |

#### Magnitude 0.009, arm Omix-Mo-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.30 | 2.73 | 0.0285 | 2.77 | 0.0264 | 0.46 | 0.7186 | <0.0001 | <0.0001 | 0.0792 | 0.3 | 0.7 | 27.04 | 27.04 | 0.433 | 0.366 | 5.0 | 3.87 | 41.3 |
| 10 | mean_reverting | -1.02 | 2.17 | 0.0106 | 2.24 | 0.0089 | 0.30 | 0.7357 | <0.0001 | <0.0001 | 0.0780 | 0.2 | 1.1 | 28.48 | 28.48 | 0.445 | 0.381 | 4.9 | 3.86 | 41.1 |
| 10 | choppy | 1.81 | 2.07 | 0.0365 | 2.04 | 0.0398 | 0.05 | 0.9642 | <0.0001 | <0.0001 | 0.7927 | 0.2 | 1.3 | 27.95 | 27.95 | 0.379 | 0.326 | 4.9 | 3.86 | 41.2 |
| 10 | stress_flash_crash | -4.60 | 1.36 | 0.1065 | 1.54 | 0.0687 | -0.07 | 0.9380 | <0.0001 | <0.0001 | 0.6656 | 0.2 | 1.3 | 29.42 | 29.42 | 0.379 | 0.326 | 4.8 | 3.79 | 41.8 |
| 100 | trending | 5.39 | 2.73 | 0.0009 | 2.67 | 0.0018 | -0.68 | 0.4379 | <0.0001 | <0.0001 | <0.0001 | 30.6 | 13.8 | 134.78 | 13.48 | 0.431 | 0.331 | 7.0 | 6.00 | 32.0 |
| 100 | mean_reverting | -0.34 | 1.65 | <0.0001 | 2.09 | <0.0001 | -0.68 | 0.0199 | <0.0001 | <0.0001 | <0.0001 | 31.1 | 13.3 | 133.93 | 13.39 | 0.439 | 0.355 | 7.0 | 5.93 | 33.1 |
| 100 | choppy | 1.97 | 1.87 | 0.0114 | 1.98 | 0.0106 | -0.64 | 0.4229 | <0.0001 | <0.0001 | <0.0001 | 30.2 | 12.0 | 136.16 | 13.62 | 0.387 | 0.310 | 7.0 | 5.94 | 32.9 |
| 100 | stress_flash_crash | -4.33 | 0.76 | 0.2359 | 1.46 | 0.0304 | -0.53 | 0.4440 | <0.0001 | <0.0001 | <0.0001 | 28.7 | 10.2 | 157.00 | 15.70 | 0.387 | 0.310 | 7.0 | 5.91 | 33.3 |
| 1000 | trending | 5.37 | 2.65 | 0.0007 | 2.47 | 0.0025 | -1.00 | 0.2316 | <0.0001 | <0.0001 | <0.0001 | 323.2 | 170.5 | 1348.62 | 13.49 | 0.433 | 0.331 | 7.1 | 6.16 | 32.7 |
| 1000 | mean_reverting | -0.29 | 1.58 | <0.0001 | 2.09 | <0.0001 | -0.79 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 332.8 | 161.5 | 1351.13 | 13.51 | 0.436 | 0.350 | 7.0 | 6.13 | 33.0 |
| 1000 | choppy | 2.07 | 1.87 | 0.0080 | 1.99 | 0.0072 | -0.68 | 0.3749 | <0.0001 | <0.0001 | <0.0001 | 330.7 | 127.7 | 1383.33 | 13.83 | 0.388 | 0.309 | 7.0 | 6.14 | 33.0 |
| 1000 | stress_flash_crash | -4.30 | 0.66 | 0.2831 | 1.52 | 0.0197 | -0.53 | 0.4278 | <0.0001 | <0.0001 | <0.0001 | 323.2 | 114.1 | 1598.75 | 15.99 | 0.388 | 0.308 | 7.0 | 6.12 | 33.1 |

#### Magnitude 0.009, arm Omix-Mp-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x2 | Welch p vs B-c0.2-x2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x2 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.34 | 2.78 | 0.0255 | 2.81 | 0.0236 | 0.50 | 0.6912 | <0.0001 | <0.0001 | 0.0393 | 0.4 | 0.0 | 27.37 | 27.37 | 0.433 | 0.364 | 5.0 | 3.89 | 40.7 |
| 10 | mean_reverting | -0.87 | 2.32 | 0.0065 | 2.39 | 0.0054 | 0.45 | 0.6118 | <0.0001 | <0.0001 | 0.0033 | 0.4 | 0.0 | 28.71 | 28.71 | 0.445 | 0.378 | 4.9 | 3.95 | 39.1 |
| 10 | choppy | 1.95 | 2.21 | 0.0283 | 2.18 | 0.0309 | 0.19 | 0.8609 | <0.0001 | <0.0001 | 0.3095 | 0.4 | 0.0 | 28.76 | 28.76 | 0.379 | 0.321 | 5.0 | 3.91 | 40.4 |
| 10 | stress_flash_crash | -4.52 | 1.44 | 0.0917 | 1.62 | 0.0589 | 0.01 | 0.9882 | <0.0001 | <0.0001 | 0.9319 | 0.4 | 0.0 | 30.34 | 30.34 | 0.379 | 0.322 | 4.9 | 3.84 | 41.0 |
| 100 | trending | 5.75 | 3.09 | 0.0002 | 3.04 | 0.0005 | -0.31 | 0.7207 | <0.0001 | <0.0001 | <0.0001 | 35.9 | 0.0 | 141.05 | 14.10 | 0.431 | 0.319 | 7.0 | 6.03 | 31.7 |
| 100 | mean_reverting | -0.02 | 1.98 | <0.0001 | 2.41 | <0.0001 | -0.36 | 0.2251 | <0.0001 | <0.0001 | <0.0001 | 36.6 | 0.0 | 140.94 | 14.09 | 0.439 | 0.345 | 7.0 | 5.93 | 33.0 |
| 100 | choppy | 2.35 | 2.25 | 0.0033 | 2.36 | 0.0032 | -0.26 | 0.7496 | <0.0001 | <0.0001 | <0.0001 | 34.9 | 0.0 | 145.35 | 14.54 | 0.387 | 0.301 | 7.1 | 5.94 | 32.4 |
| 100 | stress_flash_crash | -4.06 | 1.04 | 0.1148 | 1.74 | 0.0121 | -0.25 | 0.7206 | <0.0001 | <0.0001 | <0.0001 | 33.3 | 0.0 | 162.52 | 16.25 | 0.387 | 0.301 | 7.0 | 5.92 | 32.7 |
| 1000 | trending | 5.88 | 3.16 | <0.0001 | 2.97 | 0.0004 | -0.50 | 0.5561 | <0.0001 | <0.0001 | <0.0001 | 391.0 | 0.0 | 1462.19 | 14.62 | 0.433 | 0.316 | 7.3 | 6.15 | 32.8 |
| 1000 | mean_reverting | 0.13 | 2.00 | <0.0001 | 2.51 | <0.0001 | -0.37 | 0.0132 | <0.0001 | <0.0001 | <0.0001 | 397.1 | 0.0 | 1459.56 | 14.60 | 0.436 | 0.337 | 7.1 | 6.12 | 33.0 |
| 1000 | choppy | 2.36 | 2.15 | 0.0026 | 2.28 | 0.0025 | -0.39 | 0.6069 | <0.0001 | <0.0001 | <0.0001 | 382.3 | 0.0 | 1479.20 | 14.79 | 0.388 | 0.300 | 7.0 | 6.12 | 33.2 |
| 1000 | stress_flash_crash | -4.12 | 0.84 | 0.1774 | 1.70 | 0.0100 | -0.35 | 0.6010 | <0.0001 | <0.0001 | <0.0001 | 367.9 | 0.0 | 1679.69 | 16.80 | 0.388 | 0.300 | 7.1 | 6.10 | 33.2 |

#### Magnitude 0.009, arm RO-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.89 | 2.32 | 0.0445 | 2.36 | 0.0412 | -0.24 | 0.8406 | <0.0001 | <0.0001 | 0.0112 | 0.0 | 0.0 | 10.79 | 10.79 | 0.433 | 0.364 | 4.9 | 4.05 | 40.4 |
| 10 | mean_reverting | -1.21 | 1.98 | 0.0157 | 2.05 | 0.0132 | -0.18 | 0.8329 | <0.0001 | <0.0001 | 0.0224 | 0.0 | 0.0 | 11.25 | 11.25 | 0.445 | 0.385 | 4.9 | 4.00 | 42.8 |
| 10 | choppy | 1.70 | 1.95 | 0.0474 | 1.92 | 0.0516 | -0.29 | 0.7830 | <0.0001 | <0.0001 | 0.0130 | 0.0 | 0.0 | 11.01 | 11.01 | 0.379 | 0.320 | 4.9 | 4.00 | 40.9 |
| 10 | stress_flash_crash | -4.53 | 1.43 | 0.0844 | 1.60 | 0.0529 | -0.15 | 0.8633 | <0.0001 | <0.0001 | 0.0833 | 0.0 | 0.0 | 12.26 | 12.26 | 0.379 | 0.318 | 4.8 | 3.99 | 40.8 |
| 100 | trending | 4.52 | 1.87 | 0.0177 | 1.81 | 0.0277 | -1.97 | 0.0228 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 106.94 | 10.69 | 0.431 | 0.348 | 7.0 | 5.99 | 32.1 |
| 100 | mean_reverting | -0.91 | 1.09 | <0.0001 | 1.52 | <0.0001 | -1.63 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 109.02 | 10.90 | 0.439 | 0.367 | 7.0 | 5.88 | 33.7 |
| 100 | choppy | 1.50 | 1.41 | 0.0532 | 1.51 | 0.0473 | -1.39 | 0.0849 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 112.28 | 11.23 | 0.387 | 0.319 | 7.0 | 5.91 | 33.0 |
| 100 | stress_flash_crash | -4.50 | 0.60 | 0.3406 | 1.30 | 0.0498 | -0.80 | 0.2426 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 124.14 | 12.41 | 0.387 | 0.318 | 7.0 | 5.89 | 33.1 |
| 1000 | trending | 4.48 | 1.76 | 0.0184 | 1.57 | 0.0458 | -2.40 | 0.0044 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1076.71 | 10.77 | 0.433 | 0.348 | 7.0 | 6.12 | 32.8 |
| 1000 | mean_reverting | -0.96 | 0.91 | <0.0001 | 1.41 | <0.0001 | -1.87 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1082.34 | 10.82 | 0.436 | 0.363 | 7.0 | 6.12 | 32.9 |
| 1000 | choppy | 1.55 | 1.34 | 0.0506 | 1.47 | 0.0429 | -1.57 | 0.0394 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1131.62 | 11.32 | 0.388 | 0.319 | 7.0 | 6.10 | 33.0 |
| 1000 | stress_flash_crash | -4.50 | 0.46 | 0.4437 | 1.33 | 0.0385 | -0.88 | 0.1827 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1238.22 | 12.38 | 0.388 | 0.318 | 7.0 | 6.09 | 33.0 |

#### Magnitude 0.009, arm O3-N-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.63 | 4.06 | 0.0011 | 4.10 | 0.0010 | 1.50 | 0.2326 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 30.84 | 30.84 | 0.433 | 0.335 | 4.9 | 3.68 | 41.9 |
| 10 | mean_reverting | -0.03 | 3.17 | 0.0005 | 3.23 | 0.0004 | 1.01 | 0.2764 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 30.64 | 30.64 | 0.445 | 0.355 | 4.9 | 3.54 | 44.9 |
| 10 | choppy | 3.15 | 3.41 | 0.0021 | 3.38 | 0.0024 | 1.17 | 0.3121 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 31.56 | 31.56 | 0.379 | 0.294 | 4.8 | 3.61 | 44.4 |
| 10 | stress_flash_crash | -3.55 | 2.42 | 0.0095 | 2.59 | 0.0055 | 0.84 | 0.3860 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 33.15 | 33.15 | 0.379 | 0.293 | 4.7 | 3.59 | 45.0 |
| 100 | trending | 6.11 | 3.46 | <0.0001 | 3.40 | 0.0001 | -0.39 | 0.6612 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 331.88 | 33.19 | 0.431 | 0.324 | 7.0 | 5.81 | 32.7 |
| 100 | mean_reverting | 0.28 | 2.27 | <0.0001 | 2.70 | <0.0001 | -0.45 | 0.1385 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 331.56 | 33.16 | 0.439 | 0.343 | 7.0 | 5.82 | 33.0 |
| 100 | choppy | 2.76 | 2.67 | 0.0006 | 2.77 | 0.0007 | -0.13 | 0.8767 | <0.0001 | <0.0001 | 0.0667 | 0.0 | 0.0 | 335.22 | 33.52 | 0.387 | 0.298 | 7.0 | 5.76 | 33.5 |
| 100 | stress_flash_crash | -3.83 | 1.26 | 0.0615 | 1.97 | 0.0057 | -0.14 | 0.8452 | <0.0001 | <0.0001 | 0.0367 | 0.0 | 0.0 | 348.46 | 34.85 | 0.387 | 0.299 | 7.0 | 5.75 | 33.7 |
| 1000 | trending | 6.09 | 3.37 | <0.0001 | 3.19 | 0.0001 | -0.79 | 0.3577 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3338.46 | 33.38 | 0.433 | 0.324 | 7.0 | 6.06 | 32.5 |
| 1000 | mean_reverting | 0.27 | 2.14 | <0.0001 | 2.65 | <0.0001 | -0.64 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3324.96 | 33.25 | 0.436 | 0.339 | 7.0 | 6.07 | 32.8 |
| 1000 | choppy | 2.80 | 2.59 | 0.0004 | 2.72 | 0.0004 | -0.32 | 0.6823 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3393.88 | 33.94 | 0.388 | 0.298 | 7.0 | 6.03 | 32.8 |
| 1000 | stress_flash_crash | -3.83 | 1.13 | 0.0762 | 1.99 | 0.0033 | -0.21 | 0.7540 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3481.67 | 34.82 | 0.388 | 0.299 | 7.0 | 6.03 | 32.8 |

#### Magnitude 0.009, arm O3-Mo-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.77 | 4.20 | 0.0009 | 4.24 | 0.0008 | 1.64 | 0.1955 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.2 | 31.32 | 31.32 | 0.433 | 0.333 | 4.9 | 3.69 | 41.7 |
| 10 | mean_reverting | 0.03 | 3.22 | 0.0004 | 3.29 | 0.0003 | 1.06 | 0.2502 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.9 | 30.98 | 30.98 | 0.445 | 0.353 | 4.9 | 3.56 | 44.2 |
| 10 | choppy | 3.24 | 3.50 | 0.0018 | 3.47 | 0.0020 | 1.26 | 0.2799 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.5 | 32.27 | 32.27 | 0.379 | 0.291 | 4.9 | 3.63 | 44.0 |
| 10 | stress_flash_crash | -3.49 | 2.47 | 0.0087 | 2.64 | 0.0050 | 0.89 | 0.3609 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.4 | 33.72 | 33.72 | 0.379 | 0.291 | 4.8 | 3.60 | 44.7 |
| 100 | trending | 6.92 | 4.26 | <0.0001 | 4.21 | <0.0001 | 0.42 | 0.6391 | <0.0001 | <0.0001 | <0.0001 | 29.7 | 14.9 | 387.35 | 38.73 | 0.431 | 0.308 | 7.0 | 5.75 | 32.7 |
| 100 | mean_reverting | 0.86 | 2.85 | <0.0001 | 3.29 | <0.0001 | 0.14 | 0.6592 | <0.0001 | <0.0001 | 0.1784 | 28.9 | 16.1 | 380.19 | 38.02 | 0.439 | 0.329 | 7.0 | 5.73 | 33.5 |
| 100 | choppy | 3.28 | 3.19 | <0.0001 | 3.29 | <0.0001 | 0.39 | 0.6456 | <0.0001 | <0.0001 | <0.0001 | 29.2 | 12.4 | 384.55 | 38.46 | 0.387 | 0.286 | 7.0 | 5.70 | 33.5 |
| 100 | stress_flash_crash | -3.54 | 1.55 | 0.0243 | 2.26 | 0.0019 | 0.15 | 0.8382 | <0.0001 | <0.0001 | 0.0649 | 27.8 | 11.0 | 388.17 | 38.82 | 0.387 | 0.287 | 7.0 | 5.69 | 33.7 |
| 1000 | trending | 6.92 | 4.20 | <0.0001 | 4.02 | <0.0001 | 0.05 | 0.9549 | <0.0001 | <0.0001 | 0.2766 | 317.6 | 181.7 | 3956.72 | 39.57 | 0.433 | 0.308 | 7.0 | 6.00 | 32.6 |
| 1000 | mean_reverting | 0.92 | 2.79 | <0.0001 | 3.30 | <0.0001 | 0.01 | 0.9199 | <0.0001 | <0.0001 | 0.5782 | 320.0 | 178.2 | 3866.08 | 38.66 | 0.436 | 0.324 | 7.0 | 6.00 | 32.9 |
| 1000 | choppy | 3.38 | 3.17 | <0.0001 | 3.30 | <0.0001 | 0.27 | 0.7365 | <0.0001 | <0.0001 | <0.0001 | 324.6 | 136.4 | 3977.73 | 39.78 | 0.388 | 0.284 | 7.0 | 5.96 | 33.0 |
| 1000 | stress_flash_crash | -3.53 | 1.43 | 0.0274 | 2.29 | 0.0009 | 0.09 | 0.9013 | <0.0001 | <0.0001 | 0.0439 | 299.9 | 126.0 | 3958.93 | 39.59 | 0.388 | 0.287 | 7.1 | 5.97 | 32.9 |

#### Magnitude 0.009, arm O3-Mp-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.77 | 4.20 | 0.0008 | 4.24 | 0.0007 | 1.64 | 0.1932 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 31.08 | 31.08 | 0.433 | 0.332 | 4.9 | 3.73 | 41.1 |
| 10 | mean_reverting | 0.16 | 3.35 | 0.0002 | 3.42 | 0.0002 | 1.19 | 0.1984 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 31.46 | 31.46 | 0.445 | 0.349 | 4.9 | 3.59 | 43.4 |
| 10 | choppy | 3.38 | 3.64 | 0.0014 | 3.61 | 0.0016 | 1.40 | 0.2358 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 32.25 | 32.25 | 0.379 | 0.288 | 4.9 | 3.62 | 43.8 |
| 10 | stress_flash_crash | -3.39 | 2.57 | 0.0070 | 2.75 | 0.0040 | 0.99 | 0.3132 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 33.70 | 33.70 | 0.379 | 0.287 | 4.8 | 3.61 | 44.2 |
| 100 | trending | 7.40 | 4.75 | <0.0001 | 4.69 | <0.0001 | 0.91 | 0.3196 | <0.0001 | <0.0001 | <0.0001 | 35.6 | 0.0 | 405.48 | 40.55 | 0.431 | 0.297 | 7.0 | 5.73 | 32.6 |
| 100 | mean_reverting | 1.31 | 3.31 | <0.0001 | 3.74 | <0.0001 | 0.59 | 0.0640 | <0.0001 | <0.0001 | <0.0001 | 35.1 | 0.0 | 396.81 | 39.68 | 0.439 | 0.317 | 7.0 | 5.67 | 33.7 |
| 100 | choppy | 3.74 | 3.65 | <0.0001 | 3.75 | <0.0001 | 0.85 | 0.3240 | <0.0001 | <0.0001 | <0.0001 | 35.1 | 0.0 | 403.45 | 40.34 | 0.387 | 0.274 | 7.0 | 5.63 | 33.8 |
| 100 | stress_flash_crash | -3.25 | 1.84 | 0.0088 | 2.54 | 0.0006 | 0.44 | 0.5572 | <0.0001 | <0.0001 | <0.0001 | 32.3 | 0.0 | 401.03 | 40.10 | 0.387 | 0.277 | 7.0 | 5.62 | 34.1 |
| 1000 | trending | 7.54 | 4.82 | <0.0001 | 4.64 | <0.0001 | 0.67 | 0.4475 | <0.0001 | <0.0001 | <0.0001 | 392.4 | 0.0 | 4198.84 | 41.99 | 0.433 | 0.294 | 7.1 | 5.94 | 32.7 |
| 1000 | mean_reverting | 1.45 | 3.32 | <0.0001 | 3.82 | <0.0001 | 0.54 | 0.0005 | <0.0001 | <0.0001 | <0.0001 | 395.1 | 0.0 | 4100.78 | 41.01 | 0.436 | 0.310 | 7.1 | 5.96 | 32.8 |
| 1000 | choppy | 3.82 | 3.61 | <0.0001 | 3.74 | <0.0001 | 0.70 | 0.3787 | <0.0001 | <0.0001 | <0.0001 | 381.8 | 0.0 | 4162.24 | 41.62 | 0.388 | 0.273 | 7.1 | 5.90 | 33.1 |
| 1000 | stress_flash_crash | -3.25 | 1.71 | 0.0093 | 2.57 | 0.0002 | 0.37 | 0.6000 | <0.0001 | <0.0001 | <0.0001 | 356.0 | 0.0 | 4118.69 | 41.19 | 0.388 | 0.277 | 7.1 | 5.91 | 33.1 |

#### Magnitude 0.009, arm O5-N-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.29 | 3.72 | 0.0025 | 3.76 | 0.0022 | 1.16 | 0.3494 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 21.79 | 21.79 | 0.433 | 0.339 | 4.9 | 3.81 | 41.5 |
| 10 | mean_reverting | -0.30 | 2.90 | 0.0011 | 2.96 | 0.0009 | 0.74 | 0.4179 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 21.66 | 21.66 | 0.445 | 0.364 | 4.9 | 3.82 | 43.3 |
| 10 | choppy | 2.88 | 3.14 | 0.0029 | 3.11 | 0.0033 | 0.90 | 0.4173 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 21.69 | 21.69 | 0.379 | 0.297 | 4.8 | 3.76 | 44.5 |
| 10 | stress_flash_crash | -3.74 | 2.22 | 0.0119 | 2.40 | 0.0068 | 0.65 | 0.4845 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 23.07 | 23.07 | 0.379 | 0.295 | 4.8 | 3.73 | 45.2 |
| 100 | trending | 5.50 | 2.85 | 0.0006 | 2.79 | 0.0012 | -0.99 | 0.2594 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 210.08 | 21.01 | 0.431 | 0.332 | 7.0 | 5.89 | 32.4 |
| 100 | mean_reverting | -0.20 | 1.79 | <0.0001 | 2.22 | <0.0001 | -0.93 | 0.0018 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 210.17 | 21.02 | 0.439 | 0.352 | 7.0 | 5.84 | 33.4 |
| 100 | choppy | 2.26 | 2.16 | 0.0044 | 2.27 | 0.0042 | -0.64 | 0.4384 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 215.22 | 21.52 | 0.387 | 0.305 | 7.0 | 5.81 | 33.3 |
| 100 | stress_flash_crash | -4.11 | 0.98 | 0.1342 | 1.69 | 0.0148 | -0.42 | 0.5543 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 224.69 | 22.47 | 0.387 | 0.306 | 7.0 | 5.80 | 33.4 |
| 1000 | trending | 5.40 | 2.68 | 0.0006 | 2.49 | 0.0022 | -1.48 | 0.0807 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2100.35 | 21.00 | 0.433 | 0.333 | 7.0 | 6.08 | 32.7 |
| 1000 | mean_reverting | -0.26 | 1.61 | <0.0001 | 2.12 | <0.0001 | -1.17 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2090.42 | 20.90 | 0.436 | 0.349 | 7.0 | 6.08 | 32.9 |
| 1000 | choppy | 2.29 | 2.08 | 0.0034 | 2.21 | 0.0032 | -0.82 | 0.2845 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2158.77 | 21.59 | 0.388 | 0.305 | 7.0 | 6.04 | 33.0 |
| 1000 | stress_flash_crash | -4.11 | 0.84 | 0.1741 | 1.71 | 0.0098 | -0.50 | 0.4614 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2238.95 | 22.39 | 0.388 | 0.306 | 7.0 | 6.04 | 33.0 |

#### Magnitude 0.009, arm O5-Mo-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.53 | 3.97 | 0.0016 | 4.00 | 0.0014 | 1.41 | 0.2664 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 21.91 | 21.91 | 0.433 | 0.335 | 5.0 | 3.90 | 40.0 |
| 10 | mean_reverting | -0.17 | 3.02 | 0.0007 | 3.09 | 0.0006 | 0.86 | 0.3441 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 21.89 | 21.89 | 0.445 | 0.359 | 4.9 | 3.87 | 42.0 |
| 10 | choppy | 3.03 | 3.28 | 0.0022 | 3.25 | 0.0025 | 1.04 | 0.3533 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.3 | 22.19 | 22.19 | 0.379 | 0.294 | 4.9 | 3.81 | 43.6 |
| 10 | stress_flash_crash | -3.66 | 2.30 | 0.0105 | 2.48 | 0.0060 | 0.72 | 0.4395 | <0.0001 | <0.0001 | <0.0001 | 0.3 | 0.3 | 23.52 | 23.52 | 0.379 | 0.292 | 4.9 | 3.76 | 44.6 |
| 100 | trending | 6.97 | 4.31 | <0.0001 | 4.26 | <0.0001 | 0.47 | 0.6031 | <0.0001 | <0.0001 | <0.0001 | 34.8 | 4.3 | 271.90 | 27.19 | 0.431 | 0.299 | 7.0 | 5.76 | 32.9 |
| 100 | mean_reverting | 1.02 | 3.01 | <0.0001 | 3.45 | <0.0001 | 0.29 | 0.3435 | <0.0001 | <0.0001 | 0.0010 | 34.5 | 4.9 | 263.83 | 26.38 | 0.439 | 0.321 | 7.0 | 5.71 | 33.5 |
| 100 | choppy | 3.28 | 3.18 | <0.0001 | 3.29 | <0.0001 | 0.38 | 0.6505 | <0.0001 | <0.0001 | <0.0001 | 33.9 | 2.9 | 270.29 | 27.03 | 0.387 | 0.279 | 7.0 | 5.70 | 33.5 |
| 100 | stress_flash_crash | -3.52 | 1.57 | 0.0223 | 2.27 | 0.0017 | 0.17 | 0.8200 | <0.0001 | <0.0001 | 0.0272 | 32.8 | 2.5 | 269.82 | 26.98 | 0.387 | 0.283 | 7.0 | 5.69 | 33.8 |
| 1000 | trending | 7.03 | 4.31 | <0.0001 | 4.13 | <0.0001 | 0.16 | 0.8549 | <0.0001 | <0.0001 | <0.0001 | 375.0 | 65.3 | 2815.47 | 28.15 | 0.433 | 0.297 | 7.0 | 5.96 | 32.9 |
| 1000 | mean_reverting | 1.04 | 2.91 | <0.0001 | 3.41 | <0.0001 | 0.13 | 0.3685 | <0.0001 | <0.0001 | <0.0001 | 378.0 | 68.8 | 2739.60 | 27.40 | 0.436 | 0.316 | 7.1 | 5.95 | 33.2 |
| 1000 | choppy | 3.43 | 3.22 | <0.0001 | 3.35 | <0.0001 | 0.32 | 0.6880 | <0.0001 | <0.0001 | <0.0001 | 373.0 | 46.4 | 2804.26 | 28.04 | 0.388 | 0.277 | 7.0 | 5.92 | 33.1 |
| 1000 | stress_flash_crash | -3.46 | 1.50 | 0.0199 | 2.37 | 0.0006 | 0.16 | 0.8193 | <0.0001 | <0.0001 | <0.0001 | 353.8 | 41.4 | 2780.85 | 27.81 | 0.388 | 0.280 | 7.0 | 5.94 | 33.1 |

#### Magnitude 0.009, arm O5-Mp-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.49 | 3.92 | 0.0015 | 3.96 | 0.0014 | 1.36 | 0.2749 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 21.83 | 21.83 | 0.433 | 0.335 | 5.0 | 3.90 | 40.2 |
| 10 | mean_reverting | -0.12 | 3.07 | 0.0006 | 3.14 | 0.0005 | 0.91 | 0.3160 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 22.24 | 22.24 | 0.445 | 0.359 | 4.9 | 3.86 | 42.5 |
| 10 | choppy | 3.13 | 3.39 | 0.0017 | 3.36 | 0.0019 | 1.15 | 0.3086 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 22.22 | 22.22 | 0.379 | 0.291 | 4.9 | 3.82 | 42.8 |
| 10 | stress_flash_crash | -3.59 | 2.37 | 0.0086 | 2.55 | 0.0048 | 0.80 | 0.3970 | <0.0001 | <0.0001 | <0.0001 | 0.4 | 0.0 | 23.49 | 23.49 | 0.379 | 0.288 | 4.9 | 3.80 | 43.3 |
| 100 | trending | 7.14 | 4.48 | <0.0001 | 4.43 | <0.0001 | 0.64 | 0.4776 | <0.0001 | <0.0001 | <0.0001 | 35.9 | 0.0 | 273.54 | 27.35 | 0.431 | 0.295 | 7.0 | 5.78 | 32.3 |
| 100 | mean_reverting | 1.20 | 3.19 | <0.0001 | 3.62 | <0.0001 | 0.47 | 0.1343 | <0.0001 | <0.0001 | <0.0001 | 36.9 | 0.0 | 269.53 | 26.95 | 0.439 | 0.315 | 7.0 | 5.70 | 33.7 |
| 100 | choppy | 3.52 | 3.43 | <0.0001 | 3.53 | <0.0001 | 0.63 | 0.4595 | <0.0001 | <0.0001 | <0.0001 | 35.4 | 0.0 | 273.13 | 27.31 | 0.387 | 0.273 | 7.0 | 5.66 | 33.7 |
| 100 | stress_flash_crash | -3.35 | 1.74 | 0.0119 | 2.44 | 0.0008 | 0.34 | 0.6464 | <0.0001 | <0.0001 | <0.0001 | 33.7 | 0.0 | 272.15 | 27.22 | 0.387 | 0.277 | 7.0 | 5.66 | 33.8 |
| 1000 | trending | 7.33 | 4.61 | <0.0001 | 4.43 | <0.0001 | 0.45 | 0.6006 | <0.0001 | <0.0001 | <0.0001 | 401.2 | 0.0 | 2874.02 | 28.74 | 0.433 | 0.290 | 7.1 | 5.94 | 32.9 |
| 1000 | mean_reverting | 1.29 | 3.15 | <0.0001 | 3.66 | <0.0001 | 0.38 | 0.0103 | <0.0001 | <0.0001 | <0.0001 | 404.4 | 0.0 | 2807.11 | 28.07 | 0.436 | 0.309 | 7.2 | 5.92 | 33.3 |
| 1000 | choppy | 3.62 | 3.42 | <0.0001 | 3.54 | <0.0001 | 0.51 | 0.5221 | <0.0001 | <0.0001 | <0.0001 | 391.9 | 0.0 | 2857.56 | 28.58 | 0.388 | 0.271 | 7.1 | 5.89 | 33.3 |
| 1000 | stress_flash_crash | -3.33 | 1.63 | 0.0122 | 2.49 | 0.0003 | 0.29 | 0.6807 | <0.0001 | <0.0001 | <0.0001 | 370.2 | 0.0 | 2817.43 | 28.17 | 0.388 | 0.275 | 7.1 | 5.91 | 33.3 |

#### Magnitude 0.009, arm O10-N-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.89 | 2.32 | 0.0445 | 2.36 | 0.0412 | -0.24 | 0.8406 | <0.0001 | <0.0001 | 0.0112 | 0.0 | 0.0 | 10.94 | 10.94 | 0.433 | 0.364 | 4.9 | 4.05 | 40.5 |
| 10 | mean_reverting | -1.21 | 1.98 | 0.0157 | 2.05 | 0.0132 | -0.18 | 0.8329 | <0.0001 | <0.0001 | 0.0224 | 0.0 | 0.0 | 11.53 | 11.53 | 0.445 | 0.383 | 4.9 | 3.99 | 42.9 |
| 10 | choppy | 1.70 | 1.95 | 0.0474 | 1.92 | 0.0516 | -0.29 | 0.7830 | <0.0001 | <0.0001 | 0.0130 | 0.0 | 0.0 | 11.22 | 11.22 | 0.379 | 0.319 | 4.9 | 4.00 | 41.0 |
| 10 | stress_flash_crash | -4.53 | 1.43 | 0.0842 | 1.60 | 0.0528 | -0.15 | 0.8639 | <0.0001 | <0.0001 | 0.0852 | 0.0 | 0.0 | 12.53 | 12.53 | 0.379 | 0.317 | 4.8 | 3.99 | 40.9 |
| 100 | trending | 4.19 | 1.53 | 0.0508 | 1.48 | 0.0720 | -2.31 | 0.0081 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 108.70 | 10.87 | 0.431 | 0.355 | 7.0 | 5.98 | 32.3 |
| 100 | mean_reverting | -1.21 | 0.78 | 0.0013 | 1.22 | <0.0001 | -1.94 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 110.17 | 11.02 | 0.439 | 0.373 | 7.0 | 5.92 | 33.4 |
| 100 | choppy | 1.22 | 1.12 | 0.1216 | 1.23 | 0.1061 | -1.68 | 0.0376 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 112.04 | 11.20 | 0.387 | 0.325 | 7.0 | 5.92 | 33.1 |
| 100 | stress_flash_crash | -4.77 | 0.32 | 0.6081 | 1.03 | 0.1217 | -1.08 | 0.1179 | 0.0003 | <0.0001 | <0.0001 | 0.0 | 0.0 | 120.71 | 12.07 | 0.387 | 0.325 | 7.0 | 5.91 | 33.1 |
| 1000 | trending | 4.06 | 1.34 | 0.0693 | 1.16 | 0.1386 | -2.81 | 0.0009 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1085.03 | 10.85 | 0.433 | 0.357 | 7.0 | 6.14 | 32.8 |
| 1000 | mean_reverting | -1.32 | 0.55 | <0.0001 | 1.05 | <0.0001 | -2.23 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1082.76 | 10.83 | 0.436 | 0.371 | 7.0 | 6.14 | 33.0 |
| 1000 | choppy | 1.25 | 1.04 | 0.1258 | 1.17 | 0.1043 | -1.87 | 0.0145 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1135.67 | 11.36 | 0.388 | 0.325 | 7.0 | 6.12 | 33.0 |
| 1000 | stress_flash_crash | -4.78 | 0.18 | 0.7635 | 1.05 | 0.1011 | -1.16 | 0.0802 | 0.0163 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1217.88 | 12.18 | 0.388 | 0.326 | 7.0 | 6.12 | 33.0 |

#### Magnitude 0.009, arm O10-Mo-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.19 | 2.63 | 0.0240 | 2.66 | 0.0220 | 0.07 | 0.9544 | <0.0001 | <0.0001 | 0.0013 | 0.4 | 0.0 | 11.27 | 11.27 | 0.433 | 0.357 | 5.0 | 4.10 | 39.0 |
| 10 | mean_reverting | -0.99 | 2.20 | 0.0081 | 2.27 | 0.0068 | 0.04 | 0.9636 | <0.0001 | <0.0001 | 0.0743 | 0.3 | 0.0 | 12.02 | 12.02 | 0.445 | 0.376 | 5.0 | 4.07 | 41.6 |
| 10 | choppy | 2.03 | 2.29 | 0.0244 | 2.26 | 0.0268 | 0.05 | 0.9651 | <0.0001 | <0.0001 | 0.0075 | 0.4 | 0.0 | 11.60 | 11.60 | 0.379 | 0.311 | 5.0 | 4.09 | 39.3 |
| 10 | stress_flash_crash | -4.35 | 1.62 | 0.0576 | 1.79 | 0.0356 | 0.04 | 0.9682 | <0.0001 | <0.0001 | 0.0069 | 0.4 | 0.0 | 12.85 | 12.85 | 0.379 | 0.309 | 5.0 | 4.09 | 39.4 |
| 100 | trending | 6.33 | 3.67 | <0.0001 | 3.62 | <0.0001 | -0.17 | 0.8516 | <0.0001 | <0.0001 | 0.0438 | 35.4 | 0.0 | 160.38 | 16.04 | 0.431 | 0.300 | 7.0 | 5.89 | 32.2 |
| 100 | mean_reverting | 0.63 | 2.62 | <0.0001 | 3.06 | <0.0001 | -0.09 | 0.7606 | <0.0001 | <0.0001 | 0.2326 | 37.1 | 0.3 | 157.66 | 15.77 | 0.439 | 0.323 | 7.0 | 5.79 | 33.0 |
| 100 | choppy | 2.74 | 2.65 | 0.0007 | 2.75 | 0.0007 | -0.15 | 0.8539 | <0.0001 | <0.0001 | 0.0350 | 35.2 | 0.0 | 159.13 | 15.91 | 0.387 | 0.283 | 7.0 | 5.84 | 33.0 |
| 100 | stress_flash_crash | -3.83 | 1.27 | 0.0547 | 1.97 | 0.0046 | -0.14 | 0.8443 | <0.0001 | <0.0001 | 0.0318 | 33.9 | 0.0 | 160.44 | 16.04 | 0.387 | 0.286 | 7.0 | 5.83 | 33.0 |
| 1000 | trending | 6.44 | 3.72 | <0.0001 | 3.54 | <0.0001 | -0.43 | 0.6131 | <0.0001 | <0.0001 | <0.0001 | 390.7 | 3.9 | 1739.59 | 17.40 | 0.433 | 0.295 | 7.1 | 6.02 | 33.1 |
| 1000 | mean_reverting | 0.58 | 2.45 | <0.0001 | 2.96 | <0.0001 | -0.33 | 0.0239 | <0.0001 | <0.0001 | <0.0001 | 398.2 | 4.1 | 1690.43 | 16.90 | 0.436 | 0.320 | 7.2 | 6.01 | 33.1 |
| 1000 | choppy | 2.89 | 2.68 | 0.0003 | 2.81 | 0.0003 | -0.23 | 0.7697 | <0.0001 | <0.0001 | <0.0001 | 381.5 | 3.1 | 1722.53 | 17.23 | 0.388 | 0.279 | 7.1 | 5.99 | 33.2 |
| 1000 | stress_flash_crash | -3.83 | 1.13 | 0.0715 | 2.00 | 0.0029 | -0.21 | 0.7561 | <0.0001 | <0.0001 | <0.0001 | 362.8 | 1.9 | 1697.94 | 16.98 | 0.388 | 0.285 | 7.1 | 6.01 | 33.3 |

#### Magnitude 0.009, arm O10-Mp-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.19 | 2.63 | 0.0240 | 2.66 | 0.0220 | 0.07 | 0.9544 | <0.0001 | <0.0001 | 0.0013 | 0.4 | 0.0 | 11.27 | 11.27 | 0.433 | 0.357 | 5.0 | 4.10 | 39.0 |
| 10 | mean_reverting | -0.99 | 2.20 | 0.0081 | 2.27 | 0.0068 | 0.04 | 0.9636 | <0.0001 | <0.0001 | 0.0743 | 0.3 | 0.0 | 12.02 | 12.02 | 0.445 | 0.376 | 5.0 | 4.07 | 41.6 |
| 10 | choppy | 2.03 | 2.29 | 0.0244 | 2.26 | 0.0268 | 0.05 | 0.9651 | <0.0001 | <0.0001 | 0.0075 | 0.4 | 0.0 | 11.60 | 11.60 | 0.379 | 0.311 | 5.0 | 4.09 | 39.3 |
| 10 | stress_flash_crash | -4.35 | 1.62 | 0.0576 | 1.79 | 0.0356 | 0.04 | 0.9682 | <0.0001 | <0.0001 | 0.0069 | 0.4 | 0.0 | 12.85 | 12.85 | 0.379 | 0.309 | 5.0 | 4.09 | 39.4 |
| 100 | trending | 6.35 | 3.69 | <0.0001 | 3.64 | <0.0001 | -0.15 | 0.8679 | <0.0001 | <0.0001 | 0.0085 | 35.6 | 0.0 | 161.82 | 16.18 | 0.431 | 0.298 | 7.0 | 5.88 | 32.1 |
| 100 | mean_reverting | 0.60 | 2.59 | <0.0001 | 3.02 | <0.0001 | -0.13 | 0.6696 | <0.0001 | <0.0001 | 0.0202 | 36.8 | 0.0 | 158.82 | 15.88 | 0.439 | 0.323 | 7.0 | 5.79 | 33.5 |
| 100 | choppy | 2.83 | 2.73 | 0.0005 | 2.84 | 0.0005 | -0.07 | 0.9380 | <0.0001 | <0.0001 | 0.2225 | 35.6 | 0.0 | 162.24 | 16.22 | 0.387 | 0.280 | 7.0 | 5.82 | 33.0 |
| 100 | stress_flash_crash | -3.80 | 1.29 | 0.0519 | 1.99 | 0.0044 | -0.11 | 0.8737 | <0.0001 | <0.0001 | 0.0104 | 33.8 | 0.0 | 162.18 | 16.22 | 0.387 | 0.286 | 7.0 | 5.84 | 32.8 |
| 1000 | trending | 6.55 | 3.83 | <0.0001 | 3.65 | <0.0001 | -0.32 | 0.7052 | <0.0001 | <0.0001 | <0.0001 | 393.9 | 0.0 | 1749.26 | 17.49 | 0.433 | 0.292 | 7.1 | 6.01 | 33.2 |
| 1000 | mean_reverting | 0.66 | 2.53 | <0.0001 | 3.04 | <0.0001 | -0.25 | 0.0892 | <0.0001 | <0.0001 | <0.0001 | 400.0 | 0.0 | 1692.95 | 16.93 | 0.436 | 0.317 | 7.1 | 6.01 | 33.0 |
| 1000 | choppy | 2.91 | 2.71 | 0.0002 | 2.83 | 0.0002 | -0.20 | 0.7968 | <0.0001 | <0.0001 | <0.0001 | 383.4 | 0.0 | 1722.19 | 17.22 | 0.388 | 0.278 | 7.2 | 5.99 | 33.4 |
| 1000 | stress_flash_crash | -3.80 | 1.16 | 0.0641 | 2.03 | 0.0025 | -0.18 | 0.7892 | <0.0001 | <0.0001 | <0.0001 | 364.4 | 0.0 | 1700.93 | 17.01 | 0.388 | 0.283 | 7.2 | 6.01 | 33.3 |

#### Magnitude 0.009, arm Omix-N-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.38 | 2.81 | 0.0246 | 2.85 | 0.0228 | 0.25 | 0.8425 | <0.0001 | <0.0001 | 0.3582 | 0.0 | 0.0 | 28.92 | 28.92 | 0.433 | 0.362 | 4.8 | 3.77 | 41.9 |
| 10 | mean_reverting | -0.94 | 2.25 | 0.0087 | 2.32 | 0.0073 | 0.09 | 0.9186 | <0.0001 | <0.0001 | 0.6415 | 0.0 | 0.0 | 29.87 | 29.87 | 0.445 | 0.377 | 4.8 | 3.78 | 41.9 |
| 10 | choppy | 1.88 | 2.13 | 0.0313 | 2.10 | 0.0342 | -0.11 | 0.9198 | <0.0001 | <0.0001 | 0.5890 | 0.0 | 0.0 | 29.99 | 29.99 | 0.379 | 0.321 | 4.8 | 3.77 | 41.9 |
| 10 | stress_flash_crash | -4.59 | 1.37 | 0.1034 | 1.55 | 0.0665 | -0.21 | 0.8170 | <0.0001 | <0.0001 | 0.2266 | 0.0 | 0.0 | 30.48 | 30.48 | 0.379 | 0.323 | 4.7 | 3.75 | 42.2 |
| 100 | trending | 4.28 | 1.63 | 0.0393 | 1.57 | 0.0570 | -2.22 | 0.0111 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 145.42 | 14.54 | 0.431 | 0.354 | 7.0 | 5.99 | 32.1 |
| 100 | mean_reverting | -1.14 | 0.85 | 0.0005 | 1.29 | <0.0001 | -1.86 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 146.44 | 14.64 | 0.439 | 0.371 | 7.0 | 5.90 | 33.4 |
| 100 | choppy | 1.29 | 1.20 | 0.0976 | 1.30 | 0.0855 | -1.60 | 0.0465 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 148.96 | 14.90 | 0.387 | 0.325 | 7.0 | 5.92 | 33.1 |
| 100 | stress_flash_crash | -4.73 | 0.37 | 0.5612 | 1.07 | 0.1068 | -1.04 | 0.1325 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 156.79 | 15.68 | 0.387 | 0.326 | 7.0 | 5.90 | 33.3 |
| 1000 | trending | 4.19 | 1.47 | 0.0477 | 1.29 | 0.1012 | -2.68 | 0.0016 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1456.51 | 14.57 | 0.433 | 0.355 | 7.0 | 6.15 | 32.7 |
| 1000 | mean_reverting | -1.21 | 0.66 | <0.0001 | 1.17 | <0.0001 | -2.11 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1455.47 | 14.55 | 0.436 | 0.369 | 7.0 | 6.13 | 33.1 |
| 1000 | choppy | 1.32 | 1.12 | 0.1009 | 1.25 | 0.0841 | -1.79 | 0.0189 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1503.26 | 15.03 | 0.388 | 0.325 | 7.0 | 6.12 | 33.0 |
| 1000 | stress_flash_crash | -4.74 | 0.22 | 0.7191 | 1.08 | 0.0905 | -1.13 | 0.0900 | 0.0046 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1580.32 | 15.80 | 0.388 | 0.325 | 7.0 | 6.12 | 33.0 |

#### Magnitude 0.009, arm Omix-Mo-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.42 | 2.86 | 0.0233 | 2.89 | 0.0215 | 0.30 | 0.8151 | <0.0001 | <0.0001 | 0.2885 | 0.3 | 0.7 | 29.15 | 29.15 | 0.433 | 0.362 | 4.9 | 3.77 | 42.0 |
| 10 | mean_reverting | -0.94 | 2.25 | 0.0086 | 2.32 | 0.0072 | 0.09 | 0.9171 | <0.0001 | <0.0001 | 0.6347 | 0.2 | 1.0 | 30.10 | 30.10 | 0.445 | 0.377 | 4.9 | 3.78 | 41.7 |
| 10 | choppy | 1.90 | 2.15 | 0.0303 | 2.12 | 0.0331 | -0.09 | 0.9321 | <0.0001 | <0.0001 | 0.6441 | 0.2 | 1.3 | 30.06 | 30.06 | 0.379 | 0.321 | 4.9 | 3.77 | 41.9 |
| 10 | stress_flash_crash | -4.58 | 1.38 | 0.1018 | 1.56 | 0.0655 | -0.20 | 0.8242 | <0.0001 | <0.0001 | 0.2433 | 0.2 | 1.3 | 30.59 | 30.59 | 0.379 | 0.323 | 4.7 | 3.75 | 42.1 |
| 100 | trending | 5.88 | 3.22 | 0.0001 | 3.17 | 0.0003 | -0.62 | 0.4855 | <0.0001 | <0.0001 | <0.0001 | 31.2 | 12.7 | 188.66 | 18.87 | 0.431 | 0.315 | 7.0 | 5.89 | 32.1 |
| 100 | mean_reverting | 0.05 | 2.04 | <0.0001 | 2.47 | <0.0001 | -0.68 | 0.0243 | <0.0001 | <0.0001 | <0.0001 | 32.1 | 12.0 | 182.21 | 18.22 | 0.439 | 0.341 | 7.0 | 5.83 | 33.5 |
| 100 | choppy | 2.33 | 2.23 | 0.0029 | 2.34 | 0.0029 | -0.57 | 0.4852 | <0.0001 | <0.0001 | <0.0001 | 31.2 | 10.6 | 186.77 | 18.68 | 0.387 | 0.297 | 7.0 | 5.83 | 33.2 |
| 100 | stress_flash_crash | -4.13 | 0.96 | 0.1368 | 1.66 | 0.0146 | -0.44 | 0.5254 | <0.0001 | <0.0001 | <0.0001 | 29.3 | 9.3 | 189.04 | 18.90 | 0.387 | 0.300 | 7.0 | 5.82 | 33.5 |
| 1000 | trending | 5.91 | 3.19 | <0.0001 | 3.01 | 0.0003 | -0.97 | 0.2566 | <0.0001 | <0.0001 | <0.0001 | 343.2 | 142.0 | 1978.73 | 19.79 | 0.433 | 0.313 | 7.1 | 6.05 | 32.9 |
| 1000 | mean_reverting | 0.14 | 2.01 | <0.0001 | 2.51 | <0.0001 | -0.77 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 348.9 | 133.4 | 1918.48 | 19.18 | 0.436 | 0.335 | 7.0 | 6.03 | 33.3 |
| 1000 | choppy | 2.48 | 2.27 | 0.0015 | 2.40 | 0.0014 | -0.63 | 0.4115 | <0.0001 | <0.0001 | <0.0001 | 346.8 | 109.7 | 1964.55 | 19.65 | 0.388 | 0.294 | 7.1 | 6.03 | 33.3 |
| 1000 | stress_flash_crash | -4.08 | 0.88 | 0.1532 | 1.75 | 0.0080 | -0.46 | 0.4931 | <0.0001 | <0.0001 | <0.0001 | 330.5 | 104.7 | 1974.30 | 19.74 | 0.388 | 0.297 | 7.1 | 6.04 | 33.2 |

#### Magnitude 0.009, arm Omix-Mp-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.49 | 2.92 | 0.0203 | 2.96 | 0.0188 | 0.36 | 0.7781 | <0.0001 | <0.0001 | 0.1812 | 0.4 | 0.0 | 29.43 | 29.43 | 0.433 | 0.359 | 4.9 | 3.81 | 41.3 |
| 10 | mean_reverting | -0.79 | 2.40 | 0.0053 | 2.47 | 0.0044 | 0.24 | 0.7856 | <0.0001 | <0.0001 | 0.1641 | 0.4 | 0.0 | 30.44 | 30.44 | 0.445 | 0.373 | 4.9 | 3.88 | 39.8 |
| 10 | choppy | 2.04 | 2.29 | 0.0234 | 2.26 | 0.0256 | 0.05 | 0.9629 | <0.0001 | <0.0001 | 0.8017 | 0.4 | 0.0 | 30.82 | 30.82 | 0.379 | 0.317 | 4.9 | 3.83 | 41.2 |
| 10 | stress_flash_crash | -4.50 | 1.46 | 0.0877 | 1.64 | 0.0561 | -0.12 | 0.8979 | <0.0001 | <0.0001 | 0.4777 | 0.4 | 0.0 | 31.44 | 31.44 | 0.379 | 0.319 | 4.8 | 3.80 | 41.4 |
| 100 | trending | 6.21 | 3.56 | <0.0001 | 3.50 | <0.0001 | -0.29 | 0.7491 | <0.0001 | <0.0001 | <0.0001 | 35.7 | 0.0 | 193.15 | 19.31 | 0.431 | 0.306 | 7.0 | 5.89 | 32.1 |
| 100 | mean_reverting | 0.36 | 2.35 | <0.0001 | 2.78 | <0.0001 | -0.37 | 0.2294 | <0.0001 | <0.0001 | <0.0001 | 37.0 | 0.0 | 189.58 | 18.96 | 0.439 | 0.332 | 7.0 | 5.81 | 33.7 |
| 100 | choppy | 2.67 | 2.58 | 0.0009 | 2.68 | 0.0009 | -0.22 | 0.7891 | <0.0001 | <0.0001 | 0.0001 | 35.1 | 0.0 | 192.00 | 19.20 | 0.387 | 0.288 | 7.0 | 5.82 | 32.9 |
| 100 | stress_flash_crash | -3.87 | 1.23 | 0.0629 | 1.93 | 0.0056 | -0.17 | 0.8060 | <0.0001 | <0.0001 | 0.0001 | 33.5 | 0.0 | 193.56 | 19.36 | 0.387 | 0.292 | 7.0 | 5.83 | 33.1 |
| 1000 | trending | 6.36 | 3.65 | <0.0001 | 3.46 | <0.0001 | -0.51 | 0.5512 | <0.0001 | <0.0001 | <0.0001 | 398.7 | 0.0 | 2064.41 | 20.64 | 0.433 | 0.302 | 7.2 | 6.03 | 33.0 |
| 1000 | mean_reverting | 0.51 | 2.38 | <0.0001 | 2.89 | <0.0001 | -0.40 | 0.0076 | <0.0001 | <0.0001 | <0.0001 | 404.1 | 0.0 | 2006.36 | 20.06 | 0.436 | 0.325 | 7.0 | 6.02 | 33.3 |
| 1000 | choppy | 2.74 | 2.53 | 0.0005 | 2.66 | 0.0005 | -0.37 | 0.6294 | <0.0001 | <0.0001 | <0.0001 | 389.8 | 0.0 | 2029.16 | 20.29 | 0.388 | 0.287 | 7.1 | 6.01 | 33.5 |
| 1000 | stress_flash_crash | -3.93 | 1.03 | 0.0975 | 1.90 | 0.0043 | -0.31 | 0.6477 | <0.0001 | <0.0001 | <0.0001 | 370.2 | 0.0 | 2026.93 | 20.27 | 0.388 | 0.291 | 7.1 | 6.02 | 33.4 |

#### Magnitude 0.009, arm RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.82 | 2.25 | 0.0486 | 2.29 | 0.0450 | -0.31 | 0.7944 | <0.0001 | <0.0001 | 0.0012 | 0.0 | 0.0 | 9.36 | 9.36 | 0.433 | 0.366 | 4.9 | 4.14 | 38.9 |
| 10 | mean_reverting | -1.25 | 1.94 | 0.0167 | 2.01 | 0.0140 | -0.22 | 0.7944 | <0.0001 | <0.0001 | 0.0122 | 0.0 | 0.0 | 9.61 | 9.61 | 0.445 | 0.386 | 4.9 | 4.07 | 41.5 |
| 10 | choppy | 1.70 | 1.95 | 0.0437 | 1.92 | 0.0477 | -0.29 | 0.7828 | <0.0001 | <0.0001 | 0.0373 | 0.0 | 0.0 | 9.71 | 9.71 | 0.379 | 0.320 | 4.9 | 4.06 | 39.7 |
| 10 | stress_flash_crash | -4.41 | 1.55 | 0.0576 | 1.73 | 0.0348 | -0.03 | 0.9731 | <0.0001 | <0.0001 | 0.7953 | 0.0 | 0.0 | 10.51 | 10.51 | 0.379 | 0.320 | 4.9 | 4.06 | 39.7 |
| 100 | trending | 6.27 | 3.61 | <0.0001 | 3.56 | <0.0001 | -0.23 | 0.7851 | <0.0001 | <0.0001 | 0.0040 | 0.0 | 0.0 | 149.12 | 14.91 | 0.431 | 0.285 | 7.0 | 5.79 | 33.2 |
| 100 | mean_reverting | 1.02 | 3.01 | <0.0001 | 3.44 | <0.0001 | 0.29 | 0.2902 | <0.0001 | <0.0001 | 0.0001 | 0.0 | 0.0 | 148.40 | 14.84 | 0.439 | 0.320 | 7.0 | 5.64 | 35.3 |
| 100 | choppy | 3.04 | 2.95 | <0.0001 | 3.05 | <0.0001 | 0.15 | 0.8505 | <0.0001 | <0.0001 | 0.0850 | 0.0 | 0.0 | 150.74 | 15.07 | 0.387 | 0.275 | 7.0 | 5.71 | 33.9 |
| 100 | stress_flash_crash | -2.94 | 2.16 | 0.0006 | 2.86 | <0.0001 | 0.75 | 0.2620 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 151.43 | 15.14 | 0.387 | 0.280 | 7.0 | 5.72 | 34.0 |
| 1000 | trending | 6.74 | 4.02 | <0.0001 | 3.84 | <0.0001 | -0.14 | 0.8654 | <0.0001 | <0.0001 | 0.0776 | 0.0 | 0.0 | 1704.11 | 17.04 | 0.433 | 0.273 | 7.0 | 5.92 | 33.4 |
| 1000 | mean_reverting | 1.41 | 3.28 | <0.0001 | 3.79 | <0.0001 | 0.51 | 0.0003 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1688.28 | 16.88 | 0.436 | 0.305 | 7.0 | 5.90 | 33.5 |
| 1000 | choppy | 3.50 | 3.29 | <0.0001 | 3.42 | <0.0001 | 0.38 | 0.6089 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1719.43 | 17.19 | 0.388 | 0.263 | 7.0 | 5.90 | 33.6 |
| 1000 | stress_flash_crash | -2.58 | 2.38 | <0.0001 | 3.25 | <0.0001 | 1.04 | 0.1104 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1707.11 | 17.07 | 0.388 | 0.271 | 7.0 | 5.93 | 33.5 |

#### Magnitude 0.009, arm O3-RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.81 | 4.25 | 0.0007 | 4.28 | 0.0006 | 1.69 | 0.1807 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 31.33 | 31.33 | 0.433 | 0.332 | 4.8 | 3.66 | 42.1 |
| 10 | mean_reverting | 0.26 | 3.45 | 0.0002 | 3.52 | 0.0001 | 1.29 | 0.1639 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 31.35 | 31.35 | 0.445 | 0.348 | 4.9 | 3.52 | 44.7 |
| 10 | choppy | 3.35 | 3.60 | 0.0012 | 3.57 | 0.0014 | 1.36 | 0.2392 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 32.83 | 32.83 | 0.379 | 0.289 | 4.8 | 3.55 | 45.2 |
| 10 | stress_flash_crash | -3.34 | 2.62 | 0.0055 | 2.79 | 0.0031 | 1.04 | 0.2863 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 33.88 | 33.88 | 0.379 | 0.289 | 4.7 | 3.55 | 45.5 |
| 100 | trending | 7.69 | 5.04 | <0.0001 | 4.98 | <0.0001 | 1.20 | 0.1733 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 436.31 | 43.63 | 0.431 | 0.294 | 7.0 | 5.66 | 33.1 |
| 100 | mean_reverting | 1.99 | 3.99 | <0.0001 | 4.42 | <0.0001 | 1.27 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 432.25 | 43.22 | 0.439 | 0.312 | 7.0 | 5.63 | 33.8 |
| 100 | choppy | 4.26 | 4.17 | <0.0001 | 4.27 | <0.0001 | 1.37 | 0.1015 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 436.06 | 43.61 | 0.387 | 0.272 | 7.0 | 5.56 | 34.0 |
| 100 | stress_flash_crash | -2.23 | 2.86 | <0.0001 | 3.56 | <0.0001 | 1.46 | 0.0450 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 436.70 | 43.67 | 0.387 | 0.273 | 7.0 | 5.55 | 34.2 |
| 1000 | trending | 7.97 | 5.25 | <0.0001 | 5.07 | <0.0001 | 1.10 | 0.1971 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 4591.66 | 45.92 | 0.433 | 0.291 | 7.0 | 5.91 | 33.0 |
| 1000 | mean_reverting | 2.24 | 4.11 | <0.0001 | 4.61 | <0.0001 | 1.33 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 4450.31 | 44.50 | 0.436 | 0.305 | 7.0 | 5.94 | 33.2 |
| 1000 | choppy | 4.55 | 4.34 | <0.0001 | 4.47 | <0.0001 | 1.43 | 0.0660 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 4560.04 | 45.60 | 0.388 | 0.269 | 7.0 | 5.88 | 33.3 |
| 1000 | stress_flash_crash | -2.08 | 2.87 | <0.0001 | 3.74 | <0.0001 | 1.53 | 0.0262 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 4517.87 | 45.18 | 0.388 | 0.272 | 7.0 | 5.91 | 33.3 |

#### Magnitude 0.009, arm O5-RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 5.55 | 3.99 | 0.0012 | 4.02 | 0.0011 | 1.43 | 0.2511 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 22.30 | 22.30 | 0.433 | 0.332 | 4.9 | 3.82 | 41.3 |
| 10 | mean_reverting | -0.05 | 3.14 | 0.0004 | 3.21 | 0.0004 | 0.98 | 0.2822 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 22.09 | 22.09 | 0.445 | 0.358 | 4.9 | 3.80 | 43.0 |
| 10 | choppy | 3.10 | 3.36 | 0.0014 | 3.33 | 0.0016 | 1.12 | 0.3108 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 22.46 | 22.46 | 0.379 | 0.290 | 4.8 | 3.73 | 44.6 |
| 10 | stress_flash_crash | -3.48 | 2.48 | 0.0051 | 2.66 | 0.0028 | 0.90 | 0.3282 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 23.63 | 23.63 | 0.379 | 0.288 | 4.8 | 3.70 | 45.3 |
| 100 | trending | 7.47 | 4.81 | <0.0001 | 4.76 | <0.0001 | 0.97 | 0.2676 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 316.30 | 31.63 | 0.431 | 0.280 | 7.0 | 5.67 | 32.9 |
| 100 | mean_reverting | 1.86 | 3.85 | <0.0001 | 4.29 | <0.0001 | 1.13 | 0.0002 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 305.24 | 30.52 | 0.439 | 0.302 | 7.0 | 5.58 | 34.4 |
| 100 | choppy | 4.11 | 4.02 | <0.0001 | 4.12 | <0.0001 | 1.22 | 0.1416 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 317.34 | 31.73 | 0.387 | 0.258 | 7.0 | 5.51 | 34.3 |
| 100 | stress_flash_crash | -2.25 | 2.85 | <0.0001 | 3.55 | <0.0001 | 1.44 | 0.0445 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 312.52 | 31.25 | 0.387 | 0.262 | 7.0 | 5.54 | 34.0 |
| 1000 | trending | 7.76 | 5.04 | <0.0001 | 4.85 | <0.0001 | 0.88 | 0.2929 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3365.71 | 33.66 | 0.433 | 0.274 | 7.0 | 5.85 | 33.1 |
| 1000 | mean_reverting | 2.14 | 4.00 | <0.0001 | 4.51 | <0.0001 | 1.23 | <0.0001 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3255.81 | 32.56 | 0.436 | 0.291 | 7.0 | 5.85 | 33.4 |
| 1000 | choppy | 4.38 | 4.17 | <0.0001 | 4.30 | <0.0001 | 1.27 | 0.1002 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3356.12 | 33.56 | 0.388 | 0.254 | 7.0 | 5.79 | 33.6 |
| 1000 | stress_flash_crash | -2.06 | 2.90 | <0.0001 | 3.77 | <0.0001 | 1.56 | 0.0221 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3293.74 | 32.94 | 0.388 | 0.258 | 7.0 | 5.81 | 33.7 |

#### Magnitude 0.009, arm O10-RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.18 | 2.62 | 0.0239 | 2.65 | 0.0220 | 0.06 | 0.9621 | <0.0001 | <0.0001 | 0.2671 | 0.0 | 0.0 | 11.31 | 11.31 | 0.433 | 0.356 | 4.9 | 4.04 | 39.9 |
| 10 | mean_reverting | -0.95 | 2.25 | 0.0066 | 2.31 | 0.0055 | 0.09 | 0.9206 | <0.0001 | <0.0001 | 0.0848 | 0.0 | 0.0 | 12.04 | 12.04 | 0.445 | 0.376 | 4.9 | 3.98 | 42.5 |
| 10 | choppy | 1.96 | 2.22 | 0.0247 | 2.18 | 0.0272 | -0.03 | 0.9804 | <0.0001 | <0.0001 | 0.7374 | 0.0 | 0.0 | 11.53 | 11.53 | 0.379 | 0.312 | 4.9 | 4.00 | 40.3 |
| 10 | stress_flash_crash | -4.22 | 1.74 | 0.0367 | 1.91 | 0.0216 | 0.16 | 0.8564 | <0.0001 | <0.0001 | 0.1255 | 0.0 | 0.0 | 12.57 | 12.57 | 0.379 | 0.312 | 4.8 | 4.01 | 40.3 |
| 100 | trending | 6.22 | 3.56 | <0.0001 | 3.50 | <0.0001 | -0.28 | 0.7419 | <0.0001 | <0.0001 | 0.0005 | 0.0 | 0.0 | 185.51 | 18.55 | 0.431 | 0.285 | 7.0 | 5.74 | 33.1 |
| 100 | mean_reverting | 0.89 | 2.88 | <0.0001 | 3.31 | <0.0001 | 0.16 | 0.5608 | <0.0001 | <0.0001 | 0.0251 | 0.0 | 0.0 | 177.61 | 17.76 | 0.439 | 0.315 | 7.0 | 5.62 | 34.7 |
| 100 | choppy | 3.03 | 2.94 | <0.0001 | 3.04 | 0.0001 | 0.14 | 0.8612 | <0.0001 | <0.0001 | 0.0915 | 0.0 | 0.0 | 185.70 | 18.57 | 0.387 | 0.270 | 7.0 | 5.67 | 34.2 |
| 100 | stress_flash_crash | -2.93 | 2.17 | 0.0008 | 2.87 | <0.0001 | 0.76 | 0.2684 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 182.99 | 18.30 | 0.387 | 0.276 | 7.0 | 5.71 | 33.8 |
| 1000 | trending | 6.45 | 3.73 | <0.0001 | 3.55 | <0.0001 | -0.42 | 0.6020 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1986.73 | 19.87 | 0.433 | 0.279 | 7.0 | 5.92 | 33.3 |
| 1000 | mean_reverting | 1.17 | 3.04 | <0.0001 | 3.55 | <0.0001 | 0.26 | 0.0575 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1941.31 | 19.41 | 0.436 | 0.303 | 7.0 | 5.91 | 33.4 |
| 1000 | choppy | 3.31 | 3.10 | <0.0001 | 3.23 | <0.0001 | 0.20 | 0.7919 | <0.0001 | <0.0001 | 0.0032 | 0.0 | 0.0 | 2001.08 | 20.01 | 0.388 | 0.263 | 7.0 | 5.88 | 33.5 |
| 1000 | stress_flash_crash | -2.73 | 2.23 | 0.0003 | 3.10 | <0.0001 | 0.89 | 0.1734 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 1961.19 | 19.61 | 0.388 | 0.269 | 7.0 | 5.90 | 33.5 |

#### Magnitude 0.009, arm Omix-RT-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs B-c0.2-x4 | Welch p vs B-c0.2-x4 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs B-c0.2-x4 (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.49 | 2.93 | 0.0198 | 2.96 | 0.0183 | 0.37 | 0.7731 | <0.0001 | <0.0001 | 0.1781 | 0.0 | 0.0 | 29.91 | 29.91 | 0.433 | 0.361 | 4.8 | 3.75 | 42.2 |
| 10 | mean_reverting | -0.72 | 2.48 | 0.0038 | 2.54 | 0.0031 | 0.32 | 0.7204 | <0.0001 | <0.0001 | 0.0884 | 0.0 | 0.0 | 29.23 | 29.23 | 0.445 | 0.375 | 4.8 | 3.78 | 41.5 |
| 10 | choppy | 2.05 | 2.30 | 0.0203 | 2.27 | 0.0224 | 0.06 | 0.9531 | <0.0001 | <0.0001 | 0.7451 | 0.0 | 0.0 | 30.07 | 30.07 | 0.379 | 0.318 | 4.8 | 3.78 | 41.6 |
| 10 | stress_flash_crash | -4.38 | 1.58 | 0.0642 | 1.76 | 0.0401 | 0.01 | 0.9953 | <0.0001 | <0.0001 | 0.9749 | 0.0 | 0.0 | 30.40 | 30.40 | 0.379 | 0.320 | 4.7 | 3.75 | 42.1 |
| 100 | trending | 6.04 | 3.39 | <0.0001 | 3.33 | <0.0001 | -0.45 | 0.5949 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 195.22 | 19.52 | 0.431 | 0.300 | 7.0 | 5.83 | 32.8 |
| 100 | mean_reverting | 0.73 | 2.72 | <0.0001 | 3.16 | <0.0001 | 0.01 | 0.9846 | <0.0001 | <0.0001 | 0.9349 | 0.0 | 0.0 | 189.02 | 18.90 | 0.439 | 0.328 | 7.0 | 5.71 | 34.4 |
| 100 | choppy | 2.92 | 2.82 | 0.0001 | 2.93 | 0.0002 | 0.02 | 0.9775 | <0.0001 | <0.0001 | 0.7958 | 0.0 | 0.0 | 194.58 | 19.46 | 0.387 | 0.283 | 7.0 | 5.75 | 33.4 |
| 100 | stress_flash_crash | -3.04 | 2.05 | 0.0013 | 2.76 | <0.0001 | 0.65 | 0.3389 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 195.78 | 19.58 | 0.387 | 0.287 | 7.0 | 5.74 | 33.7 |
| 1000 | trending | 6.29 | 3.57 | <0.0001 | 3.38 | <0.0001 | -0.59 | 0.4696 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2031.56 | 20.32 | 0.433 | 0.295 | 7.0 | 6.02 | 33.1 |
| 1000 | mean_reverting | 1.01 | 2.88 | <0.0001 | 3.38 | <0.0001 | 0.10 | 0.4580 | <0.0001 | <0.0001 | 0.0005 | 0.0 | 0.0 | 1989.75 | 19.90 | 0.436 | 0.318 | 7.0 | 5.99 | 33.4 |
| 1000 | choppy | 3.17 | 2.97 | <0.0001 | 3.09 | <0.0001 | 0.06 | 0.9379 | <0.0001 | <0.0001 | 0.3811 | 0.0 | 0.0 | 2047.20 | 20.47 | 0.388 | 0.277 | 7.0 | 5.97 | 33.6 |
| 1000 | stress_flash_crash | -2.85 | 2.11 | 0.0005 | 2.98 | <0.0001 | 0.77 | 0.2387 | <0.0001 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2035.83 | 20.36 | 0.388 | 0.283 | 7.0 | 5.99 | 33.6 |

