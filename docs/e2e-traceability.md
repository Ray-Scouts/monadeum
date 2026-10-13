# End-to-end test traceability

This table maps every scenario named in `BRIEF.md`'s testing requirements, in issue #47, and in `THREAT-MODEL.md` section 6 to the tests that attempt it and check the mitigation. "Integrated" means the worker loop over the real modules (`apps/worker/test/harness.ts`: StrategyService, RiskService with a signed policy, X402Client, TradingService over WalletsTradeSigner over WalletsService, FitnessService, ReallocationService), with only the chain, bundler, paymaster, token, Kuru, x402 provider, and reallocation contract faked. Contract tests run against the Solidity sources under Foundry; fork tests need a Monad RPC.

Run the TypeScript suites with `bun run test` at the repository root and the contract suites with `forge test` in `contracts/`.

## THREAT-MODEL.md section 6

| Scenario | Integrated test | Supporting tests |
|---|---|---|
| A: fake-authorization prompt injection | `apps/worker/test/threats.test.ts` (scenario A: a plan carrying the provider's "approved by the owner" transfer or unbounded approve to the attacker is rejected, nothing is sent); `apps/worker/test/integration.test.ts` (instructions injected in descriptive fields or a token field change nothing) | `libs/risk/test/risk.test.ts` (scenario A); `libs/external/test/accept.test.ts`; `contracts/test/AgentSpendPolicy.t.sol` and `AgentSpendPolicy.invariant.t.sol` (recipient rule on-chain) |
| B: unsolicited transfer as permission escalation | `apps/worker/test/threats.test.ts` (scenario B: a large unsolicited deposit changes no owner operation, session record, registry record, or cap; the oversized trade is rejected on the unchanged per-action cap; the sender is still not a recipient) | `libs/read-model/test/funding.test.ts` (third-party transfers never change principal); `contracts/test/KernelIntegration.t.sol` (`test_e2e_sessionKeyCannotRaiseOwnCaps`) |
| C: x402 discovery-layer manipulation | `apps/worker/test/threats.test.ts` (scenario C: a genome naming an unlisted provider asks and pays no one) | `libs/risk/test/risk.test.ts` (scenario C); `libs/x402/test/x402.test.ts` (unlisted provider or off-host resource refused before any request) |
| D: selection-driven erosion of safety constraints | `apps/worker/test/threats.test.ts` (scenario D: forged debits above the cap, across owners, without a policy, or above the slot ceiling are rejected and reach no contract); `apps/worker/test/integration.test.ts` (reallocation tests) | `libs/reallocation/test/properties.test.ts`; `libs/risk/test/reallocation.test.ts`; `contracts/test/AgentReallocation.t.sol`, `AgentReallocation.invariant.t.sol`, `ReallocationSpendPolicy.t.sol` |
| E: settlement race or replay against x402 | `apps/worker/test/threats.test.ts` (scenario E: a replayed settlement reference is a duplicate-grant anomaly, no trade, no second payment); `apps/worker/test/integration.test.ts` (crash after payment: the restart neither pays again nor trades) | `libs/x402/test/x402.test.ts`; `libs/x402/test/payer.test.ts`; `apps/worker/test/x402.test.ts` (reconciliation alerts); `contracts/test/X402PaymentValidator.t.sol` and its invariant and fork tests |
| F: hallucinated or malformed transaction proposal | `apps/worker/test/threats.test.ts` (scenario F: off-allowlist contract, wrong decimals, malformed calldata rejected before signing; an off-allowlist plan with a forged approval is still not signed) | `libs/risk/test/risk.test.ts` (scenario F); `libs/wallets/test/wallets.test.ts` (out-of-scope calls never signed); `contracts/test/AgentSpendPolicy.t.sol` |
| G: compromised root credential | `apps/api/test/api.test.ts` (holds the fourth distinct agent inside an hour, releases it after confirmation and the delay) | `libs/recovery/test/decide.test.ts` |
| H: phishing and address substitution at funding | `apps/api/test/funding.test.ts` (sender and recipient from the API's records, signature recovery, replay, limits) | `apps/indexer/test/funding.test.ts`; `libs/read-model/test/funding.test.ts`; `apps/worker/test/principal.test.ts` |
| I: signature-path drain through ERC-1271 | Contract layer only, by design | `contracts/test/X402PaymentValidator.t.sol`, `X402PaymentValidator.invariant.t.sol`, `fork/X402MainnetFork.t.sol`, `fork/KernelV31Fork.t.sol`; `libs/wallets/test/x402.test.ts`, `x402-lifecycle.test.ts` |

## BRIEF.md testing requirements and issue #47 criteria

| Requirement | Tests |
|---|---|
| Tool permission tests | `libs/wallets/test/wallets.test.ts`; `apps/worker/test/threats.test.ts` (scenarios A, F); `contracts/test/AgentSpendPolicy.t.sol`, `KernelIntegration.t.sol` |
| Prompt injection tests | `apps/worker/test/threats.test.ts` (scenario A); `apps/worker/test/integration.test.ts` (injected fields); `libs/external/test/accept.test.ts` |
| Malicious and malformed API responses fail the tick with no action (`ARCHITECTURE.md` section 14) | `apps/worker/test/integration.test.ts` (malformed, wrong provider, server error, oversized, no settlement reference, payee substitution, unreachable) |
| Budget exhaustion fails closed (`SECURITY.md` section 8) | `apps/worker/test/integration.test.ts` (x402 daily cap, paymaster budget with no gas balance, session daily cap); `libs/wallets/test/wallets.test.ts` (sponsorship ledger) |
| Transaction failure handling | `apps/worker/test/integration.test.ts` (four crash points); `libs/trading/test/trading.test.ts`; `libs/wallets/test/tick.test.ts` |
| Population explosion (as re-scoped by PR #96) | `apps/worker/test/threats.test.ts` (population explosion: evaluations create no agent and submit no deployment; a debit to an unregistered agent is refused; scenario D for the ceiling and owner boundary); `apps/api/test/creation.test.ts` (creation refused at the population cap); `contracts/test/AgentReallocation.t.sol` (`test_unregisteredSourceOrSinkReverts`, `test_ceilingPlusOneReverts`, `test_ownerCannotNameAnotherOwnersAgent`, `test_mismatchedOwnersRevert`, `test_operatorAndAdminRoles`) |
| PnL, fee, gas, and slippage accounting, matching the dashboard | `apps/worker/test/threats.test.ts` (accounting: over the Postgres stores, the trade count, x402 spend, and capital the API serves equal the operations included, the payer's authorizations, and the chain balance; slippage is measured at the mid; fitness net is the cash result less gas and x402 spend); `apps/worker/test/close.test.ts`; `apps/api/test/activity.test.ts`, `evaluations.test.ts` (the API serves those store reads) |

## Not covered, and why

- **Population cap at the contract layer.** The global population cap is enforced in `apps/api` only (`EVOLUTION.md` section 4). No contract counts agents: Kernel accounts can be deployed by anyone, and `AgentReallocation.registerAgent` is restricted to the operator but has no cap. What the contract does enforce is that the mechanism cannot create or credit an unregistered account. An on-chain population cap, or an explicit decision that the application-layer cap is sufficient, is still open.
- **Scenario D's population-level circuit breaker** (`SECURITY.md` section 9, layer 3) is not implemented outside the web app's sample data, so no test can show it trips. Reallocation itself is off by default, and the bounds it would run under are covered above.
- **Scenario G at the chain level.** The bulk recovery hold is enforced in the application (`libs/recovery`, `apps/api`); its on-chain enforcement is later work (issue #26).
- **Fork tests** need a Monad RPC: without one, `forge test` skips them.
