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
- **`api`**: the population, per-agent, capital-flow, and create screens read `apps/api` from the browser (`src/data/api/client.ts`), because the credential lives there. They refresh every 15 seconds and when the tab regains focus. Screens whose data the API does not serve yet (selection events, controls) say so instead of showing sample data. Fields the API returns as null (capital, fitness, trades, x402 purchases, evaluation outcomes) are named as not served, never filled in; evaluation results are to be shown once the API serves them.

The data source is a build-time choice, not a runtime toggle: a build serves either sample data or API data, never a mix.

## Sign-in and sessions

- **Primary path, email or Google through Privy.** After Privy's login, the client sends the access token and the identity token to `POST /auth/privy/sign-in`, then sends the access token as `Authorization: Bearer` on every request, with `credentials: "omit"` so a leftover wallet session cookie can never make a request carry both credentials (the API refuses that as `ambiguous-credentials`).
- **Secondary path, below an "advanced" divider: an external browser wallet.** The client asks the API for a one-time EIP-4361 message, has the wallet sign exactly that text, and posts the signature to `POST /auth/wallet/verify`, which sets the `HttpOnly` session cookie. Later requests use `credentials: "include"`; the browser attaches the cookie and its own `Origin`, which the API checks on state-changing requests. The page never reads the cookie.
- **Session check timeout.** If neither the API nor Privy confirms or refuses a session within 10 seconds, the page shows the sign-in options with an error instead of loading indefinitely.
- **Sign out** ends the Privy session with Privy's SDK and calls `POST /auth/sign-out`, which clears the wallet session cookie.
- **Deployment constraint.** The cookie is `SameSite=Strict` and `Secure`, so the web app and the API must be same-site (for example `app.example.com` and `api.example.com`, or `localhost` on two ports in development), and the web origin must equal the API's `AUTH_SIWE_URI`, the only origin its CORS policy allows.

A session identifies the user and authorizes nothing (`THREAT-MODEL.md` trust boundary 10). Every button here captures intent; the API re-derives ownership and re-validates every value.

## Create an agent

In `api` mode the create screen reads `GET /genome/presets` and sends `POST /agents` with exactly `name`, `perTxCap`, `dailyCap` (converted to base units with the configured decimals), and `preset`; the API builds the genome and refuses any other field. Each preset is shown in plain language (pair, largest position as a share of capital, decision cadence and lookback, paid information or none) with the hash of the genome it commits, never as its raw parameters, and with the statement that a preset is not a tested edge. The screen states that the agent will not trade until it is funded: principal starts at 0, funding is not built, and the worker does not tick an unfunded agent. The per-agent view and the population table repeat that state. A `409 population-cap`, a `400` (cap above the server's maximum, unknown preset, invalid body), and a `503` without a session key vault are each shown with the statement that nothing was created. After creation, the owner signs the account deployment on the same screen.

## Stop this agent

The per-agent view in `api` mode has a "Stop this agent" card: the button, then a confirmation, so two interactions (issue #44). It is labeled as an emergency stop and says that it is not retirement. It calls `POST /agents/:id/stop` and shows what the API answers, never an assumed state: the off-chain revocation at once, the owner signature for the on-chain step, `stopped` only once the operation reports the on-chain revocation verified, and the status from `GET /agents/:id/revocation` (validator installed, nonces), which anyone can check against the account. A stop held by the bulk recovery rule shows the confirm and release steps. A `503 wallets-unavailable` (no session key vault on that server) is shown as such, with the statement that nothing was changed.

## Owner-signed operations

Deployment and revocation are relayed by the API to the owner's wallet (`apps/api` README, "Owner-signed operations"). The page shows a plain-language summary of what the owner authorizes, then the exact payload in an expandable section, then asks the wallet to sign through EIP-1193 (`personal_sign` or `eth_signTypedData_v4`). Only the signature is posted back; no key is read or sent. A wallet whose address is not the owner wallet is refused before anything is signed. When the request is a 32-byte user operation hash, the page says plainly that it cannot recompute that hash from the calls, which is the API's documented blind-signing gap.

## Tests

`bun run test` builds the libraries the screens import, type-checks, runs `bun test src`, and runs `next build` (sample mode). Data-layer tests (`src/data/api/api.test.ts`) drive the API client against a mocked `fetch` and check credentials, errors, the stop states, the explainer states, and that typed data and messages signed through the EIP-1193 call verify against the API's own definitions. Component tests (`src/components/api/components.test.tsx`) render the sign-in, stop, signature, and read views from API-shaped props. The sample-source tests are unchanged.

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
- No owner-signed operation has been signed by a real wallet through this page: the running API has no WalletsModule, so deployment and stop answer 503. The signing path is covered by tests with a local key standing in for the wallet.
- MetaMask-style wallets require `types.EIP712Domain` and an active chain matching the typed data's `chainId`; the page adds the former and asks the wallet to switch to Monad testnet, but no specific wallet has been tried.
