# SECURITY.md

Concrete security controls for Monadeum, implementing the mitigations `THREAT-MODEL.md` points to. That document enumerates what can go wrong and why; this one states what specifically prevents it. Where a control is not yet built, that is stated as a known limitation, not implied to already exist.

---

## 1. Wallet security

Each agent has its own ERC-4337 smart account on Monad, per `ARCHITECTURE.md` section 6. Two controls apply specifically to the account itself, independent of anything the application layer does:

- **On-chain spend-limit policy**: every agent's smart account enforces a per-transaction cap, a rolling daily cap, and a call allowlist (Kuru's router, the owner-scoped reallocation contract, and the settlement asset, nothing else), and a recipient rule (a settlement-asset `transfer` or `approve` must name Kuru's router or the reallocation contract), per the interface in `ARCHITECTURE.md` section 16.3 and `contracts/src/IAgentSpendPolicy.sol`. The allowlist, the recipient rule, and the per-transaction cap, summed over every call in one operation, are checked in validation: a transaction outside them is rejected by the account itself before it becomes a valid operation, regardless of what any off-chain component approved. The rolling daily cap is checked in execution, because ERC-7562 forbids reading the current time during validation: a breach reverts, and the operation still pays gas. The x402 facilitator is not an allowlisted target; whether the cap covers x402 payments is the open question in section 13.
- **Owner-scoped reallocation only**: the reallocation contract, which replaces the reproduction contract of the superseded mechanism (`EVOLUTION.md` sections 3 and 3.6, labeled `reproduction` in the `ARCHITECTURE.md` section 16.1 allowlist type), moves capital only between two existing accounts with the same owner, only while that owner's signed reallocation policy is in force and names both agents, and only within the reallocation cap, capital floor, and slot ceiling. It checks all of these on-chain at execution time and creates no accounts.
- **Owner-controlled recovery**: the user's embedded wallet (Privy or Dynamic, per `ARCHITECTURE.md` section 6) is the smart account's owner. The owner can rotate or revoke the agent's session key, or sweep remaining funds out of a compromised agent's account, at any time, without needing the agent's own cooperation or the platform operator's intervention. Revocation is paymaster-sponsored outside the per-agent gas budget (`ARCHITECTURE.md` section 7), so neither a spent budget nor an account without MON delays it; only a paymaster outage combined with an account without MON does, and that state is reported, not hidden.

## 2. Agent permissions

Permissions are additive only by explicit, owner-authorized action, never automatically, and never in response to an incoming transfer. Security invariant 2 in `THREAT-MODEL.md` states this directly: receiving a token or NFT never changes an agent's spend limits, allowlist, or session-key scope. This is the direct, concrete answer to the real incident (`THREAT-MODEL.md` scenario B) where an unsolicited NFT transfer was treated as sufficient authorization to expand an agent's transaction-signing capability elsewhere; in this system, there is no code path that reads "received an asset" as an input to a permission decision at all.

A session key is scoped narrowly at issuance: it can invoke Kuru's router, the reallocation contract, and the settlement asset, and nothing else, within the smart account's own spend limits (section 1). By default it cannot sign for the account through ERC-1271, because the spend policy's signature check always fails; signing the x402 payment authorizations described in `ARCHITECTURE.md` section 16.3 would require the owner to set Kernel's skip-signature flag at install, which is the open question in that section, not a default. Scope is never widened by the agent's own request; widening a scope is a user action taken through the dashboard, mediated by the same WalletsModule that issued the key in the first place. The same holds for the reallocation policy: only the owner's root wallet signs it, it can only tighten the protocol bounds, and no agent can propose a change to it.

## 3. Smart contract security

Everything in this document that depends on "the smart account rejects out-of-policy transactions" depends on that validator module's implementation being correct. This document states the requirement rather than the proof:

- Contracts are built with Foundry, with unit, integration, fuzz, and invariant tests, per the brief's own testing requirements, before any testnet deployment.
- The specific invariants that must hold under fuzzing include, at minimum, every numbered invariant in `THREAT-MODEL.md` section 7, expressed as executable invariant tests, not just prose: spend-limit rejection, capital conservation across reallocation (invariant 3), the per-evaluation cap and capital floor on a source (invariant 4), the slot ceiling on a sink (invariant 12), and no capital crossing an owner boundary (invariant 13) are the most directly testable as contract-level invariants. Parent-capital-never-below-principal was the corresponding invariant of the superseded reproduction contract.
- An external audit is a gate before mainnet, not an optional step; `deploy-monad-mainnet` checklist practice applies here directly. No mainnet deployment carrying real user capital happens before an audit is complete and its findings are resolved or explicitly accepted as residual risk.
- The spend-policy contract (`contracts/src/AgentSpendPolicy.sol`) is flagged for external audit with a stricter gate: no deployment carrying real user-controlled capital, on testnet or mainnet, happens before that audit. Its tests express `THREAT-MODEL.md` invariant 1 as Foundry invariants over fuzzed operation sequences: no accepted operation counts more than `perTxCap`, no 24-hour period holds more than `dailyCap` of accepted spend, and no call outside the configured allowlist, or to the policy or the account itself, is accepted at any amount. Its audit package (`contracts/audit/README.md`, issue #46) holds the scope, the integration assumptions, the invariants mapped to tests, the coverage report, the static-analysis triage, the known limitations, and a draft request for proposal; no auditor is engaged yet.
- The owner-scoped reallocation contract specifically is the one most directly responsible for the capital-conservation and owner-boundary invariants; it receives disproportionate audit and fuzz-testing attention relative to its code size, because a bug there is the one place this document's core financial guarantees (`THREAT-MODEL.md` invariants 3 and 13) could actually be violated on-chain. Its fuzz targets include adversarial sequences: repeated calls inside one evaluation, a source and sink with different owners, a revoked or replaced policy, a retired agent as source or sink, and amounts at each bound.

## 4. AI security: separating proposal from authorization

This is the single most load-bearing control in the entire system, and it is structural, not a configuration setting. An agent's LLM reasoning step produces a **proposal**: an intended action, with a stated rationale. That proposal is evaluated by the **Policy/Risk Engine**, a deterministic, non-LLM component, against the agent's actual configured limits, asset allowlist, and the structural shape of the transaction itself (destination, amount, asset), independent of whatever justification the LLM attached to it. Only an approved proposal reaches the **execution** layer, and even there, the on-chain smart account's own validator (section 1) is a second, independent check that does not trust the Policy/Risk Engine's correctness either.

This three-stage separation exists because of a specific, repeated pattern in the two real incidents `THREAT-MODEL.md` documents: in both, the LLM's own judgment was the only safeguard, and in both, an attacker successfully argued the LLM into believing an unauthorized action was authorized. Concretely, the Policy/Risk Engine never evaluates "does this proposal sound legitimate"; it evaluates "is this destination in the allowlist, is this amount within the cap, is this asset in the agent's configured universe," questions with deterministic, structural answers that no amount of persuasive text in a prompt can change.

**Prompt injection posture**: every piece of text that reaches an agent's LLM context from outside the platform's own code, an x402 API response body, an on-chain string field, a future agent-to-agent message, is treated as untrusted input by default, following both Monad's own stated guidance ("every attacker-influenced value you return, store, or log is live input") and the industry pattern of scanning untrusted content that enters a model's context window for adversarial instructions before it is used. This is a defense-in-depth measure on top of, not a substitute for, the structural policy-engine check above; the policy engine's guarantee does not depend on prompt-injection defenses working, because it never trusts the LLM's conclusions in the first place, only the injection-scanning layer is what keeps an agent's actual decision quality from being degraded by manipulated input, which matters for the fitness metric even when it cannot matter for fund safety.

## 5. x402 security

- **Provider allowlist, not open discovery**, for the MVP: the agent worker's x402 client is restricted to two named, manually vetted providers, Nansen and DeFiLlama, closing off the discovery-layer manipulation attack `THREAT-MODEL.md` scenario C describes by construction rather than by runtime scoring. Expanding this list is a deliberate, reviewed action, not something an agent's own genome or reasoning can do on its own.
- **Per-resource idempotency tracking on the client side**, never assumed from the provider or facilitator: the x402 client records which resource identifiers it has already paid for in the current window and treats a repeated or duplicate grant as an anomaly to log, not to silently accept, mitigating the replay pattern documented against x402 generally.
- **No caching of paid responses at any intermediary the platform controls**, explicit `no-store` discipline on every HTTP path that touches a paid x402 response, directly closing the cache-leakage pattern documented against x402's HTTP-layer implementation.
- **Every x402 payment is logged with its outcome**: provider, price, response summary, and whether the response changed the agent's subsequent decision. This is both a cost-accounting requirement (feeds the fitness function in `EVOLUTION.md`) and a security-monitoring input (section 9 below).

## 6. External API security

Every external response, from an x402 provider or otherwise, is validated against an expected schema before any part of it is used in an agent's reasoning or stored. A malformed or unexpected response is treated as a failed call (see section 8), not partially trusted. This applies even to the two allowlisted providers: allowlisting establishes that a provider was chosen deliberately, not that every individual response from it is trustworthy content rather than untrusted input.

**Tool poisoning, considered separately.** A malicious API response (section 5 and the paragraph above) attacks the data a tool returns. Tool poisoning attacks the tool itself: the description, parameter schema, or metadata an agent reads to decide *which* tool to call and *how*, so the agent misuses a legitimate tool, for example the x402 client or the trading interface, without any direct bypass of a financial permission. It matters most where tool definitions come from a third party at runtime, such as an open tool registry or a provider's self-description. The MVP closes that surface by construction rather than by runtime scanning, with two rules. First, every tool definition an agent's LLM sees is static and versioned in this repository, never loaded from a provider, registry, or discovery service at runtime. Second, descriptive text a provider supplies alongside a payment request or a response never enters the LLM context; only the validated, typed fields do. A poisoned tool could still degrade decision quality, but it cannot move capital outside policy, because a tool call is only ever a proposal to the Policy/Risk Engine (section 4). Admitting third-party tools, for example external MCP servers or an open x402 discovery layer, reopens this surface and requires revisiting this paragraph first.

## 7. Transaction security

- **Structural validation before signing**: the Policy/Risk Engine checks that a proposed transaction's asset exists in the agent's allowed universe, its amount is within configured bounds, and its destination is in the allowlist, independent of the LLM's stated reasoning. This is the direct mitigation for `THREAT-MODEL.md` scenario F, a hallucinated or malformed transaction proposal, a risk category this project found no established external prior art for and is defending against with a first-principles structural check rather than a borrowed pattern.
- **Idempotency keyed to (agent ID, tick sequence number)** on every job the agent worker processes, so a worker crash and retry cannot double-submit a trade or a payment; see `ARCHITECTURE.md` section 14.
- **Gas-limit awareness**: Monad charges gas based on the submitted gas limit, not gas actually used, a documented, non-obvious difference from Ethereum. The transaction-building layer estimates gas limits deliberately rather than padding generously "for safety," since over-padding directly costs more MON on Monad in a way it would not on Ethereum.
- **Funding step** (`ARCHITECTURE.md` section 6.1, `THREAT-MODEL.md` scenario H and invariant 16): the API sets an on-ramp session's destination to the authenticated user's own embedded wallet and locks the asset to USDC on Monad; the client cannot supply either. The on-ramp opens only from inside the app, and the product never sends funding links by email or message. A balance is credited only from an observed on-chain transfer of the canonical USDC contract; the vendor's webhook is verified and used for progress display only. The allocation authorization is built by the API for an agent smart account address the API has derived and checked belongs to the user, and the relayer submits exactly what the user signed. Relayed allocations are capped per user per day (`ARCHITECTURE.md` section 7).

## 8. Fail-closed behavior

Stated once, applied everywhere: any state where the system cannot determine whether a proposed action is within policy does not execute the action. A timed-out RPC call, a malformed API response, an ambiguous account state, a worker that crashed mid-decision, none of these are treated as "probably fine, proceed." Each is treated as a failed tick: no action taken, logged, retried on the next scheduled cycle. This is `THREAT-MODEL.md` invariant 10 restated as an operating rule rather than a proof obligation.

## 9. Emergency controls and circuit breakers

A layered-cap pattern, matching the production precedent found in research (Coinbase's Agentic Wallets enforces spending policy at the smart-contract level specifically so an agent cannot exceed its limit even if application logic is compromised):

1. **Per-transaction and per-day caps, on-chain, per agent** (section 1). No application bug or compromised worker process can exceed these, because the chain itself rejects the transaction.
2. **A session-level budget enforced by the Policy/Risk Engine**, tighter than the on-chain cap, evaluated before a transaction is even submitted. This catches problems earlier than the on-chain layer, at the cost of being bypassable if the application layer itself is compromised, which is exactly why layer 1 exists independently.
3. **An aggregate, population-level circuit breaker**, tracking total capital at risk across all live agents and the aggregate capital moved by reallocation per evaluation. If either crosses a configured threshold, this is the platform-wide equivalent of a kill switch: new agent ticks stop being scheduled, and reallocation is paused, until a human reviews and clears the condition. This is the control that specifically answers `THREAT-MODEL.md` scenario D, capital drifting toward a strategy whose risk the fitness metric does not capture; no single agent's individual spend limit catches a slow, population-wide drift toward a bad strategy, only an aggregate view can. (Under the superseded reproduction mechanism the second signal was the aggregate reproduction rate.)
4. **Manual, immediate per-agent stop**: the user can retire any agent from the dashboard at any time, which revokes its session key immediately (section 1); the operator can do the same for any agent platform-wide in an incident.

### Bulk recovery hold

The owner path in section 1 (revoke, rotate, or sweep) stays immediate for one agent. It does not stay immediate when one root wallet would touch many agents in a short window. A phished or otherwise compromised root credential could otherwise revoke or sweep every agent that owner controls in one session. That is the same blast-radius shape as layer 3 above, with credential compromise in place of a degenerate strategy. The application hold below is implemented in `libs/recovery`. Chain-level enforcement of the same rule still belongs to the wallet and validator work (issues #24 and #25). The thresholds are proposed defaults, not a claim that these exact numbers have been measured.

- Count the distinct agent accounts a root wallet has revoked or swept during the last 60 minutes.
- An action that names exactly one agent executes immediately when the count, including that agent, is still 3 or lower.
- An action that names two or more agents is held. It does not execute.
- An action that names one agent, but would push the distinct-agent count above 3 inside the window, is held. It does not execute.
- A held action notifies the user and lists the agents it would affect. Releasing it takes a second explicit confirmation that restates how many agents are affected, followed by a 15 minute delay, and only then execution.
- A legitimate owner who wants to retire every agent can still do it. They confirm the count and wait 15 minutes. They do not get a path that skips the hold.
- A single revoke or sweep does not wait. Revoking agent A, and revoking agent B an hour later, both execute at once. Revoking A, then B, then C inside the same hour still executes. The request that would touch a fourth distinct agent, or any request that names two agents at once, waits.

## 10. Operating modes

The product runs in one of three modes. This section assembles the controls `BRIEF.md` requires for each mode and points at the document that already specifies the mechanism. It does not add a control.

### Simulation

No real money moves. Inputs are historical or synthetic. A run with a given seed is deterministic. Market conditions, costs, and strategy parameters are configurable.

- No real money, and no wallets or chain state: `BRIEF.md` (Simulation engine) and `ARCHITECTURE.md` section 10 (`SimulationModule`).
- Deterministic historical or synthetic markets: `ECONOMICS.md` sections 3 and 7, and `BRIEF.md` (Simulation engine).
- Configurable conditions: `BRIEF.md` (Simulation engine) and the cost inputs in `ECONOMICS.md` section 1.

### Testnet

Testnet uses real testnet assets. It exists to validate the paths mainnet will use.

- Wallets and smart accounts: `ARCHITECTURE.md` section 6.
- x402: `ARCHITECTURE.md` section 8 and section 5 of this document.
- Reallocation and retirement: `EVOLUTION.md` sections 3 and 6.
- Accounting: `ECONOMICS.md` section 2. Reallocation moves capital that already exists between one owner's agents. It does not create capital, and it never crosses owners.
- Trading: `ARCHITECTURE.md` section 10 (`TradingModule`).
- Policies: sections 1 and 4 of this document.

### Mainnet

Mainnet is opt-in per user and per agent. It is never the default, and unrestricted autonomous mainnet trading is not a mode of this system.

Opt-in is two stored flags, `user.mainnetEnabled` and `agent.mainnetEnabled`. Both default to false. An agent may execute on mainnet only when both are true. Each flag changes only by an explicit action of the root-wallet owner, and that action is stored with its timestamp. Funding an agent, deploying its smart account, or finishing a testnet run does not set either flag. A missing flag is not mainnet.

`BRIEF.md` requires the following controls on mainnet. Each one is already specified elsewhere:

- Spending limits: section 1 (per-transaction cap and rolling daily cap) and the tighter session budget in section 9.
- Position limits: `EVOLUTION.md` section 1, the protocol ceiling on `riskTolerance`.
- Loss limits: the rolling daily spend cap in section 1, the population-level capital-at-risk circuit breaker in section 9, and the minimum viable capital floor in `EVOLUTION.md` section 6. Those three are the loss controls the document set actually specifies. There is no separate maximum-drawdown parameter beside them.
- API budgets: `informationBudget` in `EVOLUTION.md` section 1, and the per-tick and daily x402 budget in `ARCHITECTURE.md` section 3.
- Gas budgets: the per-agent paymaster budget in `ARCHITECTURE.md` section 7. Session-key revocation is sponsored outside it, so a spent budget never blocks the emergency stop; past the budget, other operations pay gas in native MON from the agent's account.
- Reallocation limits: the reallocation cap, capital floor, slot ceiling, and owner policy in `EVOLUTION.md` sections 3.1 and 4. (The superseded reproduction limits, eligibility, `max_child_capital`, and the per-parent descendant cap, are in `EVOLUTION.md` sections 3.6 and 4.)
- A maximum population: the global population cap in `EVOLUTION.md` section 4.
- An allowlist of permitted contracts: section 1 of this document.
- An emergency stop: section 9 of this document (the population circuit breaker, and the immediate per-agent stop).
- Withdrawal controls: `ARCHITECTURE.md` section 3 (a withdrawal back to the user stays inside the user's configured limits) and section 1 of this document (the owner can sweep a compromised agent's account).

## 11. Key management

- **User root keys**: never held by the platform. The embedded wallet vendor (Privy or Dynamic) manages the user's own key material under its own custody model; the platform never has access to the user's root signing key.
- **On-ramp data**: card details and identity documents are collected by the on-ramp vendor inside its own widget (`ARCHITECTURE.md` section 6.1). The platform does not receive or store them; it stores only the vendor's order identifier and status. The vendor API key is a secret under the rule below.
- **Allocation relayer key**: the platform relayer that submits users' EIP-3009 allocation authorizations holds MON for gas only, never user funds, and is funded no further than its capped budget. It cannot alter an authorization's recipient or amount, which the user's signature fixes.
- **Agent session keys**: held server-side by agent worker processes, scoped narrowly (section 2), rotated on a schedule and immediately on any suspected compromise, and revocable by the user at any time without needing platform operator action.
- **No private key, of any kind, is ever committed to source control, logged in plaintext, or stored outside the vendor's own key-management infrastructure or a dedicated secrets manager.** This is a hard rule, not a preference, and applies equally to development, testnet, and mainnet environments.

## 12. Monitoring

Every agent action, decision, x402 payment, transaction, trade, error, capital change, fitness change, reallocation, retirement, and reallocation policy change is logged with enough detail to reconstruct what happened without reading raw logs, feeding the dashboard views defined in `ARCHITECTURE.md` section 15. Specific patterns monitored for anomaly, beyond simple logging:

- An agent whose x402 spend pattern changes sharply (for instance, paying the same provider on every tick regardless of whether it changes the agent's decision) is flagged, since this is one of the concrete signals a compromised or degenerate agent could produce.
- An agent approaching its on-chain spend cap repeatedly without breaching it is flagged as worth reviewing, since it suggests the on-chain cap is doing load-bearing work that the application-layer policy engine's own tighter budget should ideally have caught first. The spend-policy contract's `Spent` event carries each operation's counted amount and the resulting window total, and `windowTotal` can be read at any time, so this signal can come from the chain rather than from the application's own ledger.
- Reallocations are monitored in aggregate for volume anomalies (section 9, layer 3) and individually against their bounds: a move between different owners, without a policy in force, above the cap, below the floor, above the ceiling, or involving a retired agent should be structurally impossible if the planner and the contract are implemented correctly, and a revert or a ledger record showing one is alerted on immediately.
- A genome whose on-chain hash does not match its off-chain record, or any write to a live agent's genome, is alerted on immediately, since genomes are fixed at creation (`EVOLUTION.md` section 3.1).
- An owner whose capital is repeatedly concentrated at the slot ceiling in one agent is flagged for review, since that is where reallocation amplifies one strategy's tail risk most (`THREAT-MODEL.md` scenario D).

## 13. Known limitations

Stated honestly, matching `THREAT-MODEL.md` section 8's residual-risk posture:

- The on-chain spend-limit validator module described throughout this document is written (`contracts/src/AgentSpendPolicy.sol`, issue #25) and has Foundry unit, fuzz, and invariant tests, but it is not audited and not deployed. Its Kernel v3.1 integration has been checked against Kernel's source, a test double, and the Kernel v3.1 contracts deployed on Monad testnet through a fork test, not yet through a bundler (`ARCHITECTURE.md` section 16.3). Every guarantee in sections 1, 4, and 9 that depends on it is provisional until that integration runs through a bundler on an account and the contract passes the audit gate in section 3. Its full known-limitations list is in `contracts/audit/README.md` section 8.
- Section 1 says an out-of-bounds transaction is rejected before it becomes a valid operation. That holds for the allowlist, the recipient rule, and the per-transaction cap. It may not hold for the rolling daily cap: ERC-7562's validation rules forbid reading the current time during validation, so the interface in `ARCHITECTURE.md` section 16.3 checks the daily cap in the execution phase, where a breach reverts but still pays gas. Issue #18's testnet run found no native ZeroDev mechanism that changes this: the closest native combination neither bounds batched operations nor rolls, per `ARCHITECTURE.md` section 16.3, so the rolling daily cap depends entirely on the custom spend-policy contract.
- If x402 payments settle through a signed EIP-3009 authorization, as `ARCHITECTURE.md` section 16.3 assumes but has not verified, they bypass user-operation validation, and the on-chain daily cap does not bound them until the spend policy covers the account's ERC-1271 signature path. Until then, only the application-layer information caps bound x402 spend. The spend policy blocks a session key's ERC-1271 signatures by default, and the opt-out, Kernel's skip-signature flag, would expose more than x402: Monad mainnet's USDC appears to accept ERC-1271 signatures for `transferWithAuthorization` and `permit` (checked 2026-10-10 through its revert reasons, `contracts/audit/README.md` section 8), so a session key with that flag could authorize a transfer or approval of the whole balance to any address. The flag is not set for any agent until the policy bounds that path.
- The on-chain recipient rule (`ARCHITECTURE.md` section 16.3) stops a compromised session key from paying the settlement asset to an address of its choosing, but only through `check`. It does not see calls that count 0: whether Kuru's router can be made to forward funds to an arbitrary address is a property of the router, not yet checked (issue #20). It does not see x402 payments either, per the item above. Within those limits, a compromised key can still lose funds up to the caps through bad trades or misplace them through a bounded reallocation, but it cannot transfer them to itself directly, and a reallocation it pushes stays inside the owner's agents and the contract's bounds.
- The reallocation ranking is computed off-chain and is not verifiable on-chain; a corrupted ranking can misdirect capital among one owner's agents within the contract's bounds (`THREAT-MODEL.md` section 8).
- No production incident exists for the selection-specific attack surface this project is building; the mitigations in section 9's layer 3 and `EVOLUTION.md`'s protocol-immutable parameters are the best defense this research phase could ground in evidence, not a proven-in-production control.
- The funding controls in section 7 are specified, not built. Two of their premises are unverified: that a relayed EIP-3009 `transferWithAuthorization` succeeds on Monad's USDC contract (the contract exposes the type hashes; no call has been executed), and that the on-ramp vendor's destination lock cannot be changed by the user inside the widget. The vendor holds the user's money between card payment and delivery; a vendor failure in that window is outside this system's control, and is visible to the user only through the vendor's own status.
- This document does not model a fully adversarial platform operator; the operator is trusted for the MVP, per `THREAT-MODEL.md`'s stated non-goals.
- The MVP's provider allowlist (section 5) closes off x402 discovery-layer risk by narrowing scope, not by building a robust discovery-security layer; expanding the provider list in the future re-opens that surface and requires revisiting this section before it happens, not after.
- Kuru's router sits on the same capital-moving allowlist as the reallocation contract and the settlement asset (section 1). As of 2026-09-22, Kuru's own documentation says its core contracts are audited and links Spearbit and Cantina reports, plus post-fix reviews and a Kuru Flow review (`https://docs.kuru.io/contracts/Audits`). This repository has not read those reports, and has not checked that the allowlisted bytecode matches what those reports covered. CertiK's public project page, checked the same day, still lists no third-party audit. Until the reports are read and matched to the contracts this system would actually call, Kuru's audit status is unconfirmed for our purposes, and that is a residual risk of the allowlist model.
