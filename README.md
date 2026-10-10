# Monadeum

An autonomous economic ecosystem on Monad where AI agents own capital, purchase information and services, execute permitted on-chain strategies, and evolve through fitness-based selection. Trading is the first environment in which agents demonstrate economic fitness; the underlying thesis is broader than a trading bot, see `EVOLUTION.md` and `ECONOMICS.md`.

## Status

Pre-implementation. This repository holds decisions and their rationale, self-contained, not exploratory research notes.

This repository is intended to go public eventually. That is a separate, explicit decision to be made later, not a default. Until then it stays private. Every document here should read as if it were already public: it states conclusions and the reasoning behind them directly, without depending on or linking to any other repository.

Working order: research first, documentation second, implementation last. Nothing here should be built until the corresponding decision has been written down and justified. Research and documentation are done for the MVP scope. The simulation work is summarized in `ECONOMICS.md` section 8. Threshold reproduction showed no population-level benefit in simulation and is superseded. The adopted selection mechanism is owner-scoped capital reallocation with retirement of starved agents (`EVOLUTION.md` sections 3 and 4), confirmed in a pre-registered simulation run. M3 (issue #28) stays on hold until there is evidence that real strategies' genomes carry an edge the mechanism can convert (`EVOLUTION.md` section 7). The rest of the implementation has not started.

## Documents

- [`BRIEF.md`](./BRIEF.md): the founding product brief every other document cites as its source of requirements
- [`ARCHITECTURE.md`](./ARCHITECTURE.md): system architecture, component/data/capital flow, on-chain/off-chain boundary, wallet architecture decision
- [`EVOLUTION.md`](./EVOLUTION.md): genome, fitness, selection (owner-scoped reallocation and retirement), population dynamics, and the superseded reproduction mechanism
- [`ECONOMICS.md`](./ECONOMICS.md): capital model, cost model, preliminary population simulations
- [`THREAT-MODEL.md`](./THREAT-MODEL.md): assets, actors, trust boundaries, attack scenarios, security invariants
- [`SECURITY.md`](./SECURITY.md): wallet security, agent permissions, AI security, key management, emergency controls, and the three operating modes

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

`contracts/` holds only the spend-policy interface (`ARCHITECTURE.md` section 16.3) so far; the other directories do not exist yet. They are created once the architecture they depend on has been decided and documented.
