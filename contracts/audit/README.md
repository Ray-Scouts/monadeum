# Audit package

This directory is the material an external auditor needs to review the on-chain contracts of this repository, prepared under issue #46. It is organized per contract so that each contract in scope has its own section. Today it covers `AgentSpendPolicy`, the on-chain spend policy for agent smart accounts (issue #25), in sections 1 to 11, `X402PaymentValidator`, which bounds the account's x402 payment signatures, in section 12, and `AgentReallocation`, the owner-scoped reallocation and retirement contract (issue #31, merged in #105), in section 13. Section 14 ties the testnet deployment to this source, section 15 lists every command that reproduces the package, and section 16 states what remains before and during the external engagement.

`SECURITY.md` section 3 sets the gate this package serves: `AgentSpendPolicy` carries no real user-controlled capital, on testnet or mainnet, before an external audit is complete and every finding is resolved or explicitly accepted as residual risk in `SECURITY.md`.

**Every contract in `contracts/src` that holds, moves, or authorizes the movement of value is in scope.** Checked on 2026-10-12 against every file in `contracts/src`:

| File | Holds or moves value | Package section | Testnet address (`contracts/deployments/monad-testnet.json`) |
| --- | --- | --- | --- |
| `AgentSpendPolicy.sol` | Authorizes: the only on-chain bound on what a session key can move from an agent account | 1 to 9 | `0xe54512401B8fCD0DCc3f4Aa4929b99F05AbA3f05` |
| `X402PaymentValidator.sol` | Authorizes: the only on-chain bound on the account's x402 (EIP-3009) signatures | 12 | `0xCA918F53FFc7507Bd41602c0bD1ef72558705991` |
| `AgentReallocation.sol` | Moves: pulls the settlement asset from a source account and credits sinks; holds no balance by design | 13 | `0x4e7500415e81017670a9cFb8763f873EE6694A7f` |
| `IAgentSpendPolicy.sol`, `IAgentReallocation.sol` | No: interfaces and NatSpec specification, reviewed as the specification of the two implementations | 1, 13 | not deployed |
| `kernel/IKernelModules.sol` | No: Kernel v3.1 interfaces declared locally | 1 | not deployed |

No other contract is deployed by this repository. The files under `contracts/script` (`DeployTestnet.s.sol`, `CreateWmonMarket.s.sol`, `SeedWmonMarket.s.sol`, `KuruTestnet.sol`) are Foundry scripts and interface declarations run from the owner's workstation; they deploy no contract of their own and are out of scope (section 9), except that `DeployTestnet.s.sol` fixes the constructor arguments and role addresses of the three contracts, which the auditor may wish to read alongside them. There is no wallet-deployment factory of our own: accounts are created by ZeroDev's Kernel v3.1 factory, out of scope (section 9).

Contents:

1. Scope
2. System overview and trust model
3. External integration assumptions
4. Invariants and the tests that check them
5. Test suite and coverage
6. Static analysis and triage
7. Testing against real Kernel v3.1
8. Known limitations and residual risk
9. Out of scope
10. Adding the reallocation contract
11. Request for proposal (draft)
12. X402PaymentValidator
13. AgentReallocation
14. Deployed testnet bytecode
15. Reproducing this package
16. Engagement status and remaining steps

## 1. Scope

| File | nSLOC | Role |
| --- | --- | --- |
| `contracts/src/AgentSpendPolicy.sol` | 194 | Implementation: spend rules, traded assets, rolling window, Kernel v3.1 policy and hook entry points |
| `contracts/src/IAgentSpendPolicy.sol` | 35 | Authoritative interface and NatSpec specification |
| `contracts/src/kernel/IKernelModules.sol` | 32 | Kernel v3.1 module interfaces and `PackedUserOperation`, declared locally to match Kernel's ABI |
| **Total** | **261** | |

nSLOC as counted by Aderyn 0.6.8 (normalized source lines, excluding comments and blank lines).

- **Commit**: the commit at which this package is merged to `main`. An engagement pins the exact commit hash in the statement of work; any later change to a file above is out of the audited scope until re-reviewed. **Re-pin required**: the traded-asset rule (`setTradedAsset`, `isTradedAsset`, the `TradedAssetSelector` and `TradedAssetNotAllowed` errors, the `TradedAssetSet` event, and the traded-asset branch of `check` and of the recipient rule) was added after the package was first assembled, by the pull request that adds closing positions on Kuru's WETH/USDC market. Any commit pinned before it is not the code that will be deployed.
- **Compiler**: solc 0.8.24, pinned in `contracts/foundry.toml`. `AgentSpendPolicy.sol` uses an exact `pragma solidity 0.8.24;`; the two interface files keep `^0.8.24` so that other contracts can import them. EVM version `cancun`, optimizer on with 200 runs, `bytecode_hash = "none"`.
- **Dependencies**: none at runtime. The contract imports only the two local interface files. `forge-std` (git submodule under `contracts/lib/forge-std`) is used by tests only.
- **Toolchain**: Foundry `forge` 1.8.5, the version CI pins.
- **Deployment model**: one deployment serves every agent account. The constructor takes the settlement asset address, which is immutable. There is no owner, no admin, no upgradeability, and no pause: every piece of state is keyed by the account that wrote it.

## 2. System overview and trust model

Each agent in this system runs a ZeroDev Kernel v3.1 smart account (ERC-4337, EntryPoint v0.7). The user's own wallet is the account's root validator. The agent itself acts through a session key, installed as a Kernel permission: an ECDSA signer plus policies. `AgentSpendPolicy` is installed on that permission twice, as a policy (validation phase) and as the permission's hook (execution phase). It is the on-chain enforcement of `THREAT-MODEL.md` invariant 1 (an account rejects any transaction exceeding its on-chain spend limit) and the on-chain part of invariant 11 (a session key moves funds only through allowlisted calls, to allowlisted recipients).

What it enforces, for operations validated by the session key:

- **Validation phase** (`checkUserOpPolicy`, which calls the same logic as the view `check`): every call's `(target, selector)` is on the account's allowlist; no target is the policy contract or the account itself; native value is 0; a counted call (`transfer` or `approve` on the settlement asset) decodes and names a recipient that passes the recipient rule; the sum of counted amounts over the whole operation is at most `perTxCap`. A `transfer` or `approve` on a traded asset (an ERC-20 the owner marked with `setTradedAsset`, the base of the market the agent trades, WETH in the default deployment) decodes and names a recipient that passes the same rule, and counts 0. A traded asset is never a recipient. No time-dependent reads.
- **Configuration rules** (`setAllowed`, `setTradedAsset`): the settlement asset and a traded asset admit only `transfer` and `approve`; no other target may hold either selector; a token is marked or unmarked only while the account has no selector allowed on it.
- **Execution phase** (`preCheck`, which calls the same logic as `record`): recomputes the total with the same rules, adds it to the current hour's bucket, and reverts with `DailyCapExceeded` if the 25-bucket window total would exceed `dailyCap`.

Trust model:

| Actor | Trusted for | Not trusted for |
| --- | --- | --- |
| Account owner (root validator) | Setting limits, the allowlist, and the traded assets through `setLimits`, `setAllowed`, and `setTradedAsset`, which read the account from `msg.sender`; choosing install flags | Nothing is enforced against the owner; the owner can always change or remove the policy |
| Session key | Nothing | Assumed fully compromised: the policy must bound everything it can do through user operations |
| Kernel v3.1 implementation | Calling the entry points in the sequence its source shows (section 3) | n/a, its behavior is an assumption the fork test checks |
| Settlement asset | Standard ERC-20 `transfer` and `approve` semantics | Its ERC-1271 signature paths are not bounded by this contract; `X402PaymentValidator` bounds the one the system uses (section 12) |
| Traded asset (WETH on Monad mainnet in the default deployment) | Standard ERC-20 `transfer` and `approve` semantics | Amounts on it are not capped by this contract (section 8, item 15) |
| Allowlisted non-asset targets (Kuru router, reallocation contract) | Pulling funds only through allowances the account set with a counted `approve` | Not decoded: their arguments are not inspected |
| Anyone else | Nothing | May call every external function; each writes only state keyed by `msg.sender` |

The contract cannot tell the owner from a session key, because both execute from the account. Two rules close that gap independently of the allowlist: `check` rejects any call whose target is the policy contract or the account itself, so a session-key operation never reaches `setLimits`, `setAllowed`, or the account's module-management functions; and the owner reaches them only through the root validator, whose operations do not run the session key's policy or hook.

`ARCHITECTURE.md` section 16.3 is the design record for every decision summarized here.

## 3. External integration assumptions

Each assumption names how it is verified. "Fork" means `contracts/test/fork/KernelV31Fork.t.sol` (section 7), which runs against the contracts deployed on Monad testnet.

### 3.1 Kernel v3.1 call sequence

Read from `zerodevapp/kernel`, tag `v3.1`, commit `03f7f5cf5871cda0070e4223f196f5b577f6cde2` (`src/Kernel.sol`, `src/core/ValidationManager.sol`, `src/core/HookManager.sol`, `src/utils/ExecLib.sol`, `src/utils/ValidationTypeLib.sol`).

| # | Assumption | Verified by |
| --- | --- | --- |
| K1 | During validation, for a permission validation, the account calls `policy.checkUserOpPolicy(permissionId, userOp)` for each policy whose flag does not set skip-user-op, with the full `userOp.callData` (including the `executeUserOp` prefix) and `userOp.signature` replaced by the policy's slice. A revert propagates out of `validateUserOp`; a nonzero low 160 bits in the return makes Kernel revert with `PolicyFailed`. No value is sent. | Source; test double; fork |
| K2 | When a validation has a hook other than `address(1)`, Kernel requires `userOp.callData` to start with `executeUserOp` and checks the permission's selector access on `callData[4:8]`. | Source; fork |
| K3 | During execution, `executeUserOp` calls `hook.preCheck(msg.sender, msg.value, userOp.callData[4:])` from the account, then delegatecalls itself with `userOp.callData[4:]`, reverting the whole execution with `ExecutionReverted` if that fails, then calls `hook.postCheck(context)`. No value is forwarded to the hook. | Source; test double; fork |
| K4 | `execute(bytes32 mode, bytes executionCalldata)` decodes call type single as `abi.encodePacked(target, value, callData)` and batch as `abi.encode(Execution[])`, with `Execution` laid out as `(address, uint256, bytes)`, the same as `Call`. Exec type `0x00` reverts on a failed call, `0x01` (try) continues. | Source; unit tests; fork (single and batch) |
| K5 | On the ERC-1271 path, for a permission, Kernel calls `policy.checkSignaturePolicy` in a view context for each policy whose flag does not set skip-signature, and reverts with `PolicyFailed(i)` on a nonzero result. | Source; fork |
| K6 | When installing a validation with a hook, Kernel calls `hook.isInitialized(account)` and calls `onInstall(hookData[1:])` only if it returns false or `hookData[0] == 0xff`; it reads `hookData[0]` in either case, so the installer passes at least one byte. | Source; fork (enable mode with `hookData = 0x00`) |
| K7 | Permission install data is `abi.encode(bytes[])`, each policy entry `flag (2 bytes) | policy (20) | data`, the signer last. | Source; fork |
| K8 | Root-validator operations run the root validator's hook (here `address(1)`, none), never the session key's policy or hook. | Source; fork (owner configuration in `setUp`) |

The contract's decoder (`_decodeExecute`) is a reimplementation of K4, not a call into Kernel. The two must interpret every byte string the same way, or an operation could be checked as one set of calls and executed as another. The differences found on review all fail closed, and are listed for the auditor to confirm:

- Kernel's batch decoder (`ExecLib.decodeBatch`) is inline assembly with no bounds checks and ignores the declared length of `executionCalldata`; this contract copies exactly the declared length and decodes it with `abi.decode`, which reverts on any out-of-bounds offset. An encoding whose offsets point past the declared length is therefore executed by Kernel but rejected here.
- Both read the outer `bytes executionCalldata` through the ABI offset and length words, so non-canonical offsets resolve to the same bytes.
- Dirty upper bits in a batch element's `target` revert in `abi.decode`; Kernel's Solidity-level access to `Execution.target` in calldata also validates it under ABI coder v2.

### 3.2 ERC-4337 and ERC-7562 validation-phase rules

| # | Assumption | Verified by |
| --- | --- | --- |
| E1 | The validation path (`checkUserOpPolicy`) reads only storage associated with the account: every per-account mapping has the account as its innermost key (ERC-7562 associated storage). | `test_validation_readsOnlyAccountAssociatedStorage` records every slot read and checks each is one derived with the account as innermost key, and that nothing is written |
| E2 | The validation path uses no opcode ERC-7562 bans for unstaked entities (`TIMESTAMP`, `NUMBER`, `BALANCE`, `GASPRICE`, `BLOCKHASH`, `COINBASE`, and others). | Code review; `settlementAsset` is an immutable (code, not storage). Not checked by a tracer |
| E3 | The bundlers used on Monad accept these reads and this policy, unstaked. | **Not verified.** A fork runs no bundler. See section 7 |
| E4 | The daily cap cannot be checked in validation because ERC-7562 forbids `TIMESTAMP` there; a breach surfaces as an included operation that reverts in execution and pays gas. | Fork (`test_fork_dailyCapBreachRevertsInExecutionAndRecordsNothing`) |

### 3.3 Settlement asset

| # | Assumption | Verified by |
| --- | --- | --- |
| A1 | `transfer(to, amount)` and `approve(spender, amount)` have standard semantics: the counted `amount` is exactly what moves or is approved. No fee-on-transfer, rebasing, or hooks on the recipient. | Assumption about USDC. Tests use a mock token |
| A2 | No selector other than `transfer` and `approve` on the asset can move it uncounted, because `setAllowed` refuses every other selector and `check` refuses them again. | `testFuzz_setAllowed_settlementAssetAdmitsOnlyTransferAndApprove`, `test_check_rejectsUncountedSettlementSelectorEvenIfStored` |
| A3 | The asset's signature-authorized paths (EIP-3009 `transferWithAuthorization`, EIP-2612 `permit`) are reachable from a smart account only through ERC-1271, which this policy blocks by default. On Monad mainnet's USDC, those paths accept ERC-1271 signatures (section 8, item 5). | Fork for the default; Monad mainnet fork for the asset behavior (`test/fork/X402MainnetFork.t.sol`) |
| A4 | USDC is an upgradeable proxy controlled by its issuer, and can blocklist addresses. An upgrade could change A1. A blocklisted account's counted transfer reverts in execution, which reverts the hook's record with it under exec type default. | Assumption; not testable here |

### 3.4 Chain

- Block timestamps never decrease. `_windowTotal` computes `hour - b.hour` with checked arithmetic, so a bucket written at a later hour than the current one would revert every later `record` for that account (fail closed, a denial of service for that account only). Monad block timestamps are assumed monotonic per EVM rules; not verified against Monad's specification.
- Monad supports the opcodes the compiler emits for the `cancun` target, `PUSH0` among them. The fork test deploys and runs the contract under forge's Monad EVM selection, which is evidence but not a deployment.

## 4. Invariants and the tests that check them

| ID | Invariant | Source | Tests |
| --- | --- | --- | --- |
| I1 | No accepted operation counts more than `perTxCap`, summed over every call in the operation | `THREAT-MODEL.md` invariant 1 | `invariant_perTxCapNeverExceeded`; `testFuzz_check_perTxCapOnSingleCall`; `testFuzz_check_perTxCapOnBatchSum`; `test_check_hugeAmountsDoNotOverflow`; `test_e2e_batchOverPerTxCapRejectedInValidation`; `test_fork_batchOverPerTxCapRejectedInValidation` |
| I2 | No 24-hour period holds more than `dailyCap` of accepted spend | `THREAT-MODEL.md` invariant 1 | `invariant_rolling24hSpendWithinDailyCap`; `invariant_windowTotalMatchesModel`; `testFuzz_window_matchesModelAcrossDays`; `test_window_boundaryAtHour25`; `test_window_lateThenEarlyBurstIsBounded`; `test_window_bucketSlotReuseDropsStaleHour`; `test_fork_dailyCapBreachRevertsInExecutionAndRecordsNothing` |
| I3 | No call outside the allowlist is accepted, at any amount | `THREAT-MODEL.md` invariant 11 | `invariant_allowlistAlwaysEnforced`; `testFuzz_check_rejectsNonAllowlistedTargetRegardlessOfAmount`; `testFuzz_check_rejectsNonAllowlistedSelectorOnAllowlistedTarget`; `test_check_rejectsAccountWithoutAllowlist` |
| I4 | No call to the policy contract or the account itself is accepted, even if allowlisted | `ARCHITECTURE.md` 16.3, self-protection | `test_check_rejectsPolicyAndAccountTargetsEvenIfAllowlisted`; `test_e2e_sessionKeyCannotRaiseOwnCaps`; `test_fork_sessionKeyCannotReachPolicyEvenIfAllowlisted`; the invariant handler allowlists both and counts acceptances |
| I5 | The recipient of a `transfer` or `approve` on the settlement asset or on a traded asset has an allowed selector and is not the settlement asset, a traded asset, the policy, or the account | `THREAT-MODEL.md` invariant 11 | `invariant_recipientRuleAndNativeValueEnforced`; `testFuzz_check_rejectsRecipientWithoutAllowedSelector`; `test_check_rejectsRecipientThatIsAssetPolicyOrAccount`; `test_check_recipientRuleFollowsAllowlistRemoval`; `testFuzz_check_tradedAssetCallToAnyOtherRecipientIsRejected`; `test_check_aTradedAssetIsNeverARecipient`; `test_check_rejectsMalformedTradedAssetCalls`; `test_e2e_tradedAssetApproveToRouterOnlyAndUncounted`; `test_fork_tradedAssetApproveIsRecipientCheckedAndUncounted` |
| I6 | Nonzero native value is never accepted | `ARCHITECTURE.md` 16.3 | `invariant_recipientRuleAndNativeValueEnforced`; `testFuzz_check_rejectsNativeValue` |
| I7 | No allowlist entry can move the settlement asset uncounted | `ARCHITECTURE.md` 16.3 | `testFuzz_setAllowed_settlementAssetAdmitsOnlyTransferAndApprove`; `test_setAllowed_rejectsUncountedSettlementSelectors`; `test_check_rejectsUncountedSettlementSelectorEvenIfStored` |
| I8 | `record` never trusts validation: it reruns every rule, and accepts nothing `check` rejects | `IAgentSpendPolicy` NatSpec | `invariant_checkAgreesWithModel`; `test_record_runsTheValidationRulesAgain` |
| I9 | An account whose limits were never set fails every counted call (fail closed) | `THREAT-MODEL.md` invariant 10 | `test_check_failsClosedWhenLimitsNeverSet`; `test_record_failsClosedWhenLimitsNeverSet` |
| I10 | State is per account: no account's calls read or write another's limits, allowlist, or window | Design | `test_setLimits_isPerAccountAndEmits`; `test_record_isKeyedByMsgSender`; `test_hook_recordsForCallingAccount` |
| I11 | Only `execute` with call type single or batch and exec type default or try is accepted; delegatecall, static, other call types, and every other account selector are rejected | `ARCHITECTURE.md` 16.3 | `test_policy_rejectsDelegatecall`; `testFuzz_policy_rejectsEveryOtherCallType`; `testFuzz_policy_rejectsUnknownExecType`; `test_policy_rejectsOtherAccountSelectors`; `test_policy_rejectsMalformedExecutionData`; `test_fork_delegatecallRejectedInValidation` |
| I12 | The ERC-1271 signature policy never approves | `ARCHITECTURE.md` 16.3 | `test_signaturePolicyAlwaysFails`; `test_fork_sessionKeyErc1271SignatureFailsByDefault` |
| I13 | Validation reads only account-associated storage and writes nothing | ERC-7562 | `test_validation_readsOnlyAccountAssociatedStorage`, which since the traded-asset change includes a traded-asset call and expects the `_tradedAsset[target][account]` slots it reads, both with the account as innermost key |
| I14 | No token call outside the settlement asset escapes the recipient rule: only a traded asset may hold `transfer` or `approve`, a traded asset admits no other selector, its calls count 0 against `perTxCap` and the window, and a token is marked or unmarked only while no selector is allowed on it | `ARCHITECTURE.md` 16.3, traded assets | `invariant_tradedAssetMarkingRefusesWhatItMust`; `invariant_checkAgreesWithModel` (the model counts traded-asset calls as 0); `testFuzz_setAllowed_tradedAssetAdmitsOnlyTransferAndApprove`; `testFuzz_setAllowed_rejectsTokenSelectorsOnAnyOtherTarget`; `test_setTradedAsset_rejectsTheAssetPolicyAccountZeroAndAnAllowlistedTarget`; `test_setTradedAsset_changesOnlyWhileNoSelectorIsAllowed`; `test_check_rejectsOtherTradedAssetSelectorsEvenIfStored`; `test_check_tradedAssetCallToTheRouterIsAcceptedAndCountsNothing`; `test_record_tradedAssetCallsAddNothingToTheWindow` |

The invariant suite (`test/AgentSpendPolicy.invariant.t.sol`) keeps an independent model of the allowlist and of accepted spend, drives random batches over a pool of allowlisted and non-allowlisted targets (including the policy and the account, both allowlisted), random selectors, recipients, and amounts, allowlist toggles, traded-asset marking and unmarking, close-shaped approves on a traded asset, and time jumps across hour and day boundaries, and counts every acceptance the model says must be a rejection. Configuration: 256 runs, depth 64, `fail_on_revert = true`; fuzz tests run 1000 cases.

## 5. Test suite and coverage

| Suite | File | What it covers |
| --- | --- | --- |
| Unit and fuzz | `test/AgentSpendPolicy.t.sol` | Every rule of `check`, `record`, the window, configuration, and the storage-read check |
| Kernel adapter | `test/KernelIntegration.t.sol` | The policy and hook entry points with calldata built to Kernel's encoding, and an end-to-end flow through a test double of Kernel (`test/utils/Mocks.sol`) |
| Invariant | `test/AgentSpendPolicy.invariant.t.sol` | I1 to I8 and I14 over fuzzed sequences |
| Fork (opt-in) | `test/fork/KernelV31Fork.t.sol` | The deployed Kernel v3.1 contracts on Monad testnet, section 7 |

Coverage of `src/` (test and mock files excluded), from `forge coverage` with forge 1.8.5:

| File | Lines | Statements | Branches | Functions |
| --- | --- | --- | --- | --- |
| `src/AgentSpendPolicy.sol` | 100.00% (120/120) | 100.00% (163/163) | 100.00% (31/31) | 100.00% (25/25) |

Regenerated on 2026-10-10 after the traded-asset change, and again after rebasing onto the `X402PaymentValidator` change (107 tests passed, the two fork suites skipped; `AgentSpendPolicy.sol` figures unchanged by the rebase, which touched only its comments; the validator's own figures are in the same `summary.txt`; before the change: 106/106 lines, 139/139 statements, 26/26 branches, 23/23 functions). Before this package, coverage was 99.06% of lines and 96.15% of branches. The one uncovered branch was the second, independent refusal of an uncounted settlement-asset selector in `_check`, unreachable through `setAllowed` by design. `test_check_rejectsUncountedSettlementSelectorEvenIfStored` writes such an entry into storage directly to show `check` refuses it on its own. Coverage is a floor, not evidence of correctness: the invariant and fuzz suites in section 4 are the substantive checks. The same run reports `X402PaymentValidator` (section 12.3) and `AgentReallocation` (section 13.4).

Regenerated again on 2026-10-12 at commit `513e943`, with forge 1.8.5: 15 suites, 188 tests passed, 0 failed, 3 skipped (the three opt-in fork suites). The per-file figures for all three contracts are unchanged from those above and in 12.3 and 13.4; the totals are 99.72% of lines (360/361), 99.61% of statements (516/518), 97.94% of branches (95/97), and 100% of functions (69/69). The test count rose from 178 because `test/DeployTestnet.t.sol` and `test/WmonMarketScripts.t.sol` cover the deployment and market scripts, which are excluded from the coverage figures. Section 15 lists every suite.

To regenerate, from the repository root, with Foundry 1.8.5 installed:

```sh
bash contracts/audit/coverage.sh
```

It writes `contracts/audit/coverage-report/summary.txt` and `contracts/audit/coverage-report/lcov.info`. The fork suite is skipped in this run, since it needs `--fork-url`. Coverage disables the optimizer, so gas figures in that output do not match a normal build.

## 6. Static analysis and triage

First run on 2026-10-10 against this package's sources, and re-run the same day, with the same tool versions and commands, after the traded-asset change, on the tree before `X402PaymentValidator.sol` was added (section 12.4 covers that file). Since that re-run, `AgentSpendPolicy.sol` and `IAgentSpendPolicy.sol` changed only in comments. The re-run's results are below; every finding of the first run reappears, and the only differences are listed.

- **Slither 0.11.4**, installed from PyPI into a throwaway virtual environment: `slither . --filter-paths "lib/|test/"` from `contracts/` (it runs `forge clean` and a forced build first). 100 detectors. First run: 6 results from 5 detectors (`timestamp` reports two functions). Re-run: 7 results from 6 detectors. `cyclomatic-complexity` on `_check` rose from 12 to 13 (the traded-asset branch), and `pragma` reported the exact pragma of the implementation against the caret pragma of the two interfaces (S6).
- **Aderyn 0.6.8**, installed from Cyfrin's npm package `@cyfrin/aderyn`: `aderyn . --src src` from `contracts/`. 88 detectors, 1 high and 6 low results, the same findings in both runs; nSLOC 261 in the re-run (239 before).
- **forge lint** (Foundry 1.8.5, built in; it also runs on every `forge build`): `forge lint` from `contracts/`. On `src/`, in both runs: 7 `unsafe-typecast`, 8 `require-revert-in-loop`, 1 `block-timestamp`, 1 `reentrancy-events`. On `test/`: 4 `environment-read-across-mutation` in the first run, 3 in the re-run (the one fixed under L5).

Every finding is triaged below. None is dropped.

| # | Tool | Finding | Location | Triage |
| --- | --- | --- | --- | --- |
| S1 | Slither | `weak-prng`: `hour % BUCKETS` | `_record` | **False positive.** The modulo indexes a 25-slot ring buffer by hour. No randomness is derived or relied on |
| S2 | Slither | `locked-ether`: payable functions, no withdrawal | `checkUserOpPolicy`, `preCheck`, `postCheck`, `onInstall`, `onUninstall` | **Accepted risk.** The functions are `payable` because Kernel's `IPolicy` and `IHook` declare them so, and keeping the declared mutability avoids any doubt about matching the interface. Kernel v3.1 sends no value to any of them (section 3.1, K1 and K3, from source). Ether can therefore reach the contract only if a third party sends it directly, which is that party's own loss and touches no system funds; native value can also always be forced in with `selfdestruct`. A withdrawal function would add an owner role this contract deliberately does not have. Rejecting `msg.value != 0` was considered and not adopted: it protects only that third party and adds a revert path to every validation |
| S3 | Slither | `timestamp`: comparisons using `block.timestamp` | `_record`, `_windowTotal` | **Accepted by design.** The window is hourly; a block producer's influence over a timestamp is far below one hour, and the window rule over-counts rather than under-counts at the hour edge (`ARCHITECTURE.md` 16.3). Timestamp is read only in execution, never in validation |
| S4 | Slither | `assembly` | `_word` | **Accepted, reviewed.** One `mload` of a 32-byte word. Both call sites check `data.length >= 68` first, so the read stays inside `data`. Marked `memory-safe` correctly: it only reads |
| S6 | Slither | `pragma`: different versions used | `AgentSpendPolicy.sol` (`0.8.24`) and the two interfaces (`^0.8.24`) | **Accepted, by design.** Same decision as D7: the implementation is pinned, the interfaces stay importable |
| S5 | Slither | `cyclomatic-complexity` 12, 13 since the traded-asset change | `_check` | **Accepted, informational.** One linear rule per line, each reverting with a distinct error; splitting it would spread a single rule set across functions without reducing what an auditor must read |
| D1 | Aderyn H-1 | Contract locks Ether without a withdraw function | `AgentSpendPolicy` | Same as S2 |
| D2 | Aderyn L-1 | Empty block | `postCheck`, `onInstall`, `onUninstall` | **False positive.** Required interface functions whose correct behavior is to do nothing: configuration never comes from installation data, and nothing is checked after execution |
| D3 | Aderyn L-2 | Literal instead of constant (16 instances) | `_check`, `_decodeExecute`, `checkUserOpPolicy` | **Accepted, informational.** The literals are ABI layout offsets (4-byte selector, 20-byte address, 32-byte words, 68-byte two-argument call), each next to the slice it bounds. Named constants would not make the layout easier to check against the ABI specification |
| D4 | Aderyn L-3 | `PUSH0` opcode | All files | **Accepted, to verify at deployment.** The target is `cancun` deliberately; Monad is assumed to support it (section 3.4). A chain without `PUSH0` would fail at deployment, not at run time |
| D5 | Aderyn L-4 | Loop contains `revert` | `_check` | **False positive.** All-or-nothing is the required semantics: one disallowed call must reject the whole operation |
| D6 | Aderyn L-5 | Unchecked return | `checkUserOpPolicy`, `_check(...)` result ignored | **False positive.** `_check` reverts on every failure; its return value, the counted total, is needed only by `record` |
| D7 | Aderyn L-6 | Unspecific pragma | All three files | **Fixed for the implementation.** `AgentSpendPolicy.sol` now pins `pragma solidity 0.8.24;`. The deployed bytecode is byte-for-byte unchanged (compiler pinned in `foundry.toml` already). The two interface files keep `^0.8.24` so integrators can import them |
| L1 | forge lint | `unsafe-typecast` (7) | `EXECUTE_SELECTOR`, `EXECUTE_USER_OP_SELECTOR`, `bytes4(data)` in `_check` and `_decodeExecute`, `address(uint160(recipientWord))`, `uint64(hour)`, `uint192(total)` | **False positive, each bounded.** The two constants take a selector from a hash by design. `bytes4(data)` reads the selector; both sites reject `data.length < 4` before relying on it. The recipient word is rejected above `type(uint160).max` on the line before the cast. `hour` is `block.timestamp / 3600`, far below `2**64`. `total` is at most `dailyCap`, a `uint128`, checked on the line before |
| L2 | forge lint | `require-revert-in-loop` (8) | `_check` | Same as D5 |
| L3 | forge lint | `block-timestamp` | `_record` | Same as S3 |
| L4 | forge lint | `reentrancy-events`: `Spent` emitted after an external call | `_record` | **False positive.** `_record` makes no external call: `_check` and `_windowTotal` are internal and read only this contract's storage |
| L5 | forge lint | `environment-read-across-mutation` (4) | `test/AgentSpendPolicy.t.sol` | **Fixed in one place, false positive in three.** In `test_window_bucketSlotReuseDropsStaleHour`, `block.timestamp` was read after a `vm.warp` to compute the next warp, which can see a stale value under some compiler settings; it now uses `vm.getBlockTimestamp()`. The other three read `block.timestamp` once, before any warp in the test |

To reproduce, from `contracts/`:

```sh
python3 -m venv /tmp/slither-venv && /tmp/slither-venv/bin/pip install slither-analyzer==0.11.4
/tmp/slither-venv/bin/slither . --filter-paths "lib/|test/"

npm install --prefix /tmp/aderyn @cyfrin/aderyn@0.6.8
/tmp/aderyn/node_modules/.bin/aderyn . --src src -o /tmp/aderyn-report.md

forge lint
```

## 7. Testing against real Kernel v3.1

### 7.1 Done: fork test against the deployed contracts

`contracts/test/fork/KernelV31Fork.t.sol` replaces the test double with the contracts ZeroDev deployed on Monad testnet (chain 10143), at the addresses in ZeroDev's SDK constants (`@zerodev/sdk` 5.5.10, `@zerodev/ecdsa-validator` 5.4.9, `@zerodev/permissions` 5.6.3); `setUp` checks each has code:

| Contract | Address |
| --- | --- |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| Kernel v3.1 implementation | `0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D` |
| Kernel v3.1 factory | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` |
| ECDSA validator (root) | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` |
| ECDSA signer (permission) | `0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF` |

It adds no dependency: the few EntryPoint and Kernel functions it calls are declared in the test file. Every operation goes through `EntryPoint.handleOps`. The flow:

1. Creates an account through the real factory with the ECDSA root validator.
2. Configures limits and the allowlist as the owner, through a root-validator user operation.
3. Enables the session-key permission (ECDSA signer plus this contract as policy, and this contract as the permission's hook) in Kernel's enable mode, the path ZeroDev's SDK uses for v3.1, signed by the owner over Kernel's EIP-712 enable digest, inside the first session-key operation.

Tests: a batch within the caps executes and is recorded; a single call; a batch over `perTxCap` fails validation with `FailedOpWithRevert(0, "AA23 reverted", PerTxCapExceeded(...))`; a daily-cap breach is included, reverts in execution with `DailyCapExceeded` in `UserOperationRevertReason`, and records and moves nothing; delegatecall fails validation with `UnsupportedExecMode`; a session-key call to `setLimits` fails validation with `CallNotAllowed` even with a mistaken allowlist entry for it; and the session key's ERC-1271 signature reverts with Kernel's `PolicyFailed(0)`. All 7 passed on 2026-10-10 against the latest Monad testnet block. After the traded-asset change an eighth test was added: the owner marks an ERC-20 as a traded asset and allows its `approve` through the root validator, the session key's close-shaped batch (approve the router on it, then a router call) executes and adds nothing to the window, and an approve of it to another address fails validation with `RecipientNotAllowed`. All 8 passed on 2026-10-10 against the latest Monad testnet block, through `https://testnet-rpc.monad.xyz`.

Run, from `contracts/`:

```sh
forge test --match-path test/fork/KernelV31Fork.t.sol --fork-url "$MONAD_TESTNET_RPC_URL"
```

`https://testnet-rpc.monad.xyz` is Monad's public testnet endpoint. Add `--fork-block-number <n>` to pin a block. Without `--fork-url` the suite skips, so CI is unaffected. Forge 1.8.5 refuses to create a Monad fork from inside a test (`vm.createSelectFork`) because it selects the EVM variant at startup, which is why the fork is chosen on the command line.

### 7.2 Remaining: through a bundler on Monad testnet

A fork runs no bundler, so it cannot show that the bundlers used on Monad accept this policy's validation-phase storage reads and opcodes under ERC-7562 (assumption E3), nor that Monad's own client executes the operations the same way as forge's EVM. The step that closes both:

1. Deploy `AgentSpendPolicy` on Monad testnet with a test settlement asset. Done on 2026-10-11 (section 14); one account deployment through ZeroDev's bundler has installed it (`SECURITY.md` section 13), but no spending operation has been validated by it through a bundler.
2. Run the opt-in testnet test in `libs/wallets` (`WALLETS_TESTNET=1`, see `libs/wallets/README.md`), which installs the policy as policy and hook through ZeroDev's SDK and sends user operations through the ZeroDev bundler.
3. Repeat the cases of 7.1 there: within caps, over `perTxCap` (expect the bundler to refuse it in simulation), a daily-cap breach (expect inclusion and an execution revert), delegatecall, and the ERC-1271 default.
4. Record the bundler, its version or endpoint, and the result in `ARCHITECTURE.md` 16.3, and remove assumption E3 from this list.

This step needs testnet funds and a bundler endpoint, so it is a manual run, not CI.

## 8. Known limitations and residual risk

1. **Kernel integration is verified on a fork, not through a bundler.** Section 7.2. Until that run, ERC-7562 acceptance on Monad is an assumption.
2. **Try mode over-counts.** Exec type `0x01` (try) is accepted, and `record` counts every counted call in the operation, including one that later fails. This over-counts and never under-counts: the cost is headroom, not safety.
3. **`perTxCap` of 0 rejects every counted call, including an amount of 0.** This is the fail-closed default for an account never configured. It also means an owner who freezes an agent by setting `perTxCap` to 0 blocks the session key from revoking an approval with `approve(spender, 0)`; the owner can still revoke through the root validator.
4. **`perTxCap > 0` with `dailyCap` of 0, or a window already at the cap, passes validation and reverts in execution.** Each such operation is included and pays gas. A compromised session key can therefore spend the account's gas balance (or a paymaster's sponsorship) on operations that revert, and it can do the same with any allowlisted call that reverts. Gas spend is not bounded by this contract; a paymaster or gas policy and off-chain monitoring are the controls.
5. **The signature policy always fails, and the skip-signature flag is never set.** `checkSignaturePolicy` always fails, so a session key cannot produce an ERC-1271 signature; the owner could override that only with Kernel's skip-signature flag, which the design forbids for every agent (`ARCHITECTURE.md` 16.3). On 2026-10-10, calls to Monad mainnet's USDC (`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`) with a contract as `from` returned the ERC-1271 path's invalid-signature errors (`FiatTokenV2: invalid signature`, `EIP2612: invalid signature`) for the `bytes`-signature `transferWithAuthorization` and `permit`, where an externally owned `from` gets the ECDSA length error. That indicates the token accepts ERC-1271 signatures for both, though no signature was actually accepted in that check. A Monad mainnet fork then confirmed it (`test_fork_skipSignatureFlagWouldLetASessionKeyPermitTheWholeBalance`, block 112242207): with the flag, a session key's signature made USDC grant a `permit` of the whole balance to an arbitrary spender, outside both caps and the recipient rule. The flag must never be set; x402 uses the separate validator of section 12 instead.
6. **x402 is outside this contract.** x402 settles through EIP-3009 authorizations (the x402 specification's default for USDC, `ARCHITECTURE.md` 16.3), which never pass through `check` or `record`. `X402PaymentValidator` (section 12) bounds them with its own payee list and rate bound, which adds to `dailyCap`.
7. **Uncounted calls are not decoded.** Calls to the Kuru router and the reallocation contract count 0. If either can be made to forward funds to an arbitrary address, or to pull more than the account approved, the recipient rule and the caps do not see it. This is a property of those contracts (issue #20 for the router).
8. **The allowlist is the owner's responsibility beyond the two self-protection rules.** Only the policy and the account are refused as targets regardless of configuration. Allowlisting the EntryPoint (`withdrawTo` moves the account's deposit), a Kernel module, a validator, or any contract that forwards calls would hand the session key a path this policy does not inspect. Any allowlisted target that is not a token also becomes a valid recipient under the derived recipient rule.
9. **The hook must be installed with the policy.** If the policy is installed on a permission without this contract as that permission's hook, validation still applies the per-transaction rules, but `record` never runs and the daily cap does not apply. Kernel does not tie the two together; the installer must.
10. **Configuration persists across uninstall and reinstall.** `onInstall` and `onUninstall` change no state, so limits and allowlist entries outlive a permission's removal and apply again if the policy is reinstalled.
11. **Approvals are counted when set, not when used.** A counted `approve` for an amount uses that much of `perTxCap` and the window at the moment it is set; a later pull by the spender is not counted again. Allowance left unused stays available to the spender beyond the window in which it was counted.
12. **Window shape.** The window total covers 24 to 25 hours, so it can over-count by up to one hour of spend; it never under-counts. `record` reads 25 storage slots per operation, a fixed gas cost per counted or uncounted operation.
13. **The settlement asset's issuer can change its behavior.** USDC is upgradeable and can blocklist addresses (section 3.3, A4).
14. **No formal verification.** The guarantees rest on review, unit, fuzz, invariant, and fork tests.
15. **A traded asset's amounts are not capped.** A `transfer` or `approve` on a traded asset is held to the recipient rule and counts 0, because the caps are denominated in the settlement asset and the contract has no price for the token. A compromised session key can therefore approve the router for the account's whole traded-asset balance and sell it through the router with any `minAmountOut`, converting the position to the settlement asset at a bad price. It cannot send the token anywhere else. This is the same exposure a buy already has (a bad trade within the router), widened to the whole position rather than one `perTxCap`; the off-chain RiskModule bounds the size of a close by the position, not this contract.
16. **The traded-asset mark is the owner's responsibility.** Only an owner can mark a token. A marked token's behavior (for example WETH's) is assumed standard ERC-20, as A1 assumes for the settlement asset; a token with hooks, fee-on-transfer, or an upgrade path could behave otherwise. Unmarking requires removing its selectors first, so the rule cannot be dropped under a live entry.

## 9. Out of scope

- ZeroDev Kernel v3.1, its validators, signers, and factory; the ERC-4337 EntryPoint v0.7. Assumed correct as deployed; their behavior that this contract depends on is listed in section 3.1.
- The settlement asset (USDC) and its issuer's controls, and any traded asset (WETH in the default deployment).
- The Kuru router and any other allowlisted target.
- Off-chain components: the RiskModule (`libs/risk`), the wallet library (`libs/wallets`), the agent runtime, and any bundler or paymaster.
- Test code, mocks, and the fork test, except as evidence for the claims above.

## 10. Adding the reallocation contract

Done: the reallocation contract is section 13, with its scope, trust model, integration assumptions (including the counted `approve` of section 8, item 7, now an audited property, 13.2), invariants `THREAT-MODEL.md` 3, 4, 12, 13, and 15 mapped to tests, coverage, static-analysis triage, and known limitations. `coverage.sh` covers all three contracts again (13.4).

## 11. Request for proposal (draft)

This is a draft for issue #46. It has not been sent to any auditor.

**Project**: monadeum, an agent economy on Monad in which each agent trades through a ZeroDev Kernel v3.1 smart account under a session key.

**Scope**: `AgentSpendPolicy` and its interfaces, 261 nSLOC in three files (section 1), `X402PaymentValidator`, 196 nSLOC (section 12), and `AgentReallocation` with its interface, 370 nSLOC (section 13): 827 nSLOC in all, at a pinned commit.

**What we ask the auditor to focus on**:

1. Whether any operation a fully compromised session key can submit moves the settlement asset beyond `perTxCap` per operation or `dailyCap` per 24 hours, or to a recipient outside the derived recipient rule.
2. Parser equivalence between `_decodeExecute` and Kernel v3.1's `ExecLib` for every byte string Kernel would execute (section 3.1).
3. The self-protection rules: whether a session key can reach `setLimits`, `setAllowed`, `setTradedAsset`, or the account's module functions by any route.
4. The traded-asset rule (I14): whether any configuration reachable through `setAllowed` and `setTradedAsset` lets a token call outside the settlement asset escape the recipient rule.
5. ERC-7562 compliance of the validation path for an unstaked policy (section 3.2).
6. The rolling window arithmetic and its edge cases.
7. The known limitations in section 8: whether any is worse than stated, and whether any accepted risk should be fixed instead.
8. `X402PaymentValidator`: whether any signature a fully compromised x402 key can produce moves the settlement asset other than to a listed payee, above `maxValue`, or beyond the 24-hour rate bound, and whether the self-protection rule in section 12.1 holds against direct calls from the account (section 12).
9. `AgentReallocation`: whether any sequence of calls by a compromised session key, a compromised operator, or both moves capital across owners, debits an account other than the caller, exceeds the cap, floor, or ceiling, or opens evaluations faster than `minEvaluationInterval` (section 13).

**Materials provided**: this README, the interface NatSpec, `ARCHITECTURE.md` section 16.3, `THREAT-MODEL.md` section 7, the test suites, the coverage report, the static-analysis triage, and the testnet deployment record with its bytecode check (section 14).

**Timeline assumptions** (to confirm with the auditor, not commitments):

- Size: 827 nSLOC across three contracts. Our working estimate is 3 to 5 auditor-days for `AgentSpendPolicy`, plus 2 to 3 for `X402PaymentValidator` and 4 to 6 for `AgentReallocation`. These are assumptions, not quotes.
- Start: all three contracts are merged, so they can be audited in one engagement.
- Fix review: one round of fix review included, on the commits that resolve findings.
- Gate: no real user-controlled capital on testnet or mainnet before the report is final and every finding is resolved or accepted in `SECURITY.md` (section 3 of that document).

**Deliverables requested**: a written report with severity-rated findings, a fix-review addendum, and permission to publish the final report in this repository.

## 12. X402PaymentValidator

`contracts/src/X402PaymentValidator.sol` is in scope for the same engagement, with the same gate: it carries no real user-controlled capital before the audit. It is a separate contract from `AgentSpendPolicy` and does not change any file in section 1. `ARCHITECTURE.md` section 16.3 ("x402 signature path") is its design record, including the options rejected and why.

### 12.1 Scope and model

| File | Lines | Role |
| --- | --- | --- |
| `contracts/src/X402PaymentValidator.sol` | 196 | Kernel v3.1 validator (module type 1) that approves ERC-1271 signatures only for bounded EIP-3009 `transferWithAuthorization` payments, plus its local `IValidator`, Kernel-view, and domain-separator interfaces |

196 is also Aderyn 0.6.8's nSLOC for the file (run 2026-10-10), so the package now totals 457 nSLOC (261 in section 1 plus 196). Same compiler, settings, and toolchain as section 1. No owner, admin, upgradeability, or pause; the settlement asset is an immutable constructor argument; configuration is keyed by account.

Each agent account has two keys besides the owner: the trading session key (a permission with `AgentSpendPolicy` as policy and hook) and an x402 key, which only this validator trusts. The owner installs the validator through the root validator with `abi.encode(signer, maxValue, paymentsPerEpoch, maxValidity, payees)`.

What it enforces, in `isValidSignatureWithSender(sender, hash, data)` called by the account:

- the account's configuration is live;
- `data` is exactly `abi.encode(to, value, validAfter, validBefore, slot) || r || s || v` (225 bytes);
- `to` is a listed payee; `0 < value <= maxValue`; `0 < validBefore - validAfter <= maxValidity <= 3600`; `slot < paymentsPerEpoch`;
- `hash` equals Kernel's wrapping, under the account's EIP-712 domain, of the settlement asset's digest of `TransferWithAuthorization(account, to, value, validAfter, validBefore, keccak256(abi.encode(NONCE_TAG, account, validAfter / 3600, slot)))`;
- `(r, s, v)` recovers to the configured signer, with low `s` and `v` in {27, 28}.

`validateUserOp` always returns 1 (failed). `sender` is not checked, by design (16.3). Trust model differences from section 2: the x402 key is assumed fully compromised and the validator must bound everything it can sign; the listed payees are third parties the owner chose, trusted for nothing.

### 12.2 Integration assumptions

| # | Assumption | Verified by |
| --- | --- | --- |
| X1 | Kernel v3.1 `isValidSignature` in validator mode (`0x01 | validator | rest`) calls `validator.isValidSignatureWithSender(msg.sender, _toWrappedHash(hash), rest)` from the account, after checking only that the validation's hook is nonzero | Source; mainnet fork |
| X2 | `_toWrappedHash(h)` is the EIP-712 hash of `Kernel(bytes32 hash)` (`KERNEL_WRAPPER_TYPE_HASH`) under the domain the account's `eip712Domain()` returns | Source; mainnet fork (the validator computes it from `eip712Domain()` and the payment settles) |
| X3 | Kernel records a validation (hook nonzero) before calling `onInstall`, and clears the hook before calling `onUninstall`; `validationConfig(bytes21)` reads that state | Source (`_installValidation`, `_uninstallValidation`); mainnet fork (install and uninstall through root operations) |
| X4 | On the permission path, a policy cannot receive per-policy data on ERC-1271 (`SignerPrefixNotPresent`), which is why this is a validator | Source; mainnet fork (`test_fork_permissionPathCannotCarryPolicyData`) |
| X5 | Kernel's ERC-1271 path does not read `validNonceFrom`; uninstalling is the revocation | Source |
| X6 | The settlement asset accepts each EIP-3009 nonce once per authorizer, requires `validAfter < now < validBefore`, and checks a contract authorizer through ERC-1271 at settlement | FiatToken v2.2 behavior; mainnet fork against Monad's USDC (settlement, nonce reuse refused, uninstall invalidates a signed authorization) |
| X7 | The settlement asset's `DOMAIN_SEPARATOR()` is its EIP-712 domain for `TransferWithAuthorization`, and its type hash equals `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` | Read from Monad mainnet USDC on 2026-10-10; mainnet fork |
| X8 | The facilitator used on Monad accepts ERC-1271 signatures for EIP-3009 | **Not verified.** The x402 reference facilitator does (16.3, fact 2) |

### 12.3 Invariants and tests

| ID | Invariant | Tests |
| --- | --- | --- |
| V1 | Every movement out of the account through this path goes to a listed payee for at most `maxValue` | `invariant_onlyListedPayeesWithinMaxValue`; `test_transferToAnUnlistedAddressIsRejected`; `test_unboundedTransferWithAuthorizationIsRejected`; `test_fork_unboundedTransferWithAuthorizationRefused` |
| V2 | No 24-hour period sees more than `26 * paymentsPerEpoch * maxValue` leave the account | `invariant_rolling24hOutflowWithinBound`; `test_payment_everySlotOfAnHourOnceThenNoMore`; `test_payment_aSlotIsFreshAgainInTheNextHour` |
| V3 | No `permit`, `receiveWithAuthorization`, other token, other authorizer, or digest that differs from the supplied fields is approved | `invariant_noAllowanceEverGranted`; `testFuzz_permitNeverApproved`; `testFuzz_rejectsEveryOtherHash`; `test_permitForTheWholeBalanceIsRejected`; `test_receiveWithAuthorizationDigestIsRejected`; `test_anotherTokenDomainIsRejected`; `test_anotherAuthorizerIsRejected`; `test_randomNonceAsTheReferenceClientUsesIsRejected`; `test_unwrappedDigestIsRejected`; `test_fork_permitRefusedByTheX402Validator` |
| V4 | An honestly described, correctly signed authorization is approved exactly when every bound holds | `testFuzz_acceptsIffWithinBounds`; one test per bound |
| V5 | Only the configured key's low-s signature is approved | `test_validator_anotherKeyIsInvalid`; `test_validator_highSOrBadVIsInvalid` |
| V6 | No user operation is ever validated | `test_validateUserOp_alwaysFails` |
| V7 | Direct calls from the account cannot replace a live configuration or retire one Kernel lists | `invariant_configurationUnchanged`; `test_directCallsFromTheAccountCannotWidenALiveConfig`; `test_directInstallWhileKernelDoesNotListTheValidatorIsRefused` |
| V8 | Uninstalling stops every signature, including ones made earlier, and drops the payee list | `test_uninstallKillsOutstandingAuthorizationsAndDropsPayees`; `test_fork_uninstallKillsOutstandingAuthorization` |
| V9 | Configuration is validated and per account | `test_installValidatesConfiguration`; `test_configurationIsPerAccount`; `test_installFromANonKernelCallerReverts` |

The invariant handler acts as a fully compromised x402 key and, separately, as a session key that reaches the validator from the account: in-bounds and out-of-bounds payments, random nonces, lying fields, permits, and direct `onInstall`/`onUninstall` calls with a widened configuration, with time jumps across hours. Suites: `test/X402PaymentValidator.t.sol` (unit and fuzz), `test/X402PaymentValidator.invariant.t.sol`, and `test/fork/X402MainnetFork.t.sol` (opt-in, `--fork-url` at Monad mainnet; 7 tests passed on 2026-10-10, including the exact install and uninstall calls `libs/wallets` builds, including `test_fork_skipSignatureFlagWouldLetASessionKeyPermitTheWholeBalance`, which shows the risk behind section 8, item 5). Coverage of `src/X402PaymentValidator.sol` from `forge coverage` with forge 1.8.5: 100% of lines (72/72), statements (109/109), branches (17/17), and functions (16/16). `coverage.sh` includes it: the script excludes only `test/` and `script/`.

### 12.4 Static analysis

Run on 2026-10-10 against this file, with the same tools, versions, and commands as section 6: Slither 0.11.4 (`slither . --filter-paths "lib/|test/"`, 100 detectors), Aderyn 0.6.8 (`aderyn . --src src`, 88 detectors), and `forge lint` (Foundry 1.8.5). Every finding that names this file is listed; none is dropped. Slither's first run also reported `shadowing-local` twice (a local named `config` shadowed the `config` view in `isValidSignatureWithSender` and `_boundedDigest`); the locals were renamed to `cfg`, with no change in behavior or tests, and the rerun no longer reports it.

| # | Tool | Finding | Location | Triage |
| --- | --- | --- | --- | --- |
| XS1 | Slither | `locked-ether` | `onInstall`, `onUninstall`, `validateUserOp` | Same as XL1 |
| XS2 | Slither | `unused-return` | `kernelWrappedHash`, `eip712Domain()` | Same as XL4 |
| XS3 | Slither | `pragma`: two version constraints | all `src/` files | **Accepted, informational.** Same as D7: implementations pin `0.8.24`, the interface files keep `^0.8.24` |
| XS4 | Slither | `naming-convention` | `IEIP712DomainSeparator.DOMAIN_SEPARATOR()` | **False positive.** The name is fixed by EIP-2612 and FiatToken; renaming it would call a function the token does not have |
| XD1 | Aderyn H-1 | Contract locks Ether without a withdraw function | contract | Same as XL1 |
| XD2 | Aderyn L-1 | Costly operations (`SSTORE`) inside a loop | `onInstall` payee loop | **Accepted.** One store per listed payee, at most 8, only at install, an owner operation |
| XD3 | Aderyn L-2 | `ecrecover` signature malleability | `_recover` | **False positive.** `_recover` refuses `s` above secp256k1n / 2 and any `v` other than 27 or 28 before calling `ecrecover`, the same rule as OpenZeppelin's ECDSA (`test_validator_highSOrBadVIsInvalid`); replay is also prevented by the token's nonce registry |
| XD4 | Aderyn L-4 | Literal instead of constant (2) | `_recover`, the `32` and `64` slice offsets | **Accepted, informational.** Same as D3: ABI offsets next to the slice they bound |
| XD5 | Aderyn L-5 | `PUSH0` opcode | file | Same as D4 |
| XD6 | Aderyn L-6 | Loop contains `revert` | `onInstall` payee loop | Same as XL3 |
| XL1 | forge lint | `locked-ether` | contract | Same as S2: `onInstall`, `onUninstall`, and `validateUserOp` are `payable` because Kernel's interfaces declare them so; Kernel sends no value |
| XL2 | forge lint | `missing-events-access-control` | `onUninstall`, `delete _config[...]` | **False positive.** `Uninstalled` is emitted on the next line |
| XL3 | forge lint | `require-revert-in-loop` | `onInstall` payee loop | **False positive.** One bad payee must reject the whole install |
| XL4 | forge lint | `unused-return` | `kernelWrappedHash`, `eip712Domain()` | **False positive.** Only `name`, `version`, `chainId`, and `verifyingContract` enter the domain hash; Kernel's `fields` is `0x0f` (those four) |
| XL5 | forge lint | `unsafe-typecast` | `_listedByKernel`, `bytes21(abi.encodePacked(...))` | **False positive.** The packed value is exactly 21 bytes |

### 12.5 Known limitations

1. **Rate bound, not amount window.** The bound is per hour of `validAfter`, so up to 26 hours of slots can land in one 24-hour period, and it adds to `dailyCap` rather than sharing it. The deployment chooses `paymentsPerEpoch` and `maxValue` with that product in mind.
2. **Listed payees are trusted to be the providers.** A payee that colludes with an attacker receives up to the bound. The payee list is the owner's, fixed at install.
3. **Anyone can submit a signed authorization**, an EIP-3009 property: it can only pay its signed payee its signed amount once, inside its window.
4. **Exhausted slots fail closed**: once an hour's slots are used, the agent cannot pay until the next hour.
5. **Relies on Kernel v3.1 storage semantics** for the self-protection rule (X3). A different account implementation, or a Kernel version that changes install ordering, needs this rule rechecked; a caller that is not a Kernel account reverts on `validationConfig`.
6. **Facilitator acceptance is unverified** (X8). If the facilitator refuses ERC-1271 signatures, agents cannot pay x402; nothing fails open.
7. **Wired, off by default**: WalletsModule installs the validator in the deployment operation and uninstalls it on revocation, and the worker's payer is disabled until a facilitator on Monad is confirmed to accept ERC-1271 (`ARCHITECTURE.md` section 16.3). The x402 key has no production vault implementation yet (`SECURITY.md` section 11).

## 13. AgentReallocation

`contracts/src/AgentReallocation.sol` (merged in #105) is in scope for the same engagement, with the same gate. It does not change any file in sections 1 or 12, and it interacts with `AgentSpendPolicy` only through the counted `approve` described in 13.2. `ARCHITECTURE.md` section 16.5 is its design record, including the owner decisions accepted for testnet; `EVOLUTION.md` sections 3.1, 3.3, and 6 define the mechanism. Deployment does not turn reallocation on: every off-chain path that would submit a move or relay a policy is behind the reallocation switch, off by default (`ARCHITECTURE.md` section 5).

### 13.1 Scope and model

| File | nSLOC | Role |
| --- | --- | --- |
| `contracts/src/AgentReallocation.sol` | 280 | Implementation: moves, owner policy, operator registry, evaluation counter, roles |
| `contracts/src/IAgentReallocation.sol` | 90 | Interface and NatSpec specification |
| **Total** | **370** | |

nSLOC from Aderyn 0.6.8, run 2026-10-10. `AgentReallocation.sol` pins `pragma solidity 0.8.24;` and the interface keeps `^0.8.24` so that other contracts can import it (RS7), both compiled with the settings of section 1. No upgradeability, no pause. The settlement asset, the capital floor (`6 * 10^decimals / 100`, `decimals` read from the token at deployment), and `minEvaluationInterval` are immutable.

| Actor | Can | Cannot |
| --- | --- | --- |
| Source account (its session key) | Call `reallocate` to debit itself once per evaluation, after a counted `approve` of the total | Debit any other account; exceed the policy's cap, floor, or a sink's ceiling; move to another owner's agent |
| Owner (root wallet) | Commit or revoke its own policy, directly or by EIP-712 signature (EOA only, low-`s`); retire its own agents | Loosen any bound past the protocol constants; name another owner's agent |
| Operator (multisig contract) | Register agents (owner set once), set principal, advance the evaluation counter at most once per `minEvaluationInterval`, retire agents | Move capital; change an agent's owner; bypass a policy |
| Admin (multisig contract) | Replace the operator; propose a new admin (two-step) | Anything the operator cannot |
| Anyone else | Relay a signed policy or revocation | Anything else |

### 13.2 Integration assumptions

| # | Assumption | Verified by |
| --- | --- | --- |
| R1 | The settlement asset has standard `transferFrom` and `balanceOf` semantics; a token that delivers less, takes more, or returns false is refused by the balance checks | `test_feeOnTransferTokenReverts`, `test_sourceDebitedMoreThanTheTotalReverts`, `test_falseReturningTokenReverts` |
| R2 | A source is debited only through an allowance it set itself. With `AgentSpendPolicy`, that is a counted `approve(thisContract, total)` in the same operation, so every reallocated amount has passed the source's `perTxCap` and `dailyCap`, and `reallocate` itself counts 0 | `test/ReallocationSpendPolicy.t.sol` (`test_batchedMoveIsCountedOnceByTheSpendPolicy`, `test_approveAbovePerTxCapIsRejectedInValidation`, `test_movesAcrossEvaluationsShareTheDailyCap`) |
| R3 | The account's allowlist holds only the `reallocate` selector on this contract, which makes it an allowed spender and keeps the session key away from the owner and operator functions | `test_sessionKeyCannotReachOwnerOrOperatorFunctions`, `test_unlistedReallocationContractIsNotAnAllowedSpender` |
| R4 | The operator's registry (owner, principal, status) matches the platform's records; the contract cannot check it against the Kernel account | Assumption; operator trust, 13.5 item 1 |
| R5 | Block timestamps are monotonic, so `minEvaluationInterval` spaces evaluations in wall-clock time | Assumption, as section 3.4 |
| R6 | The EIP-712 policy hash equals `libs/commitment`'s, so the planner and the contract agree on the commitment | `test/ReallocationCommitmentVector.t.sol` |

This resolves section 8, item 7 for this contract: with its code in scope, it can forward funds only from `msg.sender` to Active agents of the same owner named by that owner's policy in force, which is now an audited property rather than an assumption.

### 13.3 Invariants and tests

| ID | Invariant | Source | Tests |
| --- | --- | --- | --- |
| RV1 | Total and per-owner capital are conserved by every move, retirement, deposit, and withdrawal; the contract never holds a balance | `THREAT-MODEL.md` invariants 3 and 13 | `invariant_totalCapitalConserved`; `invariant_perOwnerCapitalConserved`; `test_moveAtCapTransfersSourceToSinkAndEmits` |
| RV2 | No move exceeds the cap of the source's balance or leaves it below the floor; one debit per source per evaluation | `THREAT-MODEL.md` invariant 4 | `invariant_sourceBounds`; `test_capPlusOneReverts`; `test_capAppliesToTheSumOfCredits`; `test_protocolFloorMinusOneReverts`; `test_secondDebitInOneEvaluationReverts`; `testFuzz_singleMoveMatchesModelAndConserves` |
| RV3 | No sink ends above the slot ceiling times its principal through a move | `THREAT-MODEL.md` invariant 12 | `invariant_sinkCeiling`; `test_ceilingPlusOneReverts`; `test_ceilingCountsDuplicateCreditsToOneSink` |
| RV4 | Source and sinks share one owner, named by that owner's policy in force with the given hash | `THREAT-MODEL.md` invariant 13 | `invariant_contractMatchesModel`; `test_mismatchedOwnersRevert`; `test_ownerCannotNameAnotherOwnersAgent`; `test_uncoveredAgentReverts`; `test_revocationTakesEffectImmediately`; `test_replacedPolicyHashAndCoverageNoLongerApply` |
| RV5 | A retired or unregistered agent is never moved; retirement is one way and moves nothing | `THREAT-MODEL.md` invariant 15 | `invariant_retirement`; `test_retirementMovesNoCapital`; `test_retiredAgentIsNeitherSourceNorSink`; `test_retirementIsOneWayAndRestricted` |
| RV6 | Evaluations are never opened closer together than `minEvaluationInterval`; the first is not spaced | `ARCHITECTURE.md` 16.5 | `invariant_evaluationSpacing`; `test_evaluationSpacingAtTheBound`; `test_firstEvaluationIsNotSpaced`; `testFuzz_evaluationSpacing` |
| RV7 | Policy bounds are never looser than the protocol constants; signatures are bound to this deployment, consume a nonce, and refuse other keys and malleable forms | `EVOLUTION.md` 3.1 item 8 | `test_commitRejectsLooserBoundsAndBadShapes`; `test_commitRejectsWrongNonceAndWrongSender`; `test_policySignatureFromAnotherKeyOrMalleableRejected`; `test_signatureForAnotherDeploymentRejected` |
| RV8 | Operator and admin are contracts; roles are enforced | `ARCHITECTURE.md` 16.5 | `test_operatorAndAdminRoles`; `test_rolesWithoutCodeRejected`; `test_adminFunctionsRefuseOthersAndZeroOperator` |

The invariant suite (`test/AgentReallocation.invariant.t.sol`) drives three owners and one unregistered account through moves (including repeats in one evaluation), commits with random and wrong nonces, revocations, retirements, principal changes, deposits, withdrawals, and evaluation advances at random times, against an independent model of every rule; `test_handlerExercisesBothOutcomes` checks the run is not vacuous. Configuration as section 4: 256 runs, depth 64, `fail_on_revert = true`; fuzz tests run 1000 cases. `test/AgentReallocationEdges.t.sol`, added with this section, covers the constructor and role paths the main suite did not reach and a token that takes more from the source than it delivers.

### 13.4 Coverage and static analysis

`bash contracts/audit/coverage.sh` failed on `main` since #105: coverage compiles with the optimizer and via-IR off, and one handler function of `test/AgentReallocation.invariant.t.sol` (`commit`) held too many locals for the legacy code generator ("stack too deep"). The function is now split in two (`_commitSeeded`), with the same behavior; the script runs again. From `forge coverage` with forge 1.8.5, 2026-10-10, 178 tests passed and the fork suites skipped:

| File | Lines | Statements | Branches | Functions |
| --- | --- | --- | --- | --- |
| `src/AgentReallocation.sol` | 99.41% (168/169) | 99.19% (244/246) | 95.92% (47/49) | 100.00% (28/28) |

The two uncovered branches are unreachable by construction and kept as defense in depth: the re-check in `_authorize` that a stored policy's bounds are not looser than the protocol constants (`_commit` already refuses such a policy, and nothing else writes one), and `_commit`'s zero-owner check (`commitPolicy` requires `msg.sender == owner`, and `commitPolicyBySig` fails signature recovery first). Before the edge tests the branch figure was 83.67% (41/49).

Slither 0.11.4 and Aderyn 0.6.8 (commands as section 6) and `forge lint`, 2026-10-10. Every finding that names `AgentReallocation.sol` or `IAgentReallocation.sol`:

| # | Tool | Finding | Location | Triage |
| --- | --- | --- | --- | --- |
| RS1 | Slither, forge lint | `calls-loop` (3) | `_credit` (`balanceOf` twice), `_transferFrom` | **Accepted by design.** One transfer per credit, and each is checked by balance before and after. The only callee is the immutable settlement asset; a revert in any credit reverts the whole move, which is the intended atomicity |
| RS2 | Slither, forge lint | `reentrancy-events` | `_credit`, `Reallocated` after `transferFrom` | **Accepted.** The callee is the settlement asset fixed at deployment, not a caller-supplied contract; the event is emitted only after the balance checks pass |
| RS3 | Aderyn H-2 | State change after external call | `reallocate`: `lastDebitEvaluation` written after `balanceOf(msg.sender)` | **False positive.** `balanceOf` is a view on the trusted settlement asset; the one-debit marker is written before any transfer, so a re-entrant `reallocate` in the same evaluation reverts with `AlreadyDebited` |
| RS4 | Slither, forge lint | `timestamp` | `advanceEvaluation` | **Accepted by design.** Spacing is hours (36000 seconds at the decided one-hour tick); producer influence on a timestamp is far smaller (16.5) |
| RS5 | Slither | `low-level-calls` (2) | constructor `decimals()`, `_transferFrom` | **Accepted, reviewed.** Both handle tokens that return nothing or revert: the constructor refuses them (`UnsupportedDecimals`), `_transferFrom` accepts an empty or `true` return and refuses `false` (`TransferFailed`) |
| RS6 | Slither | `cyclomatic-complexity` 15 | `_authorize` | **Accepted, informational.** One check per rule, each with its own error |
| RS7 | Slither, Aderyn L-11 | `pragma`: `^0.8.24` | both files | **Resolved for the implementation.** `AgentReallocation.sol` now pins `pragma solidity 0.8.24;`, like `AgentSpendPolicy` and `X402PaymentValidator` (D7). The deployed bytecode is byte-for-byte unchanged: `forge inspect AgentReallocation deployedBytecode` before and after the change is identical (9,276 bytes; SHA-256 of the printed output `1d3ec5ca...87324fcf2` both times), because the compiler is already pinned in `foundry.toml`. The interface file keeps `^0.8.24` so integrators can import it |
| RS8 | forge lint | `incorrect-strict-equality` | `reallocate`, `balanceOf(source) != sourceBefore - total` | **False positive, intended.** Exactness is the rule: the source must lose exactly the total (R1) |
| RS9 | forge lint | `unsafe-typecast` | constructor, `uint8(decimals)` | **False positive.** Guarded: values above 255 are reported as 255, and any value outside 2 to 36 reverts |
| RS10 | forge lint | `missing-zero-check` | `proposeAdmin` | **False positive, intended.** `address(0)` cancels a pending proposal; any other address must be a contract |
| RS11 | forge lint (10), Aderyn L-8 (3) | `require-revert-in-loop` | `_authorize`, `_credit`, `_commit` loops | **False positive.** One bad credit or agent must reject the whole move or policy |
| RS12 | Aderyn L-1 | Costly operations inside loop | `_commit` coverage writes | **Accepted.** One store per named agent, an owner operation |
| RS13 | Aderyn L-2 | `ecrecover` malleability | `_recover` | **False positive.** High-`s` and any `v` other than 27 or 28 are refused before `ecrecover` (`test_policySignatureFromAnotherKeyOrMalleableRejected`) |
| RS14 | Aderyn L-4, L-5 | Large numeric literal; literal instead of constant | `SLOT_CEILING_BPS`, `BPS`, ABI offsets in `_recover` and `_transferFrom`, decimals bounds | **Accepted, informational.** The large literals are named constants; the others are ABI offsets and the documented decimals range |
| RS15 | Aderyn L-6 | Local variable shadows state variable | `PolicyState.capitalFloor` (struct field) vs `capitalFloor()` | **False positive.** A struct member, not a local; the two are always accessed qualified (`p.capitalFloor`, `capitalFloor`) |
| RS16 | Aderyn L-7 | `PUSH0` opcode | both files | Same as D4 |
| RS17 | Aderyn L-10 | Unsafe ERC20 operation | `_transferFrom` | **False positive.** The return value is checked by hand to accept tokens that return nothing (RS5) |

### 13.5 Known limitations and residual risk

1. **Operator trust.** The operator writes owner, principal, and status, and advances the evaluation counter; the contract cannot check the registry against the Kernel account (R4). A compromised operator cannot move capital between owners, debit an account without that account's own operation, loosen a bound, or move anything without a signed policy in force. It can register a new account under a chosen owner (which matters only if that owner signs a policy naming it), raise an agent's principal and with it its ceiling within that owner's own capital, retire agents, or stop advancing evaluations (fail closed). `ARCHITECTURE.md` 16.5 and `THREAT-MODEL.md` section 8 hold the full statement.
2. **Minimum evaluation spacing bounds, but does not remove, operator-driven churn.** A compromised operator can advance the counter every `minEvaluationInterval` seconds, and a session key that is also compromised can then make one capped debit per advance, bounded by the floor and by the source's `dailyCap` through the counted `approve`. The deployment value, 36000 seconds (10 hours), is half the 20-hour evaluation cadence at the decided one-hour tick, so a compromised operator opens at most three evaluations in any 24 hours (16.5).
3. **Multisig threshold is not checkable on-chain.** The contract refuses a role address with no code, not a contract with one signer; the 2-of-3 threshold is a deployment requirement checked at deployment and by monitoring.
4. **Settlement-asset-only capital.** Positions in other assets (WETH in the default deployment) are not counted: conservative for the source's cap and floor, but a sink holding an open position can exceed `slot_ceiling` times principal in total value (16.5, known gaps).
5. **Off-chain ranking and zero-downside flag.** Which agents are source and sink, and the zero-downside flag, are computed off-chain and not verifiable on-chain (`THREAT-MODEL.md` section 8).
6. **EOA owners only.** Policy signatures are ECDSA from an externally owned account; ERC-1271 owners are not supported.7. **Deployed on testnet, but not exercised against a deployed Kernel account.** It is deployed on Monad testnet (section 14) with reallocation off. `currentEvaluation()` and `lastEvaluationAt()` still read 0 on 2026-10-12 (block 70562473), so no evaluation has been opened, and the repository records no `registerAgent`, `commitPolicy`, `reallocate`, or `retire` call against it. Its interaction with an account is tested against the test double of section 5, not a fork or a bundler.

## 14. Deployed testnet bytecode

The three contracts were deployed on Monad testnet on 2026-10-11 by `contracts/script/deploy-testnet.sh`; addresses, transaction hashes, blocks, gas, constructor inputs, and the Safe that holds `AgentReallocation`'s roles are in `contracts/deployments/monad-testnet.json`.

On 2026-10-12, `audit/check-deployed-bytecode.py` compared the runtime bytecode at each recorded address with a `forge build` of commit `513e943` (forge 1.8.5, the settings of section 1), masking the constructor-set immutables on both sides by the build's `immutableReferences`. All three matched byte for byte: `AgentSpendPolicy` 6,716 bytes, `AgentReallocation` 9,276 bytes, `X402PaymentValidator` 6,566 bytes. With `bytecode_hash = "none"` no metadata hash is appended, so the comparison covers the whole runtime code. The source of all three files has not changed since commit `7ee25ee` (2026-10-10). This shows the testnet deployment runs the code in this package; it is not a substitute for explorer source verification, which has not been done (`deploy/README.md`, open question 4).

From `contracts/`, after `forge build`:

```sh
python3 audit/check-deployed-bytecode.py deployments/monad-testnet.json https://testnet-rpc.monad.xyz
```

The script sends only `eth_getCode` requests. Run it after `forge build`, not after `forge coverage`, which leaves an unoptimized build in `out/`.

## 15. Reproducing this package

Everything below runs from `contracts/` with Foundry 1.8.5 and the `forge-std` submodule checked out (`git submodule update --init`). None of it sends a transaction.

| Command | What it shows | Last result recorded here |
| --- | --- | --- |
| `forge test` | Every suite; the fork suites skip | 2026-10-12, `513e943`: 15 suites, 188 passed, 0 failed, 3 skipped |
| `bash audit/coverage.sh` | Coverage of `src/`, written to `audit/coverage-report/` | 2026-10-12, `513e943`: figures in section 5 |
| `forge test --match-path test/fork/KernelV31Fork.t.sol --fork-url https://testnet-rpc.monad.xyz` | Section 7.1, against the Kernel v3.1 contracts on Monad testnet | 2026-10-12: 8 passed |
| `forge test --match-path test/fork/WmonMarketFork.t.sol --fork-url https://testnet-rpc.monad.xyz` | Creating, seeding, buying on, and closing on the testnet WMON/USDC market, on a fork; outside audit scope, evidence for the trading path | 2026-10-12: 1 passed |
| `forge test --match-path test/fork/X402MainnetFork.t.sol --fork-url "$MONAD_MAINNET_RPC_URL"` | Section 12.3, against Monad mainnet USDC and Kernel v3.1 | 2026-10-10: 7 passed; not rerun on 2026-10-12 |
| Slither, Aderyn, `forge lint` | Sections 6, 12.4, 13.4 | 2026-10-10 |
| `python3 audit/check-deployed-bytecode.py` | Section 14 | 2026-10-12: 3 of 3 match |

Suites: `AgentSpendPolicy.t.sol`, `AgentSpendPolicy.invariant.t.sol`, and `KernelIntegration.t.sol` (sections 4 and 5); `X402PaymentValidator.t.sol` and `X402PaymentValidator.invariant.t.sol` (12.3); `AgentReallocation.t.sol`, `AgentReallocation.invariant.t.sol`, `AgentReallocationEdges.t.sol`, `ReallocationSpendPolicy.t.sol`, and `ReallocationCommitmentVector.t.sol` (13.2 and 13.3); `DeployTestnet.t.sol` and `WmonMarketScripts.t.sol` (the scripts, outside audit scope); and the three fork suites in `test/fork/`.

## 16. Engagement status and remaining steps

Status on 2026-10-12: the package covers every value-bearing contract (the table at the top of this file), the tests and coverage pass, and the deployed testnet bytecode matches the source. **No auditor has been engaged, and the request for proposal in section 11 has not been sent.** The remaining steps are human decisions, in this order, and none can be done from this repository:

1. Choose the auditors to approach and send them section 11, with this file and the commit to pin. The three source files are unchanged since `7ee25ee`, so any later commit that does not touch `contracts/src` audits the same code; pin the commit that merges this section or a later one, so the package and the code agree.
2. Agree scope, price, and dates in a statement of work. Record the auditor, the pinned commit, and the dates in this section, replacing this status.
3. Run section 7.2 (the bundler run on testnet) before or during the engagement, so that assumption E3 is either closed or handed to the auditor as open.
4. Resolve every finding with a code change and a re-test, or accept it in `SECURITY.md` with a stated rationale. No finding is dropped (issue #46).
5. Publish the final report and the fix review in this directory, with the auditor's permission.

Until step 4 is complete, the gate of `SECURITY.md` section 3 holds: none of the three contracts carries real user-controlled capital, on testnet or mainnet; the testnet deployment holds testnet assets only. The testnet validation checklist (`docs/testnet-validation-checklist.md`) carries the audit's status as a precondition of issue #48.
