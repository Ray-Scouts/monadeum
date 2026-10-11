# Testnet trading options

Status: research and recommendation. The owner accepted option A on 2026-10-11; it is recorded in `ARCHITECTURE.md` section 10 ("Testnet market"), `ECONOMICS.md` section 1, and `deploy/README.md` (step 2b). Those documents, not this one, hold the decision.

Every on-chain read below was made on 2026-10-11 against `https://testnet-rpc.monad.xyz` (chain 10143, around block 70201714) or `https://rpc.monad.xyz` (chain 143), with view calls and `eth_call` simulations only. No transaction was signed or sent on any network. FACT means read on chain or from the named official source on that date; ASSUMPTION means not verified. All of it is time-sensitive.

## 1. Problem

Agents cannot trade end to end on Monad testnet today:

- The deployed `AgentSpendPolicy`, `AgentReallocation`, and `X402PaymentValidator` (`contracts/deployments/monad-testnet.json`) fix the settlement asset at deployment to `0x534b2f3A21130d7a60830c2Df862319e593943A3`.
- The decided pair is WETH/USDC with an ERC-20 base, so a close sells with zero native value (`ARCHITECTURE.md` section 10, TradingModule).
- Kuru's documented testnet router `0x7EFbE105Ca7415dE98F96622173458ac1c054630` lists one market, MON/USDC with a native base, quoted in `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570`, not in the settlement asset.
- Kuru's testnet API lists a newer market set that the pinned SDK, `@kuru-labs/kuru-sdk` 0.0.95, cannot decode.

## 2. Findings

### 2.1 The settlement asset is Circle's testnet USDC

- FACT (Circle, `https://developers.circle.com/stablecoins/usdc-contract-addresses`): Circle lists `0x534b2f3A21130d7a60830c2Df862319e593943A3` as USDC on Monad Testnet. This resolves the assumption previously recorded in `deploy/.env.testnet.example`, which this pull request updates.
- FACT (on chain): `mint` from an arbitrary address reverts with `FiatToken: caller is not a minter`.
- FACT (`https://faucet.circle.com`): Circle's faucet serves Monad Testnet, 20 USDC per request, one request per address per network every 2 hours.
- FACT (on chain, Transfer logs): 45 transfers of this token in the last 20,000 blocks. It is in use, but thinly.

### 2.2 Kuru's newer testnet contracts

What they are:

- FACT (GitHub, `Kuru-Labs/ts-sdk`, pushed 2026-10-01): Kuru publishes a new TypeScript SDK described as the "Typescript SDK for the new Kuru exchange contracts". It is released on npm as `@toxicflow-labs/ts-sdk`, not under the `@kuru-labs` scope. Versions run from 0.0.1 (2026-09-01) to 0.3.0 (2026-10-01, tag `latest`). Its `package.json` declares `"license": "UNLICENSED"`.
- FACT (npm): `@kuru-labs/kuru-sdk` is still at `latest` 0.0.95 (2026-01-27). Its `beta` tag is 1.0.3 (2024-11-22), which is older. No newer release of the old SDK exists.
- FACT (PyPI): `kuru-sdk-py` latest is 0.1.13 (2026-05-05). It was not checked against the new contracts.
- FACT (on chain): SDK 0.0.95's `ParamFetcher.getMarketParams` fails with `CALL_EXCEPTION` on the new WETH market. The new SDK's committed `orderBookAbi` decodes it.

How they work. FACT, from the new SDK's committed ABIs and confirmed on chain:

- The model is account-based. A trader deposits into `AccountCore` at `0xdbaaDe7B42c95399bb1E9614D51B5B9e2cf78038`, via `deposit(rootOwner, token, amount)`. It trades from that internal balance on the order book, via `swap(uint40 userId, bool isBuy, uint128 amountIn, uint128 minAmountOut, uint64 deadline)`. It withdraws via `withdraw(uint40 rootAccountId, address token, uint256 amount, address recipient)`.
- There is no wallet-to-wallet router swap like the old `anyToAnySwap`. The `SpotPeriphery` ABI offers only `deposit` and `estimateSwap` variants.
- Withdrawals pass through a `WithdrawalLimiter` (`0x6d9599d6B9A5Cf601C2cdBc43fF170462B256fe0`). A `withdrawalAuthority` can freeze them, globally or per token. `withdrawalsFrozen()` read false.
- Markets are created by `SpotRouter` (`0xf75A7529b83941e001d7D9bc113A73C92112947E`, owner `0xc64346f7dDc776B34EAa44C0B61D564797038143`) for whitelisted tokens only.
  - `whitelistedSpotTokens(0x534b...)` is false, and so is `isAssetEnabledForSpot(0x534b...)` on AccountCore.
  - `deploySpotMarket(Kuru Test WETH, 0x534b...)` reverts when simulated from an arbitrary address.
  - A new-contract market on the settlement asset cannot be created by us.

The markets, from the API (`https://api.testnet.kuru.io/api/v1/markets`) and on chain:

| Market | Address | Base | Quote | Book (on chain) |
|---|---|---|---|---|
| WETH/USDC | `0x9d187971b64505ac81f12c5fd2ac9c5247ec62f3` | Kuru Test WETH `0x63c84e18184021c6cce5ea57d0c3ec0e65f3b303` (18 decimals) | Kuru Test USDC `0xa402b424f392eaa05dbc8779e4502a1f6a96fef1` (6 decimals) | Two-sided. Bid 2678.20, ask 2680.89, about 10 bps wide. Five levels a side, about 0.0056 WETH (about 15 USDC) each. |
| USDT/USDC | `0x4a0888c502e64aeae11115508ec0955c70293dba` | Kuru Test USDT | Kuru Test USDC | Two-sided, about 0.9990 / 1.0006. |
| MON/USDC | `0x26cd68436b6a4aeb3ec52abc20a4d121f8b4bac9` | native MON | Kuru Test USDC | One placeholder ask at 100, no bid. |
| WBTC/USDC, XAUT/USDC | listed | Kuru Test WBTC, XAUT | Kuru Test USDC | Not read. |

Further facts about these markets:

- FACT: there is no WETH/USDC or other ERC-20-base market on the settlement asset in this set. Every market is quoted in Kuru Test USDC.
- FACT (on chain): `getMarketParams` for the WETH market gives:
  - pricePrecision 100, sizePrecision 1e10, tickSize 1;
  - minimum quote notional 1e7 (10 USDC) and maximum 5e12;
  - taker fee 7000 and maker fee 4000 PPS. The SDK documents PPS as parts per 10,000,000, so these are 7 bps and 4 bps.
- FACT: the API reports `volume24h` 0 and `tradeCount24h` 0 for every market, and all were created at Unix time 1790316437.
- FACT: the testnet WETH book is not anchored to the real price. Kuru's mainnet WETH/USDC book read 2520.38 / 2521.49 at the same time, so the testnet book is about 6 percent away from it.
- FACT (bytecode and simulation): Kuru Test USDC has `mint(address,uint256)`, but it reverts for an arbitrary caller. Its bytecode contains neither the EIP-3009 `transferWithAuthorization` selector nor the EIP-2612 `permit` selector.
- ASSUMPTION: Kuru hands out its test tokens through its app or team. No faucet was found in Kuru's documentation.
- ASSUMPTION: whether `swap` enforces the 10 USDC minimum quote notional was not verified. `estimateSwap` for a 1 USDC buy returns a normal quote, but the contract source is not public.

### 2.3 Creating a market on Kuru's documented testnet router

- FACT (source, `Kuru-Labs/Kuru-contracts-dex-public`, `contracts/Router.sol`): `deployProxy` is `public` with no owner check. It validates only the market type, tick size, and the power-of-ten precisions.
- FACT (on chain): the router's `orderBookImplementation()` is `0x72caE0a99C19B574e8a6De558F43fc1D019c9374`. That is also the EIP-1967 implementation of the existing testnet MON/USDC market, which SDK 0.0.95 decodes. A market created there today runs the code the pinned SDK already reads and builds swaps for.
- FACT (`eth_call` simulation from an arbitrary address): two `NO_NATIVE` markets were simulated, and both succeed:
  - `deployProxy` with base Wrapped MON `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` and quote `0x534b...`, which would deploy at `0x4965c3ff667ca607bc72540d52cc89a77a8fef00`. Its `eth_estimateGas` is 1,246,425, about 0.13 MON at the 100 gwei base fee if Monad charges the limit.
  - `deployProxy` with base Kuru Test WETH and quote `0x534b...`.
  - With `_kuruAmmSpread` 0 the call reverts, so a nonzero AMM spread is required.
- FACT (Monad docs, `https://docs.monad.xyz/developer-essentials/testnets`): Wrapped MON on testnet is `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541`. FACT (on chain): its total supply is about 4.6 million, so wrapping is in use. Anyone can wrap faucet MON (`https://faucet.monad.xyz`) into it.
- FACT (SDK 0.0.95 source, `src/router/path.ts`): `PathFinder.findBestPath` uses the explicit pool list when one is passed, and calls no API. `libs/trading` passes one, so a market Kuru's API does not list is still quoted. ASSUMPTION, to be confirmed by a dry run once the market exists: the quote and calldata are correct end to end on it.
- Each market created by `deployProxy` gets a Kuru AMM vault. FACT (SDK 0.0.95 ABI): the vault has `deposit(uint256,uint256,address)` and `withdraw(uint256,address,address)`. So liquidity can be seeded passively, without a market-making process. ASSUMPTION: the vault quotes around the ratio of its reserves at the configured spread. It was not exercised.
- The Monad testnet token list (`monad-crypto/token-list`, `tokenlist-testnet.json`, 2026-04-02) names a WETH at `0x45477f4709771331db81944A5E20eF95Bc7BA2D7`. FACT (on chain): its total supply is 0, so it cannot serve as a base without a source of it.

### 2.4 Other Monad testnet venues

- FACT (Uniswap docs): Uniswap v3 and v4 are documented on Monad mainnet (chain 143). Uniswap v4's deployment page does not list Monad testnet. FACT (on chain): the mainnet addresses of the v3 factory, the v4 PoolManager, the Universal Router, and Kuru Flow have no code on testnet.
- FACT (on chain): the 25 most active counterparties of the settlement asset over the last 20,000 blocks include no contract that answers as an AMM pool (`token0`, `token1`, `getReserves`, `factory`).
- No other Monad testnet DEX with an SDK or a simple router and a market on the settlement asset was found. This is a negative result of a bounded search, not proof that none exists.

## 3. Options and costs

The `AgentSpendPolicy` facts used below come from `ARCHITECTURE.md` section 16.3:

- It allowlists calls at `(target, selector)` granularity.
- It decodes recipients only on `transfer` and `approve` of the settlement asset or of a traded asset.
- It counts only those calls against the caps.
- The settlement asset is a constructor argument.

### Option A: our own ERC-20-base market on Kuru's documented testnet router, quoted in the settlement asset (recommended)

Create one `NO_NATIVE` market through the permissionless `deployProxy` on `0x7EFb...`, with base Wrapped MON and quote `0x534b...`. Seed its AMM vault, or rest limit orders, with an operator-held amount of both tokens.

- **Settlement asset**: unchanged. No contract is redeployed.
- **Code in `libs/trading`**:
  - A `KuruMarket` constant for the new market, filled in from the chain after creation, and a way to select it per deployment. Today `DEFAULT_MARKET` is a constant.
  - The MON price for gas. `kuruBookReader` refuses any book whose base is not native MON, and testnet has no MON book quoted in the settlement asset. One option is to let it accept a configured wrapped-native base, since WMON wraps MON one to one, so the new market is also the gas price source. That is a small, testable change.
  - The venue, the router call, the zero-value close, and position accounting stay as they are. This is the same router interface and order-book implementation the code already targets.
- **Configuration**:
  - `API_AGENT_PAIR` becomes WMON/USDC on testnet.
  - `WALLETS_TRADED_ASSETS` becomes `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541`.
  - `WALLETS_KURU_ROUTER` is unchanged.
  - Each agent's owner calls `setTradedAsset(WMON, true)` through the existing mechanism.
- **One-time on-chain work**, sent by the owner and not part of this research:
  - `deployProxy`, about 1.25 million gas.
  - Approvals and a vault deposit.
  - Testnet MON from the Monad faucet, wrapped.
  - Testnet USDC from Circle's faucet at 20 USDC per address every 2 hours, so a seed of a few hundred USDC takes several addresses or days.
- **Honesty limits**, to be stated wherever testnet results are shown:
  - The only liquidity is ours, so the price is whatever we seed. It moves only with agents' own trades, or with a re-quoting process if one is added.
  - Agents' profit and loss is a transfer to or from our seed, not evidence of skill.
  - Testnet fitness numbers must not inform any economic conclusion.
  - The pair differs from the mainnet decision (MON exposure, not ETH). What testnet then proves is the plumbing:
    - a buy and a zero-value close through the router;
    - the spend policy and traded-asset rule on a live chain;
    - gas, fees, and receipts;
    - fills and positions.
- **Variant A2**: deploy our own mintable test token as base, named as a test WETH, to keep a WETH/USDC label. Same router and settlement path. It adds a token contract we write and deploy, keeps the price just as arbitrary, and still leaves gas without a MON price source. It is not preferred.

### Option B: move testnet to Kuru's new markets (WETH against Kuru Test USDC)

This option has the most realistic book: third-party quotes, two-sided, with a nonzero fee. But it is the costliest by far:

- **Settlement asset must change** to Kuru Test USDC. That means redeploying `AgentSpendPolicy`, `AgentReallocation`, and `X402PaymentValidator`, plus new addresses in configuration, a new indexer start block, and a new Safe-administered reallocation contract.
- **Kuru Test USDC has no EIP-3009** (bytecode, section 2.2). The x402 path and the relayed allocation transfer of the funding flow both rely on `transferWithAuthorization` (`ARCHITECTURE.md` sections 6.1 and 16.3), so both stop working on testnet.
- **The token is not obtainable by us**: `mint` is restricted. Funding agents would depend on Kuru handing it out (ASSUMPTION).
- **The custody model changes**: funds move from the agent's smart account into Kuru's `AccountCore`, behind a withdrawal limiter and freeze authority.
- **The spend policy cannot bound the withdraw recipient**: `withdraw(rootAccountId, token, amount, recipient)` takes an arbitrary recipient, and the policy allowlists by selector only. Allowlisting it would hand a compromised session key a drain path (`THREAT-MODEL.md` scenario A), so the policy contract itself would need a new argument-decoding rule, a security-relevant contract change.
- **New venue code**: a second `Venue` implementation on a 0.x SDK under a different npm scope, declared `UNLICENSED`, with deposit, swap by account ID, and withdraw replacing one router call. Fill and swap detection change with it.
- **The minimum order may block agents**: a 10 USDC minimum quote notional against the 1 USDC per-transaction starting cap, if `swap` enforces it (ASSUMPTION).
- **The prices are still not real**: the book sat about 6 percent from mainnet at the time of reading.
- **Possible mainnet relevance**: if Kuru moves mainnet to these contracts, the venue integration will need this work regardless. That is an ASSUMPTION about Kuru's plans, worth asking Kuru directly, and a reason to track the new SDK, not a reason to switch testnet now.

### Option C: another Monad testnet DEX

No candidate was found (section 2.4). Cost: none, but no benefit.

### Option D: a minimal AMM or order book of our own

This is feasible, but it puts new, unaudited trading code of ours in the path. The router interface, calldata, and SDK would all differ from the mainnet venue. It has the same price-honesty limits as option A and adds code that exercises none of the production path. Option A dominates it.

### Option E: keep the status quo

No live testnet swap. The close path stays exercised offline and on a fork, as `ARCHITECTURE.md` section 10 records today. Cost: none. The gap remains: no live receipt for gas, fees, and the spend policy in a real trade.

## 4. Ranking and recommendation

| Rank | Option | Contract redeploy | `libs/trading` change | Main limit |
|---|---|---|---|---|
| 1 | A: own WMON/USDC market on Kuru's documented testnet router | None | Small: market selection per deployment, MON price from a wrapped-native book | Self-seeded price; pair differs from mainnet |
| 2 | E: status quo | None | None | No live testnet trade |
| 3 | A2: own test-WETH/USDC market | None | Same as A, plus a gas price source | A token contract of ours, arbitrary price |
| 4 | B: Kuru's new markets | All three, on a non-EIP-3009 token | New venue, new SDK, deposit and withdraw flow | Breaks x402 and the funding flow on testnet, needs a policy contract change, token not obtainable |
| 5 | D: own AMM | None | New venue | New unaudited code, no production path exercised |
| n/a | C: other DEX | n/a | n/a | None found |

**Recommendation: option A.** It is the only option that runs the production trading path end to end on testnet without touching the deployed contracts or the settlement asset:

- the Kuru router, the order-book implementation SDK 0.0.95 already decodes, an ERC-20 base sold with zero native value, the spend policy, and the traded-asset rule;
- every step it needs was verified as possible, either by an on-chain simulation or from source.

Proposed steps, each a separate, reviewable change:

1. The owner accepts option A, and `ARCHITECTURE.md` section 10 and `deploy/README.md` (open question 1) record it. The record states that testnet trades WMON/USDC on a self-seeded market and that testnet P&L carries no economic meaning.
2. The owner sends `deployProxy` and the seeding transactions. Before seeding, re-read the market with `getMarketParams` and `verifiedMarket`.
3. `libs/trading`: per-deployment market selection, and the wrapped-native MON price book, with tests.
4. A dry run, then one live buy and one close, recording the measured gas and fee in `ECONOMICS.md` section 1.

Separately, track `@toxicflow-labs/ts-sdk`, and ask Kuru whether mainnet will move to the account-based contracts. If it will, option B's venue, custody, and spend-policy questions become mainnet questions, and they deserve their own decision document.
