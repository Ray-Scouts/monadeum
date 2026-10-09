# simulation

Standalone harness for the evolutionary loop. It does not talk to a wallet, a chain, or the API. NestJS `SimulationModule` is a later wrapper around `run`. It is not a second copy of the fitness, reproduction, or risk rules. Those rules live in `src/fitness.ts`, `src/reproduction.ts`, and `src/risk.ts`, and the runner only calls them.

## Assumptions, labeled as such

- Market paths are synthetic. They are not historical Monad prints. Four regimes match `ECONOMICS.md` section 3: trending, mean-reverting, choppy, and a single stress shock halfway through the run.
- Each agent has a hidden skill drawn once from -0.002 to 0.004. While the agent is in the market, that skill is added to the bar's return. This is the "some agents are slightly better" device from `ECONOMICS.md` section 3, not a measured edge. A child's skill is `h * parent.skill + (1 - h) * fresh draw`, where `h` is `RunConfig.skillHeritability` (default 0, a fresh draw). Production agents have no hidden skill, so `h` is an experiment knob (issue #80, `results/heritability.md`), not a protocol constant.
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

`bun run rerun` runs the evolving versus static comparison for one arm of `results/twelve-cell-rerun.md` (`ARM=A`, `B`, or `C`; `POPS`, `REGIMES`, `SEEDS`, and `OUT` narrow it or write JSON to a file). `node dist/src/cli-rerun-report.js <dir>` turns a directory of those JSON files into the tables and the section 8 call per arm. `H=<h>` sets skill heritability for that arm and names it, for example, `A-h0.5`; the report then adds a mean skill table. `RunConfig.informationPurchases: false` turns information purchases off: no x402 spend and no information edge, with the agent RNG stream unchanged.

`bun run threshold` prints the profit threshold and x402 price grid in `results/reproduction-threshold.md`. Environment variables `POPS`, `REGIMES`, `FRACTIONS`, `X402`, and `SEEDS` narrow or widen it.
