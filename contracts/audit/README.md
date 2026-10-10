# Audit package

This directory is the material an external auditor needs to review the on-chain contracts of this repository, prepared under issue #46. It is organized per contract so that each contract in scope has its own section. Today it covers one contract, `AgentSpendPolicy`, the on-chain spend policy for agent smart accounts (issue #25). The owner-scoped reallocation contract (issue #31) is being written separately and is not in this package yet; section 10 states what adding it involves.

`SECURITY.md` section 3 sets the gate this package serves: `AgentSpendPolicy` carries no real user-controlled capital, on testnet or mainnet, before an external audit is complete and every finding is resolved or explicitly accepted as residual risk in `SECURITY.md`.

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

## 1. Scope

| File | nSLOC | Role |
| --- | --- | --- |
| `contracts/src/AgentSpendPolicy.sol` | 177 | Implementation: spend rules, rolling window, Kernel v3.1 policy and hook entry points |
| `contracts/src/IAgentSpendPolicy.sol` | 30 | Authoritative interface and NatSpec specification |
| `contracts/src/kernel/IKernelModules.sol` | 32 | Kernel v3.1 module interfaces and `PackedUserOperation`, declared locally to match Kernel's ABI |
| **Total** | **239** | |

nSLOC as counted by Aderyn 0.6.8 (normalized source lines, excluding comments and blank lines).

- **Commit**: the commit at which this package is merged to `main`. An engagement pins the exact commit hash in the statement of work; any later change to a file above is out of the audited scope until re-reviewed.
- **Compiler**: solc 0.8.24, pinned in `contracts/foundry.toml`. `AgentSpendPolicy.sol` uses an exact `pragma solidity 0.8.24;`; the two interface files keep `^0.8.24` so that other contracts can import them. EVM version `cancun`, optimizer on with 200 runs, `bytecode_hash = "none"`.
- **Dependencies**: none at runtime. The contract imports only the two local interface files. `forge-std` (git submodule under `contracts/lib/forge-std`) is used by tests only.
- **Toolchain**: Foundry `forge` 1.8.5, the version CI pins.
- **Deployment model**: one deployment serves every agent account. The constructor takes the settlement asset address, which is immutable. There is no owner, no admin, no upgradeability, and no pause: every piece of state is keyed by the account that wrote it.

## 2. System overview and trust model

Each agent in this system runs a ZeroDev Kernel v3.1 smart account (ERC-4337, EntryPoint v0.7). The user's own wallet is the account's root validator. The agent itself acts through a session key, installed as a Kernel permission: an ECDSA signer plus policies. `AgentSpendPolicy` is installed on that permission twice, as a policy (validation phase) and as the permission's hook (execution phase). It is the on-chain enforcement of `THREAT-MODEL.md` invariant 1 (an account rejects any transaction exceeding its on-chain spend limit) and the on-chain part of invariant 11 (a session key moves funds only through allowlisted calls, to allowlisted recipients).

What it enforces, for operations validated by the session key:

- **Validation phase** (`checkUserOpPolicy`, which calls the same logic as the view `check`): every call's `(target, selector)` is on the account's allowlist; no target is the policy contract or the account itself; native value is 0; a counted call (`transfer` or `approve` on the settlement asset) decodes and names a recipient that passes the recipient rule; the sum of counted amounts over the whole operation is at most `perTxCap`. No time-dependent reads.
- **Execution phase** (`preCheck`, which calls the same logic as `record`): recomputes the total with the same rules, adds it to the current hour's bucket, and reverts with `DailyCapExceeded` if the 25-bucket window total would exceed `dailyCap`.

Trust model:

| Actor | Trusted for | Not trusted for |
| --- | --- | --- |
| Account owner (root validator) | Setting limits and the allowlist through `setLimits` and `setAllowed`, which read the account from `msg.sender`; choosing install flags | Nothing is enforced against the owner; the owner can always change or remove the policy |
| Session key | Nothing | Assumed fully compromised: the policy must bound everything it can do through user operations |
| Kernel v3.1 implementation | Calling the entry points in the sequence its source shows (section 3) | n/a, its behavior is an assumption the fork test checks |
| Settlement asset | Standard ERC-20 `transfer` and `approve` semantics | Its ERC-1271 signature paths are not bounded (section 8) |
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
| A3 | The asset's signature-authorized paths (EIP-3009 `transferWithAuthorization`, EIP-2612 `permit`) are reachable from a smart account only through ERC-1271, which this policy blocks by default. On Monad mainnet's USDC, those paths appear to accept ERC-1271 signatures (section 8, item 5). | Fork for the default; mainnet calls for the asset behavior |
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
| I5 | A counted call's recipient has an allowed selector and is not the asset, the policy, or the account | `THREAT-MODEL.md` invariant 11 | `invariant_recipientRuleAndNativeValueEnforced`; `testFuzz_check_rejectsRecipientWithoutAllowedSelector`; `test_check_rejectsRecipientThatIsAssetPolicyOrAccount`; `test_check_recipientRuleFollowsAllowlistRemoval` |
| I6 | Nonzero native value is never accepted | `ARCHITECTURE.md` 16.3 | `invariant_recipientRuleAndNativeValueEnforced`; `testFuzz_check_rejectsNativeValue` |
| I7 | No allowlist entry can move the settlement asset uncounted | `ARCHITECTURE.md` 16.3 | `testFuzz_setAllowed_settlementAssetAdmitsOnlyTransferAndApprove`; `test_setAllowed_rejectsUncountedSettlementSelectors`; `test_check_rejectsUncountedSettlementSelectorEvenIfStored` |
| I8 | `record` never trusts validation: it reruns every rule, and accepts nothing `check` rejects | `IAgentSpendPolicy` NatSpec | `invariant_checkAgreesWithModel`; `test_record_runsTheValidationRulesAgain` |
| I9 | An account whose limits were never set fails every counted call (fail closed) | `THREAT-MODEL.md` invariant 10 | `test_check_failsClosedWhenLimitsNeverSet`; `test_record_failsClosedWhenLimitsNeverSet` |
| I10 | State is per account: no account's calls read or write another's limits, allowlist, or window | Design | `test_setLimits_isPerAccountAndEmits`; `test_record_isKeyedByMsgSender`; `test_hook_recordsForCallingAccount` |
| I11 | Only `execute` with call type single or batch and exec type default or try is accepted; delegatecall, static, other call types, and every other account selector are rejected | `ARCHITECTURE.md` 16.3 | `test_policy_rejectsDelegatecall`; `testFuzz_policy_rejectsEveryOtherCallType`; `testFuzz_policy_rejectsUnknownExecType`; `test_policy_rejectsOtherAccountSelectors`; `test_policy_rejectsMalformedExecutionData`; `test_fork_delegatecallRejectedInValidation` |
| I12 | The ERC-1271 signature policy never approves | `ARCHITECTURE.md` 16.3 | `test_signaturePolicyAlwaysFails`; `test_fork_sessionKeyErc1271SignatureFailsByDefault` |
| I13 | Validation reads only account-associated storage and writes nothing | ERC-7562 | `test_validation_readsOnlyAccountAssociatedStorage` |

The invariant suite (`test/AgentSpendPolicy.invariant.t.sol`) keeps an independent model of the allowlist and of accepted spend, drives random batches over a pool of allowlisted and non-allowlisted targets (including the policy and the account, both allowlisted), random selectors, recipients, and amounts, allowlist toggles, and time jumps across hour and day boundaries, and counts every acceptance the model says must be a rejection. Configuration: 256 runs, depth 64, `fail_on_revert = true`; fuzz tests run 1000 cases.

## 5. Test suite and coverage

| Suite | File | What it covers |
| --- | --- | --- |
| Unit and fuzz | `test/AgentSpendPolicy.t.sol` | Every rule of `check`, `record`, the window, configuration, and the storage-read check |
| Kernel adapter | `test/KernelIntegration.t.sol` | The policy and hook entry points with calldata built to Kernel's encoding, and an end-to-end flow through a test double of Kernel (`test/utils/Mocks.sol`) |
| Invariant | `test/AgentSpendPolicy.invariant.t.sol` | I1 to I8 over fuzzed sequences |
| Fork (opt-in) | `test/fork/KernelV31Fork.t.sol` | The deployed Kernel v3.1 contracts on Monad testnet, section 7 |

Coverage of `src/` (test and mock files excluded), from `forge coverage` with forge 1.8.5:

| File | Lines | Statements | Branches | Functions |
| --- | --- | --- | --- | --- |
| `src/AgentSpendPolicy.sol` | 100.00% (106/106) | 100.00% (139/139) | 100.00% (26/26) | 100.00% (23/23) |

Before this package, coverage was 99.06% of lines and 96.15% of branches. The one uncovered branch was the second, independent refusal of an uncounted settlement-asset selector in `_check`, unreachable through `setAllowed` by design. `test_check_rejectsUncountedSettlementSelectorEvenIfStored` writes such an entry into storage directly to show `check` refuses it on its own. Coverage is a floor, not evidence of correctness: the invariant and fuzz suites in section 4 are the substantive checks.

To regenerate, from the repository root, with Foundry 1.8.5 installed:

```sh
bash contracts/audit/coverage.sh
```

It writes `contracts/audit/coverage-report/summary.txt` and `contracts/audit/coverage-report/lcov.info`. The fork suite is skipped in this run, since it needs `--fork-url`. Coverage disables the optimizer, so gas figures in that output do not match a normal build.

## 6. Static analysis and triage

Run on 2026-10-10 against this package's sources.

- **Slither 0.11.4**, installed from PyPI into a throwaway virtual environment: `slither . --filter-paths "lib/|test/"` from `contracts/` (it runs `forge clean` and a forced build first). 100 detectors, 6 results from 5 detectors (`timestamp` reports two functions).
- **Aderyn 0.6.8**, installed from Cyfrin's npm package `@cyfrin/aderyn`: `aderyn . --src src` from `contracts/`. 88 detectors, 1 high and 6 low results.
- **forge lint** (Foundry 1.8.5, built in; it also runs on every `forge build`): `forge lint` from `contracts/`. On `src/`: 7 `unsafe-typecast`, 8 `require-revert-in-loop`, 1 `block-timestamp`, 1 `reentrancy-events`. On `test/`: 4 `environment-read-across-mutation`.

Every finding is triaged below. None is dropped.

| # | Tool | Finding | Location | Triage |
| --- | --- | --- | --- | --- |
| S1 | Slither | `weak-prng`: `hour % BUCKETS` | `_record` | **False positive.** The modulo indexes a 25-slot ring buffer by hour. No randomness is derived or relied on |
| S2 | Slither | `locked-ether`: payable functions, no withdrawal | `checkUserOpPolicy`, `preCheck`, `postCheck`, `onInstall`, `onUninstall` | **Accepted risk.** The functions are `payable` because Kernel's `IPolicy` and `IHook` declare them so, and keeping the declared mutability avoids any doubt about matching the interface. Kernel v3.1 sends no value to any of them (section 3.1, K1 and K3, from source). Ether can therefore reach the contract only if a third party sends it directly, which is that party's own loss and touches no system funds; native value can also always be forced in with `selfdestruct`. A withdrawal function would add an owner role this contract deliberately does not have. Rejecting `msg.value != 0` was considered and not adopted: it protects only that third party and adds a revert path to every validation |
| S3 | Slither | `timestamp`: comparisons using `block.timestamp` | `_record`, `_windowTotal` | **Accepted by design.** The window is hourly; a block producer's influence over a timestamp is far below one hour, and the window rule over-counts rather than under-counts at the hour edge (`ARCHITECTURE.md` 16.3). Timestamp is read only in execution, never in validation |
| S4 | Slither | `assembly` | `_word` | **Accepted, reviewed.** One `mload` of a 32-byte word. Both call sites check `data.length >= 68` first, so the read stays inside `data`. Marked `memory-safe` correctly: it only reads |
| S5 | Slither | `cyclomatic-complexity` 12 | `_check` | **Accepted, informational.** One linear rule per line, each reverting with a distinct error; splitting it would spread a single rule set across functions without reducing what an auditor must read |
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

Tests: a batch within the caps executes and is recorded; a single call; a batch over `perTxCap` fails validation with `FailedOpWithRevert(0, "AA23 reverted", PerTxCapExceeded(...))`; a daily-cap breach is included, reverts in execution with `DailyCapExceeded` in `UserOperationRevertReason`, and records and moves nothing; delegatecall fails validation with `UnsupportedExecMode`; a session-key call to `setLimits` fails validation with `CallNotAllowed` even with a mistaken allowlist entry for it; and the session key's ERC-1271 signature reverts with Kernel's `PolicyFailed(0)`. All 7 passed on 2026-10-10 against the latest Monad testnet block.

Run, from `contracts/`:

```sh
forge test --match-path test/fork/KernelV31Fork.t.sol --fork-url "$MONAD_TESTNET_RPC_URL"
```

`https://testnet-rpc.monad.xyz` is Monad's public testnet endpoint. Add `--fork-block-number <n>` to pin a block. Without `--fork-url` the suite skips, so CI is unaffected. Forge 1.8.5 refuses to create a Monad fork from inside a test (`vm.createSelectFork`) because it selects the EVM variant at startup, which is why the fork is chosen on the command line.

### 7.2 Remaining: through a bundler on Monad testnet

A fork runs no bundler, so it cannot show that the bundlers used on Monad accept this policy's validation-phase storage reads and opcodes under ERC-7562 (assumption E3), nor that Monad's own client executes the operations the same way as forge's EVM. The step that closes both:

1. Deploy `AgentSpendPolicy` on Monad testnet with a test settlement asset.
2. Run the opt-in testnet test in `libs/wallets` (`WALLETS_TESTNET=1`, see `libs/wallets/README.md`), which installs the policy as policy and hook through ZeroDev's SDK and sends user operations through the ZeroDev bundler.
3. Repeat the cases of 7.1 there: within caps, over `perTxCap` (expect the bundler to refuse it in simulation), a daily-cap breach (expect inclusion and an execution revert), delegatecall, and the ERC-1271 default.
4. Record the bundler, its version or endpoint, and the result in `ARCHITECTURE.md` 16.3, and remove assumption E3 from this list.

This step needs testnet funds and a bundler endpoint, so it is a manual run, not CI.

## 8. Known limitations and residual risk

1. **Kernel integration is verified on a fork, not through a bundler.** Section 7.2. Until that run, ERC-7562 acceptance on Monad is an assumption.
2. **Try mode over-counts.** Exec type `0x01` (try) is accepted, and `record` counts every counted call in the operation, including one that later fails. This over-counts and never under-counts: the cost is headroom, not safety.
3. **`perTxCap` of 0 rejects every counted call, including an amount of 0.** This is the fail-closed default for an account never configured. It also means an owner who freezes an agent by setting `perTxCap` to 0 blocks the session key from revoking an approval with `approve(spender, 0)`; the owner can still revoke through the root validator.
4. **`perTxCap > 0` with `dailyCap` of 0, or a window already at the cap, passes validation and reverts in execution.** Each such operation is included and pays gas. A compromised session key can therefore spend the account's gas balance (or a paymaster's sponsorship) on operations that revert, and it can do the same with any allowlisted call that reverts. Gas spend is not bounded by this contract; a paymaster or gas policy and off-chain monitoring are the controls.
5. **The signature policy fails by default, and opting out is wider than x402.** `checkSignaturePolicy` always fails, so a session key cannot produce an ERC-1271 signature unless the owner installs the policy with Kernel's skip-signature flag. On 2026-10-10, calls to Monad mainnet's USDC (`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`) with a contract as `from` returned the ERC-1271 path's invalid-signature errors (`FiatTokenV2: invalid signature`, `EIP2612: invalid signature`) for the `bytes`-signature `transferWithAuthorization` and `permit`, where an externally owned `from` gets the ECDSA length error. That indicates the token accepts ERC-1271 signatures for both, though no signature was actually accepted in that check. If so, a session key with the skip-signature flag could authorize a transfer or an approval of the account's whole balance to any address, outside both caps and the recipient rule. The flag must not be set until the policy bounds the signature path.
6. **x402 coverage is an open question.** If x402 settles through EIP-3009 authorizations, as `ARCHITECTURE.md` 16.3 assumes but has not verified, x402 payments never pass through `check`, and only the application-layer caps bound them. Item 5 is the consequence of opting out today.
7. **Uncounted calls are not decoded.** Calls to the Kuru router and the reallocation contract count 0. If either can be made to forward funds to an arbitrary address, or to pull more than the account approved, the recipient rule and the caps do not see it. This is a property of those contracts (issue #20 for the router).
8. **The allowlist is the owner's responsibility beyond the two self-protection rules.** Only the policy and the account are refused as targets regardless of configuration. Allowlisting the EntryPoint (`withdrawTo` moves the account's deposit), a Kernel module, a validator, or any contract that forwards calls would hand the session key a path this policy does not inspect. Any allowlisted target also becomes a valid recipient under the derived recipient rule.
9. **The hook must be installed with the policy.** If the policy is installed on a permission without this contract as that permission's hook, validation still applies the per-transaction rules, but `record` never runs and the daily cap does not apply. Kernel does not tie the two together; the installer must.
10. **Configuration persists across uninstall and reinstall.** `onInstall` and `onUninstall` change no state, so limits and allowlist entries outlive a permission's removal and apply again if the policy is reinstalled.
11. **Approvals are counted when set, not when used.** A counted `approve` for an amount uses that much of `perTxCap` and the window at the moment it is set; a later pull by the spender is not counted again. Allowance left unused stays available to the spender beyond the window in which it was counted.
12. **Window shape.** The window total covers 24 to 25 hours, so it can over-count by up to one hour of spend; it never under-counts. `record` reads 25 storage slots per operation, a fixed gas cost per counted or uncounted operation.
13. **The settlement asset's issuer can change its behavior.** USDC is upgradeable and can blocklist addresses (section 3.3, A4).
14. **No formal verification.** The guarantees rest on review, unit, fuzz, invariant, and fork tests.

## 9. Out of scope

- ZeroDev Kernel v3.1, its validators, signers, and factory; the ERC-4337 EntryPoint v0.7. Assumed correct as deployed; their behavior that this contract depends on is listed in section 3.1.
- The settlement asset (USDC) and its issuer's controls.
- The Kuru router and any other allowlisted target.
- Off-chain components: the RiskModule (`libs/risk`), the wallet library (`libs/wallets`), the agent runtime, and any bundler or paymaster.
- Test code, mocks, and the fork test, except as evidence for the claims above.
- The reallocation contract (issue #31) until it is added under section 10.

## 10. Adding the reallocation contract

When the reallocation contract from issue #31 is merged, it is added to this package as its own set of sections, without changing the sections above unless the two contracts interact:

- Add its files and nSLOC to the scope table in section 1, and the merged commit.
- Add a system overview subsection with its trust model, in particular the owner, the signed reallocation policy, and who may call it.
- Add its integration assumptions: how it pulls funds (the counted `approve` it relies on from this contract, section 8, item 7), and its interaction with the settlement asset.
- Add its invariants, at least `THREAT-MODEL.md` invariants 3, 4, 12, 13, and 15, each mapped to the tests that check them.
- Extend `coverage.sh` output and the static-analysis triage to its files.
- Revisit section 8, item 7: once its code is in scope, whether it can forward funds outside the owner's agents is an audited property rather than an assumption.
- Update the request for proposal below with the combined nSLOC.

## 11. Request for proposal (draft)

This is a draft for issue #46. It has not been sent to any auditor.

**Project**: monadeum, an agent economy on Monad in which each agent trades through a ZeroDev Kernel v3.1 smart account under a session key.

**Scope**: `AgentSpendPolicy` and its interfaces, 239 nSLOC in three files (section 1), at a pinned commit. Planned addition before engagement if ready: the owner-scoped reallocation contract (issue #31), size to be stated when merged.

**What we ask the auditor to focus on**:

1. Whether any operation a fully compromised session key can submit moves the settlement asset beyond `perTxCap` per operation or `dailyCap` per 24 hours, or to a recipient outside the derived recipient rule.
2. Parser equivalence between `_decodeExecute` and Kernel v3.1's `ExecLib` for every byte string Kernel would execute (section 3.1).
3. The self-protection rules: whether a session key can reach `setLimits`, `setAllowed`, or the account's module functions by any route.
4. ERC-7562 compliance of the validation path for an unstaked policy (section 3.2).
5. The rolling window arithmetic and its edge cases.
6. The known limitations in section 8: whether any is worse than stated, and whether any accepted risk should be fixed instead.

**Materials provided**: this README, the interface NatSpec, `ARCHITECTURE.md` section 16.3, `THREAT-MODEL.md` section 7, the test suites, the coverage report, and the static-analysis triage.

**Timeline assumptions** (to confirm with the auditor, not commitments):

- Size: 239 nSLOC is a small engagement. Our working estimate is 3 to 5 auditor-days for this contract alone, plus time for the reallocation contract once its size is known. This is an assumption, not a quote.
- Start: after the reallocation contract is merged, so both are audited in one engagement, unless that slips past the testnet deployment target (issue #48), in which case `AgentSpendPolicy` goes first on its own.
- Fix review: one round of fix review included, on the commits that resolve findings.
- Gate: no real user-controlled capital on testnet or mainnet before the report is final and every finding is resolved or accepted in `SECURITY.md` (section 3 of that document).

**Deliverables requested**: a written report with severity-rated findings, a fix-review addendum, and permission to publish the final report in this repository.
