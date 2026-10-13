# Web

The dashboard of `ARCHITECTURE.md` section 15: Next.js App Router, Tailwind CSS, strict TypeScript, viem 2.56.9, and Privy's React SDK `@privy-io/react-auth` 3.48.0, the version the issue #19 spike validated, both pinned exactly.

## Data sources

One configuration switch, read at build time (`src/data/config.ts`):

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_MONADEUM_DATA_SOURCE` | `sample` (default) or `api`. |
| `NEXT_PUBLIC_MONADEUM_API_URL` | The API's origin. Required in `api` mode; https, or http on localhost. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app ID, public. Without it the email and Google path is shown as not configured; the external wallet path still works. |
| `NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL` | Label of the asset the API's limits and spends are counted in. Unset: amounts are labeled as settlement asset units. |
| `NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS` | Decimals of that asset. Default 6, matching the API's `API_SETTLEMENT_DECIMALS` default. |

- **`sample`**: every screen reads the deterministic sample source behind `PopulationSource` (`src/data/source.ts`), server-rendered, and says on screen that the data is a sample. This is the mode for local development and the test suite.
- **`api`**: the population, per-agent, capital-flow, selection-events, and create screens read `apps/api` from the browser (`src/data/api/client.ts`), because the credential lives there. They refresh every 15 seconds and when the tab regains focus. Screens whose data the API does not serve yet (controls) say so instead of showing sample data. The per-agent view adds net earnings after costs with its parts and the return on principal, the population screen the average fitness percentile of your ranked agents, and its reallocation explainer states the worker's recorded outcome for the latest evaluation, the binding reason included when a ranked agent moved nothing. The selection-events screen reads `GET /events`: retirements and reallocations between the owner's agents; policy-engine decisions are not served there yet. The population screen has the sample dashboard's layout: a row of platform totals, then the caller's agents in a table beside a niche card and an x402 card. The per-agent view opens with the same kind of hero and figures, then a capital history card. A figure the API leaves null or does not return (capital, capital history, fitness, trades, x402 purchases, the last evaluation) is shown in its place as pending, never filled in, and the line below the dashboard names only the fields that this response actually lacks. These fields are typed as optional (`src/data/api/types.ts`), so the screens read an API built before a field existed the same way as one that returns it as null, and fill in once it is served. Platform totals stay aggregates: the niche card groups only the caller's own live agents, by the risk band of each committed genome (the band half of `nicheKey` in `@monadeum/fitness`), and counts their distinct niches; no other owner's agent is identified.

The data source is a build-time choice, not a runtime toggle: a build serves either sample data or API data, never a mix.

## Reallocation is off unless the API says otherwise

The deployment's reallocation switch (`MONADEUM_REALLOCATION_ENABLED`, `ARCHITECTURE.md` section 5) is not a web setting: in `api` mode the screens read it from `reallocation` in `GET /owners/me`. Unless that says `enabled: true`, including when the field is missing, every agent's explainer reads "Reallocation is off" with the study result as the reason, a policy recorded earlier is stated to have no effect, the capital-flow summary shows reallocation off for every agent instead of the policy state, and no policy step is offered. With it on, the screens show the policy state as before, with a note that promises no returns. In `sample` mode the reallocation screens keep the sample's policies and moves, which illustrate the design, and say that they do not describe a running deployment and that reallocation is off there. The reason text comes from `@monadeum/reallocation/switch`, the same text the API reports.

## Sign-in and sessions

In `api` mode the web app is login-first: nobody sees any part of the app before signing in.

| Route | Session unknown | Signed out | Signed in |
|---|---|---|---|
| `/login` | The sign-in page, shown at once | The sign-in page | Redirect to `next`, else `/population` |
| `/` | Landing page | Landing page | Landing page |
| App screens (`/population`, `/agents/:id`, ...) | Neutral "Checking your session" state: no navigation, no data | Redirect to `/login?next=<path>` | Navigation and screen |

- **`/login`** is a full-screen page with no navigation and no data: the product name, one sentence on what it is, the testnet note, and the two sign-in paths below. It does not wait for Privy's SDK: the buttons render immediately (the page is prerendered), and the email and Google button stays disabled until Privy reports ready. If Privy's SDK fails to load (for example a rejected app ID), the page says so and the wallet path keeps working.
- **`next`** is accepted only as a same-origin relative path (`src/components/api/navigation.ts`, `safeNext`): an absolute or protocol-relative URL, a backslash, a control character, a path that normalizes to `//host`, or `/login` itself falls back to `/population`, so the parameter cannot be used as an open redirect.
- **The landing page** (`src/app/_landing`) renders at `/` in both modes and does not depend on the session. Every figure on it is labeled as an illustrative sample, so it is never read as live data. Its "Open app" and "Create my first agent" links lead to app screens, which in `api` mode go through the gate above.
- **The session** is mounted once in the root layout (`ApiRoot`), so it survives navigation between `/login` and the app. Privy loads beside it through `next/dynamic` and reports its state upward; until it does, the session check runs against a not-ready placeholder.
- **This is UX gating, not access control.** Every API endpoint that serves data requires a session and answers `401` without one, and the API decides authorization from its own records (`THREAT-MODEL.md` trust boundary 10); the redirects only decide what the browser shows.

In `sample` mode none of this applies: there is no session, the app screens render directly with the sample wallet chip, and `/login` redirects to `/population`.

- **Primary path, email or Google through Privy.** After Privy's login, the client sends the access token and the identity token to `POST /auth/privy/sign-in`, then sends the access token as `Authorization: Bearer` on every request, with `credentials: "omit"` so a leftover wallet session cookie can never make a request carry both credentials (the API refuses that as `ambiguous-credentials`).
- **Secondary path, below an "advanced" divider: an external browser wallet.** The client asks the API for a one-time EIP-4361 message, has the wallet sign exactly that text, and posts the signature to `POST /auth/wallet/verify`, which sets the `HttpOnly` session cookie. Later requests use `credentials: "include"`; the browser attaches the cookie and its own `Origin`, which the API checks on state-changing requests. The page never reads the cookie.
- **Session check timeout.** If neither the API nor Privy confirms or refuses a session within 10 seconds, the app screens redirect to `/login`, which shows the sign-in options with an error instead of loading indefinitely.
- **Sign out** ends the Privy session with Privy's SDK and calls `POST /auth/sign-out`, which clears the wallet session cookie, then returns to `/login` without a `next`.
- **Deployment constraint.** The cookie is `SameSite=Strict` and `Secure`, so the web app and the API must be same-site (for example `app.example.com` and `api.example.com`, or `localhost` on two ports in development), and the web origin must equal the API's `AUTH_SIWE_URI`, the only origin its CORS policy allows.

A session identifies the user and authorizes nothing (`THREAT-MODEL.md` trust boundary 10). Every button here captures intent; the API re-derives ownership and re-validates every value.

## Create an agent

In `api` mode the create screen reads `GET /genome/presets` and sends `POST /agents` with exactly `name`, `perTxCap`, `dailyCap` (converted to base units with the configured decimals), and `preset`; the API builds the genome and refuses any other field. Each preset is shown in plain language (pair, largest position as a share of capital, decision cadence and lookback, paid information or none) with the hash of the genome it commits, never as its raw parameters, and with the statement that a preset is not a tested edge. The screen states that the agent will not trade until it is funded: principal starts at 0, funding is not built, and the worker does not tick an unfunded agent. The per-agent view and the population table repeat that state. A `409 population-cap`, a `400` (cap above the server's maximum, unknown preset, invalid body), and a `503` without a session key vault are each shown with the statement that nothing was created. After creation, the owner signs the account deployment on the same screen.

## Activate this agent

A deployed agent without a live session key shows an "Activate this agent" card above the stop card. Before anything is signed it lists what the key can do (only the allowlisted calls, within the per-transaction and daily caps, which the account's spend policy enforces on chain) and cannot do (pay an address of its choosing, change its own limits or allowlist, sign messages for the account), names the guarantee not yet checked (whether the exchange router can forward funds elsewhere), and states that activation does not make the agent trade: an unfunded agent is not ticked, and the worker's tick runner, which needs a signed risk policy, is off until the operator enables it. The button calls `POST /agents/:id/activate`; the owner signs Kernel's EIP-712 enable approval through the same plain-language signing view, with the raw typed data expandable. The card shows "active" only once the operation reports the key issued and the chain accepting it, then shows the key as `GET /agents/:id/session` reads it from chain; "Stop this agent" becomes available. After a stop, the card offers a new key and says the old one stays revoked. Each refusal (`409 not-deployed`, `already-active`, `revocation-pending`, `agent-retired`, `503 wallets-unavailable`) is shown as the API states it.

## Stop this agent

The per-agent view in `api` mode has a "Stop this agent" card: the button, then a confirmation, so two interactions (issue #44). It is labeled as an emergency stop and says that it is not retirement. It calls `POST /agents/:id/stop` and shows what the API answers, never an assumed state: the off-chain revocation at once, the owner signature for the on-chain step, `stopped` only once the operation reports the on-chain revocation verified, and the status from `GET /agents/:id/revocation` (validator installed, nonces), which anyone can check against the account. A stop held by the bulk recovery rule shows the confirm and release steps. A `503 wallets-unavailable` (no session key vault on that server) is shown as such, with the statement that nothing was changed.

## Owner-signed operations

Deployment and revocation are relayed by the API to the owner's wallet (`apps/api` README, "Owner-signed operations"). The page shows a plain-language summary of what the owner authorizes, then the exact payload in an expandable section, then asks the wallet to sign through EIP-1193 (`personal_sign` or `eth_signTypedData_v4`). Only the signature is posted back; no key is read or sent. A wallet whose address is not the owner wallet is refused before anything is signed. When the request is a 32-byte user operation hash, the page says plainly that it cannot recompute that hash from the calls, which is the API's documented blind-signing gap.

## Tests

`bun run test` builds the libraries the screens import, type-checks, runs `bun test src`, and runs `next build` (sample mode). Data-layer tests (`src/data/api/api.test.ts`) drive the API client against a mocked `fetch` and check credentials, errors, the stop states, the explainer states, and that typed data and messages signed through the EIP-1193 call verify against the API's own definitions. Component tests (`src/components/api/components.test.tsx`) render the sign-in, stop, signature, and read views from API-shaped props, including the population dashboard and the per-agent figures both against today's API shape (the new fields absent, rendered as pending) and with those fields served. Gating tests (`src/components/api/gate.test.tsx`) cover the redirect decisions (signed out to `/login` with `next`, open-redirect `next` values refused), that the navigation rail is not rendered before a session is confirmed, that the landing renders with its sample labels, and that `sample` mode is unchanged. The redirects themselves run in effects, which a static render does not execute, so they are tested on the decision functions the components call. The sample-source tests are unchanged.

`scripts/smoke-api.ts` is an opt-in run against a live API process on in-memory stores, using the external wallet path with a throwaway key:

```bash
# terminal 1, from apps/api after building it
AUTH_PRIVY_APP_ID=app AUTH_PRIVY_VERIFICATION_KEY="<a P-256 PEM public key, for example from openssl ec -pubout>" AUTH_CHAIN_ID=10143 \
AUTH_SIWE_DOMAIN=localhost:3000 AUTH_SIWE_URI=http://localhost:3000 \
API_MAX_PER_TX_CAP=1000000 API_MAX_DAILY_CAP=5000000 API_AGENT_PAIR=WETH/USDC API_PORT=3901 node dist/src/main.js
# terminal 2, from apps/web
SMOKE_API_URL=http://127.0.0.1:3901 SMOKE_ORIGIN=http://localhost:3000 bun scripts/smoke-api.ts
```

## Not verified yet

- No run against a live Privy app: the Privy path (login, identity token, embedded wallet provider, `switchChain`) follows the SDK's type definitions and the issue #19 spike, and has not been exercised against the API's sign-in endpoint with real tokens.
- The login gate was checked in a browser against an `api` build with no reachable API and a rejected Privy app ID (redirect to `/login?next=`, the API and Privy errors shown, the wallet button enabled). The signed-in redirect (from `/login` to `next`) and sign-out returning to `/login` are covered by the decision tests only, not by a browser run with a live session.
- No owner-signed operation has been signed by a real wallet through this page: the running API has no WalletsModule, so deployment and stop answer 503. The signing path is covered by tests with a local key standing in for the wallet.
- MetaMask-style wallets require `types.EIP712Domain` and an active chain matching the typed data's `chainId`; the page adds the former and asks the wallet to switch to Monad testnet, but no specific wallet has been tried.

## Discovery metadata

Crawler rules (`/robots.txt`), `/sitemap.xml`, the home page `Link` header, `/.well-known/api-catalog`, markdown for `Accept: text/markdown` on `/` and `/evidence`, and two read-only WebMCP tools on `/evidence` are described in `ARCHITECTURE.md` section 15. They are built from `src/lib/site.ts` and `src/lib/markdown.ts`. The production build sets `NEXT_PUBLIC_MONADEUM_WEB_URL` and `NEXT_PUBLIC_MONADEUM_API_URL`; without the API URL the catalog answers 404 and the home page omits its link.
