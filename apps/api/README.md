# API

The API process of `ARCHITECTURE.md` section 10: a NestJS application on Fastify that composes AuthModule (`@monadeum/auth`), WalletsModule (`@monadeum/wallets`), RecoveryModule (`@monadeum/recovery`), the commitment library, and the indexer read-model, behind HTTP. It has no agent loop. The decisions are recorded in `ARCHITECTURE.md` section 10 (API entry), and the trust boundary it implements is `THREAT-MODEL.md` boundary 10.

## Endpoints

Every response is JSON. An error is `{ "error": "<reason>", "detail"?: "..." }` with a stable reason.

| Method and path | Auth | What it does |
|---|---|---|
| `GET /health` | none | Liveness, whether wallet operations and funding are configured, and the funding relayer's address. Reads no store. |
| `POST /auth/privy/sign-in` | none, rate limited | Verifies a Privy access token and identity token, creates or finds the user. The client then sends the access token as `Authorization: Bearer`. |
| `POST /auth/wallet/challenge` | none, rate limited | Issues a one-time EIP-4361 message for an external wallet. |
| `POST /auth/wallet/verify` | none, rate limited | Verifies the signed message and sets the `monadeum_session` cookie. The token is never in the body. |
| `POST /auth/wallet/link/challenge`, `POST /auth/wallet/link` | session, rate limited | Links an external wallet to the caller. Never changes the owner wallet. |
| `POST /auth/privy/link` | session, rate limited | Links a Privy identity and its embedded wallets to the caller. |
| `POST /auth/sign-out` | cookie, optional | Deletes the wallet session and clears the cookie. |
| `GET /auth/me` | session | The caller's user record. |
| `GET /population` | session | Platform aggregates, no agent identified: counts and total spend from the read-model, `trades` (filled trades across every agent), `x402` (purchases, spend, and spend per provider across every agent), and from the worker's evaluation records the latest evaluation (`lastEvaluation`) and the live agents' summed capital (`capital`). |
| `GET /owners/me` | session | The caller as an owner, in the web's `Owner` shape. |
| `GET /agents`, `GET /agents/:id` | session, owner | The caller's agents: registry, WalletsModule record, the read-model's view of each account, each agent's filled trades and x402 spend from the worker's stores, and the worker's evaluation records. |
| `GET /capital-flow` | session | The caller's capital flow. Reallocations are not indexed yet, so the list is empty and `reallocationsIndexed` is false. |
| `GET /genome/presets` | session | The genome presets an agent can be created from, the configured pair, and the hash each would commit. |
| `POST /agents` | session | Creates an agent from a genome preset and starts its owner-signed deployment. |
| `POST /agents/:id/deploy` | session, owner | Retries deployment. |
| `POST /agents/:id/activate` | session, owner | "Activate this agent": starts the owner-signed issuance of the agent's session key. |
| `GET /agents/:id/session` | session, owner | The session key read from chain and WalletsModule, including whether the account accepts it now. |
| `POST /agents/:id/stop` | session, owner | "Stop this agent" (issue #44): revokes the session key, subject to the bulk recovery hold. |
| `GET /agents/:id/revocation` | session, owner | Revocation status read from chain. |
| `GET /agents/:id/funding` | session, owner | The funding card: limits, the caller's relays left in the last 24 hours, and the owner wallet's USDC balance read from chain. |
| `POST /agents/:id/funding/prepare`, `POST /agents/:id/funding/submit`, `GET /agents/:id/funding/:nonce` | session, owner | "Fund this agent": the EIP-3009 authorization the owner signs, its relayed submission, and its status. |
| `GET /recovery/holds`, `POST /recovery/holds/:id/confirm`, `POST /recovery/holds/:id/release` | session, owner | The bulk recovery hold of `SECURITY.md` section 9. |
| `GET /policies/reallocation`, `POST /policies/reallocation` | session, owner | The owner-signed reallocation policy, and the reallocation switch as `reallocation: { enabled, reason }`. The proposal answers `409 reallocation-disabled` while the switch is off. |
| `GET /operations/:id`, `POST /operations/:id/signature` | session, starter | The signature relay for owner-signed operations. |

### Authentication and authorization

- Two credentials: a Privy access token as `Authorization: Bearer`, verified locally per request, or the external wallet session cookie (`HttpOnly`, `Secure`, `SameSite=Strict`). A request carrying both is refused (`ambiguous-credentials`).
- A state-changing request authenticated by the cookie must carry the web app's origin as `Origin` (`origin-not-allowed` otherwise), and so must `POST /auth/wallet/verify`, which sets the cookie. CORS allows only that origin.
- A session identifies the caller and authorizes nothing (`THREAT-MODEL.md` boundary 10). Every per-agent handler reads the agent's owner from the API's registry, never from the request, and AuthModule compares it with the caller's one owner wallet. Another user's agent answers `404 not-found`, like a missing one, so its existence is not disclosed. WalletsModule's record and the worker's agent registry (`@monadeum/agent-registry`, `worker_agents`), where they exist, must name the same owner, or the request fails closed with `409 ownership-mismatch`.
- Rate limiting: `@nestjs/throttler` 6.7.1, one named throttler `auth`, in-process storage, applied per client IP and per endpoint to every sign-in, challenge, and link endpoint. Proposed default: 10 requests per 60 seconds.

### Owner-signed operations

The API never holds an owner key. Deployment, activation, revocation, and the reallocation policy each run as an operation whose signer relays every signature request to the owner's wallet:

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

Both rows are written or neither. Without a session key vault the request answers `503 wallets-unavailable` before anything is written. Principal is 0 until the worker's principal job recomputes it from finalized, indexed owner transfers to the deployed account (`EVOLUTION.md` section 1.1); until then the worker does not tick or evaluate the agent. The relayed allocation transfer that funds an agent from the owner wallet is described under "Fund this agent" below. The agent view serves the committed genome (`genome`, with `hash` and `preset`; `informationBudget` in base units as a decimal string), `principal` in base units as a decimal string, and the worker's `status`.

### Activate this agent

`POST /agents/:id/activate` issues the agent's session key through `WalletsService.issueSessionKey`, as an owner-signed operation of kind `activate`. Refusals, all before any key is generated:

| Status and reason | When |
|---|---|
| `404 not-found` | The agent does not exist or the caller does not own it. |
| `409 not-deployed` | WalletsModule has not recorded the account as deployed. Deploy it first. |
| `409 agent-retired` | The worker's record says the agent is retired. |
| `409 already-active` | The agent has an active session key. |
| `409 revocation-pending` | A stop destroyed the previous key but its on-chain revocation is not verified yet. |
| `503 wallets-unavailable` | No chain, bundler, or session key vault is configured. |

A revoked key can be replaced: the agent gets a new key and the old one stays revoked.

The response (`202`) is `{ operation }` with one signature request of kind `typed-data`: Kernel v3.1's EIP-712 enable data (`primaryType: "Enable"`, in the account's domain) for a permission validator scoped to the call allowlist, with the spend policy as policy and hook. Until the owner signs, the key exists only in the operation's memory; nothing is in the vault or the record. The owner posts the signature to `POST /operations/:id/signature`. WalletsModule then checks that the account has code and that the chain accepts the approval (the Kernel nonce still equals the one the signature is bound to, or the permission is installed and valid), and only then puts the key in the vault the worker reads and records it as `active`. The finished operation's `result` is `{ result, session }`: WalletsModule's `IssueResult` and the session status read from chain, the same object `GET /agents/:id/session` returns (`status`, `keyAddress`, `permissionId`, `issuedAt`, `keyHeld`, `state` with `installed`, `validatorNonce`, `currentNonce`, `validNonceFrom`, `enableNonce`, and `acceptedOnChain`).

No user operation is sent at activation, so no gas is spent and the sponsorship budget is not touched. Kernel installs the permission with the agent's first session-key operation, so right after activation `state.installed` is false and `acceptedOnChain` is true because the enable signature is still valid. "Stop this agent" works in both states. Activation does not start trading: the worker has no tick runner or market configured, and an unfunded agent is not ticked.

### Stop this agent

`POST /agents/:id/stop` revokes the agent's session key through `WalletsService.revokeSessionKey`. The revocation is immediate off chain: the key is destroyed in the session key vault and the record marked before the owner is asked to sign, so the first response already shows `local[].session: "revoking"`. The on-chain step (uninstall the permission validator, invalidate the Kernel nonce) completes when the owner signs; the operation's result carries WalletsModule's `RevokeResult` (`onChain: "verified"` and the user operation hash) and `revocationStatus` read back from chain: `installed`, `validatorNonce`, `currentNonce`, `validNonceFrom`, and `enableNonce`, which anyone can check against the account. The stop that would make a fourth distinct agent stopped by the same owner wallet within 60 minutes is held (`202`, `status: "held"`), and released through the confirm and release endpoints after the 15 minute delay, as `SECURITY.md` section 9 specifies.

### Fund this agent

The relayed allocation of `ARCHITECTURE.md` sections 6.1 and 7: USDC moves from the owner wallet on record to the agent's deployed account through an EIP-3009 `transferWithAuthorization` the owner signs, submitted by the platform's relayer, which pays the MON gas.

1. `POST /agents/:id/funding/prepare` with `{ value }` (base units, decimal string, at most `API_FUNDING_MAX_PER_TRANSFER`). The API refuses an account that is not deployed (`409 account-not-deployed`: WalletsModule's record says deployed, the account has code, and the worker's record names the same account), a retired agent, an owner wallet holding less than `value` (`409 insufficient-balance`), a spent daily budget (`429 funding-budget-exceeded`), and more than 5 open unsigned authorizations (`429 too-many-open-authorizations`). It reads the token's name, version, and decimals and checks them against its `DOMAIN_SEPARATOR` (`503 settlement-asset-unverified` otherwise), stores the authorization (`from` the owner wallet, `to` the account, `validAfter` 5 seconds ago, `validBefore` `API_FUNDING_VALIDITY_SECONDS` ahead, a random 32-byte `nonce`), and answers `201` with `typedData` in the token's domain.
2. The owner's wallet signs the typed data (`eth_signTypedData_v4`).
3. `POST /agents/:id/funding/submit` with `{ nonce, signature }`. The signature must recover the owner over the stored fields (`400 bad-signature`), at least 30 seconds before `validBefore` (`409 authorization-expired`). The relayer simulates the call (`409 relay-simulation-failed`), checks it can pay the gas limit (`503 relayer-balance-low`, nothing claimed or sent), claims the nonce and one of the user's daily relays in one step (`429 funding-budget-exceeded`), records the transaction hash, and broadcasts. The answer is `202` with `funding: { status, txHash, ... }`. The same nonce and signature again answer the recorded status and send nothing; another signature for a submitted nonce is `409 already-submitted`.
4. `GET /agents/:id/funding/:nonce` reconciles a submitted transfer from the chain: `confirmed` or `failed` from the receipt, or `failed` with `not-included` once it has expired and the token reports its nonce unused. A prepared one past its window reads `expired`.

Principal is not changed by any of this: it changes when the indexer stores the finalized transfer and the worker's principal job recomputes it (`EVOLUTION.md` section 1.1). The relayer key is created on first boot in its own encrypted file vault, testnet only; only its address is logged and served by `GET /health`.

### Reallocation policy

`POST /policies/reallocation` builds the owner's reallocation policy (`ReallocationPolicyV1` of `@monadeum/commitment`) from the caller's owner wallet and agents, naming each agent by its smart account address; an agent without one answers `409 agent-has-no-account`. It refuses any bound that loosens the protocol constants of `@monadeum/reallocation/constants`, converts fractions to the contract's basis points rounding down, takes the next sequence as the nonce, and relays the reallocation contract's own EIP-712 typed data (`policyTypedData`), in the domain of `API_REALLOCATION_CONTRACT` on `AUTH_CHAIN_ID` (`ARCHITECTURE.md` section 16.5). While the reallocation switch is off (the default) it answers `409 reallocation-disabled`, with the reason as `detail`, before reading the body, and nothing is built, relayed, or recorded; `GET /policies/reallocation` and `GET /owners/me` report the switch as `reallocation: { enabled, reason }`. Without `API_REALLOCATION_CONTRACT` it answers `503 reallocation-contract-not-configured`. The verified signature is recorded append-only, with the agent IDs, and handed to the policy writer. There is no policy writer yet, so a signed policy is recorded with `committed: null`. The ledger's sequence equals the contract's `policyNonce(owner)` only while every commit and revocation goes through this ledger; the writer, when built, reads the on-chain nonce first, and the contract refuses a mismatch with `BadNonce`.

### Read endpoints and the web

The agent view carries the field names of `Agent` in `apps/web/src/data/types.ts`. `status`, `principal`, and `genome` come from the worker's record, in the units above, which differ from the web's sample types (base-unit strings, not dollars). The evaluation fields come from the worker's evaluation records (`ARCHITECTURE.md` section 5, migration 0013), read through `monadeum_reader`, and are `null` before the worker has evaluated the agent:

| Field | Type | Source |
|---|---|---|
| `capital` | `string \| null` | the account's settlement-asset balance at the latest evaluation, base units |
| `fitnessPercentile` | `number \| null` | adjusted fitness percentile within the agent's niche at the latest evaluation, on a 0 to 100 scale (stored in [0, 1] and multiplied by 100); null when the agent had no adjusted fitness |
| `lowWindows` | `number \| null` | the starvation count (consecutive bottom-decile windows) carried out of the latest evaluation |
| `zeroDownsideFlag` | `boolean \| null` | the zero-downside flag at the latest evaluation |
| `retirement` | `{ rule: string; evaluation: number } \| null` | the section 6 rule and evaluation sequence, when an evaluation retired the agent |
| `capitalHistory` | `{ evaluation: number; capital: string }[] \| null` | the last 50 evaluations, oldest first, base units |

They are served only to the agent's owner, behind the same ownership check as every per-agent field. `GET /population` adds `lastEvaluation: { sequence: number; at: number } | null` (`at` in milliseconds since the Unix epoch, from the worker's clock) and `capital: string | null`, the sum in base units of the capital of the agents the latest evaluation recorded and did not retire. The API's own fields (`deployment`, `session`, `limits`, `chain`) are what it can source from its registry, WalletsModule, and the read-model.

Trades and x402 purchases are read from the worker's own records, which the API reads and never writes:

- `tradeCount` (number) counts the agent's `trade_records` rows with status `filled`: operations the chain included and TradingModule attributed. A policy rejection, a blocked close, a failed or reverted operation, and a record still in flight or under review are not trades and are not counted. The agent is the order's `agentId` in the record (`TradeCounts` in `@monadeum/trading`).
- `x402` is `{ purchases, spent, byProvider: [{ provider, spent }] }`, amounts in settlement-asset base units as decimal strings, `byProvider` sorted by provider. It counts the agent's `x402_payments` entries with a nonzero price, by the rule `X402Client.spent` already uses for the agent's costs: once payment was attempted at accepted terms the full price counts, including an unconfirmed or anomalous payment, so spend is never understated; a purchase that never reached payment, or that the payer refused to sign, has price 0 and is not counted. `provider` is the provider the entry stores (one of the hardcoded `PROVIDERS`, today `nansen` and `defillama`). The payments table has no agent column: the agent is the purchase key up to its first colon, because every key begins with the tick key `<agentId>:<tick>:`, which holds because agent IDs contain no colon (`PaymentTotals` and `paymentAgentId` in `@monadeum/x402`).
- Both are `null` only when no store answered; an agent with no activity reads `0` and `{ purchases: 0, spent: "0", byProvider: [] }`. `POST /agents` returns the new agent with both `null`, because it does not read them. Per-agent figures are served only for agents the caller owns, by the ownership checks above; `GET /population` serves the same figures summed over every agent, by provider and never by agent. `apps/web` reads these endpoints in its `api` mode (`apps/web/README.md`) with views of its own, which show a null field as not available yet rather than rendering it as an empty value.

## Storage

The database rules are the worker's and the indexer's: `bootApi` reads `DATABASE_URL`, `DATABASE_MIGRATIONS`, and `MONADEUM_ENV` with `loadDatabaseSettings` and opens the database with `openDatabase` from `@monadeum/db`. With `DATABASE_URL` set, every store is on Postgres, including the API's own tables from migration `0007_api.sql`: the agent registry, the recovery log and holds, and the signed policies, and the worker's `worker_agents`, where migration `0008_api_agent_creation.sql` lets the API insert and nothing more. The migrations are verified at start (`verify`, the default) or applied (`apply`, for an owner connection only). Every statement runs inside a transaction under `SET LOCAL ROLE`: the stores as `monadeum_api`; the read-model, the worker's `trade_records`, its `x402_payments`, and its evaluation records as `monadeum_reader`, which can only read them (migrations 0004 and 0005 already grant it SELECT on the first three, and migration 0013 on `evaluation_records`). The login role therefore needs membership in both group roles, and nothing else; it does not own the tables. Without `DATABASE_URL` the API runs on in-memory stores and logs that state is not durable; with `MONADEUM_ENV=production` it refuses to start instead.

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

Funding, all unset by default, which leaves the funding endpoints answering `503 funding-unavailable`:

| Variable | Required | Meaning |
|---|---|---|
| `API_FUNDING_RELAYER_VAULT_DIR` | enables funding | The relayer key's encrypted file vault. Not the session or x402 vault directory, nor inside or around either. Refused with `MONADEUM_ENV=production`. |
| `API_FUNDING_RELAYER_VAULT_PASSPHRASE_FILE` or `API_FUNDING_RELAYER_VAULT_PASSPHRASE` | with the vault | Its passphrase, at least 16 characters; the file form is for a Docker secret. |
| `API_FUNDING_SETTLEMENT_ASSET` | with the vault | The USDC contract, the indexer's `INDEXER_SETTLEMENT_ASSET_ADDRESS`. |
| `API_FUNDING_MAX_PER_TRANSFER` | with the vault | Largest relayed transfer, base units. |
| `API_FUNDING_RPC_URL` | no | Monad testnet RPC (https). Default `WALLETS_RPC_URL`, else Monad's public testnet RPC. |
| `API_FUNDING_DAILY_TRANSFERS_PER_USER` | no | Relayed transfers per user per rolling 24 hours, whatever their outcome. Proposed default 3. |
| `API_FUNDING_VALIDITY_SECONDS` | no | Window of a prepared authorization, 60 to 3600. Proposed default 600. |

The allowed origin is the origin of `AUTH_SIWE_URI`.

## Tests

`bun run --filter @monadeum/api test` runs offline. `test/api.test.ts` boots the application with `@nestjs/testing` and the Fastify adapter and drives it through HTTP injection, once on the in-memory stores and once on PGlite with every statement under the API's two roles, so a missing grant fails the suite. WalletsModule runs on its test chain from `@monadeum/wallets/testing`, extended so every owner operation requires an owner signature that recovers to the owner, and every session approval an EIP-712 enable signature that does, which is what makes the relay testable. Activation is covered end to end: refused for another user's agent, an undeployed account, an active key, and an unverified revocation; issued through the relayed typed-data signature with nothing kept before it; verified against chain state; then stopped, and activated again with a new key. Privy tokens are verified by a stand-in; AuthModule's own tests cover the real `@privy-io/node` verification. `test/creation.test.ts` creates agents end to end and checks, on PGlite under the real roles, that the worker loads the record as `monadeum_worker`, that the genome hash verifies, that a client cannot inject genome fields or create an agent for another owner wallet, that an ownership mismatch stays refused, that both records are written or neither, and that the population cap holds. `test/roles.test.ts` checks that the grants of migrations 0007, 0008, and 0014 are no wider than stated. `test/funding.test.ts` runs "Fund this agent" end to end on both backends against an in-memory USDC with EIP-3009 semantics (`test/fake-funding.ts`): the happy path, another owner, an undeployed account, the daily budget, a replayed nonce, signatures over other fields or by another key, an expired authorization, a relayer without gas, and a lost broadcast response. `test/funding-boot.test.ts` covers the relayer vault. `FUNDING_TESTNET=1` runs `test/testnet.test.ts` against Monad testnet: the token's domain check and a refused simulation, and, with `FUNDING_TESTNET_OWNER_KEY_FILE`, `FUNDING_TESTNET_RELAYER_KEY_FILE`, and `FUNDING_TESTNET_TO`, one real relayed transfer. `test/activity.test.ts` writes trade records and payment log entries as the worker would (on PGlite through `monadeum_worker`) and checks each agent's `tradeCount` and `x402` in the list and the detail, that another owner's agent and its figures are never served, and the platform totals of `GET /population`. `test/evaluations.test.ts` checks, on both backends, that the evaluation fields are null before any evaluation, served from the latest record and a bounded history to the owner, never to another owner, and that the population carries only aggregates.

## Not verified yet

- No run against a live Privy app, a bundler, or Monad testnet. The relay has been exercised only against the test chain; whether an embedded wallet's `personal_sign` over a user operation hash produces the signature Kernel's ECDSA validator accepts is an assumption from `libs/wallets`, not observed here.
- Activation through an embedded wallet: the test chain checks that the enable signature is EIP-712 typed data that recovers to the owner, but that Privy's `eth_signTypedData_v4` over Kernel's real enable data produces the signature Kernel accepts at the first session-key operation has not been observed. The opt-in testnet test in `libs/wallets` covers the same issuance with a local key.
- Blind hash signing: the owner signs a user operation hash it cannot check against the calls. Showing a verifiable preview needs the client to recompute the hash from the prepared operation, which WalletsModule does not expose.
- Rate limiting and the relay are in process. More than one API instance needs a shared throttler storage and sticky routing for operations, or a relay that persists the prepared operation; neither is built.
- No policy writer submits a signed policy to the reallocation contract yet, and the sequence-as-nonce rule above holds only while this ledger sees every change.
