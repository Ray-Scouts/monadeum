# AuthModule

Social login through Privy as the primary path, an external wallet as the secondary path, and one user record for both, as specified in `BRIEF.md` (product principle), `ARCHITECTURE.md` sections 6, 7 and 10, `THREAT-MODEL.md` trust boundary 10, and `SECURITY.md` sections 1, 2 and 11. Server-side Privy verification uses `@privy-io/node` 0.35.0, pinned exactly, with `jose` 6.2.12 (pinned exactly, the version that SDK resolves to here) for the key set; `viem` is pinned to 2.56.9, the version WalletsModule uses.

## What it does

- **Primary path, social login** (`signInWithPrivy`, then `authenticatePrivy` per request): the client sends a Privy access token and a Privy identity token. Both are verified locally: ES256 signature against a key Privy publishes for the app (selected by the token's `kid`, see "Privy verification keys" below) or a configured static key, issuer `privy.io`, audience the app ID, expiry, and both must name the same Privy user. Guest users are refused, because a guest's embedded wallet has no login method to recover it and would own agent capital. The first sign-in creates the user.
- **Embedded wallet provisioning callback**: the embedded wallet's address comes only from the verified identity token, never from a field the client sends. If the user has no owner wallet yet, the embedded wallet becomes it, and the `OwnerWalletHandoff` port is called once. Two embedded wallets with no owner yet is refused rather than guessed. An embedded wallet created after the first sign-in is picked up by the next sign-in.
- **Secondary path, external wallet** (`walletChallenge`, `signInWithWallet`, then `authenticateWalletSession` per request): the server issues a one-time EIP-4361 message, keeps it, and verifies the wallet's signature over exactly that message. A challenge is spent on first use, expires, and is bound to its purpose (sign in or link) and, for a link, to the user who asked for it. A successful sign-in returns an opaque session token; only its SHA-256 is stored. Signatures are recovered locally, so contract wallets (ERC-1271) are not supported on this path.
- **One account, both directions** (`linkWallet`, `linkPrivy`): an authenticated user can link an external wallet, or link a Privy identity and its embedded wallets. After either link, signing in through either path resolves to the same user. A Privy identity or a wallet that already belongs to another user is refused, never merged.
- **Authentication, not authorization**: a `Principal` says who the caller is and nothing else. The service accepts back only principals it issued and has not seen expire. `checkOwnership` compares the user's owner wallet with an agent owner the caller read from its own records or from chain, never from the request. `ownerSignerFor` accepts an `OwnerSigner` for WalletsModule only if its address is the user's owner wallet. The service holds no key and returns no signature: an owner-signed operation still needs the owner wallet to sign through WalletsModule, and an action on an agent's capital still passes the RiskModule and the on-chain validator.

### Owner wallet

A user has exactly one owner wallet: the owner of every agent account the user creates (`ARCHITECTURE.md` section 6). It is set once, from the first wallet the platform verifies for the user: the embedded wallet on the social path, the external wallet on the external path. Linking another wallet later never changes it, and a linked wallet that is not the owner wallet owns nothing. Changing the owner of existing agent accounts is an on-chain owner action that this module does not perform.

### Handoff to WalletsModule

Signing in deploys nothing. An agent account is deployed per agent, when AgentsModule calls `WalletsService.deploy` (`ARCHITECTURE.md` section 10: AgentsModule is the only module that calls WalletsModule to provision an account). What AuthModule hands off is the verified owner address: `OwnerWalletHandoff.ownerWalletReady` is called when it is first recorded, and `ownerSignerFor` checks the signer AgentsModule passes to `deploy`, `issueSessionKey` and `revokeSessionKey`. Handoff implementations must be idempotent; the owner is already stored when the handoff runs.

## Storage

`UserStore`, `ChallengeStore` and `SessionStore` are interfaces. The in-memory implementations here are for tests and local development; `@monadeum/db` provides the Postgres implementations. A production `UserStore` must enforce, atomically, that a Privy user ID and a wallet address each belong to at most one user: that uniqueness is what keeps one person from becoming two accounts under concurrent requests. The Postgres store does it with unique constraints and one transaction per write, and a shared conformance suite holds both implementations to the same behavior.

## Configuration

`loadAuthConfig()` reads these variables and rejects anything it cannot validate. None of them is a secret, and the Privy app secret is not used.

| Variable | Required | Meaning |
|---|---|---|
| `AUTH_PRIVY_APP_ID` | yes | Privy app ID. Tokens must carry it as their audience, and it names the key set fetched. Letters, digits, `_` and `-` only, since it is a URL path segment. |
| `AUTH_PRIVY_VERIFICATION_KEY` | no | Static override, a PEM public key. Unset or empty: keys come from Privy's published key set for the app. Set: only this key is used and nothing is fetched. Literal `\n` sequences are converted to newlines. |
| `AUTH_CHAIN_ID` | yes | Must be `10143`, Monad testnet, matching WalletsModule. |
| `AUTH_SIWE_DOMAIN` | yes | Host, with port if any, that serves the app. Written into every wallet sign-in message. |
| `AUTH_SIWE_URI` | yes | App origin, https, or http on localhost; its host must equal `AUTH_SIWE_DOMAIN`. |
| `AUTH_CHALLENGE_TTL_SECONDS` | no | Wallet challenge lifetime. Proposed default 300. |
| `AUTH_WALLET_SESSION_TTL_SECONDS` | no | Session lifetime on the external wallet path. Proposed default 3600. |

### Privy verification keys

**Decision: verify against Privy's published key set by default.** Privy publishes an app's verification keys as a JSON Web Key Set at `https://auth.privy.io/api/v1/apps/<appId>/jwks.json`, the URL `@privy-io/node` 0.35.0 builds in `lib/auth.js`. On 2026-10-11 that set listed two ES256 keys for this project's app, with different `kid`s. A single static key may then verify one kind of token and not the other, and any key change at Privy breaks every sign-in until configuration catches up. Selecting the key by `kid` from the published set removes both problems. The cost is a runtime dependency on Privy's endpoint, bounded by the cache below, and the failure direction stays closed.

How `CachedJwks` (`src/jwks.ts`) behaves, with the key then handed to the SDK's own `verifyAccessToken` and `verifyIdentityToken`, which still enforce ES256, issuer `privy.io`, audience the app ID, and expiry:

- Only ES256 is accepted, and a token without a `kid` is refused. The key is the set member whose `kid`, key type, and curve match; jose's `createLocalJWKSet` does the matching. `@privy-io/node` exports `createPrivyAppJWKS`, but its cache settings are fixed and its fetch cannot be replaced for offline tests, so this module builds its own cache around `jose` instead.
- The set is fetched on first use and refetched on the next verification after 10 minutes. If a refetch fails, the last set keeps verifying until it is 60 minutes old, then every Privy-path request is refused with `invalid-token` until a fetch succeeds. A malformed or non-200 response counts as a failed fetch. Redirects are refused, and a fetch times out after 5 seconds.
- A `kid` not in the cached set causes one refetch, so a key Privy rotates in verifies without a restart. Fetch attempts, successful or not, are at least 60 seconds apart, so tokens with invented `kid`s cannot make the API hammer Privy; within that interval an unknown `kid` is refused.
- A key Privy withdraws stops verifying at the next successful refetch.

These durations are proposed values, not derived from a measurement or a documented Privy rotation schedule; they are constructor options (`JwksCacheOptions`), not environment variables.

**Static override.** If `AUTH_PRIVY_VERIFICATION_KEY` is set, it is the only key used and nothing is fetched. That restores the fully offline behavior for an environment that needs it, at the price of the problems above: tokens signed under another key, including a second key Privy uses at the same time, are refused, and a rotation needs a configuration change and a restart of every API process.

**Rotation.** With the default, a rotation at Privy needs no action here: the new `kid` triggers a refetch. With the static override, copy the new key from the Privy dashboard into `AUTH_PRIVY_VERIFICATION_KEY` through the reviewed configuration path, restart every API process, and expect tokens signed under the old key to be refused with `invalid-token`; affected users sign in again. In both cases, confirm with the opt-in live test (`AUTH_PRIVY_LIVE=1`) using freshly issued tokens. Wallet sessions on the external path depend on neither and are not affected.

The consuming app also supplies the three stores and the `OwnerWalletHandoff`, then builds the module with `AuthModule.forRoot(new AuthService(...))`.

## Tests

`bun run --filter @monadeum/auth test` runs offline. Tokens are issued by a local stand-in for Privy with a key generated per run, and verified by the installed `@privy-io/node` code, so the signature, issuer, audience, and expiry checks under test are the SDK's own. The claim layout the stand-in emits was read from the installed SDK (`lib/auth.js`, `lib/identity-token.js`), not from Privy's live tokens.

`test/jwks.test.ts` covers the key set offline: a stub `fetch` serves a local JWKS of two keys with distinct `kid`s. Access and identity tokens signed by either key verify from one fetch; an unknown `kid` causes exactly one refetch and is then refused, with no further fetch inside the interval; a key added to the set verifies after that refetch and a removed one stops verifying; a wrong `alg` (ES384, HS256 over the public key, `none`), a missing `kid`, a wrong issuer or audience, and an expired token are refused; an unreachable endpoint, a 503, and a malformed set fail closed; a cached set survives a failed refetch only up to its maximum age; and a static key, when configured, is the only key used and nothing is fetched.

`test/live.test.ts` is skipped unless `AUTH_PRIVY_LIVE=1`. It needs every variable above plus `AUTH_PRIVY_LIVE_ACCESS_TOKEN` and `AUTH_PRIVY_LIVE_IDENTITY_TOKEN`, copied from a logged-in testnet session. It verifies both locally; without `AUTH_PRIVY_VERIFICATION_KEY` it fetches the app's published key set, and otherwise calls nothing at Privy. Never commit either token.

## Not verified yet

- No live run: the claim layout of Privy's identity token is taken from the installed SDK's parser, and has not been compared with a token Privy issued for this project's app. The live test is the check.
- Privy issues identity tokens only when they are enabled for the app in the Privy dashboard; this is an assumption about the dashboard setting to confirm with the live run.
- The issue #19 spike used Privy's React SDK 3.48.0 only; it did not exercise any server SDK. `@privy-io/node` is the package Privy's npm registry entry for the earlier `@privy-io/server-auth` points to as its replacement (checked 2026-10-10).
- The rotation behavior above has not been exercised against a real Privy key change. Which of the app's two published keys signs access tokens and which signs identity tokens was not determined; the key set handles either.
- Privy's key set endpoint was read on 2026-10-11 (two ES256 P-256 keys, `use` `sig`, `alg` ES256). Its caching headers, rate limits, and availability were not checked, and are why the cache above bounds both refetch frequency and staleness.
- The frontend (`apps/web`) calls Privy and this module through `apps/api` in its `api` mode, but that path has not been run against a live Privy app either.
