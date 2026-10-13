# Testnet validation checklist

The checklist for issue #48: what a valid Monad testnet deployment must show before a mainnet opt-in decision can even be considered, mapped to the Testnet mode of `SECURITY.md` section 10 (wallets, x402, reallocation and retirement, accounting, trading, policies). It records, for each item, what this repository already holds as evidence and what still needs a human run on testnet. It adds no control; each item points at the document that specifies it.

State as of 2026-10-12, commit `513e943`. **No item is validated on the strength of a claim alone.** The status of each item is one of:

| Status | Meaning |
| --- | --- |
| **Evidenced** | The repository holds a checkable artifact: an address and transaction hash, an on-chain read anyone can repeat, or a committed test result. |
| **Recorded** | The repository records the item as observed (a FACT line in `deploy/README.md` or `ARCHITECTURE.md`), but holds no transaction hash, account address, or log for it. To count for the report, the operator adds the hash or log. |
| **Off-chain only** | Covered by offline, CI, or fork tests, but not run against the live testnet deployment. |
| **Not run** | Needs a human run on testnet. Nothing in the repository shows it. |
| **Blocked** | Cannot be run until a named dependency or decision is in place. |

The fork tests named below read live chain state but run in Foundry's EVM, not through Monad's client or a bundler; they are "Off-chain only" for this checklist.

## 0. Deployment

| # | Check | Status | Evidence, or the human step |
| --- | --- | --- | --- |
| 0.1 | `AgentSpendPolicy`, `AgentReallocation`, `X402PaymentValidator` deployed on chain 10143 from the recorded deployer | **Evidenced** | `contracts/deployments/monad-testnet.json`: transactions `0xe57f5b86...f344e`, `0x654a555c...13ee3e`, `0x914bb2d2...17bf0f`, blocks 70167444 to 70167461, receipts status 1 (checked 2026-10-11) |
| 0.2 | The deployed bytecode is the audited source | **Evidenced** | `contracts/audit/README.md` section 14: 3 of 3 match a build of `513e943` on 2026-10-12, repeatable with `contracts/audit/check-deployed-bytecode.py` |
| 0.3 | `AgentReallocation` roles held by a 2-of-3 Safe; constructor values as decided | **Evidenced** | `contracts/deployments/monad-testnet.json` (`verified`, `safe`): operator and admin are Safe `0x9671dB7A...9897`, threshold 2, 3 owners, `minEvaluationInterval` 36000, `capitalFloor` 60000 |
| 0.4 | Safe owner keys held by different people on different devices | **Not run** | Owner confirms who holds each key (`deploy/README.md`, "Before mainnet" and open question 5). No contract can show it |
| 0.5 | API, web, worker, indexer, Postgres, Redis running on the VPS, behind TLS | **Recorded** | `deploy/README.md`, "Live testnet deployment" (2026-10-11), PRs #126, #127, #135. Human: attach the output of `deploy/README.md` step 5 (`dc ps`, `/health`) to the report |
| 0.6 | Explorer source verification of the three contracts | **Not run** | `deploy/README.md`, open question 4 |
| 0.7 | ZeroDev sponsorship limit set for chain 10143 | **Not run** | `deploy/README.md`, open question 2: sponsors all transactions today, accepted on testnet only |

## 1. Wallets and smart accounts (`ARCHITECTURE.md` section 6, `SECURITY.md` section 1)

| # | Check | Status | Evidence, or the human step |
| --- | --- | --- | --- |
| 1.1 | Owner signs in with Privy and an embedded wallet is recorded | **Recorded** | `deploy/README.md`, "Live testnet deployment"; PRs #130, #131 |
| 1.2 | Agent account provisioned: Kernel v3.1 account deployed through ZeroDev's bundler with sponsored gas, spend policy installed with limits and allowlist | **Recorded** | `deploy/README.md` and `ARCHITECTURE.md` section 11: the indexer recorded `account.deployed`, `spend.limits-set`, `spend.call-allowed` for the first agent (2026-10-11). Human: record the account address and the deployment user operation's transaction hash |
| 1.3 | Session key issued ("Activate this agent", `POST /agents/:id/activate`), signed by a Privy embedded wallet and accepted by Kernel | **Not run** | `ARCHITECTURE.md` section 11 ("Verified on testnet, and not yet"): built (PR #137), not run on testnet; Privy's `eth_signTypedData_v4` over Kernel's enable data is an assumption until this runs |
| 1.4 | A session-key operation within the caps executes through the bundler and is recorded in the window | **Not run** (fork: Off-chain only) | `contracts/audit/README.md` section 7.2, step 3. Fork evidence: `KernelV31Fork.t.sol`, 8 passed on 2026-10-12 |
| 1.5 | Over `perTxCap`: the bundler refuses it in simulation | **Not run** (fork: Off-chain only) | Section 7.2; closes assumption E3 |
| 1.6 | Daily-cap breach: included, reverts in execution with `DailyCapExceeded`, records nothing | **Not run** (fork: Off-chain only) | Section 7.2 |
| 1.7 | Delegatecall and a session-key ERC-1271 signature are refused | **Not run** (fork: Off-chain only) | Section 7.2 |
| 1.8 | Session key revoked ("Stop this agent"), revocation sponsored, and a later operation signed by the revoked key is refused | **Not run** | `ARCHITECTURE.md` section 11 (stop flow). Kernel's nonce rules for revocation were read from source, not observed on chain (`libs/wallets/README.md`) |
| 1.9 | Owner sweeps an agent account through the root validator | **Not run** | `SECURITY.md` section 1 (owner-controlled recovery) |
| 1.10 | Bulk recovery hold: a fourth distinct agent, or a two-agent request, within 60 minutes is held | **Off-chain only** | `libs/recovery` tests. Human: run against the live API with test agents |

Items 1.4 to 1.7 together are `contracts/audit/README.md` section 7.2. The opt-in `libs/wallets` test (`WALLETS_TESTNET=1`) is the documented way to run them, with a testnet-only owner key.

## 2. x402 (`ARCHITECTURE.md` section 8, `SECURITY.md` section 5)

| # | Check | Status | Evidence, or the human step |
| --- | --- | --- | --- |
| 2.1 | `X402PaymentValidator` deployed | **Evidenced** | Item 0.1 |
| 2.2 | Validator installed on an agent account with a payee list, and uninstalled on revocation | **Blocked** | No testnet pay-to addresses decided: `WALLETS_X402_VALIDATOR_ADDRESS` stays empty (`deploy/README.md`, open question 3). Mainnet fork covers install and uninstall (`X402MainnetFork.t.sol`, 7 passed 2026-10-10) |
| 2.3 | A bounded x402 payment settles through a facilitator on Monad | **Blocked** | The payer is off by decision (`WORKER_X402_PAYER_ENABLED=false`) until a facilitator on Monad is confirmed to accept ERC-1271 signatures for EIP-3009 (`contracts/audit/README.md` assumption X8, `SECURITY.md` section 13) |
| 2.4 | An out-of-bounds payment (unlisted payee, above `maxValue`, exhausted slot) is refused | **Off-chain only** | `X402PaymentValidator` unit, invariant, and mainnet-fork tests (`contracts/audit/README.md` 12.3) |
| 2.5 | x402 spend is logged and reconciled against settlement | **Blocked** | Depends on 2.3. The reconciliation job exists (PR #123) and the worker runs it (`deploy/README.md`) |

## 3. Reallocation and retirement (`EVOLUTION.md` sections 3 and 6, `ARCHITECTURE.md` section 16.5)

Reallocation is off in the testnet deployment by decision (`MONADEUM_REALLOCATION_ENABLED=false`). Issue #48 requires at least one full reallocation event on testnet, so these items need the owner to decide a controlled run with reallocation on, for test agents only.

| # | Check | Status | Evidence, or the human step |
| --- | --- | --- | --- |
| 3.1 | Contract deployed with the decided parameters, and no evaluation opened yet | **Evidenced** | Item 0.3; `currentEvaluation()` and `lastEvaluationAt()` read 0 on 2026-10-12, block 70562473 (`contracts/audit/README.md` 13.5, item 7) |
| 3.2 | Operator registers two agents of one owner and sets principal, through the Safe | **Not run** | `deploy/README.md` step 6 |
| 3.3 | Owner commits a reallocation policy naming both agents | **Not run** | `ARCHITECTURE.md` section 16.5 |
| 3.4 | Operator advances the evaluation; a second advance before 36000 seconds is refused | **Not run** | Off-chain: `test_evaluationSpacingAtTheBound` |
| 3.5 | One full reallocation: the source's counted `approve` and `reallocate` in one session-key operation, total and per-owner capital conserved, source within cap and floor, sink within ceiling | **Not run** | Off-chain: `AgentReallocation.invariant.t.sol`, `ReallocationSpendPolicy.t.sol`. Human: record balances before and after, and the transaction hash |
| 3.6 | A cross-owner move and a second debit in one evaluation are refused on chain | **Not run** | Off-chain: `test_mismatchedOwnersRevert`, `test_secondDebitInOneEvaluationReverts` |
| 3.7 | Retirement: operator retires an agent; it moves no capital and can no longer be source or sink | **Not run** | Off-chain: `test_retirementMovesNoCapital`, `test_retiredAgentIsNeitherSourceNorSink`. Agent retirement in the app is not built (`ARCHITECTURE.md` section 11) |

## 4. Accounting (`ECONOMICS.md` section 2)

| # | Check | Status | Evidence, or the human step |
| --- | --- | --- | --- |
| 4.1 | Relayed funding: owner signs an EIP-3009 authorization, the relayer submits it, the agent account receives exactly the amount | **Not run** | `deploy/README.md`, open question 6; built in PR #138. Requires the relayer to hold testnet MON |
| 4.2 | The indexer records the finalized transfer and the worker's `principal` job updates the agent's principal to match the chain | **Not run** | Depends on 4.1 |
| 4.3 | Dashboard capital, trade counts, and x402 spend per agent and in totals equal on-chain balances and logs | **Not run** | PRs #133, #134. Human: compare the API's figures with `balanceOf` and the indexer rows for each test agent |
| 4.4 | Capital is conserved across a reallocation and a retirement (the sum over one owner's agents is unchanged) | **Not run** | Depends on 3.5 and 3.7 |
| 4.5 | Realized P&L of a closed position matches the fills | **Not run** | Depends on 5.4 |

## 5. Trading (`ARCHITECTURE.md` section 10, `TradingModule`; section 11, "Tick runner")

| # | Check | Status | Evidence, or the human step |
| --- | --- | --- | --- |
| 5.1 | WMON/USDC market created at the predicted address and seeded | **Not run** | `contracts/deployments/monad-testnet-wmon-market.json` status is "planned, simulated only (nothing was sent)"; the predicted address `0x46b66f84...aeBC` had no code on 2026-10-12. The deployer needs about 45.5 MON for the seed. `deploy/README.md` step 2b. Fork: `WmonMarketFork.t.sol`, 1 passed on 2026-10-12 |
| 5.2 | Operator key generated, risk policy version 1 built, signed, appended, and in effect | **Not run** | `deploy/README.md` step 9.1 to 9.5 |
| 5.3 | Tick runner enabled; the worker verifies the market and the policy and records hourly mids | **Not run** | `deploy/README.md` step 9.6; off by default (PR #141) |
| 5.4 | A real buy and a real close on Kuru through an agent's session key and the bundler, each reconciled by the worker | **Not run** | Depends on 5.1 to 5.3 and on the mid moving (`deploy/README.md` step 9.6). `ARCHITECTURE.md` section 11: no tick has run against the live deployment |
| 5.5 | Kuru's audit reports read and matched to the allowlisted router | **Not run** | `SECURITY.md` section 13, last item |

## 6. Policies (`SECURITY.md` sections 1, 4, 8, 9)

| # | Check | Status | Evidence, or the human step |
| --- | --- | --- | --- |
| 6.1 | On-chain caps, allowlist, and recipient rule enforced through a bundler | **Not run** | Items 1.4 to 1.7 |
| 6.2 | A trade above the risk policy's per-action cap is refused by the RiskModule before submission, and nothing is sent | **Off-chain only** | Worker tick-runner tests (`ARCHITECTURE.md` section 11, "Tests"). Human: on testnet, with a plan above the cap, confirm the refusal in the worker log and no user operation |
| 6.3 | No signed policy, or a policy signed by another key: no tick record is claimed and nothing is sent | **Off-chain only** | Same tests. Human: observe the "no signed risk policy version" skip in step 9.6 before 9.5 |
| 6.4 | Fail closed on RPC failure or a stale or one-sided book | **Off-chain only** | Same tests; `ARCHITECTURE.md` section 11 records a one-sided book refused by the read-only testnet test on 2026-10-12 |
| 6.5 | Emergency stop: disabling the tick runner stops new ticks; stopping an agent revokes its key | **Not run** | `deploy/README.md` step 9 ("Stop"); item 1.8 |
| 6.6 | Population circuit breaker trips and pauses ticks and reallocation | **Not run** | `SECURITY.md` section 9, layer 3 |

## 7. Gates outside this checklist

| # | Gate | Status |
| --- | --- | --- |
| 7.1 | External audit of the three contracts complete, or engaged with a tracked follow-up (issue #46) | **Blocked on a human**: the package is ready (`contracts/audit/README.md`, section 16); no auditor is engaged |
| 7.2 | End-to-end suite (issue #47) passes against the live testnet deployment, not only in CI | **Not run**: issue #47 is open |
| 7.3 | Written validation report, stating whether the system is ready for a mainnet opt-in decision or what remains | **Not run**: written after the items above. It must state explicitly that unrestricted autonomous mainnet trading is never the default (`BRIEF.md`, `SECURITY.md` section 10, Mainnet) |

## Summary

Of the 48 items above, 5 are Evidenced (the deployment, its bytecode, its roles, the deployed x402 validator, and the reallocation contract's initial state), 3 are Recorded and need a hash or log attached, 5 are covered off-chain only, 31 need a human run (4 of them, 1.4 to 1.7, already pass on a fork), and 4 are blocked on a decision or dependency (x402 payees and facilitator, and the external audit). On this evidence the testnet deployment is not validated, and the system is not ready for a mainnet opt-in decision.

Suggested order for the human runs, each safe to stop after: item 0.5 output; 1.2 hash; 1.3 activation; 4.1 and 4.2 funding; 1.4 to 1.7 (section 7.2 of the audit package); 5.1 to 5.4 trading; 1.8 and 6.5 stop; then the controlled reallocation run (3.2 to 3.7, 4.4) once the owner decides to turn reallocation on for test agents. Record every transaction hash and account address in this file as each item moves to Evidenced.
