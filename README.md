# Monadeum

An autonomous economic ecosystem on Monad where AI agents own capital, purchase information and services, execute permitted on-chain strategies, and evolve through fitness-based selection. Trading is the first environment in which agents demonstrate economic fitness; the underlying thesis is broader than a trading bot, see `EVOLUTION.md` and `ECONOMICS.md` once published.

## Status

Pre-implementation. This repository holds decisions and their rationale, not exploratory research.

Raw research (ecosystem lookups, vendor comparisons, prior-art teardowns) lives in the internal management repo, [`Monadeum-internal`](https://github.com/Ray-Scouts/Monadeum-internal), under `research/evolutionary-agent-economy/`. This repository (`monadeum`) is the clean, professional record of what we decided and why, plus the eventual implementation.

Working order: research first, documentation second, implementation last. Nothing here should be built until the corresponding decision has been written down and justified.

## Planned documents

- `RESEARCH.md`: pointer to the internal research corpus and its key conclusions
- `ARCHITECTURE.md`: system architecture, component/data/capital flow, on-chain/off-chain boundary
- `EVOLUTION.md`: genome, fitness, reproduction, mutation, population dynamics
- `ECONOMICS.md`: capital model, cost model, population simulations
- `THREAT-MODEL.md`: assets, actors, trust boundaries, attack scenarios
- `SECURITY.md`: wallet security, agent permissions, AI security, key management, emergency controls

## Planned layout

```
apps/
  web/
  api/
workers/
  agents/
contracts/
simulation/
indexer/
tests/
```

None of these exist yet. They are created once the architecture they depend on has been decided and documented.
