# SECURITY.md

Concrete security controls for Monadeum, implementing the mitigations `THREAT-MODEL.md` points to. That document enumerates what can go wrong and why; this one states what specifically prevents it. Where a control is not yet built, that is stated as a known limitation, not implied to already exist.

---

## 1. Wallet security

Each agent has its own ERC-4337 smart account on Monad, per `ARCHITECTURE.md` section 6. Two controls apply specifically to the account itself, independent of anything the application layer does:

- **On-chain spend-limit validator module**: every agent's smart account enforces a per-transaction cap, a rolling daily cap, and a contract allowlist (the x402 facilitator, Kuru's router, and the reproduction contract, nothing else) at the validator level. A transaction outside these bounds is rejected by the account itself, before it reaches Monad's mempool as a valid operation, regardless of what any off-chain component approved.
- **Owner-controlled recovery**: the user's embedded wallet (Privy or Dynamic, per `ARCHITECTURE.md` section 6) is the smart account's owner. The owner can rotate or revoke the agent's session key, or sweep remaining funds out of a compromised agent's account, at any time, without needing the agent's own cooperation or the platform operator's intervention.

## 2. Agent permissions

Permissions are additive only by explicit, owner-authorized action, never automatically, and never in response to an incoming transfer. Security invariant 2 in `THREAT-MODEL.md` states this directly: receiving a token or NFT never changes an agent's spend limits, allowlist, or session-key scope. This is the direct, concrete answer to the real incident (`THREAT-MODEL.md` scenario B) where an unsolicited NFT transfer was treated as sufficient authorization to expand an agent's transaction-signing capability elsewhere; in this system, there is no code path that reads "received an asset" as an input to a permission decision at all.

A session key is scoped narrowly at issuance: it can invoke the x402 facilitator, Kuru's router, and the reproduction contract, and nothing else, within the smart account's own spend limits (section 1). Scope is never widened by the agent's own request; widening a scope is a user action taken through the dashboard, mediated by the same WalletsModule that issued the key in the first place.

## 3. Smart contract security

Everything in this document that depends on "the smart account rejects out-of-policy transactions" depends on that validator module's implementation being correct. This document states the requirement rather than the proof:

- Contracts are built with Foundry, with unit, integration, fuzz, and invariant tests, per the brief's own testing requirements, before any testnet deployment.
- The specific invariants that must hold under fuzzing include, at minimum, every numbered invariant in `THREAT-MODEL.md` section 7, expressed as executable invariant tests, not just prose: spend-limit rejection, capital conservation across reproduction, and parent-capital-never-below-principal are the three most directly testable as contract-level invariants.
- An external audit is a gate before mainnet, not an optional step; `deploy-monad-mainnet` checklist practice applies here directly. No mainnet deployment carrying real user capital happens before an audit is complete and its findings are resolved or explicitly accepted as residual risk.
- The reproduction contract specifically is the one most directly responsible for the capital-conservation invariant; it receives disproportionate audit and fuzz-testing attention relative to its code size, because a bug there is the one place this document's core financial guarantee (`THREAT-MODEL.md` invariant 3) could actually be violated on-chain.

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

## 7. Transaction security

- **Structural validation before signing**: the Policy/Risk Engine checks that a proposed transaction's asset exists in the agent's allowed universe, its amount is within configured bounds, and its destination is in the allowlist, independent of the LLM's stated reasoning. This is the direct mitigation for `THREAT-MODEL.md` scenario F, a hallucinated or malformed transaction proposal, a risk category this project found no established external prior art for and is defending against with a first-principles structural check rather than a borrowed pattern.
- **Idempotency keyed to (agent ID, tick sequence number)** on every job the agent worker processes, so a worker crash and retry cannot double-submit a trade or a payment; see `ARCHITECTURE.md` section 14.
- **Gas-limit awareness**: Monad charges gas based on the submitted gas limit, not gas actually used, a documented, non-obvious difference from Ethereum. The transaction-building layer estimates gas limits deliberately rather than padding generously "for safety," since over-padding directly costs more MON on Monad in a way it would not on Ethereum.

## 8. Fail-closed behavior

Stated once, applied everywhere: any state where the system cannot determine whether a proposed action is within policy does not execute the action. A timed-out RPC call, a malformed API response, an ambiguous account state, a worker that crashed mid-decision, none of these are treated as "probably fine, proceed." Each is treated as a failed tick: no action taken, logged, retried on the next scheduled cycle. This is `THREAT-MODEL.md` invariant 10 restated as an operating rule rather than a proof obligation.

## 9. Emergency controls and circuit breakers

A layered-cap pattern, matching the production precedent found in research (Coinbase's Agentic Wallets enforces spending policy at the smart-contract level specifically so an agent cannot exceed its limit even if application logic is compromised):

1. **Per-transaction and per-day caps, on-chain, per agent** (section 1). No application bug or compromised worker process can exceed these, because the chain itself rejects the transaction.
2. **A session-level budget enforced by the Policy/Risk Engine**, tighter than the on-chain cap, evaluated before a transaction is even submitted. This catches problems earlier than the on-chain layer, at the cost of being bypassable if the application layer itself is compromised, which is exactly why layer 1 exists independently.
3. **An aggregate, population-level circuit breaker**, tracking total capital at risk across all live agents and the population's aggregate reproduction rate. If either crosses a configured threshold, this the platform-wide equivalent of a kill switch: new agent ticks stop being scheduled, and reproduction is paused, until a human reviews and clears the condition. This is the control that specifically answers `THREAT-MODEL.md` scenario D, a degenerate mutation spreading through the population; no single agent's individual spend limit catches a slow, population-wide drift toward a bad strategy, only an aggregate view can.
4. **Manual, immediate per-agent stop**: the user can retire any agent from the dashboard at any time, which revokes its session key immediately (section 1); the operator can do the same for any agent platform-wide in an incident.

## 10. Key management

- **User root keys**: never held by the platform. The embedded wallet vendor (Privy or Dynamic) manages the user's own key material under its own custody model; the platform never has access to the user's root signing key.
- **Agent session keys**: held server-side by agent worker processes, scoped narrowly (section 2), rotated on a schedule and immediately on any suspected compromise, and revocable by the user at any time without needing platform operator action.
- **No private key, of any kind, is ever committed to source control, logged in plaintext, or stored outside the vendor's own key-management infrastructure or a dedicated secrets manager.** This is a hard rule, not a preference, and applies equally to development, testnet, and mainnet environments.

## 11. Monitoring

Every agent action, decision, x402 payment, transaction, trade, error, capital change, fitness change, reproduction event, and mutation is logged with enough detail to reconstruct what happened without reading raw logs, feeding the dashboard views defined in `ARCHITECTURE.md` section 15. Specific patterns monitored for anomaly, beyond simple logging:

- An agent whose x402 spend pattern changes sharply (for instance, paying the same provider on every tick regardless of whether it changes the agent's decision) is flagged, since this is one of the concrete signals a compromised or degenerate agent could produce.
- An agent approaching its on-chain spend cap repeatedly without breaching it is flagged as worth reviewing, since it suggests the on-chain cap is doing load-bearing work that the application-layer policy engine's own tighter budget should ideally have caught first.
- Reproduction events are monitored in aggregate for rate anomalies (section 9, layer 3) and individually for whether a child's mutated genome falls outside the bounds `EVOLUTION.md` section 3.3 defines, which should be structurally impossible if the mutation operator is implemented correctly, and therefore worth alerting on immediately if it is ever observed.

## 12. Known limitations

Stated honestly, matching `THREAT-MODEL.md` section 8's residual-risk posture:

- The on-chain spend-limit validator module described throughout this document is a requirement this document states, not a contract that has been written, tested, or audited yet. Every guarantee in sections 1, 4, and 9 that depends on it is provisional until that contract exists and passes the process in section 3.
- No production incident exists for the reproduction-specific attack surface this project is building; the mitigations in section 9's layer 3 and `EVOLUTION.md`'s protocol-immutable parameters are the best defense this research phase could ground in evidence, not a proven-in-production control.
- This document does not model a fully adversarial platform operator; the operator is trusted for the MVP, per `THREAT-MODEL.md`'s stated non-goals.
- The MVP's provider allowlist (section 5) closes off x402 discovery-layer risk by narrowing scope, not by building a robust discovery-security layer; expanding the provider list in the future re-opens that surface and requires revisiting this section before it happens, not after.
