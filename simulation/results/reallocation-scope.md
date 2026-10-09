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

With `refill: "none" | "retire"`, `owners`, and `donorScope` unset, the code reproduces issue #85 field for field. EQUIVALENCE_RESULT `test/reallocation-scope.test.ts` repeats the check for one cell (B-c0.2-x4, 0.009, population 10, choppy, 50 seeds) on every test run, and checks that one owner holding all 100 slots reproduces the population-wide run.

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

MAG006_TABLE

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

**What replacement was actually buying.** The `RT` diagnostic keeps reallocation and replaces nothing, but retires a starved slot as Control 1 does, leaving its capital idle in its own account. Population-wide, it beats both controls (11 and 12 of 12 cells, median gap 2.7 and 3.2 pp, stress passing on its own against both) and is indistinguishable from arm B (1 cell with p below 0.05, arm `RT` higher; median gap 0.06 pp). RT_006_SENTENCE In this model, then, the value of replacement in arm B is almost entirely that it stops a failing genome from trading, and section 6 retirement does that without copying anyone's genome. Because `RT` was chosen after the first batch was read, this is a strong, consistent observation, not a pre-registered result, and it should be confirmed as a pre-registered arm before it is relied on.

**Owner-scoped reallocation, by owner size.** With mutant replacement (`Mo` or `Mp`) or with retirement (`RT`), owner-scoped reallocation beats both controls at every owner size tested, 3, 5, 10, and the mixed distribution, at both ceilings, with no cell significantly below either control. Against arm B every such arm is inconclusive, with a median gap between -0.6 and +1.4 pp. With no replacement and no retirement (`O<k>-N`), it beats both controls only at `k` = 3 and 5; at `k` = 10 and with the mixed distribution it does not (inconclusive against Control 2 in both, and against Control 1 except mix at ceiling 4).

**Scope itself costs little; the small-pool rule adds aggressiveness.** At `k` = 10, the one size where the small-pool rule equals the population-wide decile rule, owner scope against population-wide ranking with the same replacement setting gives median gaps of -0.28 pp (`N`), -0.03 pp (`RT`), and -0.12 pp (`Mp` against arm B), with at most one significant cell in any comparison. The mixed distribution behaves the same way. Owner pools of 3 and 5 do better than population-wide ranking (median +0.8 to +1.2 pp, 2 cells significant), but they also move two to three times as much capital (21 to 46 percent of starting capital at population 1,000 trending, against 11 to 17 percent), because the small-pool rule makes a third or a fifth of each owner's slots a source at every evaluation. That is a more aggressive reallocation policy, not a benefit of a smaller pool, and the run does not separate the two. A population-wide arm with a larger source and sink share would; it was not run.

**Donor scope.** Drawing the donor within the owner (`Mo`) instead of population-wide (`Mp`) lowers the median gap against Control 1 by 0.02 to 0.33 pp, least at `k` = 10, and at `k` = 3 leaves 36 to 41 percent of starvation triggers at population 1,000 without a donor. Neither scope changes any call, and with `RT` available, neither is needed.

**Magnitude 0.006.** MAG006_PARAGRAPH

**Paired tests (secondary).** Every arm shares the market path and founders on a seed, so paired p-values are small almost everywhere and are reported per cell only in the report below. They show direction, not significance under the rule, and no call above uses them.

## What this decides (issue #89)

The issue's two questions, answered plainly:

1. **Does reallocation alone match arm B?** No, if "alone" means a failing slot keeps trading: it is about 1.1 pp below arm B and passes both controls only at ceiling 4. Yes, in this model, if a failing slot is retired under section 6 instead of replaced: that diagnostic matches arm B and beats both controls. Under "What this decides" in the issue, the first outcome then holds in its useful form: **genome replacement can be dropped from the candidate, provided starvation retires the slot**, which removes the genome consent question. This is a recommendation resting on a diagnostic arm, not a settled decision.
2. **At which owner size does owner-scoped reallocation still beat both controls?** At every size tested, 3, 5, 10, and the assumed mixed distribution, when starvation either retires or replaces the slot. Without either, only at 3 and 5, and there only through the more aggressive small-pool rule. The second outcome of the issue therefore holds: **the candidate is shippable within section 8.3's ownership constraint in this model**, and the product needs a per-owner pool with an owner-approved policy. Owners with a single agent get no benefit from reallocation at all.

For issue #28 this narrows the candidate mechanism to fixed slots with owner-scoped bounded reallocation and section 6 retirement of starved agents, with no genome copying. It still works in this model only at the 0.009 edge assumption (see `fixed-slot.md`), and whether real genomes carry such an edge (section 7) remains the gating unknown.

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
| magnitude 0.006, diagnostic | `RT-c0.2-x4`, `O<k>-RT-c0.2-x4` | 60 | RT6_WALL |
| equivalence | every issue #85 arm at magnitude 0.009, into a scratch directory, compared with `results/fixed-slot/` | 108 | EQ_WALL |

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

