# WalletsModule

Per-agent ERC-4337 account deployment, session key issuance and revocation, and paymaster sponsorship tracking, as specified in `ARCHITECTURE.md` sections 6, 7, 10 and 16.3 and `SECURITY.md` sections 1, 2, 8 and 11. Built on ZeroDev Kernel v3.1, EntryPoint 0.7, and call policy v0.0.4, with `@zerodev/sdk` 5.5.10, `@zerodev/permissions` 5.6.3, `@zerodev/ecdsa-validator` 5.4.9 and `viem` 2.56.9 pinned exactly: the versions the issue #18 and #19 spikes used.

## What it does

- **Deployment** (`deploy`): one owner-signed operation deploys the account and calls `setLimits` and `setAllowed` on the spend policy for every allowlist entry. Idempotent per agent: a repeat returns the existing account and sends nothing, a call made while an earlier operation is pending waits for it, and an account that exists but whose spend policy does not match is reported as `misconfigured`, never reconfigured silently. Each agent gets its own Kernel `index` under the owner, and one account cannot be recorded for two agents.
- **Issuance** (`issueSessionKey`): generates a key, stores it only in the `SessionKeyVault`, and has the owner sign the Kernel enable data for a permission validator with two policies: call policy v0.0.4 listing exactly the allowlist (value 0, call type `CALL`), and the spend policy contract, also installed as the validator's hook. The validator is enabled on the key's first operation. `execute` refuses, before signing, any call outside the allowlist or with native value.
- **Revocation** (`revokeSessionKey`): the key is destroyed in the vault and the record marked first, so this process cannot sign again whatever happens next. Then one owner-signed operation uninstalls the validator, if installed, and calls Kernel `invalidateNonce(currentNonce + 1)`. Success is read back from chain: the validator is not installed or is below `validNonceFrom`, and `currentNonce` is past the nonce the enable signature was bound to, so the owner's approval cannot reinstall it. `revocationStatus` repeats that check independently at any time. The on-chain step is always sponsored and never charged to the per-agent budget, because it is the emergency stop. If the paymaster is down, the account pays from its own MON if it can; if not, the result is `paymaster-unavailable`, the key stays destroyed on the platform, and the chain keeps accepting it until the call is retried and succeeds.
- **Sponsorship** (`send`, internal to every operation other than revocation): sponsored only if a paymaster is configured, the agent has budget left, the paymaster answers, and the operation's worst-case gas fits the remaining budget, reserved before submission. Otherwise the account pays in native MON, if its balance covers the worst case; if it does not, the operation is not sent. A paymaster that fails is never assumed to have sponsored. A submission the bundler rejected releases its reservation; one whose outcome is unknown keeps it.
- **Tick execution** (`executeForTick`, `lookupTick`): at-most-once session-key execution per (agent ID, tick key), across restarts. The user operation hash is computed from the prepared operation and written to the store before `submit()`. A repeated call looks the tick up first and resends only when every earlier attempt is provably dead, under the same nonce, so at most one attempt can be included. A new tick is refused with `busy` while an earlier one may still land. `lookupTick` answers `absent`, `pending`, or `included` with the receipt's logs, transaction hash, block, and gas, and throws when it cannot tell. Every result where an operation may have been submitted carries its hash. `libs/trading`'s `WalletsTradeSigner` builds `TradeSigner` on these two calls. Assumed, not verified on Monad: an operation the bundler no longer holds cannot be included later.

The spend policy contract is `contracts/src/AgentSpendPolicy.sol` (issue #25). This package depends only on its interface, `contracts/src/IAgentSpendPolicy.sol`, and its deployed address. Both policies are installed with flag `0x0000`, so neither skips the signature check, and `AgentSpendPolicy`'s `checkSignaturePolicy` always fails: a session key issued here cannot produce an ERC-1271 signature for the account. The x402 signature path needs the owner's skip-signature flag, an explicit decision this module does not make (`ARCHITECTURE.md` section 16.3, open question on x402 coverage).

## Configuration

`loadWalletsConfig()` reads these variables and rejects anything it cannot validate. None of them is a private key.

| Variable | Required | Meaning |
|---|---|---|
| `WALLETS_CHAIN_ID` | yes | Must be `10143`, Monad testnet. Mainnet waits on the audit gate in `SECURITY.md` section 3. |
| `WALLETS_RPC_URL` | no | Monad RPC. Defaults to viem's Monad testnet RPC. |
| `WALLETS_BUNDLER_URL` | yes | ZeroDev v3 bundler URL, https. It carries the ZeroDev project ID: keep it out of logs. |
| `WALLETS_PAYMASTER_URL` | no | ZeroDev paymaster URL, https. Unset: nothing is sponsored. |
| `WALLETS_SPEND_POLICY_ADDRESS` | yes | Deployed `IAgentSpendPolicy` implementation. Deployment fails closed if it has no code. |
| `WALLETS_SPEND_POLICY_DATA` | no | Install data for the policy role. Defaults to `0x`: `AgentSpendPolicy` configures nothing at install (`ARCHITECTURE.md` section 16.3). |
| `WALLETS_SPEND_POLICY_HOOK_DATA` | no | Hook data, at least one byte. Kernel v3.1 reads the first byte as a flag (`0xff` forces `onInstall`/`onUninstall`). Defaults to `0x00`. |
| `WALLETS_SETTLEMENT_ASSET` | yes | Settlement asset (USDC). Its `transfer` and `approve` are allowlisted, nothing else on it. |
| `WALLETS_KURU_ROUTER` | yes | Kuru router address. |
| `WALLETS_KURU_ROUTER_SELECTORS` | yes | Comma-separated 4-byte selectors allowed on the router, pending issue #20. |
| `WALLETS_REALLOCATION_CONTRACT` | yes | Owner-scoped reallocation contract address (`contracts/src/AgentReallocation.sol`, allowlist label `reallocation`, ARCHITECTURE.md sections 16.1 and 16.5). |
| `WALLETS_REALLOCATION_SELECTORS` | yes | Comma-separated 4-byte selectors allowed on it. In production, only `reallocate(uint256,bytes32,(address,uint256)[])`, `0x4c329bba`. |
| `WALLETS_TRADED_ASSETS` | no | Comma-separated ERC-20 bases a close sells (WETH `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` for the Monad mainnet WETH/USDC market). Each gets `approve` only and is marked with the spend policy's `setTradedAsset` before it is allowed. Unset: no close can be built. |
| `WALLETS_SPONSORED_OPERATIONS` | yes | Sponsored operations per agent, deployment included, revocations excluded. |
| `WALLETS_SPONSORED_GAS_WEI` | yes | Sponsored gas per agent in wei, deployment included, revocations excluded. |
| `WALLETS_X402_VALIDATOR_ADDRESS` | no | Deployed `X402PaymentValidator`. Unset: no x402 key is created and agents cannot pay x402. Set: deployment fails closed if it has no code. |
| `WALLETS_X402_PAYEES` | with the validator | Comma-separated x402 provider pay-to addresses, 1 to 8. |
| `WALLETS_X402_MAX_VALUE` | no | Settlement-asset base units per payment. Defaults to the decided value 50000 (0.05 USDC). |
| `WALLETS_X402_PAYMENTS_PER_EPOCH` | no | Payments per hour. Defaults to the decided value 4. 24-hour worst case: 26 x this x `WALLETS_X402_MAX_VALUE`. |
| `WALLETS_X402_MAX_VALIDITY` | no | Seconds an authorization stays valid, at most 3600. Defaults to the decided value 300. |

The consuming app also supplies an `AgentWalletStore` and a `SponsorshipLedger` backed by Postgres (`PgAgentWalletStore` and `PgSponsorshipLedger` in `@monadeum/db`), and a `SessionKeyVault`; session keys never go to Postgres. With x402 configured, the settings carry a second `SessionKeyVault` for the x402 keys, which must be a different instance (`ARCHITECTURE.md` section 16.3, x402 signature path). `test/x402-lifecycle.test.ts` covers the x402 key's install, revocation, and reinstall. `MemorySessionKeyVault` is for tests only.

### Session key vault: local encrypted files (testnet and local development only)

`FileSessionKeyVault` (`src/file-vault.ts`) is the one persistent `SessionKeyVault`. Each key is a file `<sha256(agentId)>.key` holding the key sealed with AES-256-GCM (fresh 96-bit IV, the vault's purpose and the agent ID as associated data) under a key derived from a passphrase with scrypt, N = 2^17, r = 8, p = 1, all from Node's `crypto`. `vault.json` records the scrypt salt and parameters and a sealed check value, so a wrong passphrase is refused at open. Files are 0600 in a 0700 directory owned by the process's user; a directory group or others can access is refused. Writes are create-only and atomic (a synced temporary file hard-linked into place), so the API and the worker can share a directory: `put` refuses an agent that already holds a key, `destroy` unlinks it. A damaged, modified, or moved key file throws, never reads as absent. Nothing logs a key or the passphrase.

`loadWalletsRuntime(env)` builds WalletsService for a process: nothing without `WALLETS_CHAIN_ID`, and once it is set, the chain settings above and these vault variables, read by `loadFileVaults`, which refuses all of them with `MONADEUM_ENV=production`:

| Variable | Required | Meaning |
|---|---|---|
| `WALLETS_SESSION_VAULT_DIR` | with `WALLETS_CHAIN_ID` | Directory of the session-key vault. Created with mode 0700 when absent. |
| `WALLETS_SESSION_VAULT_PASSPHRASE_FILE` or `WALLETS_SESSION_VAULT_PASSPHRASE` | with the directory | The passphrase, at least 16 characters; a file (a Docker secret) is preferred. One trailing newline in the file is ignored. |
| `WALLETS_X402_VAULT_DIR` | with `WALLETS_X402_VALIDATOR_ADDRESS` | Directory of the x402-key vault. Must not be the session directory, inside it, or contain it. |
| `WALLETS_X402_VAULT_PASSPHRASE_FILE` or `WALLETS_X402_VAULT_PASSPHRASE` | with the directory | Its passphrase. Use a different one from the session vault's. |

It protects keys at rest only: whoever holds the files and a passphrase holds the keys, and a backup brings back keys destroyed after it was taken (`SECURITY.md` section 11). Production needs a secrets manager behind `SessionKeyVault`, which is not built. `test/file-vault.test.ts` covers the round trip, file modes, wrong passphrases and purposes, moved and modified files, two processes on one directory, the loader's refusals, and WalletsService issuing and revoking a key on it.

## Tests

`bun run --filter @monadeum/wallets test` runs offline: `test/wallets.test.ts` and `test/tick.test.ts` drive the service against an in-memory chain that models the Kernel v3.1 nonce rules, the bundler's mempool, and the EntryPoint nonce (`src/testing.ts`, exported as `@monadeum/wallets/testing` for other packages' tests only), and `test/zerodev.test.ts` exercises the ZeroDev adapter against the installed SDK with a mock transport, including recovering the owner from the enable signature.

`test/testnet.test.ts` runs the full flow on Monad testnet and is skipped unless `WALLETS_TESTNET=1`. It needs every variable above, a deployed spend policy, and `WALLETS_TESTNET_OWNER_PRIVATE_KEY`, a testnet-only key standing in for the user's embedded wallet. `WALLETS_TESTNET_INDEX` optionally fixes the account index. Never use a key that holds mainnet assets, and never commit one.

## Not verified yet

- No run on Monad testnet: the spend policy contract is implemented, and its deployment script exists (`contracts/script/DeployTestnet.s.sol`), but it has not been broadcast. The opt-in test is the check.
- Installing `AgentSpendPolicy` as policy and hook is verified against the Kernel v3.1 source, Foundry tests, and a fork test against the Kernel v3.1 contracts deployed on Monad testnet (`ARCHITECTURE.md` section 16.3), not yet through a bundler.
- Sponsorship through ZeroDev's paymaster has not been exercised on Monad; both spikes paid gas from the account.
- The Kernel v3.1 nonce rules the revocation check relies on were read from the Kernel v3.1 source (`ValidationManager.sol`, `Kernel.sol`) on 2026-10-09, not observed on chain.
