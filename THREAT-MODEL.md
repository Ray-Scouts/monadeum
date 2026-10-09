# THREAT-MODEL.md

A project-specific threat model for Monadeum, not a generic checklist. Every scenario below is grounded either in a real, documented incident involving an AI agent controlling crypto funds, or in a specific, cited attack class against a component this project actually uses (x402, self-evolving agent systems). Where no prior art exists for a risk category, that gap is stated plainly rather than filled with borrowed material that does not actually cover it.

See `SECURITY.md` for the concrete controls that implement the mitigations referenced here, and `ARCHITECTURE.md` for the component boundaries this document assumes.

---

## 1. Assets

1. **User capital**, held in each agent's own smart account. The primary asset, and the one every other item in this list exists to protect.
2. **The platform's gas-sponsorship (paymaster) budget.** A cost center that can be drained independently of any agent's own trading capital if left unbounded.
3. **Agent identity and reputation**, recorded on-chain in an ERC-8004-compatible registry: ownership, lineage, generation, status.
4. **Off-chain accounting and history** (PostgreSQL): fitness scores, trade logs, x402 payment logs, LLM reasoning traces. Its integrity matters because reproduction eligibility decisions are computed from it.
5. **Session keys**, held server-side by agent worker processes, scoped to one agent's smart account each.
6. **The user's root embedded wallet and social-login credential**, which owns and can recover every agent's smart account.
7. **The evolutionary mechanism itself**: the mutation operator and the protocol-level parameters that bound it. Its integrity determines whether every other invariant in this document continues to hold across generations, not just at a single point in time.

## 2. Actors

- **The user**: creates, funds, and can retire agents; owns the root wallet that ultimately controls every agent's smart account.
- **An agent**: autonomous within its configured limits, but never fully trusted; its own LLM reasoning is explicitly not a source of authorization (see boundary 1 below).
- **The platform operator**: runs the API, the agent workers, and the paymaster. Trusted for the MVP threat model (see Non-goals); a fully adversarial-operator model is future work.
- **x402 API Hub providers and gateways** (Orthogonal, Monid, and any first-party provider such as Nansen or DeFiLlama): untrusted external parties by default. Monad's own documentation explicitly disclaims vetting them; this project adopts that same posture rather than a more trusting one.
- **Other agents**: peers in the population. In the MVP scope they do not transact with each other directly, but they are visible to each other via on-chain state, which is itself a surface (see Scenario D).
- **An external attacker**: no privileged access to the platform; interacts only through public surfaces, crafted x402 responses, on-chain data, or unsolicited transfers to a public agent address.
- **Third-party infrastructure**: the x402 facilitator, RPC providers, and ERC-4337 bundler/paymaster vendors. Their compromise or outage is a real dependency risk this project inherits rather than controls directly.

## 3. Trust boundaries

1. **LLM reasoning to Policy/Risk Engine.** The LLM's output is a proposal, never an authorization. Nothing downstream trusts the LLM's own claim that an action is safe, approved, or urgent.
2. **Application-layer Policy/Risk Engine to on-chain smart account validator.** The app-layer engine is not trusted as the sole enforcement point. This boundary exists specifically because research into self-evolving agent systems found that a policy layer subject to the same evolutionary or application-bug risk as everything else around it is not a reliable sole guarantee; the on-chain layer must hold even if the app layer is fully compromised.
3. **Agent worker to any external x402 API response.** Every response is untrusted input, not just to the immediate call, but to anything it is later stored, logged, or fed back into a prompt for. This directly follows Monad's own guidance (from its secure-coding blog post) that "every attacker-influenced value you return, store, or log is live input" to whatever consumes it next.
4. **Agent smart account to arbitrary external addresses and contracts.** Bounded by an explicit contract allowlist; there is no default-allow path.
5. **Parent genome and capital to child genome and capital, at reproduction.** Mutation only touches genome fields, never protocol parameters; capital transfer is bounded and one-directional, parent to child, never the reverse.
6. **User's root wallet to a per-agent session key.** Revocable at any time by the owner, independent of the agent's own state or cooperation.
7. **Off-chain Postgres record to on-chain commitment.** Postgres is a read-model, not a source of truth for identity or capital; anything security-critical is verifiable against an on-chain hash or event, not trusted from the database alone.
8. **One agent to another agent.** No shared mutable state and no direct fund-transfer path between sibling agents outside the reproduction mechanism itself, in the MVP scope.
9. **Platform paymaster budget to individual agent gas consumption.** Capped per agent, per `ARCHITECTURE.md` section 7, so one agent's behavior cannot exhaust the shared sponsorship pool for every other agent.
10. **Frontend to backend API.** The frontend is trusted to render state and to capture user intent and input. It is never trusted for an authorization decision. The API treats every request as coming from an untrusted client: it authenticates the caller itself, re-derives ownership (whether this root wallet owns this agent) from its own records and the chain rather than from a field in the request, and re-validates every value the frontend sends, such as a requested spend limit, a funding amount, or an agent ID. A request that reaches an agent's capital also passes the Policy/Risk Engine and the on-chain validator, exactly as if the frontend did not exist. A check the frontend performs (a disabled button, a client-side limit) is a convenience for the user, never a control. If the API cannot independently verify something the frontend claims, it does not act on the claim.

## 4. Attacker capabilities

What an external attacker, with no privileged access, can actually do against this system:

- Craft or serve a malicious x402 API response, or operate a fake provider or gateway entirely; Monad's own API Hub disclaims vetting its listed services, so this is not a hardened surface by default.
- Attempt to bias which information provider an agent selects, via metadata manipulation or Sybil-registered listings. A formal study of x402 (arXiv:2605.11781) measured selection bias as high as roughly 72 percent from metadata manipulation alone against this exact discovery-layer pattern.
- Attempt HTTP-layer replay or cache-poisoning of an x402 payment header against any intermediary that does not enforce idempotency or cache-control discipline; the same study measured 248 HTTP-layer resource grants extracted from a single real on-chain payment in one trial.
- Send an unsolicited on-chain transfer, a token or an NFT, directly to an agent's public smart account address. This is not a hypothetical: it is the exact vector used in a real 2026 incident where an NFT transfer was treated as sufficient to expand an AI agent's transaction-signing authority, leading to a loss of roughly $150,000 to $200,000.
- Attempt prompt injection via any text that reaches an agent's LLM context: an x402 response body, an on-chain string field (a token name or symbol), or, once enabled post-MVP, another agent's message.
- **Cannot** directly invoke an agent's smart account's privileged functions without either the session key or the owner's signature, assuming the validator module is implemented correctly. This is the boundary the entire wallet architecture in `ARCHITECTURE.md` is built to hold, and its correctness is a smart-contract security question this document does not itself resolve (see Residual risk).
- **Cannot** mint capital. Every attack path here is about manipulating an agent into misusing capital it already custodies, not about creating new capital.
- If an attacker compromises or operates a piece of shared infrastructure (the facilitator, a bundler, an RPC provider), they may be able to manipulate settlement timing rather than needing to compromise any individual agent; the same x402 study documented a "settlement preemption" attack with a measured revert-grant rate up to 5.18 percent under realistic reorg conditions.

## 5. Attack surfaces

1. The x402 payment and response path (agent worker to facilitator to external provider).
2. LLM prompt and context assembly, anything that ends up in an agent's reasoning input.
3. Smart account transaction construction and session-key signing.
4. The reproduction pipeline: genome mutation and the capital transfer it triggers.
5. Unsolicited on-chain transfers to an agent's public address.
6. The RPC and indexer data path, what the dashboard and the workers believe is true about on-chain state.
7. The paymaster's gas-sponsorship budget.
8. Off-chain Postgres records that feed reproduction-eligibility decisions.

## 6. Attack scenarios

### Scenario A: fake-authorization prompt injection (the Freysa pattern)

An x402 response, or any other text reaching the agent's context, contains a crafted instruction framed as a system or admin override, attempting to convince the agent's reasoning that an action outside its normal strategy is authorized. This is not hypothetical: in a real November 2024 incident, an attacker reframed an AI agent's own `approveTransfer` function via a fake "admin session," and the agent released its entire balance, 13.19 ETH, approximately $47,316, because the LLM's own judgment was the only safeguard.

**Consequence if unmitigated**: the agent proposes an out-of-policy action, believing it is authorized.

**Mitigation**: the Policy/Risk Engine evaluates the structural facts of a proposed transaction, destination, amount, asset, against the agent's actual configured limits and allowlist. A claim of authorization inside the LLM's own reasoning trace is never itself a signal the engine trusts; only the transaction's own shape is.

### Scenario B: unsolicited-transfer permission escalation (the Grok/Bankrbot pattern)

An attacker sends a token or NFT directly to an agent's smart account. If any part of the system treats "received an asset" as a signal to expand that agent's permissions, the attacker gains leverage without needing to compromise anything else. This happened in a real incident around May 2026: an NFT transfer was treated as sufficient authorization to unlock transfer and swap capability the agent previously did not have, and a malicious instruction, delivered in Morse code to evade content filters, then moved roughly $150,000 to $200,000 out of the wallet.

**Consequence if unmitigated**: expanded transaction authority granted from an untrusted, attacker-controlled event, with no independent approval step.

**Mitigation**: security invariant 2 (section 7 below) states this directly: receiving any asset never changes an agent's permissions, spend limits, or session-key scope by itself. Permission changes are a distinct, explicit, owner-authorized action only.

### Scenario C: x402 discovery-layer manipulation

A malicious or Sybil-registered information provider biases which service an agent selects, feeding it a manipulated signal intended to trigger a specific trade, without touching the wallet or settlement layer at all.

**Consequence if unmitigated**: the agent trades on manipulated information, a direct financial loss that looks, from the outside, like an ordinary bad trade rather than an attack.

**Mitigation**: the MVP does not use an open discovery layer at all. Information sources are restricted to two specifically named, manually vetted providers, closing off this surface by construction rather than by runtime defense, at the cost of a narrower information economy than the product's long-term vision. This tradeoff is explicit, in `ARCHITECTURE.md` section 8.

### Scenario D: reproduction-triggered erosion of safety constraints

A mutation, random or otherwise, produces a child genome that maximizes the fitness metric while degrading something the metric does not fully capture, for instance an aggressive position-sizing mutation that wins on raw risk-adjusted return in one market regime but carries real tail risk the sample window did not include. In the worst case, a bug or exploit attempts to have the mutation process touch protocol-level parameters (spend caps, reproduction thresholds) rather than genome fields. A formal analysis of self-evolving LLM agent systems names this general pattern the "optimizer-optimizee collapse," and in its own empirical case study found an evolution-native framework achieved 100 percent attack persistence against its own co-located security scanner, which blocked only 2.5 percent of the same attacks.

**Consequence if unmitigated**: fitness-maximizing but economically degenerate strategies propagate and multiply through the population across generations, potentially without any single transaction looking obviously wrong in isolation.

**Mitigation**: protocol-level parameters are hard-coded outside the genome and outside the mutation operator's reach entirely (`EVOLUTION.md` section 0), and an aggregate, population-level circuit breaker can halt the system based on total capital at risk or reproduction rate, independent of any single agent's individual behavior (`SECURITY.md`).

### Scenario E: settlement race or replay against the x402 payment flow

An intermediary or attacker races to settle a payment authorization ahead of the legitimate facilitator, or replays a payment header to extract multiple resource grants from one on-chain payment.

**Consequence if unmitigated**: the agent's own accounting is corrupted, either charged without receiving a paid resource, or a resource-grant record that does not correspond to a real payment, either way feeding wrong data into the cost side of the fitness function.

**Mitigation**: the agent worker's own x402 client enforces per-resource idempotency tracking independently, never assuming a provider enforces it correctly, and logs any payment-without-response or suspiciously repeated response as an anomaly rather than silently retrying.

### Scenario F: hallucinated or malformed transaction proposal

The LLM proposes an action referencing a nonexistent asset, a wrong amount or decimals, or a call to a contract outside the allowlist, from model error rather than any external attack. No established prior art was found in this project's research for this specific risk category under a distinct name; this mitigation is first-principles, not borrowed from an external framework, and that gap is stated honestly rather than papered over.

**Consequence if unmitigated**: a malformed transaction could revert, wasting gas, or, if validation is loose, execute with an unintended amount or asset.

**Mitigation**: the Policy/Risk Engine performs structural validation, asset membership in the agent's allowed universe, amount bounds, destination allowlist, on every proposed action independent of how well-reasoned the LLM's justification sounds. A proposal failing structural validation is rejected before any signing step, regardless of its stated rationale.

### Scenario G: compromised root credential with population-wide blast radius

The user's root wallet is the owner of every agent smart account that user controls (`ARCHITECTURE.md` section 6). That is what makes recovery possible: one credential can revoke a session key or sweep a compromised agent. It is also what makes the credential a population-wide key. An attacker who phishes or otherwise takes that root credential can, in one session, revoke or sweep every agent the user owns. No single agent's spend limit catches this, because the actions are owner actions, not agent actions. This is the same category of blast radius as scenario D, triggered by a stolen root credential rather than by a mutation.

**Consequence if unmitigated**: every agent under that root wallet can be drained or halted together, in the time it takes to submit one transaction per agent.

**Mitigation**: a single-agent revoke or sweep still executes immediately, which is what `ARCHITECTURE.md` section 6 requires for recovery from one compromised agent. An action that names more than one agent, or that would touch more than three distinct agents from the same root wallet inside 60 minutes, is held. Release takes a second confirmation that restates the agent count, then a 15 minute delay. The rule is specified in `SECURITY.md` section 9 (bulk recovery hold). The on-chain enforcement is later work (issue #26). The hold does not apply to a lone revoke or sweep while the rolling count is still within the threshold.

## 7. Security invariants

1. An agent's smart account rejects any transaction exceeding its own on-chain-encoded spend limit, regardless of what the application layer approved.
2. Receiving any asset never changes an agent's permissions, spend limits, or session-key scope by itself.
3. Reproduction only ever moves capital that already exists in a parent's account into a new child account; total system capital changes only through deposits, withdrawals, and realized trading or cost flows, never through a reproduction event. This is asserted by the ledger explicitly, not merely implied by the reproduction code's logic.
4. A parent's capital never falls below its own starting principal as a result of its own reproduction.
5. Protocol-level parameters (spend caps, reproduction thresholds, mutation bounds, population caps) are not part of any agent's genome and are not modified by mutation, reproduction, or any agent's own proposed action.
6. A failed or malformed external API call never causes an action to proceed as though the call had succeeded.
7. The LLM's output is never itself sufficient authorization for a financial action; every proposed action passes through the Policy/Risk Engine and is independently bounded by the on-chain smart account limit before it can execute.
8. The user can revoke one agent's session key at any time, immediately stopping that agent's ability to transact, without affecting any other agent or the user's own root wallet. A bulk revoke or sweep, or the action that would put the same root wallet over three distinct agents inside 60 minutes, is held as specified in `SECURITY.md` section 9. That hold is the mitigation for scenario G. It is not a delay on the single-agent path.
9. An agent's identity, once created, is never deleted; retirement changes status, it does not erase history.
10. Any state where the system cannot determine whether a proposed action is within policy fails closed; the action does not execute.
11. An agent's session key moves funds only through calls on its contract allowlist (`SECURITY.md` section 1): trades through Kuru's router, reproduction through the reproduction contract, and `transfer` or `approve` on the settlement asset to a recipient or spender the RiskModule allows (`ARCHITECTURE.md` section 16.1). The one path outside that allowlist is an x402 payment, a signed authorization to an allowlisted provider's payment address, bounded by the information caps (`ARCHITECTURE.md` section 16.3). The on-chain validator enforces the same recipient rule in validation (`ARCHITECTURE.md` section 16.3), so a compromised session key that bypasses the RiskModule still cannot name an arbitrary recipient or spender; until that contract is implemented and audited (issue #25), this holds off-chain only, and the x402 path and the router's own behavior stay outside it. A withdrawal to the user's root wallet goes through the owner-initiated withdrawal or sweep path, which the session key cannot invoke, and never above the user's configured limits (`ARCHITECTURE.md` section 3).
12. An agent never produces more descendants than the maximum-descendants-per-parent limit (`EVOLUTION.md` section 4), and that limit is a protocol-level constant, not a genome field, so no mutation or reproduction can raise it.
13. A child's account receives capital from its parent only through a reproduction event, and never more than the amount `EVOLUTION.md` section 3.2 allows: the reproduction fraction of the parent's profit above principal, capped at `max_child_capital`.
14. No user-supplied text, whether a prompt, an agent description, or a strategy instruction, changes a protocol-level parameter. Those parameters change only through an explicit operator change made outside any agent's or user's reasoning path.

## 8. Residual risk

Stated honestly, not minimized:

- **No documented real-world incident exists for an evolutionary or reproducing agent population being exploited**, as distinct from the single-agent incidents cited above. Monadeum's reproduction-specific attack surface is defended by first-principles invariants and academic threat analysis, not by a body of real incident-response experience the way single-agent wallet compromise already has.
- **The operator of Monad's official x402 facilitator is not identified anywhere in Monad's own documentation.** Monadeum inherits whatever operational risk that facilitator carries and cannot independently verify its uptime or security posture beyond what is observable in production.
- **Invariant 1's correctness depends on the smart account validator module's implementation being correct.** That is a smart-contract security question, audits and formal verification, that this document states as a requirement but does not itself discharge; see `SECURITY.md`'s smart-contract section for how that requirement is intended to be met before any real capital is at risk.
- **The bulk-recovery hold can be waited out by an attacker who already controls the confirmation step.** The second confirmation is itself an action of the root wallet, and the 15 minute delay only helps if the legitimate owner notices in that window. The hold raises the cost of a population-wide sweep. It does not remove the risk when the attacker holds the root credential for longer than the delay.

## 9. Non-goals

Explicitly out of scope for this threat model, to be revisited before being enabled, not silently assumed safe:

- Agent-to-agent economic interaction and the Sybil and collusion threat surface specific to populations of communicating, reproducing agents. Deferred per `ARCHITECTURE.md` section 13.
- A fully adversarial platform-operator threat model. The operator is trusted for the MVP; modeling a compromised or malicious operator is future work, relevant if the platform ever moves toward a more decentralized or non-custodial-of-the-operator-itself design.
- Formal verification of smart contracts. Stated as a future step in `SECURITY.md`, not attempted in this document.
