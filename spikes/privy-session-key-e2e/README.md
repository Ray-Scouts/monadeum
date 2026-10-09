# Spike: Privy root identity, server-side session key, revocation on Monad testnet (issue #19)

Throwaway code. It answers one question and is not part of the workspace, CI, or any product package.

## Question

Does the wallet design in `ARCHITECTURE.md` section 6 work end to end on Monad testnet with the vendors it names? Concretely: a user logs in through Privy and gets an embedded wallet; that wallet owns a ZeroDev Kernel v3.1 account; the owner grants a session key that only a server holds, without the server ever seeing an owner key and without the owner ever seeing the session key's private key; the server signs and submits a UserOp with that key, with no browser wallet popup; the owner revokes the key; and the revoked key, including a replay of the approval it still holds, is rejected.

## How it works

Two processes on loopback:

- `server.ts` (Bun, `127.0.0.1:8788`) plays the agent worker. It generates a session key in memory at startup and exposes only the key's address.
- The page (Vite + React, `http://localhost:5173`) plays the owner. Privy provides the embedded wallet, which is wrapped as a viem wallet client over Privy's EIP-1193 provider and used as the Kernel sudo (ECDSA) signer. The page reaches the server through the Vite proxy under `/api`, so the server needs no CORS and refuses any request carrying a different `Origin`.

| # | Who | Action |
|---|---|---|
| 1 | owner | log in with Privy; an embedded wallet is created for users without one |
| 2 | owner | fetch the session key address, build a permission validator from that address only (call policy v0.0.4: native transfer to the owner, at most 0.001 MON per call), derive the counterfactual Kernel v3.1 account |
| 3 | owner | fund the account from the embedded wallet (default 2 MON, see funding) |
| 4 | owner | `serializePermissionAccount(account)`: the embedded wallet signs the enable typed data; the serialized approval goes to the server. No private key argument is passed, so none is serialized |
| 4 | server | `deserializePermissionAccount(..., approval, toECDSASigner({ signer: sessionKey }))`; first UserOp sends 0.0005 MON to the owner, which deploys the account and enables the validator in the same UserOp; then checks deployment, root validator owner, validator installed; then two out-of-policy UserOps (above cap, wrong target) |
| 5 | owner | `kernelClient.uninstallPlugin({ plugin })` from a sudo-only Kernel client, signed by the embedded wallet; sends the UserOp hash to the server |
| 5 | server | records the revoke receipt, checks the validator is no longer installed, retries with the existing client, then re-deserializes the stored approval and retries again, which makes the SDK replay the owner's enable signature |

Every row is measured from a receipt or a chain read: owner balance changes, block numbers, `actualGasCost`, `validationConfig(vId).hook` on the Kernel account, `rootValidator()`, and `ecdsaValidatorStorage(account)` on the ECDSA validator. The chain is checked to be 10143 on the server at startup and in the page before every owner write. At the end the server prints a markdown table ready to paste into issue #19 and one `RESULT` line; the page shows the same table.

Expected outcome, stated as hypotheses until the run confirms them:

- The revoked key is rejected in both retries, at the bundler's simulation, so the retries cost no gas.
- The replay retry fails because Kernel v3.1 keeps the validator's config nonce on uninstall and requires a fresh nonce to enable, so the old enable signature no longer matches. This is read from the Kernel v3.1 `ValidationManager.sol` source (verified 2026-10-08), not yet observed on chain.

## What the human must do

None of this can be done by the spike's author: it needs accounts, and keys never pass through this repository.

1. **Privy app.** Create an app at dashboard.privy.io. Copy the app ID (public, not the app secret). In the app's login methods, enable email and Google, or edit `loginMethods` in `src/main.tsx` to match what is enabled. Enable Ethereum embedded wallets. In allowed origins (domains), add `http://localhost:5173`. Monad testnet is not in Privy React SDK 3.48.0's default chain list; the page supplies it through `defaultChain` and `supportedChains`, so no dashboard chain setting is assumed. Monad's docs state Privy subsidizes Monad testnet usage on request via monad@privy.io; not needed for this spike.
2. **ZeroDev project.** Create a project at dashboard.zerodev.app with Monad testnet (10143) enabled. Copy the v3 bundler URL ending in `/chain/10143`. No paymaster or gas policy is used.
3. **Funding.** After logging in once, the page shows the embedded wallet address. Send it testnet MON from a faucet. It needs the funding amount (default 2 MON) plus gas for one plain transfer. The rolling daily cap spike measured Monad testnet gas around 122 gwei and found 0.05 MON insufficient for the first UserOp's prefund, because the first UserOp deploys the account and enables the validator; about 2 MON was enough. Unspent MON stays in the agent account, which the owner controls.
4. **Run**, from this directory:

```bash
cp .env.example .env   # fill in VITE_PRIVY_APP_ID and VITE_ZERODEV_RPC
bun install
bun run server         # terminal 1, prints the session key address
bun run web            # terminal 2, then open http://localhost:5173
```

Click the numbered buttons in order. Privy shows its confirmation UI, by default, for each owner action: the funding transfer, the enable typed data, and the revoke UserOp. Copy the table from the server terminal or the page into issue #19. Restart the server for a new run; each run uses a new session key, so a new account is not needed but a new permission is installed.

## Checks run without credentials

`bun install`, `bun run typecheck`, and `bun run build` pass. The server was started against the public Monad testnet RPC with a placeholder bundler URL: chain 10143 was confirmed, `GET /api/session-key` returned an address, a request with a foreign `Origin` was refused with 403, and malformed or out-of-order requests were refused. No UserOp, transaction, or signature was produced.

## Sources, verified 2026-10-08

- ZeroDev owner-approves, agent-signs flow (`serializePermissionAccount`, `deserializePermissionAccount`, `addressToEmptyAccount`): https://docs.zerodev.app/sdk/permissions/transaction-automation. The page imports `addressToEmptyAccount` and `toECDSASigner` from `@zerodev/permissions`; in the installed `@zerodev/sdk` 5.5.10 and `@zerodev/permissions` 5.6.3 they are exported from `@zerodev/sdk` and `@zerodev/permissions/signers`.
- ZeroDev revocation: the v3 permissions docs page found by search returned 404; the method used is `uninstallPlugin` in `@zerodev/sdk` 5.5.10 (`_esm/actions/account-client/uninstallPlugin.js`), which encodes `uninstallValidation(vId, validatorData, hookData)` on the account.
- Kernel v3.1 install and uninstall nonce handling: https://github.com/zerodevapp/kernel/blob/v3.1/src/core/ValidationManager.sol and owner storage: https://github.com/zerodevapp/kernel/blob/v3.1/src/validator/ECDSAValidator.sol
- Privy custom chains: https://docs.privy.io/basics/react/advanced/configuring-evm-networks
- Privy EIP-1193 provider and viem client from an embedded wallet: https://docs.privy.io/wallets/using-wallets/ethereum/web3-integrations
- Privy on Monad testnet: https://docs.monad.xyz/tooling-and-infra/wallet-infra/embedded-wallets
- Config option names (`embeddedWallets.ethereum.createOnLogin`, `defaultChain`, `supportedChains`, `loginMethods`) read from the installed `@privy-io/react-auth` 3.48.0 type definitions.

## Known limits

- Native MON and one call policy only. The production scope (Kuru router, reproduction contract, settlement asset, rolling daily cap) is not exercised; issue #18 covers the cap.
- The session key lives in server memory for one run. Persistence, rotation, and a secrets manager (`SECURITY.md` section 11) are out of scope.
- Revocation is an owner-signed UserOp paid from the agent account's own balance, since no paymaster is configured. If the account cannot pay, revocation needs a paymaster or a top-up first. This is a finding to confirm, see below.
- The approval is checked only for matching the account address the owner reported. A production server would also check the policies it carries before using it.
- Privy behavior is from SDK 3.48.0 and the dashboard as of the verification date. Both are time-sensitive.

## Possible gaps against `ARCHITECTURE.md` section 6, to confirm by running

These are hypotheses from reading the SDKs, not results. Record what the run shows on issue #19, and update `ARCHITECTURE.md` section 6 only if a decision changes.

1. **Revocation costs gas and needs a live bundler.** Section 6 and `SECURITY.md` section 1 say the owner can revoke at any time. On Kernel v3.1 that means an owner-signed UserOp calling `uninstallValidation`, so it also depends on the agent account holding enough MON for the prefund (or a paymaster), which at about 122 gwei is not trivial.
2. **Deployment happens on the agent's first UserOp, not at owner setup.** The Kernel address depends only on the sudo validator and an index, and the permission validator is installed lazily through enable mode. One owner with several agents therefore needs a distinct `index` per agent account, which section 6 does not mention.
3. **The approval plus the session key is a bearer credential** until revoked. The approval alone carries only the owner's enable signature, but it must be stored with the same care as the key, and revocation must invalidate the enable signature. The replay retry in step 5 tests the second part.
