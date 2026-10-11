# API

The API process of `ARCHITECTURE.md` section 10: a NestJS application on Fastify that composes AuthModule (`@monadeum/auth`), WalletsModule (`@monadeum/wallets`), RecoveryModule (`@monadeum/recovery`), the commitment library, and the indexer read-model, behind HTTP. It has no agent loop. The decisions are recorded in `ARCHITECTURE.md` section 10 (API entry), and the trust boundary it implements is `THREAT-MODEL.md` boundary 10.

## Endpoints

Every response is JSON. An error is `{ "error": "<reason>", "detail"?: "..." }` with a stable reason.

| Method and path | Auth | What it does |
|---|---|---|
| `GET /health` | none | Liveness, and whether wallet operations are configured. Reads no store. |
| `POST /auth/privy/sign-in` | none, rate limited | Verifies a Privy access token and identity token, creates or finds the user. The client then sends the access token as `Authorization: Bearer`. |
| `POST /auth/wallet/challenge` | none, rate limited | Issues a one-time EIP-4361 message for an external wallet. |
| `POST /auth/wallet/verify` | none, rate limited | Verifies the signed message and sets the `monadeum_session` cookie. The token is never in the body. |
| `POST /auth/wallet/link/challenge`, `POST /auth/wallet/link` | session, rate limited | Links an external wallet to the caller. Never changes the owner wallet. |
| `POST /auth/privy/link` | session, rate limited | Links a Privy identity and its embedded wallets to the caller. |
| `POST /auth/sign-out` | cookie, optional | Deletes the wallet session and clears the cookie. |
| `GET /auth/me` | session | The caller's user record. |
| `GET /population` | session | Platform aggregates, no agent identified: counts and total spend from the read-model, `trades` (filled trades across every agent), and `x402` (purchases, spend, and spend per provider across every agent). |
| `GET /owners/me` | session | The caller as an owner, in the web's `Owner` shape. |
| `GET /agents`, `GET /agents/:id` | session, owner | The caller's agents: registry, WalletsModule record, the read-model's view of each account, and each agent's filled trades and x402 spend from the worker's stores. |
| `GET /capital-flow` | session | The caller's capital flow. Reallocations are not indexed yet, so the list is empty and `reallocationsIndexed` is false. |
| `GET /genome/presets` | session | The genome presets an agent can be created from, the configured pair, and the hash each would commit. |
| `POST /agents` | session | Creates an agent from a genome preset and starts its owner-signed deployment. |
| `POST /agents/:id/deploy` | session, owner | Retries deployment. |
| `POST /agents/:id/stop` | session, owner | "Stop this agent" (issue #44): revokes the session key, subject to the bulk recovery hold. |
| `GET /agents/:id/revocation` | session, owner | Revocation status read from chain. |
| `GET /recovery/holds`, `POST /recovery/holds/:id/confirm`, `POST /recovery/holds/:id/release` | session, owner | The bulk recovery hold of `SECURITY.md` section 9. |
| `GET /policies/reallocation`, `POST /policies/reallocation` | session, owner | The owner-signed reallocation policy, and the reallocation switch as `reallocation: { enabled, reason }`. The proposal answers `409 reallocation-disabled` while the switch is off. |
| `GET /operations/:id`, `POST /operations/:id/signature` | session, starter | The signature relay for owner-signed operations. |

### Authentication and authorization

- Two credentials: a Privy access token as `Authorization: Bearer`, verified locally per request, or the external wallet session cookie (`HttpOnly`, `Secure`, `SameSite=Strict`). A request carrying both is refused (`ambiguous-credentials`).
- A state-changing request authenticated by the cookie must carry the web app's origin as `Origin` (`origin-not-allowed` otherwise), and so must `POST /auth/wallet/verify`, which sets the cookie. CORS allows only that origin.
- A session identifies the caller and authorizes nothing (`THREAT-MODEL.md` boundary 10). Every per-agent handler reads the agent's owner from the API's registry, never from the request, and AuthModule compares it with the caller's one owner wallet. Another user's agent answers `404 not-found`, like a missing one, so its existence is not disclosed. WalletsModule's record and the worker's agent registry (`@monadeum/agent-registry`, `worker_agents`), where they exist, must name the same owner, or the request fails closed with `409 ownership-mismatch`.
- Rate limiting: `@nestjs/throttler` 6.7.1, one named throttler `auth`, in-process storage, applied per client IP and per endpoint to every sign-in, challenge, and link endpoint. Proposed default: 10 requests per 60 seconds.

### Owner-signed operations

The API never holds an owner key. Deployment, revocation, and the reallocation policy each run as an operation whose signer relays every signature request to the owner's wallet:

1. The starting request answers with `operation.status: "awaiting-signature"` and `operation.signatureRequest`: `{ id, expiresAt, kind: "message", message }` (EIP-191, which is how Kernel's ECDSA validator has the owner sign a user operation hash) or `{ id, expiresAt, kind: "typed-data", typedData }` (EIP-712; integers are decimal strings).
2. The owner's wallet signs it, and the client posts `{ requestId, signature }` to `POST /operations/:id/signature`.
3. The API verifies the signature against the owner wallet before the operation continues; a wrong signature is `400 bad-signature` and the request stays open. The response is the next state: another request, `running` (poll `GET /operations/:id?wait=true`), `succeeded` with `result`, or `failed` with `error`.

A request not answered within `API_SIGNATURE_TIMEOUT_SECONDS` fails the operation closed. Operations live in the process's memory: a signature must reach the instance that started the operation, and a restart fails every open operation. Every operation is idempotent, so the client starts it again.

The user operation hash is a 32-byte digest, so the wallet shows the owner a hash rather than the calls it authorizes. The operation names its kind and agents, but the client cannot recompute the hash from them; see Not verified yet.

### Agent creation and the genome

`POST /agents` takes `{ name, perTxCap, dailyCap, preset? }`. The owner is the caller's owner wallet. The genome is never read from the request: any other field, such as `riskTolerance`, `genome`, `genomeHash`, `principal`, or `owner`, is refused with `400 unknown-field`, and a preset that is not defined is `400 unknown-preset`. Without `preset` the default, `conservative`, applies; it is the only preset for the MVP, and `EVOLUTION.md` section 1.1 gives the reasoning for every value. The API:

1. builds the genome from the preset (`@monadeum/strategy/presets`) and `API_AGENT_PAIR`, normalizes it, and hashes it with `@monadeum/commitment` (`ARCHITECTURE.md` section 16.4);
2. takes the next account index and asks WalletsModule for the counterfactual account address;
3. in one transaction, refuses at `API_POPULATION_CAP` Active agents (`409 population-cap`), then inserts the `api_agents` row and the `worker_agents` row: the worker's genome fields, the full normalized genome document, its hash, principal 0, and status `active`;
4. starts the owner-signed deployment as below.

Both rows are written or neither. Without a session key vault the request answers `503 wallets-unavailable` before anything is written. Principal is 0 until the worker's principal job recomputes it from finalized, indexed owner transfers to the deployed account (`EVOLUTION.md` section 1.1); until then the worker does not tick or evaluate the agent. The relayed allocation transfer that funds an agent from the embedded wallet (`ARCHITECTURE.md` section 6.1) is not built. The agent view serves the committed genome (`genome`, with `hash` and `preset`; `informationBudget` in base units as a decimal string), `principal` in base units as a decimal string, and the worker's `status`.

### Stop this agent

`POST /agents/:id/stop` revokes the agent's session key through `WalletsService.revokeSessionKey`. The revocation is immediate off chain: the key is destroyed in the session key vault and the record marked before the owner is asked to sign, so the first response already shows `local[].session: "revoking"`. The on-chain step (uninstall the permission validator, invalidate the Kernel nonce) completes when the owner signs; the operation's result carries WalletsModule's `RevokeResult` (`onChain: "verified"` and the user operation hash) and `revocationStatus` read back from chain: `installed`, `validatorNonce`, `currentNonce`, `validNonceFrom`, and `enableNonce`, which anyone can check against the account. The stop that would make a fourth distinct agent stopped by the same owner wallet within 60 minutes is held (`202`, `status: "held"`), and released through the confirm and release endpoints after the 15 minute delay, as `SECURITY.md` section 9 specifies.

### Reallocation policy

`POST /policies/reallocation` builds the owner's reallocation policy (`ReallocationPolicyV1` of `@monadeum/commitment`) from the caller's owner wallet and agents, naming each agent by its smart account address; an agent without one answers `409 agent-has-no-account`. It refuses any bound that loosens the protocol constants of `@monadeum/reallocation/constants`, converts fractions to the contract's basis points rounding down, takes the next sequence as the nonce, and relays the reallocation contract's own EIP-712 typed data (`policyTypedData`), in the domain of `API_REALLOCATION_CONTRACT` on `AUTH_CHAIN_ID` (`ARCHITECTURE.md` section 16.5). While the reallocation switch is off (the default) it answers `409 reallocation-disabled`, with the reason as `detail`, before reading the body, and nothing is built, relayed, or recorded; `GET /policies/reallocation` and `GET /owners/me` report the switch as `reallocation: { enabled, reason }`. Without `API_REALLOCATION_CONTRACT` it answers `503 reallocation-contract-not-configured`. The verified signature is recorded append-only, with the agent IDs, and handed to the policy writer. There is no policy writer yet, so a signed policy is recorded with `committed: null`. The ledger's sequence equals the contract's `policyNonce(owner)` only while every commit and revocation goes through this ledger; the writer, when built, reads the on-chain nonce first, and the contract refuses a mismatch with `BadNonce`.

### Read endpoints and the web

The agent view carries the field names of `Agent` in `apps/web/src/data/types.ts`. `status`, `principal`, and `genome` come from the worker's record, in the units above, which differ from the web's sample types (base-unit strings, not dollars). Fields no service produces yet (`capital`, `fitnessPercentile`, `lowWindows`, `zeroDownsideFlag`, `retirement`, `capitalHistory`) are `null`, not invented; the API's own fields (`deployment`, `session`, `limits`, `chain`) are what it can source today.

Trades and x402 purchases are read from the worker's own records, which the API reads and never writes:

- `tradeCount` (number) counts the agent's `trade_records` rows with status `filled`: operations the chain included and TradingModule attributed. A policy rejection, a blocked close, a failed or reverted operation, and a record still in flight or under review are not trades and are not counted. The agent is the order's `agentId` in the record (`TradeCounts` in `@monadeum/trading`).
- `x402` is `{ purchases, spent, byProvider: [{ provider, spent }] }`, amounts in settlement-asset base units as decimal strings, `byProvider` sorted by provider. It counts the agent's `x402_payments` entries with a nonzero price, by the rule `X402Client.spent` already uses for the agent's costs: once payment was attempted at accepted terms the full price counts, including an unconfirmed or anomalous payment, so spend is never understated; a purchase that never reached payment, or that the payer refused to sign, has price 0 and is not counted. `provider` is the provider the entry stores (one of the hardcoded `PROVIDERS`, today `nansen` and `defillama`). The payments table has no agent column: the agent is the purchase key up to its first colon, because every key begins with the tick key `<agentId>:<tick>:`, which holds because agent IDs contain no colon (`PaymentTotals` and `paymentAgentId` in `@monadeum/x402`).
- Both are `null` only when no store answered; an agent with no activity reads `0` and `{ purchases: 0, spent: "0", byProvider: [] }`. `POST /agents` returns the new agent with both `null`, because it does not read them. Per-agent figures are served only for agents the caller owns, by the ownership checks above; `GET /population` serves the same figures summed over every agent, by provider and never by agent. `apps/web` reads these endpoints in its `api` mode (`apps/web/README.md`) with views of its own, which name the null fields as not served rather than rendering them.

## Storage

The database rules are the worker's and the indexer's: `bootApi` reads `DATABASE_URL`, `DATABASE_MIGRATIONS`, and `MONADEUM_ENV` with `loadDatabaseSettings` and opens the database with `openDatabase` from `@monadeum/db`. With `DATABASE_URL` set, every store is on Postgres, including the API's own tables from migration `0007_api.sql`: the agent registry, the recovery log and holds, and the signed policies, and the worker's `worker_agents`, where migration `0008_api_agent_creation.sql` lets the API insert and nothing more. The migrations are verified at start (`verify`, the default) or applied (`apply`, for an owner connection only). Every statement runs inside a transaction under `SET LOCAL ROLE`: the stores as `monadeum_api`; the read-model, the worker's `trade_records`, and its `x402_payments` as `monadeum_reader`, which can only read them (migrations 0004 and 0005 already grant it SELECT on those tables, so no grant was added for these reads). The login role therefore needs membership in both group roles, and nothing else; it does not own the tables. Without `DATABASE_URL` the API runs on in-memory stores and logs that state is not durable; with `MONADEUM_ENV=production` it refuses to start instead.

`bootApi` constructs WalletsModule when `WALLETS_CHAIN_ID` is set (`loadWalletsRuntime` in `@monadeum/wallets`): the `WALLETS_*` settings of `libs/wallets/README.md`, over the API's own wallet store and ledger, with the session key vault shared with the worker, so that a revocation here destroys the key the worker holds. The only vault implemented is the local encrypted file vault, for testnet and local development; it refuses `MONADEUM_ENV=production` (`SECURITY.md` section 11). Without `WALLETS_CHAIN_ID`, deployment and stop answer `503 wallets-unavailable`. `GET /health` (unauthenticated) answers `{ status: "ok", wallets: "configured" | "unavailable" }` and reads nothing else; it is the container healthcheck.

## Configuration

AuthModule's variables (`libs/auth/README.md`) are required: `AUTH_PRIVY_APP_ID`, `AUTH_CHAIN_ID`, `AUTH_SIWE_DOMAIN`, `AUTH_SIWE_URI`, and optionally the two TTLs and `AUTH_PRIVY_VERIFICATION_KEY`, a static key that replaces fetching Privy's published key set. None of the variables below is a secret except `DATABASE_URL`, which carries a password.

| Variable | Required | Meaning |
|---|---|---|
| `API_MAX_PER_TX_CAP` | yes | Highest per-transaction cap an owner may request for a new agent, settlement-asset base units. |
| `API_MAX_DAILY_CAP` | yes | Highest daily cap, base units. At least `API_MAX_PER_TX_CAP`. |
| `API_AGENT_PAIR` | yes | The trading pair every new agent's genome names, such as `WETH/USDC`. It must be in the risk policy's `allowedPairs` and be the worker's market, or every trade is refused. No default. |
| `API_POPULATION_CAP` | no | Agent creation is refused at this many Active agents. Default 50, the proposed testnet cap of `EVOLUTION.md` section 4. |
| `DATABASE_URL` | no | Postgres connection string. Unset: in-memory stores. Keep it in the secrets store, never in a file. |
| `DATABASE_MIGRATIONS` | no | `verify` (default) or `apply`, as in `libs/db/README.md`. |
| `MONADEUM_ENV` | no | `development` (default) or `production`, which refuses to start without `DATABASE_URL`. |
| `API_PORT` | no | Default 3001. |
| `API_HOST` | no | Default 127.0.0.1. |
| `API_TRUST_PROXY` | no | `true` only behind a proxy that sets `X-Forwarded-For`; otherwise every client shares one rate limit or can spoof its IP. Default `false`. |
| `API_AUTH_RATE_LIMIT` | no | Requests per window per client IP per auth endpoint. Proposed default 10. |
| `API_AUTH_RATE_WINDOW_SECONDS` | no | Proposed default 60. |
| `API_SIGNATURE_TIMEOUT_SECONDS` | no | How long a signature request stays open. Proposed default 300. |
| `API_OPERATION_WAIT_SECONDS` | no | How long one request waits for an operation's next state. Proposed default 20. |
| `API_SETTLEMENT_DECIMALS` | no | Settlement-asset decimals, for the capital floor in base units. Default 6 (USDC). |
| `MONADEUM_REALLOCATION_ENABLED` | no | `false` (default) or `true`; anything else refuses to start. Read by `loadReallocationSwitch` (`@monadeum/reallocation/switch`), as in the worker. Off: policy proposals are refused with `409 reallocation-disabled` (`ARCHITECTURE.md` section 5). |
| `MONADEUM_REALLOCATION_PRODUCTION_ACK` | with the flag on in production | With `MONADEUM_ENV=production` and the flag `true`, the API refuses to start unless this is exactly `new-preregistered-study-reported-a-persistent-edge`, which may be set only after a new pre-registered study reports a persistent genome edge of at least the modeled size (`EVOLUTION.md` section 7). |
| `API_REALLOCATION_CONTRACT` | no | The deployed reallocation contract (`contracts/src/AgentReallocation.sol`), the `verifyingContract` of the policy's EIP-712 domain. Unset: reallocation policies are refused with `503`. |

The allowed origin is the origin of `AUTH_SIWE_URI`.

## Tests

`bun run --filter @monadeum/api test` runs offline. `test/api.test.ts` boots the application with `@nestjs/testing` and the Fastify adapter and drives it through HTTP injection, once on the in-memory stores and once on PGlite with every statement under the API's two roles, so a missing grant fails the suite. WalletsModule runs on its test chain from `@monadeum/wallets/testing`, extended so every owner operation requires an owner signature that recovers to the owner, which is what makes the relay testable. Privy tokens are verified by a stand-in; AuthModule's own tests cover the real `@privy-io/node` verification. `test/creation.test.ts` creates agents end to end and checks, on PGlite under the real roles, that the worker loads the record as `monadeum_worker`, that the genome hash verifies, that a client cannot inject genome fields or create an agent for another owner wallet, that an ownership mismatch stays refused, that both records are written or neither, and that the population cap holds. `test/roles.test.ts` checks that the grants of migrations 0007 and 0008 are no wider than stated. `test/activity.test.ts` writes trade records and payment log entries as the worker would (on PGlite through `monadeum_worker`) and checks each agent's `tradeCount` and `x402` in the list and the detail, that another owner's agent and its figures are never served, and the platform totals of `GET /population`.

## Not verified yet

- No run against a live Privy app, a bundler, or Monad testnet. The relay has been exercised only against the test chain; whether an embedded wallet's `personal_sign` over a user operation hash produces the signature Kernel's ECDSA validator accepts is an assumption from `libs/wallets`, not observed here.
- Blind hash signing: the owner signs a user operation hash it cannot check against the calls. Showing a verifiable preview needs the client to recompute the hash from the prepared operation, which WalletsModule does not expose.
- Rate limiting and the relay are in process. More than one API instance needs a shared throttler storage and sticky routing for operations, or a relay that persists the prepared operation; neither is built.
- No policy writer submits a signed policy to the reallocation contract yet, and the sequence-as-nonce rule above holds only while this ledger sees every change.
