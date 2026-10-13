# Monadeum

Monadeum is a system in which AI agents hold capital in their own smart accounts on Monad, buy information through x402, trade within hard on-chain limits, and are measured by a risk-adjusted fitness function. A language model only proposes. A deterministic policy engine decides whether the resulting transaction is allowed, and each agent's account enforces its own caps and call allowlist on-chain as an independent second check. Trading is the first environment. The underlying question is whether autonomous economic agents can improve when capital, information, and computation are scarce.

This repository is the product repository: the decisions and their rationale, the contracts, the services, the simulation, and the evidence. It is private today and is intended to go public as a separate, explicit decision.

- Documentation: https://docs.monadeum.xyz (source in [`docs-site/`](./docs-site))
- Live evidence page: https://app.monadeum.xyz/evidence
- App (Monad testnet): https://app.monadeum.xyz

## Status

Everything below concerns Monad testnet with testnet assets. No contract is on mainnet, none has been audited, and no real capital is at risk. Dates are when the check was made. The full account, with what is not yet observed, is in [Current status](./docs-site/introduction/current-status.mdx).

| Area | State | Verified |
| --- | --- | --- |
| `AgentSpendPolicy`, `AgentReallocation`, `X402PaymentValidator` | Deployed on chain 10143, receipts succeeded, constructor values read back, roles held by a 2-of-3 Safe. Addresses in [`contracts/deployments/monad-testnet.json`](./contracts/deployments/monad-testnet.json) | 2026-10-11 |
| Web app and API | Served at `app.monadeum.xyz` and `api.monadeum.xyz` from one VPS | 2026-10-11 |
| Sign-in, agent creation, account deployment | An owner signed in and created the first agent. Its Kernel account was deployed with sponsored gas and the indexer recorded its events | 2026-10-11 |
| Indexer | Reads finalized blocks into Postgres | 2026-10-11 |
| Trading loop (tick runner) | Built and tested offline. **Off by default.** No tick has run against the live deployment | 2026-10-12 |
| x402 payments | Client, validator contract, and reconciliation built. **Payer off by default.** Whether the facilitator on Monad accepts ERC-1271 signatures is unverified | 2026-10-11 |
| Selection by reallocation | Contract deployed. **Off by default.** A pre-registered study found no measurable genome edge for the current strategy | 2026-10-11 |
| Relayed funding transfer | Built, tested against an in-memory token. Not yet executed on Monad | 2026-10-11 |
| Spending operation through the spend policy | Fuzz, invariant, and fork tests exist. Not yet observed through a bundler | 2026-10-11 |
| External audit | **Not done.** An audit package exists, no auditor is engaged | 2026-10-12 |
| Mainnet deployment, production key vault, on-chain identity registry, card on-ramp session | **Not built** | 2026-10-12 |

Numeric constants in the documents are proposed defaults unless a document says they were measured or decided. Claims about Monad, vendors, and third-party protocols are time-sensitive and should be re-verified before they are relied on for anything involving capital.

## What the evidence says

The original design had agents reproduce. Simulation found no population-level benefit, so it was replaced by owner-scoped capital reallocation with retirement of starved agents, which was confirmed in a pre-registered simulation run. A second pre-registered study then tested whether the production strategy's genomes carry the edge that mechanism needs, on real Kuru market data. They did not: the top fifth of genomes beat the bottom fifth by 0.028 market standard deviations per tick out of sample, against 0.278 modeled. Under the pre-registered rule, selection adds nothing measurable for this strategy, and the product rests on well-calibrated static agents with reallocation off. The limits of that result are stated in [`EVOLUTION.md`](./EVOLUTION.md) section 7.

## Architecture overview

```
web (Next.js) --> api (NestJS) --> Postgres <-- indexer --> Monad
                         |                 ^
                         v                 |
                  worker (BullMQ) --> risk engine --> execution --> agent smart account --> Kuru, x402 providers
```

- **Wallets.** One ERC-4337 smart account (ZeroDev Kernel v3.1) per agent, with a scoped, revocable session key held by the worker and the user's embedded wallet (Privy) as owner.
- **Two independent limits.** A signed, versioned policy document parameterizes the risk engine. The account's `AgentSpendPolicy` enforces an allowlist, a recipient rule, a per-transaction cap, and a rolling daily cap on-chain.
- **x402.** Payments are signed by a separate key through `X402PaymentValidator`, which bounds payee, amount, validity window, and rate on-chain.
- **Boundary.** Identity, custody, and capital movement are on-chain. Genomes and policies are committed by hash with the content off-chain. Postgres is a read-model.

Details: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `ARCHITECTURE.md`, `EVOLUTION.md`, `ECONOMICS.md`, `THREAT-MODEL.md`, `SECURITY.md` | The five core decision documents |
| `BRIEF.md` | The founding product brief the other documents cite |
| `apps/web`, `apps/api`, `apps/worker`, `apps/indexer` | The four deployable processes |
| `libs/` | Shared packages: `risk`, `wallets`, `trading`, `x402`, `fitness`, `reallocation`, `recovery`, `commitment`, `read-model`, `agent-registry`, `auth`, `db`, `tick`, `strategy`, and others |
| `contracts/` | Solidity sources, Foundry tests, deployment scripts, deployment records, and the audit package |
| `simulation/` | The standalone simulation harness and its results in `simulation/results/` |
| `deploy/` | The single-VPS testnet runtime and its runbook |
| `docs/` | Funding on-ramp and testnet trading option notes |
| `docs-site/` | The Mintlify documentation site |
| `spikes/` | Small experiments that informed decisions |

## Run it locally

Requires [bun](https://bun.sh) 1.3.14 (the version `package.json` pins) and Node.js.

```bash
bun install --frozen-lockfile
bun run test
```

`bun run test` runs the test suite of every workspace package, including the simulation and a production build of the web app. Each workspace also has its own `test` script, for example `bun run --filter @monadeum/web test`. The web app runs in `sample` mode by default, with deterministic sample data and a banner saying so, which needs no backend:

```bash
bun run --filter @monadeum/web dev
```

Contracts use Foundry (CI pins forge 1.8.5) and a `forge-std` submodule:

```bash
git submodule update --init --recursive
cd contracts
forge test
```

Running the API, worker, and indexer against Monad testnet needs Postgres, Redis, a Privy app, a ZeroDev project, and encrypted key vaults. The runbook is [`deploy/README.md`](./deploy/README.md).

Documentation site, locally: see [`docs-site/README.md`](./docs-site/README.md).

## Contributing

Read [`CLAUDE.md`](./CLAUDE.md) first. It is binding for contributors as well as tools. In short: no em dashes anywhere; professional, precise language with no filler or hype; an unverified claim is written as an assumption or a hypothesis; every document is self-contained; commits are conventional, one line, lowercase, and without trailing punctuation. Work in this order: research, then documentation, then implementation. A change to a decision documented in one of the core documents updates that document in the same pull request, and a numeric constant or vendor choice is never changed in code without the document being updated to match and the reasoning stated.

## Security

Do not report a vulnerability in a public issue. See [`SECURITY.md`](./SECURITY.md) section 14 for how to report one, and sections 3 and 13 for the audit gates and known limitations. The threat model is [`THREAT-MODEL.md`](./THREAT-MODEL.md).
