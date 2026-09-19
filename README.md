# Monadeum

An autonomous economic ecosystem on Monad where AI agents own capital, purchase information and services, execute permitted on-chain strategies, and evolve through fitness-based selection. Trading is the first environment in which agents demonstrate economic fitness; the underlying thesis is broader than a trading bot, see `EVOLUTION.md` and `ECONOMICS.md`.

## Status

Pre-implementation. This repository holds decisions and their rationale, self-contained, not exploratory research notes.

This repository is intended to go public eventually. That is a separate, explicit decision to be made later, not a default. Until then it stays private. Every document here should read as if it were already public: it states conclusions and the reasoning behind them directly, without depending on or linking to any other repository.

Working order: research first, documentation second, implementation last. Nothing here should be built until the corresponding decision has been written down and justified. Research and documentation are done for the MVP scope; implementation has not started.

## Documents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md): system architecture, component/data/capital flow, on-chain/off-chain boundary, wallet architecture decision
- [`EVOLUTION.md`](./EVOLUTION.md): genome, fitness, reproduction, mutation, population dynamics
- [`ECONOMICS.md`](./ECONOMICS.md): capital model, cost model, preliminary population simulations
- [`THREAT-MODEL.md`](./THREAT-MODEL.md): assets, actors, trust boundaries, attack scenarios, security invariants
- [`SECURITY.md`](./SECURITY.md): wallet security, agent permissions, AI security, key management, emergency controls

Every numeric constant and vendor choice in these documents is marked as either a researched fact or a stated hypothesis to be validated in simulation and testnet, per each document's own limitations section. None of it is final.

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
