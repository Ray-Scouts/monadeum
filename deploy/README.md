# Testnet deployment on one VPS

How to run Monadeum on Monad testnet (chain 10143) from a single VPS the owner controls: the three contracts, Postgres, Redis, the API, the worker, the indexer, and the web app. Testnet only. Nothing here is a mainnet deployment, and the section "Before mainnet" lists what must change first. The decisions behind this layout are in `ARCHITECTURE.md` section 10 ("Deployment on testnet") and `SECURITY.md` section 11.

## What runs

| Service | Image target | Network | Published | Role |
|---|---|---|---|---|
| `postgres` | `postgres:17.6-bookworm` | internal | no | All durable state. |
| `redis` | `redis:8.2.2-bookworm` | internal | no | The worker's BullMQ queue and agent locks. |
| `migrate` | `server` | internal | no | One-shot: applies migrations as `monadeum_owner`, creates the three login roles, exits. |
| `api` | `server` | internal and outbound | `BIND_ADDRESS:3001` | HTTP API, WalletsModule on the session key vault. |
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
- The indexer indexes the spend policy, account deployments, session key events, and settlement-asset transfers of followed accounts, from `INDEXER_START_BLOCK`.
- The worker runs its `sync`, `principal`, and `x402-reconcile` jobs. It runs no trading tick: TradingService, X402Client, and a market source are not wired into the worker process yet (`ARCHITECTURE.md` section 11, "Not yet wired"), so every tick and evaluation job is skipped and nothing is sent. This is the existing fail-closed state, not something this deployment changes.
- The x402 payer is off (`WORKER_X402_PAYER_ENABLED=false`) and reallocation is off (`MONADEUM_REALLOCATION_ENABLED=false`), both decided.
- All services run with `MONADEUM_ENV=development`, deliberately: the file vault refuses `production`, and so does a worker without a tick runner. Every store is still on Postgres, because `DATABASE_URL` is set; `development` only lifts those two refusals. The production guards stay as they are for mainnet.

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

**Fund the deployer first.** The simulation of 2026-10-11 estimated 6,769,868 gas for the three deployments and "Estimated amount required: 1.374283204006769868 MON" at a 203 gwei maximum fee, against a balance of 0.9637 MON. That figure is the worst case at the maximum fee; at the 100 gwei base fee observed the same day the three cost about 0.70 MON. Monad's documentation states that a transaction is charged for its gas limit, not the gas it uses (ASSUMPTION here: not re-verified on this deployment). Each transaction must also be covered at its own maximum fee when sent, so top the deployer up to at least 1.5 MON from the testnet faucet before broadcasting.

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

If the deployer sends no other transaction first (its nonce was 1 on 2026-10-11), the addresses are the ones the simulation predicted: `AgentSpendPolicy` `0xe54512401B8fCD0DCc3f4Aa4929b99F05AbA3f05`, `AgentReallocation` `0x4e7500415e81017670a9cFb8763f873EE6694A7f`, `X402PaymentValidator` `0xCA918F53FFc7507Bd41602c0bD1ef72558705991`.

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

## 3. Configure the VPS

On the VPS, in `/opt/monadeum`:

```bash
cp deploy/.env.testnet.example deploy/.env.testnet
chmod 600 deploy/.env.testnet
# Generate one value per password variable and paste each into deploy/.env.testnet:
for v in POSTGRES_SUPERUSER_PASSWORD DB_OWNER_PASSWORD DB_API_PASSWORD DB_WORKER_PASSWORD DB_INDEXER_PASSWORD REDIS_PASSWORD; do echo "$v=$(openssl rand -hex 32)"; done
nano deploy/.env.testnet
```

Fill in every `CHANGE_ME`: the two domains, the passwords above, `PRIVY_APP_ID` and `PRIVY_VERIFICATION_KEY` from the Privy dashboard, `WALLETS_BUNDLER_URL` (a ZeroDev project for chain 10143), and from step 2 `SPEND_POLICY_ADDRESS`, `REALLOCATION_CONTRACT`, and `INDEXER_START_BLOCK`.

Create the two vault passphrases as files, owned by the container user (uid 1000), readable by nobody else, and different from each other:

```bash
mkdir -p deploy/secrets
openssl rand -base64 48 > deploy/secrets/session_vault_passphrase
openssl rand -base64 48 > deploy/secrets/x402_vault_passphrase
sudo chown 1000:1000 deploy/secrets/session_vault_passphrase deploy/secrets/x402_vault_passphrase
sudo chmod 400 deploy/secrets/session_vault_passphrase deploy/secrets/x402_vault_passphrase
```

Copy both passphrases into the owner's password manager now. Without them the vault cannot be opened, and a backup of the vault is useless.

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

`dc run --rm migrate` applies every pending migration as `monadeum_owner` and creates or updates `monadeum_api_login`, `monadeum_worker_login`, and `monadeum_indexer_login` as members of their group roles. It is idempotent, and `dc up -d` runs it again before the services start (they wait for it to exit 0). The services then start with `DATABASE_MIGRATIONS=verify` and refuse to run on a schema that differs from their code.

With the optional Caddy proxy (DNS must already point at the VPS):

```bash
dc --profile proxy up -d
```

With a proxy of your own instead, send `WEB_DOMAIN` to `127.0.0.1:3000` and `API_DOMAIN` to `127.0.0.1:3001`, set `X-Forwarded-For`, and keep `API_TRUST_PROXY=true`.

## 5. Verify

```bash
dc ps                                   # postgres, redis, api, web healthy; worker, indexer running; migrate exited 0
dc logs migrate | tail                   # "login role monadeum_api_login: member of monadeum_api, monadeum_reader" ...
curl -s http://127.0.0.1:3001/health     # {"status":"ok","wallets":"configured"}
curl -s https://$API_DOMAIN/health       # the same, through the proxy
dc logs api | tail                       # "migrations: verified, all applied", "wallet operations configured"
dc logs worker | tail                    # "wallets: WalletsModule configured on the local file vault", "consumer running on Postgres stores"
dc logs indexer | tail                   # "indexed <from>..<to>, <n> rows"
dc exec postgres psql -U postgres -d monadeum -c "select rolname, rolsuper, rolcreaterole from pg_roles where rolname like 'monadeum%' order by 1"
dc exec postgres psql -U postgres -d monadeum -c "select block_number, finalized from indexer_cursor"
dc exec api ls -la /var/lib/monadeum/vault /var/lib/monadeum/vault/session   # drwx------ node, vault.json -rw-------
```

Then open `https://$WEB_DOMAIN`, sign in, create an agent, and sign its deployment. The agent's account should appear in the indexer's rows within a few seconds of finality.

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

3. **The two vault passphrases**, in the owner's password manager only, never next to a vault backup.

Copy backups off the VPS encrypted, for example `gpg --symmetric --cipher-algo AES256 ~/backups/monadeum-YYYY-MM-DD.dump`. Redis is not backed up: its queue and locks are rebuilt by the worker's `sync` job at start.

A vault backup holds every key that existed when it was taken. Restoring it brings back keys destroyed since then; such a key is harmless only if its revocation was also completed on chain (`GET /agents/:id/revocation` shows `revoked: true`). After any restore, stop again every agent stopped since the backup.

## 8. Upgrades and operations

```bash
cd /opt/monadeum
git pull
dc build
dc run --rm migrate
dc up -d
```

`WORKER_TICK_INTERVAL_MS` is fixed for the life of a deployment: changing it renumbers ticks. Rotating a database password: change it in `deploy/.env.testnet`, then `dc run --rm migrate` (which sets it again) and `dc up -d`. Logs are capped at 5 x 20 MB per container.

## Before mainnet

None of this is a mainnet deployment. Before one:

- **Secrets manager behind `SessionKeyVault`.** The file vault refuses `MONADEUM_ENV=production` by design. Mainnet needs a dedicated secrets manager or KMS-backed implementation (`SECURITY.md` section 11), and the passphrase files go away.
- **`MONADEUM_ENV=production`**, with a configured tick runner, so every production guard applies.
- **Separate multisig signers.** The Safe's three owner keys must be held by different people on different devices, none of them a key any process here holds (`ARCHITECTURE.md` section 16.5). The testnet Safe's owners have not been checked against that rule; the threshold and owner count are what the deployment script checks, which no contract can extend to who holds the keys.
- **External audit** of `AgentSpendPolicy`, `AgentReallocation`, and `X402PaymentValidator` with findings resolved or accepted (`SECURITY.md` section 3), and mainnet USDC, Kuru, and ZeroDev addresses re-verified at deployment time.
- **A deployer that is not a hot key**, and source verification of every contract.
- **Images pinned by digest**, a managed or replicated Postgres with point-in-time recovery, monitoring and alerting per `SECURITY.md` section 12, and more than one host if availability matters.

## Open questions

1. **No Kuru WETH/USDC market on this USDC.** The decided pair is WETH/USDC, but Kuru's documented testnet market is MON/USDC with a native-MON base, quoted in a different token, `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570` ("USD Coin", FACT on chain 2026-10-11), not in the testnet USDC the contracts are deployed against. No trade can run on testnet until a market on this USDC is chosen, or the settlement asset is changed (which means redeploying all three contracts).
2. **Which ZeroDev project** serves chain 10143 for the bundler and, optionally, the paymaster.
3. **Testnet x402 providers.** `WALLETS_X402_VALIDATOR_ADDRESS` stays empty until there are pay-to addresses to list; the payer stays off regardless.
4. **Explorer source verification** for the three contracts (the explorer's verification API and settings were not checked).
5. **Who holds each Safe owner key** (see "Before mainnet").
