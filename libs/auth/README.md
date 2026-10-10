# AuthModule

Social login through Privy as the primary path, an external wallet as the secondary path, and one user record for both, as specified in `BRIEF.md` (product principle), `ARCHITECTURE.md` sections 6, 7 and 10, `THREAT-MODEL.md` trust boundary 10, and `SECURITY.md` sections 1, 2 and 11. Server-side Privy verification uses `@privy-io/node` 0.35.0, pinned exactly; `viem` is pinned to 2.56.9, the version WalletsModule uses.

## What it does

- **Primary path, social login** (`signInWithPrivy`, then `authenticatePrivy` per request): the client sends a Privy access token and a Privy identity token. Both are verified locally: ES256 signature against the app's verification key, issuer `privy.io`, audience the app ID, expiry, and both must name the same Privy user. Guest users are refused, because a guest's embedded wallet has no login method to recover it and would own agent capital. The first sign-in creates the user.
- **Embedded wallet provisioning callback**: the embedded wallet's address comes only from the verified identity token, never from a field the client sends. If the user has no owner wallet yet, the embedded wallet becomes it, and the `OwnerWalletHandoff` port is called once. Two embedded wallets with no owner yet is refused rather than guessed. An embedded wallet created after the first sign-in is picked up by the next sign-in.
- **Secondary path, external wallet** (`walletChallenge`, `signInWithWallet`, then `authenticateWalletSession` per request): the server issues a one-time EIP-4361 message, keeps it, and verifies the wallet's signature over exactly that message. A challenge is spent on first use, expires, and is bound to its purpose (sign in or link) and, for a link, to the user who asked for it. A successful sign-in returns an opaque session token; only its SHA-256 is stored. Signatures are recovered locally, so contract wallets (ERC-1271) are not supported on this path.
- **One account, both directions** (`linkWallet`, `linkPrivy`): an authenticated user can link an external wallet, or link a Privy identity and its embedded wallets. After either link, signing in through either path resolves to the same user. A Privy identity or a wallet that already belongs to another user is refused, never merged.
- **Authentication, not authorization**: a `Principal` says who the caller is and nothing else. The service accepts back only principals it issued and has not seen expire. `checkOwnership` compares the user's owner wallet with an agent owner the caller read from its own records or from chain, never from the request. `ownerSignerFor` accepts an `OwnerSigner` for WalletsModule only if its address is the user's owner wallet. The service holds no key and returns no signature: an owner-signed operation still needs the owner wallet to sign through WalletsModule, and an action on an agent's capital still passes the RiskModule and the on-chain validator.

### Owner wallet

A user has exactly one owner wallet: the owner of every agent account the user creates (`ARCHITECTURE.md` section 6). It is set once, from the first wallet the platform verifies for the user: the embedded wallet on the social path, the external wallet on the external path. Linking another wallet later never changes it, and a linked wallet that is not the owner wallet owns nothing. Changing the owner of existing agent accounts is an on-chain owner action that this module does not perform.

### Handoff to WalletsModule

Signing in deploys nothing. An agent account is deployed per agent, when AgentsModule calls `WalletsService.deploy` (`ARCHITECTURE.md` section 10: AgentsModule is the only module that calls WalletsModule to provision an account). What AuthModule hands off is the verified owner address: `OwnerWalletHandoff.ownerWalletReady` is called when it is first recorded, and `ownerSignerFor` checks the signer AgentsModule passes to `deploy`, `issueSessionKey` and `revokeSessionKey`. Handoff implementations must be idempotent; the owner is already stored when the handoff runs.

## Storage

`UserStore`, `ChallengeStore` and `SessionStore` are interfaces. No database layer exists in this repository yet, so only in-memory implementations are provided, for tests and local development. A production `UserStore` must enforce, atomically, that a Privy user ID and a wallet address each belong to at most one user: that uniqueness is what keeps one person from becoming two accounts under concurrent requests.

## Configuration

`loadAuthConfig()` reads these variables and rejects anything it cannot validate. None of them is a secret, and the Privy app secret is not used.

| Variable | Required | Meaning |
|---|---|---|
| `AUTH_PRIVY_APP_ID` | yes | Privy app ID. Tokens must carry it as their audience. |
| `AUTH_PRIVY_VERIFICATION_KEY` | yes | The app's verification key from the Privy dashboard, a PEM public key. Literal `\n` sequences are converted to newlines. |
| `AUTH_CHAIN_ID` | yes | Must be `10143`, Monad testnet, matching WalletsModule. |
| `AUTH_SIWE_DOMAIN` | yes | Host, with port if any, that serves the app. Written into every wallet sign-in message. |
| `AUTH_SIWE_URI` | yes | App origin, https, or http on localhost; its host must equal `AUTH_SIWE_DOMAIN`. |
| `AUTH_CHALLENGE_TTL_SECONDS` | no | Wallet challenge lifetime. Proposed default 300. |
| `AUTH_WALLET_SESSION_TTL_SECONDS` | no | Session lifetime on the external wallet path. Proposed default 3600. |

The consuming app also supplies the three stores and the `OwnerWalletHandoff`, then builds the module with `AuthModule.forRoot(new AuthService(...))`.

## Tests

`bun run --filter @monadeum/auth test` runs offline. Tokens are issued by a local stand-in for Privy with a key generated per run, and verified by the installed `@privy-io/node` code, so the signature, issuer, audience, and expiry checks under test are the SDK's own. The claim layout the stand-in emits was read from the installed SDK (`lib/auth.js`, `lib/identity-token.js`), not from Privy's live tokens.

`test/live.test.ts` is skipped unless `AUTH_PRIVY_LIVE=1`. It needs every variable above plus `AUTH_PRIVY_LIVE_ACCESS_TOKEN` and `AUTH_PRIVY_LIVE_IDENTITY_TOKEN`, copied from a logged-in testnet session. It verifies both locally and calls nothing at Privy. Never commit either token.

## Not verified yet

- No live run: the claim layout of Privy's identity token is taken from the installed SDK's parser, and has not been compared with a token Privy issued for this project's app. The live test is the check.
- Privy issues identity tokens only when they are enabled for the app in the Privy dashboard; this is an assumption about the dashboard setting to confirm with the live run.
- The issue #19 spike used Privy's React SDK 3.48.0 only; it did not exercise any server SDK. `@privy-io/node` is the package Privy's npm registry entry for the earlier `@privy-io/server-auth` points to as its replacement (checked 2026-10-10).
- The verification key is configured statically, so verification never depends on Privy being reachable, but a key rotation at Privy needs a configuration change. Privy also publishes a JWKS endpoint; using it is not decided.
- The frontend (`apps/web`) still runs on sample data: its sign-in step already lists social login first and the external wallet below an "advanced" divider, but it does not call Privy or this module.
