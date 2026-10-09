# Fixed-slot replacement and reallocation

Issue #85. `EVOLUTION.md` section 8 proposes fixed slots with replacement and bounded reallocation as an alternative to the section 3 mechanism, which four runs (issues #74, #80, #82 and PR #79) found never beat a static population. This file runs the four arms of issue #85 on the issue #84 genome performance model (`genome-model.md`), plus the section 3 mechanism as a reference, under the unchanged `ECONOMICS.md` section 8 rule.

Like every earlier result here, this is a test of mechanisms in the harness, not a claim about production. The genome-to-return link is an assumption built into the model so that selection has something to find. A positive result says that, given a genome that carries an edge of this size, the mechanism converts it into population return. It does not say real strategies have such a genome.

## Setup

Every arm uses the same settings, which are the re-run settings of PR #79 arm A with the issue #84 model on:

- Genome model on, at the two validated magnitudes, 0.006 and 0.009. Hidden skill is 0. Founders are random genomes (`randomGenome`), the same founders for every arm on a given seed.
- Populations 10, 100, and 1,000, regimes trending, mean-reverting, choppy, and stress flash crash, seeds 1 to 50 in every cell including population 1,000, 300 ticks.
- Policy: risk tolerance 0.25, execution every tick, diversity on (section 5 niches), x402 $0.01, information purchases on.
- Statistic and rule: `decide` in `src/rerun.ts`, unchanged. An arm outperforms a control only if at least 7 of the 12 cells have the arm's mean ROI higher with a two-sided Welch p below 0.05 and the median gap is positive. Fewer than 6 cells with p below 0.05 in either direction is inconclusive. The stress regime is reported on its own. Paired t-tests on per-seed differences (every arm shares the market path and founders on a seed) are reported only as secondary observations and are not used for any call.

### Arms

| arm | mechanism | mode |
|---|---|---|
| C1 (Control 1) | Static population. Retirement under section 6 as in every earlier static run, no replacement. | `static` |
| C2 (Control 2) | Fixed slots. A slot that meets a replacement trigger receives a random genome. | `slots`, refill `random` |
| A | Fixed slots. A triggered slot receives a section 3.3 mutation of a fit donor's genome, under the section 5 niche rules. | `slots`, refill `mutant` |
| B | Arm A plus bounded reallocation. Swept: cap 0.05 and 0.2, per-slot ceiling 2 and 4 times principal. Named `B-c<cap>-x<ceiling>`. | `slots`, refill `mutant`, reallocation on |
| S3 (reference) | The current section 3 mechanism (account-creating reproduction, profit threshold 0.1) on the same model. | `evolving` |
| R (diagnostic) | Control 2 plus arm B's reallocation at cap 0.2, ceiling 4. Added after the four arms had run, to separate reallocation from donor-based replacement. Not one of the pre-registered arms and not used for the call. | `slots`, refill `random`, reallocation on |

No arm except S3 creates an account. Every slot arm keeps exactly `population` accounts for the whole run, so fixed per-account costs (gas per trade, x402 per purchase) are paid by the same number of accounts as in Control 1.

### Replacement triggers (section 6)

- **Bottom of niche (starvation).** An active slot whose adjusted fitness stays in the bottom decile of its niche for `K = 3` consecutive evaluations. In C1 this retires the agent, as it always has. In the slot arms it is a replacement trigger instead.
- **Capital floor.** A slot below the 0.06 floor is retired, as in C1, and is not refilled: it has no capital to trade with, and reallocation never moves capital into a bottom-ranked slot. A spot check (seeds 1 to 3, population 1,000, trending and stress, both magnitudes, arms C2, A, B-c0.2-x4, and R) found no slot retired at all, so this choice does not drive any result.
- User retirement is not modeled.

Because the starvation rule ranks within a niche, it can only fire in a niche of at least five agents (a single agent's percentile in a niche of size `n` is at least `0.5 / n`). At population 10, with founders spread across up to seven pair-set niches, it fires about 0.4 times per run, so at population 10 the slot arms differ from C1 almost only through reallocation.

### Replacement rule

A triggered slot keeps its account, its capital, and its principal. Its genome is replaced, its fitness history restarts (as a child's would under section 3), and its lineage records the donor.

- **C2:** a random genome from the same distribution as the founders, with the policy's risk tolerance and execution frequency.
- **A and B:** a donor drawn uniformly from the active agents that pass the section 3.1 fitness gates: no zero-downside flag, at least `N_min = 20` trades in the window, and adjusted fitness at or above the section 5 requirement in its own niche (the niche median, or the 75th percentile when the niche holds more than 40 percent of active agents). The new genome is `reproduction.mutate` of the donor's genome, the unchanged section 3.3 operator, at `p_mut` 0.15, doubled in a crowded niche. The capital gates of section 3.1 (profit threshold, cooldown) and the section 4 caps (descendants, population cap) are not applied: replacement moves no capital and creates no account, which is what those gates exist to bound. If no donor qualifies, the slot keeps its genome and is counted under "no donor"; this never happened.
- Draws come from a separate RNG stream (salt 4), so the market path, the founders, and every agent's information-purchase draws are identical across arms on a seed.

### Reallocation rule (arm B)

At each evaluation (every 20 ticks), after replacement:

- Active slots with an adjusted fitness are ranked by it, population-wide. The bottom decile are sources and the top decile are sinks (at least one of each; none at fewer than 10 ranked slots).
- Each source offers `cap` of its current capital, never going below the 0.06 capital floor.
- Each sink can take up to `ceiling * principal - capital`, with principal 10.
- The amount moved is the smaller of total offers and total room. Sources give in proportion to their offers and sinks receive in proportion to their room. Debits equal credits (`src/reallocation.ts`).

The population-wide ranking is a choice: niche-relative ranking would protect weak niches and could not move capital toward the regime's preferred pair. The niche diversity columns below check whether this produced a monoculture. The cap and ceiling values are assumptions, swept at two values each.

### Paper evaluation: deferred

Section 8.2 item 4 (a mutated genome trades on paper before it takes over a slot) is not included in A or B. It does not fit the harness cleanly: it needs three new unmeasured parameters (paper length, acceptance threshold, and what the slot does while the candidate is on paper), a second fitness pipeline for paper returns, and it would add a filter that confounds A and B with something other than replacement and reallocation. It is better tested as its own arm against arm B once arm B's result is known.

### Capital conservation

`test/slots.test.ts` checks, for every arm in both a trending and a stress run, that total capital changes only by gross trading P&L minus fees, slippage, gas, and x402, to within 1e-6, and that no slot arm creates an account or a reproduction. A second test repeats the check with every cost and edge at zero, so any capital created or lost by replacement or reallocation would show directly. A third checks that the mechanisms actually fired in those runs (replacements in C2 and A, capital moved in B), so the conservation check is not vacuous. `planReallocation` is tested on its own for the cap, the floor, the ceiling, and equal debits and credits.

### Model off

With `genomeModel`, `randomGenomes`, and `slots` unset, this branch still reproduces PR #79 arm A field by field (180 of 180 fields, regenerated as part of the diagnostic run below), and `test/genome-model.test.ts` repeats that check for one cell on every test run.

## Summary

The call per arm and control, from the report below. "cells p < 0.05" counts cells with Welch p below 0.05 and splits them by the sign of the gap.

| magnitude | arm | vs C1: cells p < 0.05 | vs C1: median gap pp | vs C1: call | vs C2: cells p < 0.05 | vs C2: median gap pp | vs C2: call | stress vs C1 / vs C2 (3 cells) |
|---:|---|---|---:|---|---|---:|---|---|
| 0.006 | C2 | 4 (0 up, 4 down) | -0.59 | inconclusive | n/a | n/a | n/a | underperforms / n/a |
| 0.006 | A | 4 (0 up, 4 down) | -0.21 | inconclusive | 2 (2 up, 0 down) | 0.30 | inconclusive | underperforms / inconclusive |
| 0.006 | B-c0.05-x2 | 0 | 0.16 | inconclusive | 3 (3 up, 0 down) | 0.76 | inconclusive | inconclusive / inconclusive |
| 0.006 | B-c0.05-x4 | 0 | 0.16 | inconclusive | 3 (3 up, 0 down) | 0.76 | inconclusive | inconclusive / inconclusive |
| 0.006 | B-c0.2-x2 | 5 (5 up, 0 down) | 0.67 | inconclusive | 7 (7 up, 0 down) | 1.40 | **outperforms** | inconclusive / inconclusive |
| 0.006 | B-c0.2-x4 | 5 (5 up, 0 down) | 0.80 | inconclusive | 7 (7 up, 0 down) | 1.52 | **outperforms** | inconclusive / inconclusive |
| 0.006 | S3 | 0 | -0.05 | inconclusive | 4 (4 up, 0 down) | 0.41 | inconclusive | inconclusive / outperforms |
| 0.009 | C2 | 1 (0 up, 1 down) | -0.12 | inconclusive | n/a | n/a | n/a | inconclusive / n/a |
| 0.009 | A | 3 (3 up, 0 down) | 0.47 | inconclusive | 3 (3 up, 0 down) | 0.80 | inconclusive | inconclusive / inconclusive |
| 0.009 | B-c0.05-x2 | 6 (6 up, 0 down) | 1.26 | mixed | 6 (6 up, 0 down) | 1.44 | mixed | inconclusive / inconclusive |
| 0.009 | B-c0.05-x4 | 6 (6 up, 0 down) | 1.26 | mixed | 6 (6 up, 0 down) | 1.45 | mixed | inconclusive / inconclusive |
| 0.009 | B-c0.2-x2 | 10 (10 up, 0 down) | 2.31 | **outperforms** | 11 (11 up, 0 down) | 2.46 | **outperforms** | inconclusive (1 up) / outperforms (2 up) |
| 0.009 | B-c0.2-x4 | 11 (11 up, 0 down) | 2.64 | **outperforms** | 12 (12 up, 0 down) | 2.75 | **outperforms** | outperforms (2 up) / outperforms (3 up) |
| 0.009 | S3 | 5 (0 up, 5 down) | -0.98 | inconclusive | 3 (0 up, 3 down) | -0.85 | inconclusive | inconclusive / inconclusive |
| 0.006 | R-c0.2-x4 (diagnostic) | 4 (4 up, 0 down) | 0.63 | inconclusive | 7 (7 up, 0 down) | 1.36 | outperforms | inconclusive / inconclusive |
| 0.009 | R-c0.2-x4 (diagnostic) | 9 (9 up, 0 down) | 2.12 | outperforms | 12 (12 up, 0 down) | 2.41 | outperforms | inconclusive / outperforms |

Capital moved and genome distance, population 1,000, trending regime (other cells are in the report). "moved" is the mean over seeds of total capital moved by reallocation over the run, as a percent of starting capital. Distance is the capital-weighted mean genome distance from the regime optimum over active slots.

| arm | replacements per run, m 0.006 / 0.009 | moved %, m 0.006 / 0.009 | distance t0 | distance t300, m 0.006 | distance t300, m 0.009 | effective niches t300, m 0.009 | top niche share %, m 0.009 |
|---|---|---|---:|---:|---:|---:|---:|
| C1 | 0 / 0 | 0 / 0 | 0.433 | 0.364 | 0.349 | 6.25 | 32.9 |
| C2 | 340 / 364 | 0 / 0 | 0.433 | 0.376 | 0.363 | 6.25 | 33.0 |
| A | 342 / 372 | 0 / 0 | 0.433 | 0.332 | 0.312 | 6.25 | 32.8 |
| B-c0.05-x2 | 352 / 380 | 6.3 / 6.3 | 0.433 | 0.313 | 0.294 | 6.17 | 33.0 |
| B-c0.2-x2 | 376 / 389 | 11.4 / 10.8 | 0.433 | 0.320 | 0.298 | 6.13 | 32.9 |
| B-c0.2-x4 | 386 / 397 | 16.0 / 16.4 | 0.433 | 0.307 | 0.286 | 5.98 | 33.3 |
| R-c0.2-x4 | 392 / 400 | 16.1 / 16.1 | 0.433 | 0.319 | 0.306 | 6.01 | 33.3 |
| S3 | 0 (137 / 556 reproductions) | 0 / 0 | 0.433 | 0.372 | 0.379 | 6.14 | 34.0 |

Capital-weighted genome distance from the regime optimum over time, mean over the 12 cells:

| arm | m | t0 | t60 | t120 | t180 | t240 | t300 |
|---|---:|---:|---:|---:|---:|---:|---:|
| C1 | 0.006 | 0.410 | 0.406 | 0.398 | 0.392 | 0.385 | 0.378 |
| C2 | 0.006 | 0.410 | 0.405 | 0.399 | 0.394 | 0.388 | 0.383 |
| A | 0.006 | 0.410 | 0.403 | 0.391 | 0.380 | 0.368 | 0.356 |
| B-c0.2-x4 | 0.006 | 0.410 | 0.384 | 0.361 | 0.345 | 0.333 | 0.325 |
| S3 | 0.006 | 0.410 | 0.406 | 0.398 | 0.392 | 0.385 | 0.379 |
| C1 | 0.009 | 0.410 | 0.403 | 0.392 | 0.384 | 0.374 | 0.365 |
| C2 | 0.009 | 0.410 | 0.403 | 0.394 | 0.387 | 0.379 | 0.372 |
| A | 0.009 | 0.410 | 0.399 | 0.384 | 0.370 | 0.356 | 0.341 |
| B-c0.2-x4 | 0.009 | 0.410 | 0.380 | 0.353 | 0.334 | 0.319 | 0.308 |
| S3 | 0.009 | 0.410 | 0.403 | 0.393 | 0.386 | 0.381 | 0.376 |

## What the result says

**Does arm B beat both controls?** Yes at magnitude 0.009 with a reallocation cap of 0.2: at both ceilings, B outperforms Control 1 (10 and 11 of 12 cells higher with p < 0.05, median gap 2.3 and 2.6 pp) and Control 2 (11 and 12 of 12 cells, median gap 2.5 and 2.8 pp), with no cell significantly lower. The stress cells agree in direction (every stress gap is positive), and at ceiling 4 they also pass on their own against both controls. No at magnitude 0.006: B at cap 0.2 outperforms Control 2 (7 of 12 cells) but is inconclusive against Control 1 (5 of 12 cells, all higher, median gap 0.7 to 0.8 pp). At cap 0.05 B is mixed at 0.009 and inconclusive at 0.006. So arm B beats both controls only when the genome's edge is the larger of the two validated sizes and the cap is the larger of the two tested.

**Does arm A alone?** No. Arm A is inconclusive against both controls at both magnitudes (at most 4 cells with p < 0.05). At 0.006 it is significantly below Control 1 in 4 cells (two of them stress), and so is Control 2: every replacement restarts a slot's fitness history and some replacements land on poor genomes, and at that edge size the cost shows. Arm A does move the population toward the optimum (distance 0.341 at tick 300 against 0.365 for Control 1 at 0.009), but in 300 ticks that is not enough return to pass the rule.

**Selection against chance.** Control 2 never beats Control 1, and at 0.006 it is lower in 4 cells: replacing weak slots at random does not help. Arm A is above Control 2 in every cell at 0.009 (median 0.80 pp; all 12 cells have a paired p below 0.05 except the four population-10 cells, a secondary observation), so donor selection beats chance in direction, but not under the Welch rule.

**Where B's advantage comes from.** The diagnostic arm R (random refill plus the same reallocation) also outperforms both controls at 0.009 (9 and 12 cells) and B-c0.2-x4 minus R is between -0.03 and 0.90 pp in every cell at both magnitudes. B against R directly at 0.009: 2 of 12 cells with Welch p < 0.05, median gap 0.41 pp, inconclusive; 8 cells with a paired p below 0.05 and B higher (secondary). Most of B's advantage therefore comes from reallocation, moving 11 to 16 percent of starting capital toward the top decile over the run, with donor-based replacement adding a smaller increment on top. This is consistent with the section 8.1 hypothesis that capital-weighted quality, not the number of good agents, drives the population's return.

**Section 3 reference on the new model.** S3 (account-creating reproduction) is inconclusive against both controls at both magnitudes. At 0.009 it is significantly below Control 1 in 5 cells (median gap -0.98 pp), even though it reproduces heavily (556 reproductions per run at population 1,000 trending) and the genome now carries a heritable edge. Its capital-weighted distance at tick 300 (0.376) is no better than Control 1's (0.365). With genome-driven performance, the current mechanism still does not beat a static population, consistent with the earlier runs and with the hypothesis that new accounts carry fixed costs that consume what children inherit.

**Niche diversity.** No arm collapsed into a monoculture. At population 1,000 the effective number of niches (exponential of the Shannon entropy of active capital across niches) stays between 5.98 and 6.25 in every arm, and the largest niche holds 32.8 to 34.0 percent of active capital. Reallocation narrows diversity slightly (6.25 to 5.98 at the largest setting). The section 5 mechanisms were not stressed by these runs.

## What this decides (issue #85)

Under the pre-registered rule, the first outcome holds, with a condition: **arm B beats both controls, at magnitude 0.009 and reallocation cap 0.2; it does not at magnitude 0.006**. Arm A alone does not beat either control. Fixed-slot selection with bounded reallocation is therefore the candidate mechanism for issue #28, subject to the ownership and consent constraints in `EVOLUTION.md` section 8.3, and with these qualifications stated with the result:

- It works in this model only if the genome carries an edge at least as large as the one assumed at 0.009, which is 1.5 times the hidden skill range. Whether any real strategy's genome carries such an edge is the open question in `EVOLUTION.md` section 7; this run does not answer it.
- Reallocation does most of the work. Replacement with mutated donors adds a smaller, not separately significant, increment. A follow-up should test reallocation with no replacement, to decide whether replacement earns its consent and product cost.
- The cap matters: 0.05 was not enough in 300 ticks.

## Commands

From `simulation/`, after `bun run test` (which builds `dist/`):

```bash
# 8 arms x 2 magnitudes x 12 cells = 192 jobs, 10 in parallel
for pop in 1000 100 10; do for mag in 0.006 0.009; do for arm in C1 C2 A B-c0.05-x2 B-c0.05-x4 B-c0.2-x2 B-c0.2-x4 S3; do
  for regime in trending mean_reverting choppy stress_flash_crash; do echo "$arm $mag $pop $regime"; done
done; done; done | xargs -P 10 -L 1 zsh -c \
  'ARM=$0 MAG=$1 POPS=$2 REGIMES=$3 SEEDS=50 OUT=results/fixed-slot/$0-m$1-$2-$3.json node dist/src/cli-slots.js'

# Diagnostic arm R, 24 jobs (run together with a 12-job model-off regeneration of PR #79 arm A)
for pop in 1000 100 10; do for mag in 0.006 0.009; do for regime in trending mean_reverting choppy stress_flash_crash; do
  echo "$mag $pop $regime"; done; done; done | xargs -P 10 -L 1 zsh -c \
  'ARM=R-c0.2-x4 MAG=$0 POPS=$1 REGIMES=$2 SEEDS=50 OUT=results/fixed-slot/R-c0.2-x4-m$0-$1-$2.json node dist/src/cli-slots.js'

node dist/src/cli-slots-report.js results/fixed-slot
```

Wall time on a laptop with 11 cores: 2,358 seconds for the 192 jobs, and 469 seconds for the 24 diagnostic jobs plus the 12 regeneration jobs. No seeds were reduced anywhere. The per-cell JSON outputs, with per-seed ROI, replacement count, capital moved, reproduction count, distance trace, and niche statistics, are in `results/fixed-slot/`.

## Limitations

- Everything rests on the issue #84 model, whose optimum, weights, and magnitudes are assumptions, and whose optimum does not move within a run. A moving optimum would make both replacement and reallocation chase a target, which this run does not test.
- 300 ticks is short. Arm A's distance is still falling at tick 300, so a longer run might change arm A's call; it would also give reallocation more time to concentrate capital.
- Reallocation here ranks every slot population-wide. In the product it can only move capital between accounts with the same owner (section 8.3), so a real pool is one owner's agents, which at population 10 is the case with the weakest result here.
- The donor rule draws uniformly among eligible donors. Fitness-proportional donor choice, the descendants cap, and paper evaluation were not tested.
- The secondary paired p-values are strong almost everywhere because every arm shares the market path and founders on a seed. They show direction, not significance under the pre-registered rule.

## Report

The full output of `node dist/src/cli-slots-report.js results/fixed-slot`. Per arm and cell: mean ROI, gap and Welch p against each control, the secondary paired p-values, replacements, "no donor" events, reproductions (S3 only), capital moved (absolute and as a percent of starting capital), capital-weighted distance at tick 0 and tick 300, active niches, effective niches, and the top niche's share of active capital, all means over 50 seeds.

### Magnitude 0.006

| arm | vs C1: cells p < 0.05 | vs C1: median gap pp | vs C1: stress | vs C1: call | vs C2: cells p < 0.05 | vs C2: median gap pp | vs C2: stress | vs C2: call |
|---|---|---:|---|---|---|---:|---|---|
| C2 | 4 (0 up, 4 down) | -0.59 | underperforms (0 up, 2 down) | **inconclusive** | n/a | n/a | n/a | n/a |
| A | 4 (0 up, 4 down) | -0.21 | underperforms (0 up, 2 down) | **inconclusive** | 2 (2 up, 0 down) | 0.30 | inconclusive (0 up, 0 down) | **inconclusive** |
| B-c0.05-x2 | 0 (0 up, 0 down) | 0.16 | inconclusive (0 up, 0 down) | **inconclusive** | 3 (3 up, 0 down) | 0.76 | inconclusive (0 up, 0 down) | **inconclusive** |
| B-c0.05-x4 | 0 (0 up, 0 down) | 0.16 | inconclusive (0 up, 0 down) | **inconclusive** | 3 (3 up, 0 down) | 0.76 | inconclusive (0 up, 0 down) | **inconclusive** |
| B-c0.2-x2 | 5 (5 up, 0 down) | 0.67 | inconclusive (0 up, 0 down) | **inconclusive** | 7 (7 up, 0 down) | 1.40 | inconclusive (0 up, 0 down) | **outperforms** |
| B-c0.2-x4 | 5 (5 up, 0 down) | 0.80 | inconclusive (0 up, 0 down) | **inconclusive** | 7 (7 up, 0 down) | 1.52 | inconclusive (0 up, 0 down) | **outperforms** |
| R-c0.2-x4 | 4 (4 up, 0 down) | 0.63 | inconclusive (0 up, 0 down) | **inconclusive** | 7 (7 up, 0 down) | 1.36 | inconclusive (0 up, 0 down) | **outperforms** |
| S3 | 0 (0 up, 0 down) | -0.05 | inconclusive (0 up, 0 down) | **inconclusive** | 4 (4 up, 0 down) | 0.41 | outperforms (2 up, 0 down) | **inconclusive** |

Capital-weighted genome distance from the regime optimum, mean over the 12 cells and over seeds, at each trace tick:

| arm | t0 | t60 | t120 | t180 | t240 | t300 |
|---|---:|---:|---:|---:|---:|---:|
| C1 | 0.410 | 0.406 | 0.398 | 0.392 | 0.385 | 0.378 |
| C2 | 0.410 | 0.405 | 0.399 | 0.394 | 0.388 | 0.383 |
| A | 0.410 | 0.403 | 0.391 | 0.380 | 0.368 | 0.356 |
| B-c0.05-x2 | 0.410 | 0.398 | 0.381 | 0.366 | 0.351 | 0.337 |
| B-c0.05-x4 | 0.410 | 0.398 | 0.381 | 0.366 | 0.351 | 0.337 |
| B-c0.2-x2 | 0.410 | 0.384 | 0.362 | 0.349 | 0.340 | 0.333 |
| B-c0.2-x4 | 0.410 | 0.384 | 0.361 | 0.345 | 0.333 | 0.325 |
| R-c0.2-x4 | 0.410 | 0.386 | 0.367 | 0.353 | 0.342 | 0.333 |
| S3 | 0.410 | 0.406 | 0.398 | 0.392 | 0.385 | 0.379 |

#### Magnitude 0.006, arm C1

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -3.51 | n/a | n/a | 0.13 | 0.8661 | n/a | 0.0118 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.416 | 5.0 | 4.42 | 36.6 |
| 10 | mean_reverting | -7.77 | n/a | n/a | 0.15 | 0.7370 | n/a | 0.0075 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.445 | 0.433 | 5.0 | 4.41 | 36.9 |
| 10 | choppy | -5.72 | n/a | n/a | 0.08 | 0.9030 | n/a | 0.0780 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.367 | 5.0 | 4.42 | 36.8 |
| 10 | stress_flash_crash | -10.63 | n/a | n/a | 0.23 | 0.7058 | n/a | 0.0074 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.368 | 5.0 | 4.41 | 36.9 |
| 100 | trending | -2.50 | n/a | n/a | 0.50 | 0.4484 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.431 | 0.370 | 7.0 | 6.06 | 32.2 |
| 100 | mean_reverting | -6.58 | n/a | n/a | 0.94 | <0.0001 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.439 | 0.410 | 7.0 | 6.04 | 32.6 |
| 100 | choppy | -5.05 | n/a | n/a | 0.67 | 0.2441 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.351 | 7.0 | 6.06 | 32.3 |
| 100 | stress_flash_crash | -9.46 | n/a | n/a | 1.19 | 0.0196 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.355 | 7.0 | 6.07 | 32.2 |
| 1000 | trending | -2.39 | n/a | n/a | 0.50 | 0.4309 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.364 | 7.0 | 6.25 | 32.9 |
| 1000 | mean_reverting | -6.44 | n/a | n/a | 1.08 | <0.0001 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.436 | 0.402 | 7.0 | 6.26 | 32.6 |
| 1000 | choppy | -4.94 | n/a | n/a | 0.79 | 0.1642 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.346 | 7.0 | 6.26 | 32.8 |
| 1000 | stress_flash_crash | -9.38 | n/a | n/a | 1.35 | 0.0076 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.352 | 7.0 | 6.25 | 32.9 |

#### Magnitude 0.006, arm C2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -3.65 | -0.13 | 0.8661 | n/a | n/a | 0.0118 | n/a | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.419 | 5.1 | 4.58 | 34.9 |
| 10 | mean_reverting | -7.91 | -0.15 | 0.7370 | n/a | n/a | 0.0075 | n/a | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.445 | 0.432 | 5.1 | 4.56 | 35.3 |
| 10 | choppy | -5.80 | -0.08 | 0.9030 | n/a | n/a | 0.0780 | n/a | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.366 | 5.1 | 4.57 | 35.1 |
| 10 | stress_flash_crash | -10.86 | -0.23 | 0.7058 | n/a | n/a | 0.0074 | n/a | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.367 | 5.1 | 4.57 | 35.2 |
| 100 | trending | -3.00 | -0.50 | 0.4484 | n/a | n/a | <0.0001 | n/a | 30.6 | 0.0 | 0.0 | 0.00 | 0.00 | 0.431 | 0.382 | 7.0 | 6.17 | 31.6 |
| 100 | mean_reverting | -7.52 | -0.94 | <0.0001 | n/a | n/a | <0.0001 | n/a | 31.7 | 0.0 | 0.0 | 0.00 | 0.00 | 0.439 | 0.414 | 7.0 | 6.17 | 31.7 |
| 100 | choppy | -5.73 | -0.67 | 0.2441 | n/a | n/a | <0.0001 | n/a | 28.7 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.356 | 7.0 | 6.15 | 31.8 |
| 100 | stress_flash_crash | -10.65 | -1.19 | 0.0196 | n/a | n/a | <0.0001 | n/a | 27.7 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.360 | 7.0 | 6.15 | 31.7 |
| 1000 | trending | -2.89 | -0.50 | 0.4309 | n/a | n/a | <0.0001 | n/a | 340.1 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.376 | 7.0 | 6.25 | 32.9 |
| 1000 | mean_reverting | -7.52 | -1.08 | <0.0001 | n/a | n/a | <0.0001 | n/a | 348.8 | 0.0 | 0.0 | 0.00 | 0.00 | 0.436 | 0.410 | 7.0 | 6.27 | 32.7 |
| 1000 | choppy | -5.73 | -0.79 | 0.1642 | n/a | n/a | <0.0001 | n/a | 322.3 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.355 | 7.0 | 6.26 | 32.8 |
| 1000 | stress_flash_crash | -10.74 | -1.35 | 0.0076 | n/a | n/a | <0.0001 | n/a | 311.8 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.359 | 7.0 | 6.25 | 32.9 |

#### Magnitude 0.006, arm A

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -3.55 | -0.03 | 0.9675 | 0.10 | 0.9003 | 0.4981 | 0.0610 | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.414 | 5.1 | 4.52 | 34.8 |
| 10 | mean_reverting | -7.88 | -0.11 | 0.7974 | 0.03 | 0.9394 | 0.0770 | 0.5851 | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.445 | 0.431 | 5.0 | 4.48 | 35.4 |
| 10 | choppy | -5.72 | 0.00 | 0.9966 | 0.08 | 0.9028 | 0.9641 | 0.1713 | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.362 | 5.0 | 4.49 | 35.2 |
| 10 | stress_flash_crash | -10.81 | -0.18 | 0.7750 | 0.05 | 0.9336 | 0.0225 | 0.3867 | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.363 | 5.0 | 4.50 | 35.3 |
| 100 | trending | -2.22 | 0.29 | 0.6743 | 0.78 | 0.2697 | 0.0055 | <0.0001 | 31.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.431 | 0.344 | 7.0 | 6.15 | 30.8 |
| 100 | mean_reverting | -7.00 | -0.42 | 0.0116 | 0.52 | 0.0019 | <0.0001 | <0.0001 | 32.7 | 0.0 | 0.0 | 0.00 | 0.00 | 0.439 | 0.368 | 7.0 | 6.13 | 31.1 |
| 100 | choppy | -5.30 | -0.25 | 0.6715 | 0.42 | 0.4954 | 0.0057 | <0.0001 | 29.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.326 | 7.0 | 6.15 | 31.1 |
| 100 | stress_flash_crash | -10.53 | -1.07 | 0.0398 | 0.12 | 0.8219 | <0.0001 | 0.0051 | 27.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.334 | 7.0 | 6.08 | 31.9 |
| 1000 | trending | -2.02 | 0.37 | 0.5772 | 0.86 | 0.2123 | 0.0008 | <0.0001 | 342.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.332 | 7.2 | 6.28 | 32.3 |
| 1000 | mean_reverting | -6.86 | -0.42 | <0.0001 | 0.66 | <0.0001 | <0.0001 | <0.0001 | 361.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.436 | 0.355 | 7.2 | 6.24 | 32.8 |
| 1000 | choppy | -5.21 | -0.26 | 0.6510 | 0.52 | 0.3922 | 0.0041 | <0.0001 | 323.3 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.317 | 7.1 | 6.26 | 32.6 |
| 1000 | stress_flash_crash | -10.56 | -1.18 | 0.0225 | 0.17 | 0.7452 | <0.0001 | <0.0001 | 307.1 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.324 | 7.2 | 6.23 | 33.0 |

#### Magnitude 0.006, arm B-c0.05-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.96 | 0.55 | 0.4963 | 0.68 | 0.3995 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.69 | 5.69 | 0.433 | 0.389 | 5.1 | 4.43 | 35.8 |
| 10 | mean_reverting | -7.40 | 0.36 | 0.4218 | 0.51 | 0.2530 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.63 | 5.63 | 0.445 | 0.410 | 5.0 | 4.38 | 37.0 |
| 10 | choppy | -5.28 | 0.44 | 0.5269 | 0.52 | 0.4557 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.74 | 5.74 | 0.379 | 0.340 | 5.0 | 4.41 | 36.2 |
| 10 | stress_flash_crash | -10.48 | 0.15 | 0.8095 | 0.38 | 0.5394 | 0.0683 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.87 | 5.87 | 0.379 | 0.341 | 5.0 | 4.42 | 36.2 |
| 100 | trending | -1.69 | 0.82 | 0.2357 | 1.31 | 0.0674 | <0.0001 | <0.0001 | 32.0 | 0.0 | 0.0 | 58.08 | 5.81 | 0.431 | 0.325 | 7.0 | 6.07 | 31.5 |
| 100 | mean_reverting | -6.54 | 0.04 | 0.8367 | 0.98 | <0.0001 | 0.4046 | <0.0001 | 33.6 | 0.0 | 0.0 | 56.62 | 5.66 | 0.439 | 0.352 | 7.0 | 6.04 | 32.0 |
| 100 | choppy | -4.89 | 0.17 | 0.7818 | 0.84 | 0.1816 | 0.0973 | <0.0001 | 30.1 | 0.0 | 0.0 | 57.73 | 5.77 | 0.387 | 0.309 | 7.0 | 6.03 | 32.2 |
| 100 | stress_flash_crash | -10.25 | -0.79 | 0.1296 | 0.40 | 0.4600 | <0.0001 | <0.0001 | 28.7 | 0.0 | 0.0 | 57.95 | 5.79 | 0.387 | 0.315 | 7.0 | 6.04 | 32.2 |
| 1000 | trending | -1.48 | 0.91 | 0.1683 | 1.41 | 0.0442 | <0.0001 | <0.0001 | 352.2 | 0.0 | 0.0 | 627.31 | 6.27 | 0.433 | 0.313 | 7.2 | 6.21 | 32.6 |
| 1000 | mean_reverting | -6.42 | 0.02 | 0.8222 | 1.10 | <0.0001 | 0.3863 | <0.0001 | 370.9 | 0.0 | 0.0 | 610.94 | 6.11 | 0.436 | 0.338 | 7.2 | 6.17 | 33.1 |
| 1000 | choppy | -4.81 | 0.13 | 0.8198 | 0.92 | 0.1377 | 0.1702 | <0.0001 | 332.2 | 0.0 | 0.0 | 622.00 | 6.22 | 0.388 | 0.301 | 7.1 | 6.20 | 32.9 |
| 1000 | stress_flash_crash | -10.29 | -0.90 | 0.0810 | 0.45 | 0.4061 | <0.0001 | <0.0001 | 316.6 | 0.0 | 0.0 | 616.51 | 6.17 | 0.388 | 0.308 | 7.1 | 6.19 | 32.9 |

#### Magnitude 0.006, arm B-c0.05-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.96 | 0.55 | 0.4963 | 0.68 | 0.3995 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.69 | 5.69 | 0.433 | 0.389 | 5.1 | 4.43 | 35.8 |
| 10 | mean_reverting | -7.40 | 0.36 | 0.4218 | 0.51 | 0.2530 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.63 | 5.63 | 0.445 | 0.410 | 5.0 | 4.38 | 37.0 |
| 10 | choppy | -5.28 | 0.44 | 0.5269 | 0.52 | 0.4557 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.74 | 5.74 | 0.379 | 0.340 | 5.0 | 4.41 | 36.2 |
| 10 | stress_flash_crash | -10.48 | 0.15 | 0.8095 | 0.38 | 0.5394 | 0.0683 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.87 | 5.87 | 0.379 | 0.341 | 5.0 | 4.42 | 36.2 |
| 100 | trending | -1.68 | 0.82 | 0.2334 | 1.32 | 0.0666 | <0.0001 | <0.0001 | 32.0 | 0.0 | 0.0 | 58.10 | 5.81 | 0.431 | 0.325 | 7.0 | 6.07 | 31.5 |
| 100 | mean_reverting | -6.54 | 0.04 | 0.8193 | 0.98 | <0.0001 | 0.3567 | <0.0001 | 33.5 | 0.0 | 0.0 | 56.61 | 5.66 | 0.439 | 0.352 | 7.0 | 6.04 | 32.0 |
| 100 | choppy | -4.88 | 0.17 | 0.7793 | 0.84 | 0.1806 | 0.0933 | <0.0001 | 30.1 | 0.0 | 0.0 | 57.72 | 5.77 | 0.387 | 0.308 | 7.0 | 6.04 | 32.2 |
| 100 | stress_flash_crash | -10.24 | -0.78 | 0.1326 | 0.41 | 0.4537 | <0.0001 | <0.0001 | 28.7 | 0.0 | 0.0 | 57.94 | 5.79 | 0.387 | 0.315 | 7.0 | 6.03 | 32.3 |
| 1000 | trending | -1.47 | 0.92 | 0.1672 | 1.41 | 0.0439 | <0.0001 | <0.0001 | 351.9 | 0.0 | 0.0 | 627.26 | 6.27 | 0.433 | 0.312 | 7.2 | 6.21 | 32.7 |
| 1000 | mean_reverting | -6.41 | 0.02 | 0.8125 | 1.10 | <0.0001 | 0.3603 | <0.0001 | 370.8 | 0.0 | 0.0 | 610.94 | 6.11 | 0.436 | 0.338 | 7.1 | 6.16 | 33.1 |
| 1000 | choppy | -4.81 | 0.14 | 0.8135 | 0.93 | 0.1358 | 0.1571 | <0.0001 | 332.3 | 0.0 | 0.0 | 621.85 | 6.22 | 0.388 | 0.301 | 7.1 | 6.20 | 32.8 |
| 1000 | stress_flash_crash | -10.28 | -0.90 | 0.0831 | 0.45 | 0.4001 | <0.0001 | <0.0001 | 316.1 | 0.0 | 0.0 | 616.57 | 6.17 | 0.388 | 0.308 | 7.1 | 6.19 | 32.8 |

#### Magnitude 0.006, arm B-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.24 | 1.27 | 0.1265 | 1.40 | 0.0923 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 9.19 | 9.19 | 0.433 | 0.378 | 5.1 | 4.28 | 37.5 |
| 10 | mean_reverting | -6.72 | 1.05 | 0.0273 | 1.19 | 0.0111 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 9.76 | 9.76 | 0.445 | 0.395 | 5.0 | 4.19 | 39.3 |
| 10 | choppy | -4.68 | 1.04 | 0.1442 | 1.12 | 0.1173 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 9.71 | 9.71 | 0.379 | 0.327 | 5.0 | 4.26 | 37.2 |
| 10 | stress_flash_crash | -10.04 | 0.59 | 0.3627 | 0.82 | 0.1994 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 10.88 | 10.88 | 0.379 | 0.325 | 5.0 | 4.25 | 37.4 |
| 100 | trending | -1.10 | 1.40 | 0.0446 | 1.90 | 0.0092 | <0.0001 | <0.0001 | 33.6 | 0.0 | 0.0 | 106.98 | 10.70 | 0.431 | 0.328 | 7.0 | 6.05 | 31.4 |
| 100 | mean_reverting | -6.02 | 0.56 | 0.0013 | 1.50 | <0.0001 | <0.0001 | <0.0001 | 35.0 | 0.0 | 0.0 | 105.50 | 10.55 | 0.439 | 0.355 | 7.0 | 5.96 | 32.6 |
| 100 | choppy | -4.33 | 0.73 | 0.2300 | 1.40 | 0.0277 | <0.0001 | <0.0001 | 33.2 | 0.0 | 0.0 | 115.66 | 11.57 | 0.387 | 0.305 | 7.0 | 5.90 | 33.4 |
| 100 | stress_flash_crash | -9.80 | -0.34 | 0.5178 | 0.85 | 0.1215 | 0.0008 | <0.0001 | 32.4 | 0.0 | 0.0 | 135.56 | 13.56 | 0.387 | 0.305 | 7.0 | 5.88 | 33.4 |
| 1000 | trending | -0.89 | 1.50 | 0.0257 | 2.00 | 0.0050 | <0.0001 | <0.0001 | 375.5 | 0.0 | 0.0 | 1136.61 | 11.37 | 0.433 | 0.320 | 7.1 | 6.15 | 32.7 |
| 1000 | mean_reverting | -5.99 | 0.45 | <0.0001 | 1.53 | <0.0001 | <0.0001 | <0.0001 | 388.0 | 0.0 | 0.0 | 1073.01 | 10.73 | 0.436 | 0.350 | 7.1 | 6.14 | 32.9 |
| 1000 | choppy | -4.33 | 0.61 | 0.2997 | 1.40 | 0.0257 | <0.0001 | <0.0001 | 371.7 | 0.0 | 0.0 | 1183.90 | 11.84 | 0.388 | 0.306 | 7.2 | 6.14 | 32.9 |
| 1000 | stress_flash_crash | -9.82 | -0.44 | 0.4019 | 0.92 | 0.0941 | <0.0001 | <0.0001 | 358.7 | 0.0 | 0.0 | 1497.85 | 14.98 | 0.388 | 0.303 | 7.1 | 6.08 | 33.1 |

#### Magnitude 0.006, arm B-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.11 | 1.40 | 0.0947 | 1.54 | 0.0681 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 11.15 | 11.15 | 0.433 | 0.370 | 5.1 | 4.17 | 38.7 |
| 10 | mean_reverting | -6.62 | 1.14 | 0.0160 | 1.29 | 0.0061 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 11.56 | 11.56 | 0.445 | 0.389 | 5.0 | 4.12 | 40.5 |
| 10 | choppy | -4.56 | 1.16 | 0.1076 | 1.24 | 0.0867 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 12.16 | 12.16 | 0.379 | 0.318 | 5.0 | 4.17 | 38.5 |
| 10 | stress_flash_crash | -9.97 | 0.66 | 0.3094 | 0.89 | 0.1651 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 12.86 | 12.86 | 0.379 | 0.317 | 5.0 | 4.17 | 38.6 |
| 100 | trending | -0.89 | 1.62 | 0.0223 | 2.11 | 0.0042 | <0.0001 | <0.0001 | 34.5 | 0.0 | 0.0 | 142.12 | 14.21 | 0.431 | 0.315 | 7.0 | 5.96 | 31.9 |
| 100 | mean_reverting | -5.86 | 0.72 | <0.0001 | 1.66 | <0.0001 | <0.0001 | <0.0001 | 35.2 | 0.0 | 0.0 | 136.24 | 13.62 | 0.439 | 0.346 | 7.0 | 5.88 | 33.3 |
| 100 | choppy | -4.23 | 0.82 | 0.1771 | 1.50 | 0.0195 | <0.0001 | <0.0001 | 33.3 | 0.0 | 0.0 | 137.56 | 13.76 | 0.387 | 0.299 | 7.0 | 5.85 | 33.7 |
| 100 | stress_flash_crash | -9.75 | -0.29 | 0.5807 | 0.90 | 0.1027 | 0.0040 | <0.0001 | 32.1 | 0.0 | 0.0 | 146.47 | 14.65 | 0.387 | 0.301 | 7.0 | 5.85 | 33.5 |
| 1000 | trending | -0.63 | 1.76 | 0.0100 | 2.26 | 0.0018 | <0.0001 | <0.0001 | 386.4 | 0.0 | 0.0 | 1597.47 | 15.97 | 0.433 | 0.307 | 7.1 | 6.04 | 33.1 |
| 1000 | mean_reverting | -5.79 | 0.65 | <0.0001 | 1.73 | <0.0001 | <0.0001 | <0.0001 | 396.6 | 0.0 | 0.0 | 1517.24 | 15.17 | 0.436 | 0.340 | 7.0 | 6.04 | 33.2 |
| 1000 | choppy | -4.17 | 0.78 | 0.1946 | 1.56 | 0.0138 | <0.0001 | <0.0001 | 381.4 | 0.0 | 0.0 | 1553.05 | 15.53 | 0.388 | 0.296 | 7.1 | 6.04 | 33.3 |
| 1000 | stress_flash_crash | -9.75 | -0.37 | 0.4783 | 0.98 | 0.0734 | 0.0003 | <0.0001 | 360.5 | 0.0 | 0.0 | 1631.74 | 16.32 | 0.388 | 0.297 | 7.1 | 6.05 | 33.1 |

#### Magnitude 0.006, arm R-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -2.19 | 1.33 | 0.1091 | 1.46 | 0.0787 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 11.51 | 11.51 | 0.433 | 0.372 | 5.1 | 4.18 | 38.8 |
| 10 | mean_reverting | -6.62 | 1.14 | 0.0154 | 1.29 | 0.0058 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 11.48 | 11.48 | 0.445 | 0.389 | 5.1 | 4.17 | 40.7 |
| 10 | choppy | -4.63 | 1.09 | 0.1203 | 1.17 | 0.0969 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 12.24 | 12.24 | 0.379 | 0.320 | 5.1 | 4.20 | 38.5 |
| 10 | stress_flash_crash | -10.01 | 0.62 | 0.3320 | 0.85 | 0.1768 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 13.03 | 13.03 | 0.379 | 0.320 | 5.1 | 4.21 | 38.5 |
| 100 | trending | -1.22 | 1.28 | 0.0623 | 1.78 | 0.0134 | <0.0001 | <0.0001 | 34.3 | 0.0 | 0.0 | 143.76 | 14.38 | 0.431 | 0.328 | 7.0 | 6.00 | 31.9 |
| 100 | mean_reverting | -6.07 | 0.51 | 0.0018 | 1.45 | <0.0001 | <0.0001 | <0.0001 | 35.8 | 0.0 | 0.0 | 142.24 | 14.22 | 0.439 | 0.362 | 7.0 | 5.90 | 33.4 |
| 100 | choppy | -4.42 | 0.63 | 0.2931 | 1.30 | 0.0381 | <0.0001 | <0.0001 | 32.9 | 0.0 | 0.0 | 142.21 | 14.22 | 0.387 | 0.309 | 7.0 | 5.89 | 33.5 |
| 100 | stress_flash_crash | -9.73 | -0.27 | 0.6044 | 0.92 | 0.0882 | 0.0017 | <0.0001 | 31.7 | 0.0 | 0.0 | 149.24 | 14.92 | 0.387 | 0.312 | 7.0 | 5.88 | 33.5 |
| 1000 | trending | -1.00 | 1.39 | 0.0362 | 1.89 | 0.0073 | <0.0001 | <0.0001 | 391.8 | 0.0 | 0.0 | 1613.02 | 16.13 | 0.433 | 0.319 | 7.0 | 6.05 | 33.2 |
| 1000 | mean_reverting | -5.98 | 0.45 | <0.0001 | 1.53 | <0.0001 | <0.0001 | <0.0001 | 400.1 | 0.0 | 0.0 | 1574.18 | 15.74 | 0.436 | 0.354 | 7.0 | 6.06 | 33.2 |
| 1000 | choppy | -4.31 | 0.64 | 0.2774 | 1.42 | 0.0222 | <0.0001 | <0.0001 | 384.8 | 0.0 | 0.0 | 1610.66 | 16.11 | 0.388 | 0.304 | 7.0 | 6.06 | 33.2 |
| 1000 | stress_flash_crash | -9.73 | -0.34 | 0.5043 | 1.01 | 0.0622 | <0.0001 | <0.0001 | 365.9 | 0.0 | 0.0 | 1670.78 | 16.71 | 0.388 | 0.306 | 7.0 | 6.06 | 33.2 |

#### Magnitude 0.006, arm S3

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -3.81 | -0.29 | 0.6962 | -0.16 | 0.8305 | <0.0001 | 0.0643 | 0.0 | 0.0 | 1.1 | 0.00 | 0.00 | 0.433 | 0.417 | 5.0 | 4.43 | 36.6 |
| 10 | mean_reverting | -7.77 | -0.00 | 0.9955 | 0.14 | 0.7411 | 0.3222 | 0.0087 | 0.0 | 0.0 | 0.1 | 0.00 | 0.00 | 0.445 | 0.433 | 5.0 | 4.41 | 36.9 |
| 10 | choppy | -5.81 | -0.09 | 0.8936 | -0.01 | 0.9928 | 0.0019 | 0.9137 | 0.0 | 0.0 | 0.4 | 0.00 | 0.00 | 0.379 | 0.367 | 5.0 | 4.42 | 36.8 |
| 10 | stress_flash_crash | -10.63 | 0.00 | 1.0000 | 0.23 | 0.7058 | 1.0000 | 0.0074 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.368 | 5.0 | 4.41 | 36.9 |
| 100 | trending | -2.86 | -0.36 | 0.5485 | 0.14 | 0.8232 | <0.0001 | 0.1515 | 0.0 | 0.0 | 13.2 | 0.00 | 0.00 | 0.431 | 0.377 | 7.0 | 6.04 | 32.6 |
| 100 | mean_reverting | -6.58 | -0.01 | 0.9590 | 0.94 | <0.0001 | 0.0051 | <0.0001 | 0.0 | 0.0 | 1.0 | 0.00 | 0.00 | 0.439 | 0.410 | 7.0 | 6.04 | 32.6 |
| 100 | choppy | -5.14 | -0.09 | 0.8726 | 0.59 | 0.3020 | 0.0007 | <0.0001 | 0.0 | 0.0 | 4.1 | 0.00 | 0.00 | 0.387 | 0.352 | 7.0 | 6.06 | 32.4 |
| 100 | stress_flash_crash | -9.47 | -0.01 | 0.9886 | 1.18 | 0.0201 | 0.3051 | <0.0001 | 0.0 | 0.0 | 0.1 | 0.00 | 0.00 | 0.387 | 0.356 | 7.0 | 6.07 | 32.2 |
| 1000 | trending | -2.77 | -0.38 | 0.5009 | 0.12 | 0.8435 | <0.0001 | 0.2519 | 0.0 | 0.0 | 137.0 | 0.00 | 0.00 | 0.433 | 0.372 | 7.0 | 6.22 | 33.1 |
| 1000 | mean_reverting | -6.44 | -0.00 | 0.9699 | 1.08 | <0.0001 | 0.0058 | <0.0001 | 0.0 | 0.0 | 8.5 | 0.00 | 0.00 | 0.436 | 0.402 | 7.0 | 6.26 | 32.6 |
| 1000 | choppy | -5.03 | -0.09 | 0.8613 | 0.70 | 0.2098 | 0.0008 | <0.0001 | 0.0 | 0.0 | 40.5 | 0.00 | 0.00 | 0.388 | 0.348 | 7.0 | 6.25 | 32.9 |
| 1000 | stress_flash_crash | -9.40 | -0.01 | 0.9759 | 1.34 | 0.0080 | 0.2015 | <0.0001 | 0.0 | 0.0 | 2.6 | 0.00 | 0.00 | 0.388 | 0.352 | 7.0 | 6.25 | 32.8 |

### Magnitude 0.009

| arm | vs C1: cells p < 0.05 | vs C1: median gap pp | vs C1: stress | vs C1: call | vs C2: cells p < 0.05 | vs C2: median gap pp | vs C2: stress | vs C2: call |
|---|---|---:|---|---|---|---:|---|---|
| C2 | 1 (0 up, 1 down) | -0.12 | inconclusive (0 up, 0 down) | **inconclusive** | n/a | n/a | n/a | n/a |
| A | 3 (3 up, 0 down) | 0.47 | inconclusive (0 up, 0 down) | **inconclusive** | 3 (3 up, 0 down) | 0.80 | inconclusive (0 up, 0 down) | **inconclusive** |
| B-c0.05-x2 | 6 (6 up, 0 down) | 1.26 | inconclusive (0 up, 0 down) | **mixed** | 6 (6 up, 0 down) | 1.44 | inconclusive (0 up, 0 down) | **mixed** |
| B-c0.05-x4 | 6 (6 up, 0 down) | 1.26 | inconclusive (0 up, 0 down) | **mixed** | 6 (6 up, 0 down) | 1.45 | inconclusive (0 up, 0 down) | **mixed** |
| B-c0.2-x2 | 10 (10 up, 0 down) | 2.31 | inconclusive (1 up, 0 down) | **outperforms** | 11 (11 up, 0 down) | 2.46 | outperforms (2 up, 0 down) | **outperforms** |
| B-c0.2-x4 | 11 (11 up, 0 down) | 2.64 | outperforms (2 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.75 | outperforms (3 up, 0 down) | **outperforms** |
| R-c0.2-x4 | 9 (9 up, 0 down) | 2.12 | inconclusive (0 up, 0 down) | **outperforms** | 12 (12 up, 0 down) | 2.41 | outperforms (3 up, 0 down) | **outperforms** |
| S3 | 5 (0 up, 5 down) | -0.98 | inconclusive (0 up, 0 down) | **inconclusive** | 3 (0 up, 3 down) | -0.85 | inconclusive (0 up, 0 down) | **inconclusive** |

Capital-weighted genome distance from the regime optimum, mean over the 12 cells and over seeds, at each trace tick:

| arm | t0 | t60 | t120 | t180 | t240 | t300 |
|---|---:|---:|---:|---:|---:|---:|
| C1 | 0.410 | 0.403 | 0.392 | 0.384 | 0.374 | 0.365 |
| C2 | 0.410 | 0.403 | 0.394 | 0.387 | 0.379 | 0.372 |
| A | 0.410 | 0.399 | 0.384 | 0.370 | 0.356 | 0.341 |
| B-c0.05-x2 | 0.410 | 0.394 | 0.374 | 0.357 | 0.339 | 0.322 |
| B-c0.05-x4 | 0.410 | 0.394 | 0.374 | 0.357 | 0.339 | 0.322 |
| B-c0.2-x2 | 0.410 | 0.380 | 0.354 | 0.340 | 0.328 | 0.318 |
| B-c0.2-x4 | 0.410 | 0.380 | 0.353 | 0.334 | 0.319 | 0.308 |
| R-c0.2-x4 | 0.410 | 0.382 | 0.360 | 0.344 | 0.331 | 0.321 |
| S3 | 0.410 | 0.403 | 0.393 | 0.386 | 0.381 | 0.376 |

#### Magnitude 0.009, arm C1

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 1.57 | n/a | n/a | 0.04 | 0.9743 | n/a | 0.4380 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.409 | 5.0 | 4.42 | 36.6 |
| 10 | mean_reverting | -3.19 | n/a | n/a | 0.07 | 0.9288 | n/a | 0.2248 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.445 | 0.424 | 5.0 | 4.40 | 37.1 |
| 10 | choppy | -0.26 | n/a | n/a | -0.03 | 0.9739 | n/a | 0.5786 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.359 | 5.0 | 4.41 | 37.0 |
| 10 | stress_flash_crash | -5.96 | n/a | n/a | 0.17 | 0.8232 | n/a | 0.0268 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.362 | 5.0 | 4.41 | 37.1 |
| 100 | trending | 2.65 | n/a | n/a | -0.06 | 0.9410 | n/a | 0.4935 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.431 | 0.355 | 7.0 | 6.04 | 32.5 |
| 100 | mean_reverting | -1.99 | n/a | n/a | 0.44 | 0.0597 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.439 | 0.390 | 7.0 | 6.03 | 32.7 |
| 100 | choppy | 0.09 | n/a | n/a | 0.10 | 0.8838 | n/a | 0.1937 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.338 | 7.0 | 6.06 | 32.2 |
| 100 | stress_flash_crash | -5.10 | n/a | n/a | 0.70 | 0.2587 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.343 | 7.0 | 6.03 | 32.6 |
| 1000 | trending | 2.72 | n/a | n/a | -0.18 | 0.8006 | n/a | 0.0292 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.349 | 7.0 | 6.25 | 32.9 |
| 1000 | mean_reverting | -1.87 | n/a | n/a | 0.50 | <0.0001 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.436 | 0.384 | 7.0 | 6.24 | 32.9 |
| 1000 | choppy | 0.21 | n/a | n/a | 0.13 | 0.8479 | n/a | 0.0812 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.332 | 7.0 | 6.25 | 32.8 |
| 1000 | stress_flash_crash | -4.96 | n/a | n/a | 0.87 | 0.1458 | n/a | <0.0001 | 0.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.338 | 7.0 | 6.24 | 32.9 |

#### Magnitude 0.009, arm C2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 1.53 | -0.04 | 0.9743 | n/a | n/a | 0.4380 | n/a | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.412 | 5.1 | 4.57 | 34.9 |
| 10 | mean_reverting | -3.26 | -0.07 | 0.9288 | n/a | n/a | 0.2248 | n/a | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.445 | 0.423 | 5.1 | 4.55 | 35.8 |
| 10 | choppy | -0.23 | 0.03 | 0.9739 | n/a | n/a | 0.5786 | n/a | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.359 | 5.1 | 4.57 | 35.3 |
| 10 | stress_flash_crash | -6.14 | -0.17 | 0.8232 | n/a | n/a | 0.0268 | n/a | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.361 | 5.1 | 4.57 | 35.3 |
| 100 | trending | 2.71 | 0.06 | 0.9410 | n/a | n/a | 0.4935 | n/a | 32.7 | 0.0 | 0.0 | 0.00 | 0.00 | 0.431 | 0.370 | 7.0 | 6.17 | 31.7 |
| 100 | mean_reverting | -2.43 | -0.44 | 0.0597 | n/a | n/a | <0.0001 | n/a | 33.8 | 0.0 | 0.0 | 0.00 | 0.00 | 0.439 | 0.400 | 7.0 | 6.16 | 31.9 |
| 100 | choppy | -0.01 | -0.10 | 0.8838 | n/a | n/a | 0.1937 | n/a | 31.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.345 | 7.0 | 6.15 | 31.8 |
| 100 | stress_flash_crash | -5.80 | -0.70 | 0.2587 | n/a | n/a | <0.0001 | n/a | 29.9 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.350 | 7.0 | 6.14 | 32.0 |
| 1000 | trending | 2.90 | 0.18 | 0.8006 | n/a | n/a | 0.0292 | n/a | 364.2 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.363 | 7.0 | 6.25 | 33.0 |
| 1000 | mean_reverting | -2.37 | -0.50 | <0.0001 | n/a | n/a | <0.0001 | n/a | 375.2 | 0.0 | 0.0 | 0.00 | 0.00 | 0.436 | 0.394 | 7.0 | 6.26 | 32.8 |
| 1000 | choppy | 0.08 | -0.13 | 0.8479 | n/a | n/a | 0.0812 | n/a | 347.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.343 | 7.0 | 6.24 | 33.0 |
| 1000 | stress_flash_crash | -5.82 | -0.87 | 0.1458 | n/a | n/a | <0.0001 | n/a | 329.3 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.348 | 7.0 | 6.24 | 33.0 |

#### Magnitude 0.009, arm A

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 1.63 | 0.06 | 0.9540 | 0.10 | 0.9286 | 0.1732 | 0.1813 | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.409 | 5.0 | 4.48 | 34.9 |
| 10 | mean_reverting | -3.20 | -0.01 | 0.9928 | 0.06 | 0.9367 | 0.9211 | 0.4880 | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.445 | 0.422 | 5.0 | 4.46 | 35.6 |
| 10 | choppy | -0.05 | 0.21 | 0.8292 | 0.18 | 0.8543 | 0.0865 | 0.1411 | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.356 | 5.0 | 4.49 | 35.3 |
| 10 | stress_flash_crash | -6.02 | -0.06 | 0.9458 | 0.12 | 0.8830 | 0.6158 | 0.2083 | 0.4 | 0.0 | 0.0 | 0.00 | 0.00 | 0.379 | 0.358 | 5.0 | 4.49 | 35.4 |
| 100 | trending | 4.19 | 1.54 | 0.0523 | 1.48 | 0.0736 | <0.0001 | <0.0001 | 33.8 | 0.0 | 0.0 | 0.00 | 0.00 | 0.431 | 0.326 | 7.0 | 6.14 | 30.5 |
| 100 | mean_reverting | -1.26 | 0.74 | 0.0065 | 1.17 | <0.0001 | <0.0001 | <0.0001 | 35.2 | 0.0 | 0.0 | 0.00 | 0.00 | 0.439 | 0.347 | 7.0 | 6.04 | 32.1 |
| 100 | choppy | 0.97 | 0.87 | 0.2431 | 0.98 | 0.2109 | <0.0001 | <0.0001 | 31.7 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.310 | 7.0 | 6.09 | 31.5 |
| 100 | stress_flash_crash | -5.29 | -0.20 | 0.7590 | 0.51 | 0.4514 | 0.0569 | <0.0001 | 30.0 | 0.0 | 0.0 | 0.00 | 0.00 | 0.387 | 0.317 | 7.0 | 6.09 | 31.6 |
| 1000 | trending | 4.58 | 1.86 | 0.0147 | 1.68 | 0.0371 | <0.0001 | <0.0001 | 372.3 | 0.0 | 0.0 | 0.00 | 0.00 | 0.433 | 0.312 | 7.2 | 6.25 | 32.8 |
| 1000 | mean_reverting | -0.95 | 0.92 | <0.0001 | 1.42 | <0.0001 | <0.0001 | <0.0001 | 388.3 | 0.0 | 0.0 | 0.00 | 0.00 | 0.436 | 0.333 | 7.3 | 6.23 | 32.8 |
| 1000 | choppy | 1.20 | 1.00 | 0.1529 | 1.12 | 0.1265 | <0.0001 | <0.0001 | 349.9 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.300 | 7.1 | 6.24 | 32.7 |
| 1000 | stress_flash_crash | -5.20 | -0.24 | 0.6967 | 0.63 | 0.3286 | 0.0153 | <0.0001 | 329.9 | 0.0 | 0.0 | 0.00 | 0.00 | 0.388 | 0.308 | 7.1 | 6.23 | 32.9 |

#### Magnitude 0.009, arm B-c0.05-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 2.58 | 1.02 | 0.3690 | 1.05 | 0.3521 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.45 | 5.45 | 0.433 | 0.383 | 5.0 | 4.38 | 35.9 |
| 10 | mean_reverting | -2.37 | 0.82 | 0.2978 | 0.89 | 0.2634 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.55 | 5.55 | 0.445 | 0.400 | 5.0 | 4.33 | 37.6 |
| 10 | choppy | 0.74 | 0.99 | 0.3092 | 0.96 | 0.3255 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.67 | 5.67 | 0.379 | 0.332 | 5.0 | 4.38 | 36.9 |
| 10 | stress_flash_crash | -5.38 | 0.59 | 0.4783 | 0.76 | 0.3573 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.82 | 5.82 | 0.379 | 0.335 | 5.0 | 4.39 | 36.7 |
| 100 | trending | 5.09 | 2.44 | 0.0029 | 2.38 | 0.0052 | <0.0001 | <0.0001 | 34.4 | 0.0 | 0.0 | 57.81 | 5.78 | 0.431 | 0.306 | 7.0 | 6.05 | 31.3 |
| 100 | mean_reverting | -0.48 | 1.51 | <0.0001 | 1.95 | <0.0001 | <0.0001 | <0.0001 | 36.1 | 0.0 | 0.0 | 56.88 | 5.69 | 0.439 | 0.330 | 7.0 | 5.97 | 32.6 |
| 100 | choppy | 1.66 | 1.57 | 0.0370 | 1.67 | 0.0331 | <0.0001 | <0.0001 | 32.0 | 0.0 | 0.0 | 58.28 | 5.83 | 0.387 | 0.294 | 7.0 | 6.06 | 31.5 |
| 100 | stress_flash_crash | -4.73 | 0.36 | 0.5712 | 1.07 | 0.1141 | 0.0009 | <0.0001 | 30.4 | 0.0 | 0.0 | 57.91 | 5.79 | 0.387 | 0.300 | 7.0 | 6.02 | 32.0 |
| 1000 | trending | 5.44 | 2.72 | 0.0005 | 2.54 | 0.0021 | <0.0001 | <0.0001 | 379.6 | 0.0 | 0.0 | 629.32 | 6.29 | 0.433 | 0.294 | 7.2 | 6.17 | 33.0 |
| 1000 | mean_reverting | -0.22 | 1.65 | <0.0001 | 2.15 | <0.0001 | <0.0001 | <0.0001 | 395.6 | 0.0 | 0.0 | 616.29 | 6.16 | 0.436 | 0.317 | 7.2 | 6.14 | 33.1 |
| 1000 | choppy | 1.95 | 1.74 | 0.0139 | 1.87 | 0.0123 | <0.0001 | <0.0001 | 360.1 | 0.0 | 0.0 | 626.41 | 6.26 | 0.388 | 0.283 | 7.1 | 6.14 | 33.4 |
| 1000 | stress_flash_crash | -4.61 | 0.34 | 0.5743 | 1.21 | 0.0634 | 0.0016 | <0.0001 | 338.4 | 0.0 | 0.0 | 616.18 | 6.16 | 0.388 | 0.292 | 7.1 | 6.16 | 33.2 |

#### Magnitude 0.009, arm B-c0.05-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 2.58 | 1.02 | 0.3688 | 1.05 | 0.3518 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.54 | 5.54 | 0.433 | 0.383 | 5.0 | 4.38 | 35.9 |
| 10 | mean_reverting | -2.37 | 0.82 | 0.2978 | 0.89 | 0.2634 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.55 | 5.55 | 0.445 | 0.400 | 5.0 | 4.33 | 37.6 |
| 10 | choppy | 0.74 | 0.99 | 0.3092 | 0.96 | 0.3255 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.69 | 5.69 | 0.379 | 0.332 | 5.0 | 4.37 | 36.9 |
| 10 | stress_flash_crash | -5.38 | 0.59 | 0.4783 | 0.76 | 0.3573 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 5.82 | 5.82 | 0.379 | 0.335 | 5.0 | 4.39 | 36.7 |
| 100 | trending | 5.10 | 2.44 | 0.0029 | 2.39 | 0.0051 | <0.0001 | <0.0001 | 34.4 | 0.0 | 0.0 | 58.26 | 5.83 | 0.431 | 0.305 | 7.0 | 6.05 | 31.3 |
| 100 | mean_reverting | -0.48 | 1.51 | <0.0001 | 1.95 | <0.0001 | <0.0001 | <0.0001 | 36.1 | 0.0 | 0.0 | 56.89 | 5.69 | 0.439 | 0.330 | 7.0 | 5.96 | 32.7 |
| 100 | choppy | 1.67 | 1.58 | 0.0364 | 1.68 | 0.0326 | <0.0001 | <0.0001 | 32.0 | 0.0 | 0.0 | 58.28 | 5.83 | 0.387 | 0.293 | 7.0 | 6.06 | 31.6 |
| 100 | stress_flash_crash | -4.72 | 0.37 | 0.5641 | 1.07 | 0.1119 | 0.0007 | <0.0001 | 30.5 | 0.0 | 0.0 | 57.91 | 5.79 | 0.387 | 0.300 | 7.0 | 6.02 | 32.0 |
| 1000 | trending | 5.44 | 2.72 | 0.0005 | 2.54 | 0.0021 | <0.0001 | <0.0001 | 379.7 | 0.0 | 0.0 | 630.06 | 6.30 | 0.433 | 0.294 | 7.2 | 6.18 | 32.9 |
| 1000 | mean_reverting | -0.22 | 1.65 | <0.0001 | 2.15 | <0.0001 | <0.0001 | <0.0001 | 395.7 | 0.0 | 0.0 | 616.31 | 6.16 | 0.436 | 0.317 | 7.2 | 6.14 | 33.1 |
| 1000 | choppy | 1.96 | 1.75 | 0.0137 | 1.88 | 0.0121 | <0.0001 | <0.0001 | 359.7 | 0.0 | 0.0 | 626.44 | 6.26 | 0.388 | 0.283 | 7.1 | 6.15 | 33.3 |
| 1000 | stress_flash_crash | -4.61 | 0.35 | 0.5735 | 1.21 | 0.0631 | 0.0015 | <0.0001 | 338.8 | 0.0 | 0.0 | 616.05 | 6.16 | 0.388 | 0.292 | 7.1 | 6.16 | 33.1 |

#### Magnitude 0.009, arm B-c0.2-x2

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.84 | 2.28 | 0.0484 | 2.31 | 0.0449 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 8.71 | 8.71 | 0.433 | 0.368 | 5.0 | 4.24 | 37.3 |
| 10 | mean_reverting | -1.32 | 1.87 | 0.0226 | 1.94 | 0.0191 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 8.90 | 8.90 | 0.445 | 0.388 | 5.0 | 4.21 | 39.3 |
| 10 | choppy | 1.77 | 2.02 | 0.0440 | 1.99 | 0.0478 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 8.86 | 8.86 | 0.379 | 0.321 | 5.0 | 4.23 | 37.8 |
| 10 | stress_flash_crash | -4.53 | 1.43 | 0.0899 | 1.61 | 0.0572 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 10.12 | 10.12 | 0.379 | 0.320 | 5.0 | 4.20 | 38.1 |
| 100 | trending | 6.06 | 3.41 | <0.0001 | 3.35 | 0.0001 | <0.0001 | <0.0001 | 35.6 | 0.0 | 0.0 | 100.68 | 10.07 | 0.431 | 0.309 | 7.0 | 6.03 | 31.4 |
| 100 | mean_reverting | 0.35 | 2.34 | <0.0001 | 2.77 | <0.0001 | <0.0001 | <0.0001 | 37.0 | 0.0 | 0.0 | 95.94 | 9.59 | 0.439 | 0.332 | 7.0 | 5.95 | 32.5 |
| 100 | choppy | 2.61 | 2.51 | 0.0011 | 2.62 | 0.0011 | <0.0001 | <0.0001 | 34.2 | 0.0 | 0.0 | 106.26 | 10.63 | 0.387 | 0.290 | 7.0 | 5.92 | 32.5 |
| 100 | stress_flash_crash | -3.80 | 1.29 | 0.0488 | 2.00 | 0.0040 | <0.0001 | <0.0001 | 33.4 | 0.0 | 0.0 | 135.67 | 13.57 | 0.387 | 0.288 | 7.0 | 5.85 | 33.3 |
| 1000 | trending | 6.37 | 3.65 | <0.0001 | 3.47 | <0.0001 | <0.0001 | <0.0001 | 388.8 | 0.0 | 0.0 | 1080.67 | 10.81 | 0.433 | 0.298 | 7.1 | 6.13 | 32.9 |
| 1000 | mean_reverting | 0.50 | 2.37 | <0.0001 | 2.88 | <0.0001 | <0.0001 | <0.0001 | 400.8 | 0.0 | 0.0 | 1034.74 | 10.35 | 0.436 | 0.323 | 7.1 | 6.10 | 33.0 |
| 1000 | choppy | 2.75 | 2.54 | 0.0005 | 2.67 | 0.0005 | <0.0001 | <0.0001 | 377.7 | 0.0 | 0.0 | 1100.93 | 11.01 | 0.388 | 0.286 | 7.1 | 6.11 | 32.9 |
| 1000 | stress_flash_crash | -3.77 | 1.19 | 0.0569 | 2.05 | 0.0021 | <0.0001 | <0.0001 | 366.9 | 0.0 | 0.0 | 1456.02 | 14.56 | 0.388 | 0.288 | 7.1 | 6.06 | 33.2 |

#### Magnitude 0.009, arm B-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 4.12 | 2.56 | 0.0275 | 2.60 | 0.0253 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 10.95 | 10.95 | 0.433 | 0.358 | 5.0 | 4.12 | 38.6 |
| 10 | mean_reverting | -1.03 | 2.16 | 0.0091 | 2.23 | 0.0076 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 11.85 | 11.85 | 0.445 | 0.377 | 5.0 | 4.08 | 41.4 |
| 10 | choppy | 1.99 | 2.24 | 0.0269 | 2.21 | 0.0295 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 11.28 | 11.28 | 0.379 | 0.312 | 5.0 | 4.10 | 39.0 |
| 10 | stress_flash_crash | -4.38 | 1.58 | 0.0626 | 1.75 | 0.0388 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 12.43 | 12.43 | 0.379 | 0.311 | 5.0 | 4.10 | 39.2 |
| 100 | trending | 6.50 | 3.84 | <0.0001 | 3.79 | <0.0001 | <0.0001 | <0.0001 | 36.2 | 0.0 | 0.0 | 145.01 | 14.50 | 0.431 | 0.295 | 7.0 | 5.90 | 32.0 |
| 100 | mean_reverting | 0.72 | 2.71 | <0.0001 | 3.15 | <0.0001 | <0.0001 | <0.0001 | 37.3 | 0.0 | 0.0 | 140.61 | 14.06 | 0.439 | 0.321 | 7.0 | 5.78 | 33.8 |
| 100 | choppy | 2.89 | 2.80 | 0.0003 | 2.90 | 0.0004 | <0.0001 | <0.0001 | 34.6 | 0.0 | 0.0 | 144.08 | 14.41 | 0.387 | 0.280 | 7.0 | 5.82 | 33.2 |
| 100 | stress_flash_crash | -3.69 | 1.40 | 0.0329 | 2.11 | 0.0024 | <0.0001 | <0.0001 | 34.2 | 0.0 | 0.0 | 148.45 | 14.85 | 0.387 | 0.283 | 7.0 | 5.81 | 33.4 |
| 1000 | trending | 6.88 | 4.16 | <0.0001 | 3.97 | <0.0001 | <0.0001 | <0.0001 | 396.7 | 0.0 | 0.0 | 1638.24 | 16.38 | 0.433 | 0.286 | 7.1 | 5.98 | 33.3 |
| 1000 | mean_reverting | 0.91 | 2.78 | <0.0001 | 3.28 | <0.0001 | <0.0001 | <0.0001 | 405.9 | 0.0 | 0.0 | 1578.18 | 15.78 | 0.436 | 0.314 | 7.1 | 5.96 | 33.5 |
| 1000 | choppy | 3.11 | 2.91 | <0.0001 | 3.04 | <0.0001 | <0.0001 | <0.0001 | 388.5 | 0.0 | 0.0 | 1598.18 | 15.98 | 0.388 | 0.276 | 7.0 | 5.97 | 33.5 |
| 1000 | stress_flash_crash | -3.62 | 1.34 | 0.0321 | 2.21 | 0.0010 | <0.0001 | <0.0001 | 370.4 | 0.0 | 0.0 | 1629.04 | 16.29 | 0.388 | 0.281 | 7.1 | 6.00 | 33.4 |

#### Magnitude 0.009, arm R-c0.2-x4

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | 3.99 | 2.43 | 0.0352 | 2.46 | 0.0325 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 11.05 | 11.05 | 0.433 | 0.361 | 5.1 | 4.17 | 38.3 |
| 10 | mean_reverting | -1.09 | 2.11 | 0.0112 | 2.17 | 0.0094 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 11.47 | 11.47 | 0.445 | 0.379 | 5.1 | 4.11 | 41.4 |
| 10 | choppy | 1.88 | 2.14 | 0.0289 | 2.11 | 0.0317 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 11.40 | 11.40 | 0.379 | 0.314 | 5.1 | 4.14 | 38.8 |
| 10 | stress_flash_crash | -4.45 | 1.51 | 0.0663 | 1.68 | 0.0406 | <0.0001 | <0.0001 | 0.4 | 0.0 | 0.0 | 12.21 | 12.21 | 0.379 | 0.314 | 5.0 | 4.14 | 38.5 |
| 100 | trending | 5.62 | 2.96 | 0.0003 | 2.91 | 0.0007 | <0.0001 | <0.0001 | 35.6 | 0.0 | 0.0 | 143.42 | 14.34 | 0.431 | 0.316 | 7.0 | 5.93 | 32.4 |
| 100 | mean_reverting | 0.06 | 2.06 | <0.0001 | 2.49 | <0.0001 | <0.0001 | <0.0001 | 36.9 | 0.0 | 0.0 | 142.60 | 14.26 | 0.439 | 0.345 | 7.0 | 5.86 | 33.7 |
| 100 | choppy | 2.34 | 2.25 | 0.0028 | 2.35 | 0.0028 | <0.0001 | <0.0001 | 34.3 | 0.0 | 0.0 | 143.99 | 14.40 | 0.387 | 0.296 | 7.0 | 5.87 | 33.3 |
| 100 | stress_flash_crash | -3.98 | 1.12 | 0.0810 | 1.82 | 0.0072 | <0.0001 | <0.0001 | 32.8 | 0.0 | 0.0 | 148.79 | 14.88 | 0.387 | 0.300 | 7.0 | 5.87 | 33.4 |
| 1000 | trending | 5.98 | 3.26 | <0.0001 | 3.08 | 0.0002 | <0.0001 | <0.0001 | 400.1 | 0.0 | 0.0 | 1612.83 | 16.13 | 0.433 | 0.306 | 7.0 | 6.01 | 33.3 |
| 1000 | mean_reverting | 0.22 | 2.09 | <0.0001 | 2.60 | <0.0001 | <0.0001 | <0.0001 | 404.7 | 0.0 | 0.0 | 1580.57 | 15.81 | 0.436 | 0.336 | 7.0 | 6.01 | 33.3 |
| 1000 | choppy | 2.57 | 2.37 | 0.0009 | 2.50 | 0.0009 | <0.0001 | <0.0001 | 391.7 | 0.0 | 0.0 | 1615.46 | 16.15 | 0.388 | 0.291 | 7.0 | 6.00 | 33.4 |
| 1000 | stress_flash_crash | -3.87 | 1.09 | 0.0760 | 1.95 | 0.0029 | <0.0001 | <0.0001 | 374.6 | 0.0 | 0.0 | 1655.16 | 16.55 | 0.388 | 0.294 | 7.0 | 6.02 | 33.4 |

#### Magnitude 0.009, arm S3

| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | trending | -0.03 | -1.60 | 0.1075 | -1.56 | 0.1149 | <0.0001 | <0.0001 | 0.0 | 0.0 | 5.2 | 0.00 | 0.00 | 0.433 | 0.414 | 5.1 | 4.43 | 36.7 |
| 10 | mean_reverting | -3.97 | -0.77 | 0.2778 | -0.70 | 0.3275 | <0.0001 | <0.0001 | 0.0 | 0.0 | 2.8 | 0.00 | 0.00 | 0.445 | 0.427 | 5.0 | 4.42 | 36.9 |
| 10 | choppy | -1.50 | -1.25 | 0.1422 | -1.28 | 0.1345 | <0.0001 | <0.0001 | 0.0 | 0.0 | 3.9 | 0.00 | 0.00 | 0.379 | 0.363 | 5.1 | 4.42 | 37.1 |
| 10 | stress_flash_crash | -6.36 | -0.39 | 0.5953 | -0.22 | 0.7669 | <0.0001 | 0.0524 | 0.0 | 0.0 | 1.2 | 0.00 | 0.00 | 0.379 | 0.364 | 5.0 | 4.41 | 37.3 |
| 100 | trending | 0.79 | -1.86 | 0.0046 | -1.92 | 0.0063 | <0.0001 | <0.0001 | 0.0 | 0.0 | 54.5 | 0.00 | 0.00 | 0.431 | 0.382 | 7.0 | 6.03 | 33.2 |
| 100 | mean_reverting | -2.82 | -0.82 | 0.0001 | -0.39 | 0.0720 | <0.0001 | <0.0001 | 0.0 | 0.0 | 27.3 | 0.00 | 0.00 | 0.439 | 0.401 | 7.0 | 5.99 | 33.3 |
| 100 | choppy | -1.02 | -1.12 | 0.0701 | -1.01 | 0.1211 | <0.0001 | <0.0001 | 0.0 | 0.0 | 36.2 | 0.00 | 0.00 | 0.387 | 0.350 | 7.0 | 6.00 | 33.1 |
| 100 | stress_flash_crash | -5.46 | -0.37 | 0.5139 | 0.34 | 0.5708 | <0.0001 | 0.0024 | 0.0 | 0.0 | 11.3 | 0.00 | 0.00 | 0.387 | 0.348 | 7.0 | 6.03 | 32.5 |
| 1000 | trending | 0.81 | -1.91 | 0.0019 | -2.09 | 0.0019 | <0.0001 | <0.0001 | 0.0 | 0.0 | 555.5 | 0.00 | 0.00 | 0.433 | 0.379 | 7.0 | 6.14 | 34.0 |
| 1000 | mean_reverting | -2.71 | -0.84 | <0.0001 | -0.34 | 0.0038 | <0.0001 | <0.0001 | 0.0 | 0.0 | 271.0 | 0.00 | 0.00 | 0.436 | 0.396 | 7.0 | 6.16 | 33.6 |
| 1000 | choppy | -0.93 | -1.13 | 0.0489 | -1.01 | 0.1051 | <0.0001 | <0.0001 | 0.0 | 0.0 | 364.3 | 0.00 | 0.00 | 0.388 | 0.347 | 7.0 | 6.15 | 33.9 |
| 1000 | stress_flash_crash | -5.33 | -0.37 | 0.4805 | 0.49 | 0.3824 | <0.0001 | <0.0001 | 0.0 | 0.0 | 115.4 | 0.00 | 0.00 | 0.388 | 0.343 | 7.0 | 6.22 | 33.1 |
