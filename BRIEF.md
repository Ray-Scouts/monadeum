# BRIEF.md

The founding product brief for Monadeum, as given at project start. Every other document in this repository, `ARCHITECTURE.md`, `EVOLUTION.md`, `ECONOMICS.md`, `THREAT-MODEL.md`, and `SECURITY.md`, cites this brief as the source of a requirement or a worked example. This file exists so those citations resolve to a real, in-repository document instead of an external reference.

Where a later document departs from this brief (for example, `EVOLUTION.md` section 3 replaces the reproduction model below with owner-scoped capital reallocation and retirement, after simulation showed reproduction added no population-level benefit), that departure is stated and justified in the later document, not hidden.

---

## Product vision

Build an autonomous economic ecosystem where AI agents can own or control capital, purchase information and services, make economic decisions, execute permitted on-chain strategies, generate measurable economic outcomes, evolve their strategies, reproduce, create descendants, compete for capital, and survive or become inactive based on economic fitness.

The initial use case is autonomous trading on Monad. The product is not defined as merely an AI trading bot. The deeper thesis: can autonomous economic agents evolve better strategies when capital, information, computation, and reproduction are treated as scarce resources? The system should eventually support multiple economic strategies, with trading as the initial demonstration.

## Core agent loop

User creates an agent. The agent receives initial capital. It observes its environment, purchases information or services when useful, reasons about opportunities, and proposes an economic action. A Policy/Risk Engine evaluates the proposal. An execution layer executes permitted actions. Performance is measured, fitness is updated, and the agent may reproduce. Children receive independent identities, capital, and strategies. The population evolves.

Worked example given at the outset, illustrative only, not a final mechanism: an agent starts with $5, trades and purchases information and services, grows to $10, then reproduces into two children with $5 each, one inheriting strategy A and the other strategy B. This is a starting hypothesis for the reproduction mechanism, not a specification; `EVOLUTION.md` researches better mechanisms and explicitly departs from this exact split, see `EVOLUTION.md` section 3 for why.

## Product principle

The user should not need to understand blockchain infrastructure before creating their first agent. The intended onboarding path: landing page, create your first agent, social login, an agent account or wallet is automatically provisioned, the user funds the agent, it starts. An external wallet must remain available as an advanced option, never required for primary onboarding. The product should combine web2-level onboarding with web3-native transparency: minimal friction to create an agent, while still being able to inspect agent identity, wallet or account, capital, transactions, strategies, x402 spending, trades, fitness, lineage, reproduction, generation, and performance at any time.

## Wallet and account architecture

Research and justify whether each agent should have an independent EOA, an independent embedded wallet, a smart account, a smart-contract vault, a delegated account, or another architecture, comparing Privy, Dynamic, Turnkey, Coinbase CDP or Embedded Wallets, MetaMask Embedded Wallets, thirdweb, Sequence, passkey-based approaches, MPC approaches, smart accounts, account abstraction, ERC-4337, ERC-7702, and other relevant Monad-compatible infrastructure, evaluated for what is actually supported on Monad today, not chosen because it is popular. The architecture must make it possible to isolate agent funds, enforce spending limits, enforce contract permissions, revoke permissions, limit transaction types, limit daily spending, limit reproduction, prevent unrestricted withdrawals, support agent autonomy, and recover from a compromised agent. Investigate whether a structure with one user-level embedded wallet or smart account controlling an "agent controller," under which each agent has its own isolated account or vault, is preferable to giving every agent an independent EOA.

Research the best way to support both a primary social-login onboarding path and an advanced external-wallet path without creating fragmented account models.

## Gasless and sponsored onboarding

Research whether Monad supports or integrates with gas sponsorship, paymasters, ERC-4337, ERC-7702, account abstraction, sponsored transactions, or relayers, so that the platform can sponsor a user's initial setup transaction and the user does not need to hold MON simply to create their first agent. Determine the safest and most economically reasonable approach, not the first mechanism found.

## x402 as a core economic primitive

The project should use x402 as an economic primitive for autonomous agents. Agents should potentially be able to pay for market data, blockchain analytics, AI inference, search, scraping, financial intelligence, specialized APIs, compute, and other agent services. The agent must decide whether the expected value of information justifies its price. Research how to model expected information value against information cost. Track every x402 expenditure.

## Monad API Hub

Inspect the Monad API Hub and its machine-readable feeds, identify useful services, and categorize them: market data, analytics, AI, search, scraping, blockchain intelligence, financial services, other. For every relevant service determine price, endpoint, payment mechanism, latency, reliability, data quality, trust assumptions, failure modes, and usefulness to an autonomous agent. Treat API Hub providers as external, untrusted dependencies. Do not assume Monad audits or endorses every listed service.

## Agent identity

Research ERC-8004, Monad agent identity infrastructure, and other agent identity standards. Determine whether each agent should have a persistent on-chain identity, with metadata potentially including agent ID, owner, wallet or account, parent, generation, genome hash, strategy, fitness, status, creation timestamp, and reproduction history. Determine what should be on-chain, off-chain, hashed, or indexed. Do not put expensive or unnecessary AI data on-chain.

## Evolutionary model

Research evolutionary algorithms, genetic algorithms, evolutionary computation, multi-agent systems, evolutionary trading, self-replicating agents, agent swarms, autonomous economic agents, artificial life, and population-based optimization. Research existing implementations, at minimum investigating any named projects discovered during research, for architecture, economic model, reproduction mechanism, strategy representation, agent identity, wallet model, x402 usage, what is novel, what is flawed, what to learn, and what to avoid. Verify whether projects are currently active rather than assuming they are.

## Genome

Define what constitutes an agent's genome. Potential parameters: strategy type, asset universe, risk tolerance, position size, execution frequency, time horizon, indicators, entry conditions, exit conditions, information sources, information budget, model configuration, tool preferences, risk parameters. Do not assume every genome parameter should be mutable. Classify parameters as immutable, mutable, inherited, mutated, derived, or externally constrained. Determine what should be stored on-chain versus off-chain.

## Fitness

Do not use raw profit as the only fitness metric. Research ROI, risk-adjusted return, maximum drawdown, volatility, Sharpe, Sortino, capital efficiency, operating costs, x402 costs, gas costs, trading fees, slippage, consistency, survival, and diversification. A possible model: net economic performance equals PnL minus x402 costs minus gas minus trading fees minus slippage minus other operating costs, then incorporate risk. Research whether this should become the final fitness metric. The system must explicitly investigate how to distinguish skill from luck.

## Reproduction

Research threshold reproduction, fitness-weighted reproduction, mutation, crossover, capital splitting, treasury-funded reproduction, survival, retirement, and death. A possible model: a parent that passes reproduction criteria creates a child, the child inherits the genome, the genome mutates, the child receives limited capital, the child becomes independent. Do not assume this is optimal. Investigate parent survival, capital conservation, reproduction costs, mutation rates, population caps, minimum capital, reproduction cooldown, generation limits, and descendant limits. There must be no mechanism that accidentally creates unlimited capital.

## Population dynamics

Model 10, 100, and 1,000 agents over multiple generations. Simulate high-performing agents, low-performing agents, random luck, correlated strategies, strategy convergence, mutation, reproduction, death, and capital concentration. Investigate whether the population naturally converges toward a monoculture. If so, design mechanisms to preserve useful diversity: possible mechanisms include diversity bonuses, strategy niches, mutation, capital caps, reproduction quotas, and correlation penalties. Do not implement these unless research supports them.

## Trading

Trading is the initial economic strategy. Research current Monad trading infrastructure. Identify at least three viable execution venues. For each, evaluate liquidity, pairs, fees, slippage, routing, API or SDK availability, contracts, reliability, testnet and mainnet status, and suitability for autonomous execution. Determine whether a DEX aggregator or router should be used. Do not hardcode a single DEX without research.

## Multi-strategy architecture

The system must be designed so trading is a strategy plugin. Potential future strategies: arbitrage, market making, liquidity provision, yield strategies, prediction markets, information arbitrage, data services, agent-to-agent services. The MVP may implement only one or two strategies, but the architecture should not require rewriting the entire protocol to add another strategy.

## Agent-to-agent economy

Research whether agents could eventually interact economically with each other, for example a trader agent paying an analytics agent via x402 for market analysis. Investigate whether this is a better long-term direction than a closed system where every agent only trades. Do not over-engineer the MVP.

## Security architecture

Read Monad's own published guidance on writing secure code with LLMs carefully. Do not produce a generic checklist. Derive a project-specific threat model. Identify assets, actors, trust boundaries, attacker capabilities, attack surfaces, financial flows, wallet permissions, AI boundaries, external API boundaries, smart-contract boundaries, frontend and backend boundaries, database boundaries, and agent-to-agent boundaries.

## Security invariants

Define explicit invariants. Examples: an agent cannot spend beyond its configured limits; an agent cannot withdraw protected capital; a child cannot receive unauthorized capital; reproduction cannot create capital from nothing; an agent cannot create unlimited descendants; AI output cannot directly bypass the policy engine; external API output cannot directly trigger unrestricted transactions; user prompts cannot modify protocol-level financial constraints; a failed external service call cannot silently execute a trade; agent permissions can be revoked; unexpected states fail closed. Derive additional invariants from the final architecture.

## AI security

Research prompt injection, indirect prompt injection, tool poisoning, malicious API responses, data poisoning, model manipulation, hallucinated transactions, unauthorized tool use, tool privilege escalation, and malicious strategy mutations. The architecture must separate AI decision-making from policy from execution. The LLM must never be the final authority over financial permissions.

## Real money safety: three operating modes

**Simulation**: no real money, using historical data, deterministic markets, configurable conditions.

**Testnet**: real testnet assets, validating wallets, x402, reproduction, accounting, trading, and policies.

**Mainnet**: opt-in only, never the default. Must include spending limits, position limits, loss limits, API budgets, gas budgets, reproduction limits, a maximum population, an allowlist of permitted contracts, an emergency stop, and withdrawal controls. Unrestricted autonomous mainnet trading must never be the default.

## Architecture

A likely starting architecture: social login or an external wallet feeding into a Next.js frontend, a NestJS API talking to PostgreSQL, Redis, and the blockchain, with a queue feeding agent workers that talk to Monad and x402. This is only a starting hypothesis; it should be challenged, not assumed correct. See `ARCHITECTURE.md` for what changed and why.

## Backend, workers, frontend, database

Use NestJS as the primary backend framework unless research identifies a compelling reason not to, with domain-driven module boundaries, not one module per every noun. The API process must not contain infinite autonomous agent loops. Agent execution must be separated from the HTTP/API process, using an appropriate worker or orchestration system (BullMQ, Redis queues, Temporal, or another system), chosen for reliability, retries, idempotency, scheduling, horizontal scalability, observability, state management, and failure recovery, without prematurely over-engineering it. The frontend should use Next.js, TypeScript, Tailwind, and viem, with the minimum wallet integration required; the autonomous agent runtime must not depend on React or a wallet-connector library like Wagmi.

## On-chain versus off-chain

Explicitly determine what belongs on-chain: likely candidates are agent identity, ownership, capital custody, permissions, critical limits, reproduction events, and important state transitions. Likely off-chain: LLM prompts, model outputs, reasoning, large datasets, historical analytics, and detailed strategy execution logs. Hash or commit on-chain where appropriate: genome, strategy versions, model configuration, and important agent configurations. Do not put data on-chain merely because it is technically possible.

## Simulation engine

Build the simulator before real autonomous trading. It should support configurable market conditions, strategies, mutation, reproduction, fitness, capital, fees, gas, x402 costs, slippage, and failures. It must be deterministic when given the same seed. Run experiments to determine whether evolution improves performance, whether luck dominates, whether population diversity survives, whether capital concentrates, and whether reproduction is sustainable.

## Required research and design documents

`RESEARCH.md` (research phase, in the internal repository), `ARCHITECTURE.md`, `THREAT-MODEL.md`, `SECURITY.md`, `ECONOMICS.md`, and `EVOLUTION.md`, each with the sections described above. `ECONOMICS.md` must simulate at least 10, 100, and 1,000 agents across multiple market environments.

## Challenge the product

Before implementation, answer honestly: is evolutionary reproduction actually useful; what does it achieve that ordinary autonomous agents cannot; what is the strongest argument against this project; is trading actually the right initial strategy; can x402 meaningfully improve agent intelligence or economics; is information purchasing economically rational; how do we distinguish skill from luck; does reproduction improve performance or simply multiply noise; can the population converge on one strategy; how do we preserve diversity; what happens when an agent is compromised; what happens when an API is malicious; what happens when an LLM hallucinates; can agents economically interact with each other; could this eventually become an open agent economy; what is the smallest credible MVP. If the answer is that part of the original idea is bad, change it. Optimize for the strongest technically and economically defensible system, not for agreeing with the original proposal.

## Critical development rules

Never fabricate ecosystem information. Never invent contract addresses. Never assume an integration is currently available without verifying it from a current primary source. Never commit secrets or store private keys in source control. Never allow an LLM to directly control unrestricted funds or bypass policy controls. Never trust external API responses. Never allow unlimited reproduction or reproduction that creates unauthorized capital. Never enable unrestricted mainnet execution by default. Maintain auditable accounting. Use explicit permissions. Fail closed when financial state is ambiguous.

## Implementation order

Only after research and design are mature: repository setup, authentication, wallet and account architecture, contracts, contract tests, simulation engine, agent runtime, policy engine, risk engine, x402 integration, API Hub integration, market data, trading, fitness, evolution, reproduction, indexing, dashboard, end-to-end tests, security review, testnet deployment. Do not enable mainnet autonomous trading until the security and testnet phases are complete.
