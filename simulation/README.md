# simulation

Standalone harness for the evolutionary loop. It does not talk to a wallet, a chain, or the API. NestJS `SimulationModule` is a later wrapper around `run`. It is not a second copy of the fitness, reproduction, or risk rules. Those rules live in `src/fitness.ts`, `src/reproduction.ts`, and `src/risk.ts`, and the runner only calls them.

## Assumptions, labeled as such

- Market paths are synthetic. They are not historical Monad prints. Four regimes match `ECONOMICS.md` section 3: trending, mean-reverting, choppy, and a single stress shock halfway through the run.
- Each agent has a hidden skill drawn once from -0.002 to 0.004. While the agent is in the market, that skill is added to the bar's return. This is the "some agents are slightly better" device from `ECONOMICS.md` section 3, not a measured edge. A child's skill is `h * parent.skill + (1 - h) * fresh draw`, where `h` is `RunConfig.skillHeritability` (default 0, a fresh draw). Production agents have no hidden skill, so `h` is an experiment knob (issue #80, `results/heritability.md`), not a protocol constant.
- Experiment-only genome performance model (issue #84, `src/genome-model.ts`, `results/genome-model.md`), off by default. With `RunConfig.genomeModel: { magnitude }` set, an agent's per-tick edge while in the market is `magnitude * (score - 1/3)`, where the score in [0, 1] is a weighted closeness of `timeHorizon` (0.4, log scale), `entryThreshold` (0.3), and the traded pair (0.3) to a per-regime optimum, and the hidden skill is 0 for every agent (its draw is still made). `RunConfig.randomGenomes: true` draws each founder's horizon, threshold, and pair set at random, keeping the policy's risk tolerance and execution frequency. The optima, weights, and magnitudes are assumptions; 0.006 (the hidden skill range) and 0.009 passed the static validation, 0.003 did not. `exitThreshold`, `riskTolerance`, and `executionFrequency` do not enter the score: the strategy does not read the first, and the legal policy pins the other two.
- An information purchase, with the configured probability, costs `x402Usd` and adds `infoEdge` (default 0.002) on that tick only.
- The synthetic strategy is long or flat. It trades when the trailing market mean plus the agent's edge clears `entryThreshold`.
- Numeric constants come from `EVOLUTION.md` via `src/protocol.ts`. The testnet population cap is 50. A scenario that already starts above 50 uses twice the starting population, which is the cap the preliminary model in `ECONOMICS.md` section 5 used. Applying 50 to a 1,000-agent scenario would make reproduction impossible, so it would not test the mechanism.
- `informationBudget` is clipped at 1 per tick. That ceiling is a harness bound so mutation cannot remove the budget. It is a proposed default, not a measured product limit.
- Two RNG streams share the seed: one for the market, one for agents. The market path does not change when the population size changes.

## Run

```bash
npm test
```

`npm test` typechecks and runs the short suite. It does not run the 1,000-agent sweeps.

`bun run rerun` runs the evolving versus static comparison for one arm of `results/twelve-cell-rerun.md` (`ARM=A`, `B`, or `C`; `POPS`, `REGIMES`, `SEEDS`, and `OUT` narrow it or write JSON to a file). `node dist/src/cli-rerun-report.js <dir>` turns a directory of those JSON files into the tables and the section 8 call per arm. `H=<h>` sets skill heritability for that arm and names it, for example, `A-h0.5`; the report then adds a mean skill table. `RunConfig.informationPurchases: false` turns information purchases off: no x402 spend and no information edge, with the agent RNG stream unchanged. `F=<fraction>`, `M=<m>`, and `T=1` (issue #82, `results/child-capital.md`) set `RunConfig.reproductionFraction`, the minimum child capital `RunConfig.minChildCapital`, and a treasury top-up to `m` funded by `RunConfig.treasury`, and name the arm, for example `A-h1-f0.5-m2.5-t`; the report then adds a child capital table. All three are experiment parameters whose defaults (the protocol fraction, 0, and no treasury) leave behavior unchanged.

`node dist/src/cli-genome-validation.js` runs the static validation of the genome model in `results/genome-model.md` (`REGIMES`, `MAGS` as a comma list where `skill` is the hidden skill reference, `SEEDS`, `POP`, `OUT`); `REPORT=<dir>` prints its tables from a directory of JSON outputs.

`node dist/src/cli-slots.js` runs one fixed-slot arm (`ARM` from `SLOT_ARMS` in `src/slots.ts`, `MAG` the genome model magnitude, plus `POPS`, `REGIMES`, `SEEDS`, `OUT`). `node dist/src/cli-slots-report.js <dir>` prints the tables of `results/fixed-slot.md` (issue #85). The issue #89 arms (`results/reallocation-scope.md`) are in the same registry: `N` (no replacement, no reallocation), `RO-c0.2-x<ceiling>` (reallocation only), `RT-c0.2-x4` and `O<k>-RT-c0.2-x4` (no replacement, starved slots retire as in a static run), and `O<k>-<N|Mo|Mp>-c0.2-x<ceiling>` (reallocation scoped to owners of `k` slots or the assumed `mix` distribution, with no replacement, or with mutant replacement drawing donors within the owner or population-wide). `RunConfig.slots.refill: "none"` or `"retire"`, `slots.owners`, and `slots.donorScope` are experiment-only options; unset, they leave issue #85 behavior unchanged. `node dist/src/cli-scope-report.js <issue #89 dir> <issue #85 dir>` prints the issue #89 tables against Control 1, Control 2, and arm B.

`bun run threshold` prints the profit threshold and x402 price grid in `results/reproduction-threshold.md`. Environment variables `POPS`, `REGIMES`, `FRACTIONS`, `X402`, and `SEEDS` narrow or widen it.
