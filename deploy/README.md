# Testnet deployment on one VPS

How to run Monadeum on Monad testnet (chain 10143) from a single VPS the owner controls: the three contracts, Postgres, Redis, the API, the worker, the indexer, and the web app. Testnet only. Nothing here is a mainnet deployment, and the section "Before mainnet" lists what must change first. The decisions behind this layout are in `ARCHITECTURE.md` section 10 ("Deployment on testnet") and `SECURITY.md` section 11.

## What runs

| Service | Image target | Network | Published | Role |
|---|---|---|---|---|
| `postgres` | `postgres:17.6-bookworm` | internal | no | All durable state. |
| `redis` | `redis:8.2.2-bookworm` | internal | no | The worker's BullMQ queue and agent locks. |
| `migrate` | `server` | internal | no | One-shot: applies migrations as `monadeum_owner`, creates the three login roles, exits. |
| `api` | `server` | internal and outbound | `BIND_ADDRESS:3001` | HTTP API, WalletsModule on the session key vault, and the funding relayer on its own vault. |
| `worker` | `server` | internal and outbound | no | BullMQ consumer, WalletsModule on the same vault. |
| `indexer` | `server` | internal and outbound | no | Chain sync into the read-model. |
| `web` | `web` | outbound | `BIND_ADDRESS:3000` | Next.js app built in `api` mode. |
| `proxy` (optional) | `caddy:2.10.2` | outbound | 80, 443 | TLS for `WEB_DOMAIN` and `API_DOMAIN`. |

The `backend` network is `internal`: Postgres and Redis have no route out and no published port. Each service receives only the variables it reads, and connects to Postgres as its own login role:

| Login role | Member of | Used by |
|---|---|---|
| `monadeum_owner` | none (owns the schema, `CREATEROLE`) | `migrate` only |
| `monadeum_api_login` | `monadeum_api`, `monadeum_reader` | `api` |
| `monadeum_worker_login` | `monadeum_worker` | `worker` |
| `monadeum_indexer_login` | `monadeum_indexer` | `indexer` |

### What this deployment does, and does not do, today

- Owners can sign in, create agents, sign the account deployment, and stop an agent. Session keys and x402 keys live in the local encrypted vault on the `vault` volume, shared by `api` and `worker`.
- Owners can fund an agent from the agent page ("Fund this agent"): they sign an EIP-3009 authorization moving testnet USDC from their owner wallet to the agent's deployed account, and the API's relayer submits it and pays the gas in testnet MON. The relayer key lives in its own encrypted vault on the `relayer_vault` volume, mounted into `api` only. Until the relayer holds MON, every submission is refused with `503 relayer-balance-low` and nothing is sent (step 5).
- The indexer indexes the spend policy, account deployments, session key events, and settlement-asset transfers of followed accounts, from `INDEXER_START_BLOCK`. It indexes the reallocation contract's events only with `INDEXER_REALLOCATION_ADDRESS` set, which the example leaves empty; the 2026-10-11 read-model was synced without it, so turning it on there needs the read-model rebuilt first (`apps/indexer/README.md`, "Rebuilding the read-model").
- The worker runs its `sync`, `principal`, and `x402-reconcile` jobs. It runs no trading tick until the owner enables the tick runner (`WORKER_TICK_RUNNER=enabled`, step 9; `ARCHITECTURE.md` section 11, "Tick runner"): while it is `disabled`, the default, every tick and evaluation job is skipped and nothing is sent. Enabled, it still runs no tick without a signed risk policy version in effect. The worker reads and validates the trading market (`TRADING_*`) either way and logs it.
- Agents trade WMON/USDC on testnet, on a market we create and seed (step 2b), not WETH/USDC as on mainnet. The liquidity is ours, so testnet prices and agents' P&L carry no economic meaning (`ARCHITECTURE.md` section 10, "Testnet market").
- The x402 payer is off (`WORKER_X402_PAYER_ENABLED=false`) and reallocation is off (`MONADEUM_REALLOCATION_ENABLED=false`), both decided.
- All services run with `MONADEUM_ENV=development`, deliberately: the file vault refuses `production`, and so does a worker without the tick runner enabled. Every store is still on Postgres, because `DATABASE_URL` is set; `development` only lifts those two refusals. The production guards stay as they are for mainnet.

## Live testnet deployment

The deployment this runbook produced, as of 2026-10-11. Every item is FACT, checked that day by the owner. No secret, project ID, or URL carrying one is recorded here.

- **Hosts.** The web app at `https://app.monadeum.xyz` and the API at `https://api.monadeum.xyz`, both served from one VPS by the `proxy` profile (Caddy), with certificates from Let's Encrypt. DNS has one A record for `app` and one for `api`, both pointing at the VPS.
- **Contracts.** Monad testnet only, not audited, not on mainnet: `AgentSpendPolicy` `0xe54512401B8fCD0DCc3f4Aa4929b99F05AbA3f05`, `AgentReallocation` `0x4e7500415e81017670a9cFb8763f873EE6694A7f`, `X402PaymentValidator` `0xCA918F53FFc7507Bd41602c0bD1ef72558705991`, deployed in blocks 70167444 to 70167461 (`contracts/deployments/monad-testnet.json`).
- **Privy.** The app is in development mode, with email and Google sign-in enabled and identity tokens turned on (the API reads the embedded wallet only from the identity token). Privy's embedded wallets appear in that token as `privy-v2`; the API accepts them since PR #130.
- **ZeroDev.** One project for chain 10143. The bundler and the paymaster use the same v3 endpoint, so `WALLETS_BUNDLER_URL` and `WALLETS_PAYMASTER_URL` hold the same value. Gas sponsorship is set to sponsor all transactions, which is acceptable on testnet only. Recommended: set a sponsorship limit for the chain in the ZeroDev dashboard, so a loop or a leaked endpoint cannot drain the testnet gas balance (`ARCHITECTURE.md` section 7).
- **First agent.** Created through the web app; its Kernel account was deployed with sponsored gas, and the indexer recorded `account.deployed`, `spend.limits-set`, and `spend.call-allowed` for it.

What this deployment has and has not yet shown, item by item against `SECURITY.md` section 10, is tracked in `docs/testnet-validation-checklist.md`. Record each transaction hash and account address there as a step below is run.

## 1. Prepare the VPS

Ubuntu 24.04 LTS, at least 2 vCPU, 4 GB RAM, and 40 GB disk (the server image holds the whole compiled workspace and is large). Create two DNS A records pointing at the VPS: `WEB_DOMAIN` (for example `app.example.com`) and `API_DOMAIN` (for example `api.example.com`). They must be same-site, because the session cookie is `SameSite=Strict`.

Install Docker Engine and the Compose plugin from Docker's repository:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker compose version
```

Firewall: allow SSH, HTTP, and HTTPS only. Docker publishes ports around `ufw`, which is why web and api are published on `127.0.0.1` by default and reached through the proxy.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Clone the repository (it is private: use a read-only deploy key or `gh auth login`):

```bash
sudo mkdir -p /opt/monadeum && sudo chown "$USER" /opt/monadeum
git clone git@github.com:Ray-Scouts/monadeum.git /opt/monadeum
cd /opt/monadeum
```

## 2. Deploy the contracts (owner's workstation, not the VPS)

The deployer key stays on the owner's workstation, in the Foundry keystore account `monadeum-testnet-deployer` (`0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3`, testnet only). No private key is ever written to a file or passed on a command line; Foundry prompts for the keystore password. Requires Foundry 1.8.5 (the version CI runs).

```bash
git clone git@github.com:Ray-Scouts/monadeum.git && cd monadeum
git submodule update --init --recursive
cast wallet list    # must list monadeum-testnet-deployer
```

What the script deploys, all with constructor arguments from the environment (defaults set by the wrapper, `contracts/script/deploy-testnet.sh`):

| Contract | Constructor arguments |
|---|---|
| `AgentSpendPolicy` | settlement asset `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| `AgentReallocation` | settlement asset as above; admin and operator `0x9671dB7Ab4Afa09fe76402Ce127896b166029897` (the 2-of-3 Safe); `minEvaluationInterval` 36000 |
| `X402PaymentValidator` | settlement asset as above |

Before sending anything, the script refuses unless: the chain id is 10143; the settlement asset has code, reports 6 decimals, and exposes the EIP-3009 `TRANSFER_WITH_AUTHORIZATION_TYPEHASH`; operator and admin each have code, a threshold of at least 2, and at least 3 owners; the interval is nonzero; and the broadcasting account is `0x6179...c1e3`. After deploying it reads every constructor-set value back and writes `contracts/deployments/monad-testnet.latest.json` (not committed).

**Fund the deployer first.** The simulation of 2026-10-11 estimated 6,769,868 gas for the three deployments and "Estimated amount required: 1.374283204006769868 MON" at a 203 gwei maximum fee, against a balance of 0.9637 MON. That figure is the worst case at the maximum fee; at the 100 gwei base fee observed the same day the three cost about 0.70 MON. Monad's documentation states that a transaction is charged for its gas limit, not the gas it uses; the broadcast of 2026-10-11 is consistent with that (below: each receipt's `gasUsed` equals its transaction's gas limit). Each transaction must also be covered at its own maximum fee when sent, so top the deployer up to at least 1.5 MON from the testnet faucet before broadcasting.

Simulate (sends nothing, needs no key):

```bash
contracts/script/deploy-testnet.sh simulate
```

Broadcast (sends three transactions, prompts for the keystore password):

```bash
contracts/script/deploy-testnet.sh broadcast
```

That wrapper runs exactly this, which can also be run by hand from `contracts/`:

```bash
cd contracts
MONADEUM_SETTLEMENT_ASSET=0x534b2f3A21130d7a60830c2Df862319e593943A3 \
MONADEUM_SETTLEMENT_DECIMALS=6 \
MONADEUM_REALLOCATION_OPERATOR=0x9671dB7Ab4Afa09fe76402Ce127896b166029897 \
MONADEUM_REALLOCATION_ADMIN=0x9671dB7Ab4Afa09fe76402Ce127896b166029897 \
MONADEUM_MIN_EVALUATION_INTERVAL=36000 \
MONADEUM_EXPECTED_DEPLOYER=0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3 \
forge script script/DeployTestnet.s.sol:DeployTestnet \
  --rpc-url https://testnet-rpc.monad.xyz \
  --account monadeum-testnet-deployer \
  --sender 0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3 \
  --broadcast --slow -vvv
```

**The testnet deployment (FACT, broadcast by the owner on 2026-10-11 and checked on chain the same day).** The addresses are the ones the simulation predicted from the deployer's nonce 1:

| Contract | Address | Transaction | Block | Gas |
|---|---|---|---|---|
| `AgentSpendPolicy` | `0xe54512401B8fCD0DCc3f4Aa4929b99F05AbA3f05` | `0xe57f5b866b9eb5a438d137fdd126030c4bbec09d5a2d30b9ad14489a72af344e` | 70167444 | 1,975,698 |
| `AgentReallocation` | `0x4e7500415e81017670a9cFb8763f873EE6694A7f` | `0x654a555c3214551412c29a6a17ec391ea9dd2b032221880116fd0e58a213ee3e` | 70167453 | 2,860,335 |
| `X402PaymentValidator` | `0xCA918F53FFc7507Bd41602c0bD1ef72558705991` | `0x914bb2d21130dd014ccc0688dbf5afca6df3bdd94f37880e560f1908e117bf0f` | 70167461 | 1,933,835 |

The three cost 6,769,868 gas at an effective 103.4075 gwei, 0.70005512521 MON in total, read from the receipts. Each receipt's `gasUsed` equals the transaction's gas limit. Read back on chain: every address has code; `settlementAsset()` of all three is the testnet USDC above; on `AgentReallocation`, `operator()` and `admin()` are the Safe, `pendingAdmin()` is zero, `minEvaluationInterval()` is 36000, `capitalFloor()` is 60000, and `currentEvaluation()` and `lastEvaluationAt()` are 0. The record is `contracts/deployments/monad-testnet.json`, and `deploy/.env.testnet.example` carries these values. The commands below are how a redeployment is recorded and checked.

Record the result and check it on chain:

```bash
cat deployments/monad-testnet.latest.json
# The block of the first deployment (AgentSpendPolicy): INDEXER_START_BLOCK.
cast to-dec "$(jq -r '.receipts[0].blockNumber' broadcast/DeployTestnet.s.sol/10143/run-latest.json)"
R=https://testnet-rpc.monad.xyz
REALLOC=$(jq -r '.contracts.AgentReallocation' deployments/monad-testnet.latest.json)
cast call "$REALLOC" "operator()(address)" --rpc-url $R
cast call "$REALLOC" "admin()(address)" --rpc-url $R
cast call "$REALLOC" "minEvaluationInterval()(uint256)" --rpc-url $R   # 36000
cast call "$REALLOC" "capitalFloor()(uint256)" --rpc-url $R            # 60000 (0.06 USDC)
cast call "$REALLOC" "settlementAsset()(address)" --rpc-url $R
```

Then copy the three addresses, the deployer, and the deployment block into `contracts/deployments/monad-testnet.json`, set `status` to `deployed`, and commit it through a pull request. Addresses are public; the committed file is the record of the deployment. Source verification on the explorer is not set up (open question below).

### 2a. Deploy the genome commitment contract (not done yet)

`AgentCommitments` (`ARCHITECTURE.md` section 9, issue #32) has no constructor arguments and no roles; it is deployed by its own script, so the three contracts above are not redeployed. Not broadcast yet: until it is, `WALLETS_AGENT_COMMITMENTS_ADDRESS` stays unset, deployments commit nothing on chain, and the tick runner logs that genomes are not verified.

```bash
cd contracts
# Simulate (sends nothing, needs no key):
MONADEUM_EXPECTED_DEPLOYER=0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3 \
forge script script/DeployAgentCommitments.s.sol:DeployAgentCommitments \
  --rpc-url https://testnet-rpc.monad.xyz --sender 0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3 -vvv
# Broadcast (one transaction, prompts for the keystore password):
MONADEUM_EXPECTED_DEPLOYER=0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3 \
forge script script/DeployAgentCommitments.s.sol:DeployAgentCommitments \
  --rpc-url https://testnet-rpc.monad.xyz --account monadeum-testnet-deployer \
  --sender 0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3 --broadcast --slow -vvv
cat deployments/monad-testnet-commitments.latest.json
```

Then add the address and block to `contracts/deployments/monad-testnet.json` under `contracts.AgentCommitments`, and set `WALLETS_AGENT_COMMITMENTS_ADDRESS` in the API's and the worker's environment (section 3). Agents created before that have no commitment: once the address is set, the tick runner raises the `SECURITY.md` section 12 alert for each of them and does not tick them, so on testnet they are replaced by new agents. Every later change to `libs/strategy/src/propose.ts` is a new strategy version and has the same effect on every live agent (`ARCHITECTURE.md` section 16.4, rule 7).

## 2b. Create and seed the testnet WMON/USDC market (owner's workstation)

The decision and its limits are in `ARCHITECTURE.md` section 10, "Testnet market". Two steps, each simulated first. Nothing below has been broadcast; the simulations of 2026-10-11 are recorded in `contracts/deployments/monad-testnet-wmon-market.json`.

**What the deployer needs.** About 0.18 MON for `create` (one `deployProxy`, gas limit 1,620,368, which Monad charges in full; under 0.18 MON at the 110 gwei cap the wrapper sets), then, for `seed` with the defaults, 6 USDC, 45 MON to wrap into WMON for the asks, and about 0.24 MON of gas (six transactions, gas limit 2,127,815 in total). On 2026-10-11 the deployer held 0.2637 MON and 20 USDC, enough for `create` but not for `seed`: top it up from the Monad faucet (`https://faucet.monad.xyz`), or lower `SEED_ASK_WMON_PER_LEVEL` (each ask must be at least 0.1 WMON; at 15 WMON a level the three asks cover one 1 USDC buy). The seed script refuses before sending anything if the deployer cannot cover it.

From the repository root, with the same keystore account as step 2:

```bash
# 1. Create the market (deployProxy on Kuru's testnet router). The simulation prints the predicted address,
#    0x46b66f84317941eC371E7791753f35653341aeBC with the decided parameters, and the estimated cost.
contracts/script/wmon-market.sh create simulate
contracts/script/wmon-market.sh create broadcast
cat contracts/deployments/monad-testnet-wmon-market.latest.json   # mode "broadcast", the market and AMM vault

# 2. Seed it. The mid defaults to 0.026904 USDC per MON, a REFERENCE (Kuru's mainnet MON/USDC mid on 2026-10-11),
#    not a testnet price; re-read it and pass SEED_MID_USDC to move it. Sizes are parameters:
#    SEED_LEVELS (3), SEED_FIRST_OFFSET_BPS (25), SEED_STEP_BPS (25), SEED_BID_USDC_PER_LEVEL (2), SEED_ASK_WMON_PER_LEVEL (15).
cast call 0x065C9d28E428A0db40191a54d33d5b7c71a9C394 "bestBidAsk()(uint256,uint256)" --rpc-url https://rpc.monad.xyz
contracts/script/wmon-market.sh seed simulate
contracts/script/wmon-market.sh seed broadcast
cat contracts/deployments/monad-testnet-wmon-seed.latest.json     # best bid and ask, spread, what was wrapped and deposited

# 3. Check the market on chain.
M=0x46b66f84317941eC371E7791753f35653341aeBC
R=https://testnet-rpc.monad.xyz
cast call 0x7EFbE105Ca7415dE98F96622173458ac1c054630 "verifiedMarket(address)(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)" $M --rpc-url $R
cast call $M "bestBidAsk()(uint256,uint256)" --rpc-url $R
```

Then copy the market, the transaction hashes, blocks, and gas from the receipts (`contracts/broadcast/CreateWmonMarket.s.sol/10143/run-latest.json` and `SeedWmonMarket.s.sol`) into `contracts/deployments/monad-testnet-wmon-market.json`, set `status`, and commit it through a pull request. If the market address differs from the one in `deploy/.env.testnet.example`, set `TRADING_KURU_MARKET` and `TRADING_MON_PRICE_MARKET` to it.

A dry run of an agent's buy and close against the seeded market, read-only, quoting and building both calls through the pinned SDK from the configured pool list (after `bun run test` has built `libs/trading`):

```bash
set -a; . deploy/.env.testnet; set +a
cd libs/trading && KURU_DRY_RUN=1 DRY_RUN_RPC_URL=$MONAD_RPC_URL TRADING_QUOTE=$SETTLEMENT_ASSET node --test dist/test/testnet.test.js
```

The same with `DRY_RUN_FORK_EXECUTE=1` and `DRY_RUN_TAKER=<an address holding USDC>` against an anvil fork (`anvil --fork-url $MONAD_RPC_URL`) also sends both calls there, impersonating the taker; it refuses any RPC that is not anvil. The book's MON price is refused when the fork's latest block is more than 60 seconds old, so mine a block first (`cast rpc anvil_mine`).

The market is permissionless: anyone can trade on it or add orders, and its owner is Kuru's router. Re-seed with `seed broadcast` when agents have taken the asks or bids; it deposits only the shortfall in Kuru's margin account. Withdrawing unused seed from the margin account and cancelling resting orders are not scripted.

**On a host already running (section 8).** The update by rsync never copies `deploy/.env.testnet`, so add the new values to it by hand from `deploy/.env.testnet.example`: the `TRADING_*` block, `API_AGENT_PAIR=WMON/USDC`, and `WALLETS_TRADED_ASSETS` set to WMON. Then `dc up -d api worker`. `WALLETS_TRADED_ASSETS` is read when an agent's account permissions are installed, so an agent created before the change has no WMON mark on the spend policy and cannot close a WMON position; whether to reissue its permissions or create a new agent is the owner's choice.

## 3. Configure the VPS

On the VPS, in `/opt/monadeum`:

```bash
cp deploy/.env.testnet.example deploy/.env.testnet
chmod 600 deploy/.env.testnet
# Generate one value per password variable and paste each into deploy/.env.testnet:
for v in POSTGRES_SUPERUSER_PASSWORD DB_OWNER_PASSWORD DB_API_PASSWORD DB_WORKER_PASSWORD DB_INDEXER_PASSWORD DB_POLICY_OPERATOR_PASSWORD REDIS_PASSWORD; do echo "$v=$(openssl rand -hex 32)"; done
nano deploy/.env.testnet
```

Fill in every `CHANGE_ME`: the two domains, the passwords above, `PRIVY_APP_ID` from the Privy dashboard, and `WALLETS_BUNDLER_URL` (a ZeroDev project for chain 10143). `SPEND_POLICY_ADDRESS`, `REALLOCATION_CONTRACT`, and `INDEXER_START_BLOCK` already hold the 2026-10-11 deployment from step 2; change them only after a redeployment.

- **Privy keys.** Leave `PRIVY_VERIFICATION_KEY` empty. The API then verifies Privy tokens against the keys Privy publishes for the app (`https://auth.privy.io/api/v1/apps/<PRIVY_APP_ID>/jwks.json`), selected by each token's `kid`, so a key rotation at Privy needs no change on the VPS. That endpoint listed two ES256 keys for this project's app on 2026-10-11, so one static key may not verify both access and identity tokens. The API needs outbound HTTPS to `auth.privy.io` (it is on the `egress` network); if the key set cannot be fetched and no cached key is current, Privy sign-in fails closed. Setting `PRIVY_VERIFICATION_KEY` pins one PEM key and disables the fetch (`libs/auth/README.md`).
- **ZeroDev bundler.** The bundler for chain 10143 lists EntryPoint 0.7 in `eth_supportedEntryPoints` (FACT, checked 2026-10-11), the EntryPoint Kernel v3.1 uses here. The bundler URL carries the project ID, so in the ZeroDev dashboard's Access Control, restrict the project to the VPS's public IP, so a leaked URL cannot be used from elsewhere. Neither the URL nor the project ID is committed anywhere.

- **Funding.** `API_FUNDING_MAX_PER_TRANSFER`, `API_FUNDING_DAILY_TRANSFERS_PER_USER`, and `API_FUNDING_VALIDITY_SECONDS` hold proposed starting values (100 USDC, 3 relayed transfers per user per 24 hours, 600 seconds). The relayer uses `SETTLEMENT_ASSET` and `MONAD_RPC_URL`; on its first use it reads the token's name, version, and decimals and refuses to prepare anything unless the token's `DOMAIN_SEPARATOR` equals the one they define for chain 10143.

Create the three vault passphrases as files, owned by the container user (uid 1000), readable by nobody else, and different from each other:

```bash
mkdir -p deploy/secrets
openssl rand -base64 48 > deploy/secrets/session_vault_passphrase
openssl rand -base64 48 > deploy/secrets/x402_vault_passphrase
openssl rand -base64 48 > deploy/secrets/funding_relayer_vault_passphrase
sudo chown 1000:1000 deploy/secrets/session_vault_passphrase deploy/secrets/x402_vault_passphrase deploy/secrets/funding_relayer_vault_passphrase
sudo chmod 400 deploy/secrets/session_vault_passphrase deploy/secrets/x402_vault_passphrase deploy/secrets/funding_relayer_vault_passphrase
```

Copy all three passphrases into the owner's password manager now. Without them a vault cannot be opened, and a backup of it is useless. On an existing deployment, only the third file is new; create it before `dc up -d`, or Compose refuses to start the API.

Check the configuration (Compose refuses a missing required variable by name):

```bash
alias dc='docker compose --env-file deploy/.env.testnet -f deploy/docker-compose.yml'
dc config --quiet && echo ok
```

## 4. Build, migrate, start

```bash
dc build
dc up -d postgres redis
dc run --rm migrate
dc up -d
```

`dc run --rm migrate` applies every pending migration as `monadeum_owner` and creates or updates `monadeum_api_login`, `monadeum_worker_login`, `monadeum_indexer_login`, and, when `DB_POLICY_OPERATOR_PASSWORD` is set, `monadeum_policy_operator_login`, as members of their group roles. It is idempotent, and `dc up -d` runs it again before the services start (they wait for it to exit 0). The services then start with `DATABASE_MIGRATIONS=verify` and refuse to run on a schema that differs from their code.

With the optional Caddy proxy (DNS must already point at the VPS):

```bash
dc --profile proxy up -d
```

With a proxy of your own instead, send `WEB_DOMAIN` to `127.0.0.1:3000` and `API_DOMAIN` to `127.0.0.1:3001`, set `X-Forwarded-For`, and keep `API_TRUST_PROXY=true`.

## 5. Verify

```bash
dc ps                                   # postgres, redis, api, web healthy; worker, indexer running; migrate exited 0
dc logs migrate | tail                   # "login role monadeum_api_login: member of monadeum_api, monadeum_reader" ...
curl -s http://127.0.0.1:3001/health     # {"status":"ok","wallets":"configured","funding":"configured","fundingRelayer":"0x..."}
curl -s https://$API_DOMAIN/health       # the same, through the proxy
dc logs api | tail                       # "migrations: verified, all applied", "wallet operations configured"
dc logs worker | tail                    # "wallets: WalletsModule configured on the local file vault", "consumer running on Postgres stores"
dc logs indexer | tail                   # "indexed <from>..<to>, <n> rows"
dc exec postgres psql -U postgres -d monadeum -c "select rolname, rolsuper, rolcreaterole from pg_roles where rolname like 'monadeum%' order by 1"
dc exec postgres psql -U postgres -d monadeum -c "select block_number, finalized from indexer_cursor"
dc exec api ls -la /var/lib/monadeum/vault /var/lib/monadeum/vault/session   # drwx------ node, vault.json -rw-------
```

Then open `https://$WEB_DOMAIN`, sign in, create an agent, and sign its deployment. The agent's account should appear in the indexer's rows within a few seconds of finality.

**Fund the relayer.** The API creates the funding relayer's key on its first start and logs its address (`dc logs api | grep "funding relayer"`); `GET /health` serves the same address as `fundingRelayer`, and nothing else about it. Send it testnet MON from a faucet or another testnet wallet, and check the balance:

```bash
RELAYER=$(curl -s http://127.0.0.1:3001/health | sed -E 's/.*"fundingRelayer":"(0x[0-9a-fA-F]{40})".*/\1/')
cast balance $RELAYER --ether --rpc-url https://testnet-rpc.monad.xyz
```

The relayer holds MON for gas only, never user funds. Each submission first estimates the transaction and refuses with `503 relayer-balance-low`, sending nothing and spending none of the user's daily relays, when the balance is below the gas limit times the maximum fee per gas (Monad charges the gas limit). How much MON one relayed transfer costs on testnet has not been measured; check the balance after the first transfers and top up from there. The key never leaves `relayer_vault`; it is not exported by any command here, so to move it, back up the volume (step 7).

Then fund an agent: open its page, enter an amount under "Fund this agent", sign in the wallet, and wait for "confirmed" with the transaction's explorer link. The agent's principal changes once the worker's `principal` job reads the finalized, indexed transfer.

## 6. Operator transactions through the Safe

`AgentReallocation`'s operator and admin are the Safe `0x9671dB7Ab4Afa09fe76402Ce127896b166029897` (SafeL2 1.4.1, threshold 2 of 3; FACT, read on chain and from the Safe transaction service on 2026-10-11). Operator calls are `registerAgent`, `setPrincipal`, `advanceEvaluation`, and `retire`; admin calls are `setOperator` and `proposeAdmin`. With reallocation off, none of them is needed for the services above to run.

**Safe web app (preferred).** FACT, 2026-10-11: Safe's configuration service lists Monad Testnet (chain 10143, short name `monad-testnet`, transaction service `https://api.safe.global/tx-service/monad-testnet`), and that service indexes this Safe. Open `https://app.safe.global/home?safe=monad-testnet:0x9671dB7Ab4Afa09fe76402Ce127896b166029897`, then New transaction, Transaction Builder. Enter the `AgentReallocation` address and paste its ABI (`forge inspect AgentReallocation abi --json`, from `contracts/`). One owner creates and signs, a second owner signs and executes.

**Cast only (fallback, if the Safe app or its transaction service is unavailable).** Exercised end to end on an anvil fork of Monad testnet on 2026-10-11 against a fresh 2-of-3 SafeL2 1.4.1. Each owner signs the Safe transaction hash with their own key (`--account`, or `--ledger`/`--trezor` for a hardware wallet); any account with MON executes.

```bash
R=https://testnet-rpc.monad.xyz
SAFE=0x9671dB7Ab4Afa09fe76402Ce127896b166029897
REALLOC=<AgentReallocation address>
ZERO=0x0000000000000000000000000000000000000000
DATA=$(cast calldata "advanceEvaluation()")          # or registerAgent(address,address,uint256), and so on
NONCE=$(cast call $SAFE "nonce()(uint256)" --rpc-url $R)
HASH=$(cast call $SAFE "getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)(bytes32)" \
  $REALLOC 0 $DATA 0 0 0 0 $ZERO $ZERO $NONCE --rpc-url $R)
echo $HASH    # every signer checks this hash independently before signing

# Owner A, on their own machine:
cast wallet sign --no-hash $HASH --account <owner-a-keystore>
# Owner B, on their own machine:
cast wallet sign --no-hash $HASH --account <owner-b-keystore>

# Concatenate the two 65-byte signatures (drop the second 0x) in ascending order of the signers' addresses:
SIGS=0x<signature of the lower address><signature of the higher address, without 0x>
cast send $SAFE "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)" \
  $REALLOC 0 $DATA 0 0 0 0 $ZERO $ZERO $SIGS --rpc-url $R --account <any-funded-keystore>
```

`--no-hash` signs the 32-byte hash itself, without the EIP-191 prefix, which is the form a Safe verifies for `v` 27 or 28. The operation is 0 (call), never 1 (delegatecall).

## 7. Backups

Back up three things, and keep them apart from each other:

1. **Postgres**, daily:

   ```bash
   mkdir -p ~/backups
   dc exec -T postgres pg_dump -U postgres -Fc monadeum > ~/backups/monadeum-$(date +%F).dump
   ```

   Restore into an empty database: `dc exec -T postgres pg_restore -U postgres -d monadeum --clean --if-exists < ~/backups/monadeum-YYYY-MM-DD.dump`, then `dc run --rm migrate`.

2. **The vault volume** (session and x402 keys, encrypted at rest), daily and after creating agents:

   ```bash
   docker run --rm -v monadeum_vault:/vault:ro -v ~/backups:/backup debian:bookworm-slim \
     tar czf /backup/vault-$(date +%F).tgz -C /vault .
   ```

   Restore: stop `api` and `worker`, then `docker run --rm -v monadeum_vault:/vault -v ~/backups:/backup debian:bookworm-slim sh -c 'tar xzf /backup/vault-YYYY-MM-DD.tgz -C /vault && chown -R 1000:1000 /vault && chmod 700 /vault /vault/*'`.

3. **The three vault passphrases**, in the owner's password manager only, never next to a vault backup.

The relayer vault (`relayer_vault`) is backed up the same way as the vault volume, with `monadeum_relayer_vault` in place of `monadeum_vault`. Losing it loses only the relayer's remaining testnet MON: the API creates a new key on its next start, which must then be funded.

Copy backups off the VPS encrypted, for example `gpg --symmetric --cipher-algo AES256 ~/backups/monadeum-YYYY-MM-DD.dump`. Redis is not backed up: its queue and locks are rebuilt by the worker's `sync` job at start.

A vault backup holds every key that existed when it was taken. Restoring it brings back keys destroyed since then; such a key is harmless only if its revocation was also completed on chain (`GET /agents/:id/revocation` shows `revoked: true`). After any restore, stop again every agent stopped since the backup.

## 8. Upgrades and operations

The checkout on the VPS, `/opt/monadeum`, holds two things that exist nowhere else and are not in the repository: `deploy/.env.testnet` (every password and the provider configuration) and `deploy/secrets/` (the two vault passphrases). An update must never overwrite or remove them.

**Update by rsync (the procedure used on 2026-10-11).** From an up-to-date `main` checkout on the owner's machine:

```bash
git switch main && git pull --ff-only
rsync -az \
  --exclude deploy/.env.testnet \
  --exclude deploy/secrets \
  --exclude node_modules \
  --exclude .git \
  --exclude .next \
  --exclude dist \
  --exclude '*.tsbuildinfo' \
  --exclude contracts/out \
  --exclude contracts/cache \
  --exclude contracts/broadcast \
  ./ <user>@<vps>:/opt/monadeum/
```

Then, on the VPS, rebuild and restart only the services whose code changed (`web`, `api`, `worker`, or `indexer`):

```bash
cd /opt/monadeum
dc build <service>
dc run --rm migrate        # when the change includes a migration; harmless otherwise
dc up -d <service>
```

**Warning.** Do not add `--delete` to that rsync unless every exclude above is kept. `--delete` removes from the VPS every file that is absent from the source checkout, and `deploy/.env.testnet` and `deploy/secrets/` are never in a checkout, so a `--delete` without those excludes destroys the environment file and the vault passphrases. Without the passphrases the session and x402 vaults cannot be opened, and every agent key in them is lost (sections 3 and 7). Without `--delete`, files removed from the repository stay on the VPS; that is harmless for the build, because `.dockerignore` and the Dockerfile decide what enters an image. If `--delete` is wanted, run it first with `--dry-run` and read the list of deletions.

**Alternative: a git deploy key.** Instead of pushing files, the VPS pulls. Create a key on the VPS (`ssh-keygen -t ed25519 -f ~/.ssh/monadeum_deploy -N ''`), add its public half to the GitHub repository as a deploy key with read access only, and clone with it (`GIT_SSH_COMMAND='ssh -i ~/.ssh/monadeum_deploy' git clone git@github.com:Ray-Scouts/monadeum.git /opt/monadeum`, then `git config core.sshCommand 'ssh -i ~/.ssh/monadeum_deploy'` in the checkout). An update is then:

```bash
cd /opt/monadeum
git pull --ff-only
dc build
dc run --rm migrate
dc up -d
```

`.gitignore` covers `deploy/.env.testnet` and `deploy/secrets/`, so git neither tracks nor removes them; never run `git clean -x` in this checkout, which would delete both. The key is read-only and scoped to this one repository, but it sits on the VPS, so whoever holds the VPS can read the repository; remove it from GitHub when the VPS is retired.

`WORKER_TICK_INTERVAL_MS` is fixed for the life of a deployment: changing it renumbers ticks. Rotating a database password: change it in `deploy/.env.testnet`, then `dc run --rm migrate` (which sets it again) and `dc up -d`. Logs are capped at 5 x 20 MB per container.

## 9. Enable trading: the operator key, the risk policy, and the tick runner

The decisions are in `ARCHITECTURE.md` section 11 ("Tick runner") and section 16.1 (the operator's tooling). Until this step is done the worker sends nothing. Do it in this order; each part is safe to stop after.

**Before you start.** The WMON/USDC market exists and is seeded (step 2b) and `cast call $M "bestBidAsk()(uint256,uint256)"` shows two live sides. `TRADING_*` and `WALLETS_TRADED_ASSETS` (WMON) are set as in `deploy/.env.testnet.example`. Agents that should trade were created after `WALLETS_TRADED_ASSETS` held WMON (step 2b, "On a host already running"), activated, and funded, so their principal is above 0. The VPS runs this release (`dc build`, step 8), which adds migration 0015.

**9.1 Generate the operator key (owner's workstation, never the VPS).** A new Foundry keystore, not the deployer and not a Safe owner key:

```bash
cast wallet new ~/.foundry/keystores policy-operator    # asks for a password; prints the address
cast wallet address --account policy-operator           # the address, again
```

Store the keystore file and its password in the owner's password manager, apart from each other. Only the address goes to the VPS.

**9.2 Configure the VPS.** In `deploy/.env.testnet`, set `DB_POLICY_OPERATOR_PASSWORD` (`openssl rand -hex 32`) and `WORKER_POLICY_SIGNER` to the address from 9.1. Leave `WORKER_TICK_RUNNER=disabled` for now. Then:

```bash
dc run --rm migrate                                    # applies 0015, creates monadeum_policy_operator_login
sudo install -d -o 1000 -g 1000 -m 0700 deploy/policy   # where the policy service writes documents
dc --profile operator run --rm policy show              # "no version signed by 0x... verifies"
```

**9.3 Build version 1 (VPS).** The caps are settlement-asset base units. These are the API's maximum caps (1 USDC per action, 5 USDC per rolling day), the largest an agent can hold on chain (`API_MAX_PER_TX_CAP`, `API_MAX_DAILY_CAP`); never set them above those:

```bash
dc --profile operator run --rm policy build --per-action-cap 1000000 --session-daily-cap 5000000 \
  --out /var/lib/monadeum/policy/v1.json
```

It prints the document and `hash to sign (EIP-191 over these 32 bytes): 0x...`. Read the document before signing: `settlementAsset` is USDC, `allowedPairs` is `["WMON/USDC"]`, `allowedCalls` holds exactly `transfer` and `approve` on USDC, `0xffa5210a` on Kuru's router, `0x4c329bba` on `AgentReallocation`, and `approve` on WMON, both information caps are `"0"`, and `maxPositionFraction` is `0.25`.

**9.4 Sign (owner's workstation).** Sign the printed hash, as it is, without `--no-hash`:

```bash
cast wallet sign --account policy-operator 0x<hash from 9.3>
```

This signs the 32 bytes under EIP-191, which is what the worker verifies (checked with Foundry 1.8.5 on 2026-10-12). Only the signature goes back to the VPS. The CLI's `sign` command does the same from a keystore file and a password file, for a machine with this repository built.

**9.5 Append (VPS).** The CLI refuses a signature that does not recover to `WORKER_POLICY_SIGNER` and a version that does not extend the stored chain:

```bash
dc --profile operator run --rm policy append --document /var/lib/monadeum/policy/v1.json --signature 0x<signature from 9.4>
dc --profile operator run --rm policy show              # "in effect now: version 1"
```

**9.6 Enable the tick runner.** Set `WORKER_TICK_RUNNER=enabled` in `deploy/.env.testnet`, then `dc up -d worker`. The worker refuses to start, and says why, if the market does not match the chain, the RPC serves another chain, or the spend policy counts another asset. Expect in `dc logs worker`:

- `tick runner: risk policy verified and in effect` and `tick runner enabled: WMON/USDC on 0x...`.
- One line per agent per hour. For the first 24 hours, `failed at observe: rpc`: the signal needs 25 consecutive hourly mids, which the runner starts recording when it is enabled. Enabling before 9.5 is also safe, and starts that clock earlier: every tick is then skipped with `no signed risk policy version is stored`, and the book is still sampled.
- After that, `none (no-action)` or `failed ...` lines until the mid has risen by more than 0.0002 an hour on average over the last 24 hours. On our own book the mid only moves when someone trades on it or it is reseeded at another mid (`SEED_MID_USDC`), so with the book untouched no agent buys (`ARCHITECTURE.md` section 11, "Not verified live").
- A buy is `executed (executed)`; check it with `cast call $M "bestBidAsk()(uint256,uint256)"` and the agent's WMON balance. Reseed (step 2b) when the asks are gone.

**Stop.** Set `WORKER_TICK_RUNNER=disabled` and `dc up -d worker`: no new tick runs. A tick whose operation was already sent is reconciled when the runner is enabled again.

**Population breaker.** At each evaluation the worker compares the capital at risk across all agents with `WORKER_BREAKER_CAPITAL_AT_RISK` (`SECURITY.md` section 9, layer 3). Above it, the worker records a trip and every tick and reallocation stops, across restarts, with `not ticked` lines in `dc logs worker`. The capital falling back does not release it. After reviewing why it tripped:

```bash
dc --profile operator run --rm policy breaker-show       # "population breaker TRIPPED at ...: capital-at-risk ... is above the threshold ..."
dc --profile operator run --rm policy breaker-clear --by "<your name>" --reason "<what was reviewed>"
```

Ticks resume on the next scheduled tick. Raising the threshold instead needs `WORKER_BREAKER_CAPITAL_AT_RISK` changed and the worker restarted, and still a clear.

**Change a cap or the pair.** Build the next version with `build` (it reads the stored chain, so `version` and `previousHash` are filled in; pass `--effective-from` for a later start), sign its hash, `append`. The worker picks it up at its `effectiveFrom`, without a restart. A version is never edited or deleted.

## Before mainnet

None of this is a mainnet deployment. Before one:

- **Secrets manager behind `SessionKeyVault`.** The file vault refuses `MONADEUM_ENV=production` by design. Mainnet needs a dedicated secrets manager or KMS-backed implementation (`SECURITY.md` section 11), and the passphrase files go away.
- **`MONADEUM_ENV=production`**, with the tick runner enabled and a signed risk policy in effect, so every production guard applies.
- **Separate multisig signers.** The Safe's three owner keys must be held by different people on different devices, none of them a key any process here holds (`ARCHITECTURE.md` section 16.5). The testnet Safe's owners have not been checked against that rule; the threshold and owner count are what the deployment script checks, which no contract can extend to who holds the keys.
- **External audit** of `AgentSpendPolicy`, `AgentReallocation`, and `X402PaymentValidator` with findings resolved or accepted (`SECURITY.md` section 3), and mainnet USDC, Kuru, and ZeroDev addresses re-verified at deployment time.
- **A deployer that is not a hot key**, and source verification of every contract.
- **Images pinned by digest**, a managed or replicated Postgres with point-in-time recovery, monitoring and alerting per `SECURITY.md` section 12, and more than one host if availability matters.

## Open questions

1. **Resolved (owner, 2026-10-11): testnet trades WMON/USDC on our own market.** Kuru's documented testnet market is MON/USDC with a native-MON base, quoted in another token, so the owner chose to create a WMON/USDC market on the deployed USDC (step 2b; `ARCHITECTURE.md` section 10, "Testnet market"; the options are in `docs/testnet-trading-options.md`). Still open: the deployer's MON for the seed (step 2b), and the first live tick on it: the tick runner is wired and off by default (step 9), and no tick has run against the deployment yet (`ARCHITECTURE.md` section 11, "Not verified live").
2. **ZeroDev sponsorship limit.** The project serving chain 10143 is set up ("Live testnet deployment"), and it sponsors all transactions; which per-chain limit to set is not decided.
3. **Testnet x402 providers.** `WALLETS_X402_VALIDATOR_ADDRESS` stays empty until there are pay-to addresses to list, although the validator is deployed (`0xCA918F53FFc7507Bd41602c0bD1ef72558705991`); the payer stays off regardless.
4. **Explorer source verification** for the three contracts (the explorer's verification API and settings were not checked).
5. **Who holds each Safe owner key** (see "Before mainnet").
6. **A relayed transfer on testnet has not been executed yet.** The token's domain was read and checked on chain, and a relay of an unfunded authorization was refused in simulation as expected (`FUNDING_TESTNET=1`, `apps/api/test/testnet.test.ts`), but no `transferWithAuthorization` has been submitted by the relayer. The first funding through the app, or the opt-in test with test keys, is that check. Whether a Privy embedded wallet's `eth_signTypedData_v4` signature is accepted by the token is likewise not yet observed.
