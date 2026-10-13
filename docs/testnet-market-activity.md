# Testnet market activity

What the team does to move its own testnet WMON/USDC market so the agents have something to trade on, why that is disclosed and not a result, and how to do it safely. The decision is in `ARCHITECTURE.md` section 10 ("Testnet market activity"). State as of 2026-10-13. Everything marked simulated was run against Monad testnet through `https://testnet-rpc.monad.xyz` on that date; nothing here was broadcast.

## 1. What this is, and what it is not

The WMON/USDC market on Kuru's testnet router (`0x46b66f84317941eC371E7791753f35653341aeBC`) was created and seeded by the team on 2026-10-13 (`contracts/deployments/monad-testnet-wmon-market.json`). Every resting order on it is the team's, so the price is whatever the team sets. On a book nobody else trades, the mid never moves by itself, the strategy's signal stays at its flat value, and no agent trades.

`contracts/script/market-activity.sh` lets the team move that mid on purpose, in a bounded and recorded way, so that the production path (tick, signal, risk check, bundler, Kuru fill, evidence) can be observed end to end.

**Every trade, profit, and loss that follows is not evidence of skill and must always be presented that way.** The team chose the price, the size, and the moment. An agent that buys after the team moved the mid up has followed the team, not found an edge, and its later P&L measures the team's own book. Moving the market to trigger demonstration trades is disclosed, and it is not a claim about strategy performance. The same holds for fitness, evidence, and any figure derived from testnet trades on this market.

## 2. The strategy's actual trigger

Derived from `libs/strategy/src/presets.ts` (the `conservative` preset), `libs/strategy/src/propose.ts`, and `apps/worker/src/market.ts` (`KuruMidSignal`).

- Once per tick the worker records one mid for the market: `(bestBid + bestAsk) / 2` at the first valid reading of that tick. A reading is valid only if both sides are non-empty and uncrossed, the spread is at most `WORKER_MARKET_MAX_SPREAD_BPS` (default 200), and the block read is within `WORKER_MARKET_MAX_AGE_SECONDS` (default 60) of the worker's clock.
- The signal is the mean of the last `timeHorizon` (24) per-tick mid returns, minus `entryThreshold` (0.0002). It needs `timeHorizon + 1` = 25 consecutive recorded tick mids; with any missing the worker takes no action.
- The agent proposes `long` when the signal is above 0, and `flat` otherwise (`propose.ts`). A position change is considered only when at least `executionFrequency` (24) ticks have passed since the agent's last trade; a new agent starts eligible.
- A long buys `capital x riskTolerance` (0.1) in settlement asset, within the signed risk policy's caps (1 USDC per action, 5 USDC per rolling day, `maxPositionFraction` 0.25).

So the mean return must exceed 0.0002 per tick, which is a window that sums to 24 x 0.0002 = 0.0048, or **48 bps** of mid. Returns add, so one step of 48 bps or more qualifies, and so do two steps of 25 bps in different ticks inside the same 24-tick window. On an otherwise flat window the signal after one step of `r` is `r / 24 - 0.0002`, and it stays positive for the 24 ticks in which the step is inside the window.

**Tick length.** The decided mainnet tick is one hour. The testnet deployment is decided at five minutes (`WORKER_TICK_INTERVAL_MS=300000`, `deploy/.env.testnet.example`; `ARCHITECTURE.md` section 11, "Testnet tick length"). At five minutes the window is 24 x 5 = 120 minutes and the first full window needs 25 recorded ticks, about two hours after the runner starts sampling. The VPS's own `deploy/.env.testnet` was not readable from this repository: confirm it with `grep WORKER_TICK_INTERVAL_MS deploy/.env.testnet`. If it reads 3600000 the window is 24 hours, and the times in section 5 scale by 12. `market-activity.sh status` prints the tick length it assumed and `MARKET_ACTIVITY_TICK_MS` overrides it.

### Worked example, from the live book of 2026-10-13

Best bid 0.025116, best ask 0.025242, mid 0.025179, spread 50 bps. Depth: three asks of 15 WMON at 0.025242, 0.025305, 0.025368 (0.3786, 0.3796, 0.3805 USDC), three bids of about 80 WMON (2 USDC each) at 0.025116, 0.025053, 0.024990.

| Move | Resulting mid | Return | Signal on a flat window | Agents |
| --- | --- | --- | --- | --- |
| Sweep ask 1 | 0.025211 | +12.5 bps | 0.00125/24 - 0.0002 = -0.000148 | stay flat |
| Sweep asks 1 and 2 (the most one taker order can do) | 0.025242 | +25.0 bps | 0.0025/24 - 0.0002 = -0.000096 | stay flat |
| Sweep asks 1 and 2, then reseed at `SEED_MID_USDC=0.025406` | 0.025355 | +70.0 bps | 0.0070/24 - 0.0002 = +0.000092 | propose long |

Sweeping the third ask as well would empty the ask side. A one-sided book gives no valid mid and TradingModule refuses to build a plan on it, so it blocks the trigger instead of causing it.

**Consequence: a taker order alone cannot trigger this strategy on the book as seeded.** The seeded asks span 50 bps above the best ask, so the largest mid move that leaves the book two-sided is +25 bps, short of 48. `market-activity.sh plan up 48` says so and prints the assisted route (section 4). A downward move is reachable and is what makes an agent propose `flat` (the exit), but a sell of the first bid level needs about 80 WMON in the taker's wallet.

## 3. The tool

From the repository root, with Foundry installed and the keystore account that holds the testnet USDC (`cast wallet import`, never a private key in a file or on the command line):

| Command | Sends anything | What it does |
| --- | --- | --- |
| `contracts/script/market-activity.sh status [up\|down <bps>]` | no | Chain-id guard, market registry check, best bid and ask, mid, spread, depth on both sides, the preset's window and threshold, the tick length, and whether the given move would cross the entry threshold on the recorded window (a flat window if none is supplied). |
| `contracts/script/market-activity.sh plan up\|down <bps>` | no | The smallest taker order that moves the mid by at least that many bps, from the on-chain book (`getL2Book`), checked against the order book's own quote (`placeAndExecuteMarketBuy` or `Sell` as `eth_call` from the zero address, how kuru-sdk 0.0.95 quotes). Prints the exact `buy` or `sell` commands, or says the move is unreachable and prints the assisted route. |
| `contracts/script/market-activity.sh buy <usdc> simulate` | no | One taker buy through the router's `anyToAnySwap`, run by `forge script` against the live chain state with the taker's real balances. No key is needed. |
| `contracts/script/market-activity.sh sell <wmon> simulate` | no | The same for a sell of WMON. |
| `contracts/script/market-activity.sh buy\|sell <size> broadcast` | yes | Runs the simulation first and stops if it fails, then asks you to type `BROADCAST`, then sends the approval and the swap from the keystore account. |

`MarketActivity.s.sol` builds the same two calls an agent's plan carries (`libs/trading` `buildSwapCall` and `buildSellCall`): an exact `approve` of the debit token to the router, then `anyToAnySwap(markets, isBuy, nativeSend, debitToken, creditToken, amount, minAmountOut)` with one hop and no native value, the signature in `contracts/test/fork/WmonMarketFork.t.sol`.

Bounds, enforced in the script and not only in the wrapper:

- Chain 10143 before anything else; the market must be registered at the router and trade the configured WMON and USDC.
- A hard maximum of 2 USDC per buy and 100 WMON per sell, compiled in. The environment can lower it (`MARKET_ACTIVITY_MAX_BUY_USDC`, `MARKET_ACTIVITY_MAX_SELL_WMON`) and cannot raise it.
- The order's floor is the router's quote less `MARKET_ACTIVITY_SLIPPAGE_BPS` (default 50); an order the router cannot quote is refused.
- A pre-trade book that is not two-sided is refused. After the trade, a book that is one-sided, crossed, wider than `MARKET_ACTIVITY_MAX_SPREAD_BPS` (default 200, the worker's own limit), or whose mid moved more than `MARKET_ACTIVITY_MAX_MOVE_BPS` (default 50) is refused. `forge script` runs the whole script locally before it sends anything, so a refusal also stops a broadcast.
- Optional recorded outputs go to `contracts/deployments/monad-testnet-market-activity.latest.json` (not committed).

What was simulated on 2026-10-13, with the deployer address as the taker:

| Command | Result |
| --- | --- |
| `buy 0.378631 simulate` | passed: 15.0000391227 WMON out, mid +12 bps, spread 74 bps, as planned |
| `buy 0.758206 simulate` | passed: best ask to 0.025368, mid +25 bps |
| `buy 1.2 simulate` and `buy 1.1388 simulate` | refused by the router with `InsufficientLiquidity` (`0xbb55fd27`): an order past the book's depth |
| `buy 2.5 simulate` | refused by the wrapper, above the 2 USDC maximum |
| `sell 79.630514 simulate` | refused by the script, `Insufficient("WMON", ...)`: the deployer holds 0 WMON in its wallet (its WMON is deposited in Kuru's margin account), so a standalone sell cannot be simulated until the taker holds WMON |

A sell was exercised, not as a standalone simulation, in the fork test `MarketActivityForkTest.test_fork_buyThenSellThroughTheRealRouter` (buy, then sell the WMON just bought, through the script's own `execute`). That runs in Foundry's EVM against live state, not through Monad's client, and from an externally owned account rather than an agent's ERC-4337 account, so gas is not representative. The deployer is also the maker of every resting order: the simulations show a taker order from it fills against its own orders without a revert on Foundry's EVM, but that is the real router's behavior on Monad's client only by assumption. A separate funded keystore account as the taker (`TAKER_ACCOUNT`, `TAKER_ADDRESS`) avoids the question.

## 4. Moving the mid beyond a taker order

The agents' trigger needs a larger single step than a taker can make on the seeded book. The route that fits the existing tooling, simulated on a fork on 2026-10-13 (`MarketActivityForkTest.test_fork_sweepThenReseedMovesTheMidPastTheEntryThreshold`, which passed):

1. Sweep the cheaper asks with the planned taker order, leaving one ask level: `market-activity.sh buy 0.758206 simulate`, then `broadcast`. The book stays two-sided, mid +25 bps.
2. Reseed higher with `contracts/script/wmon-market.sh seed`, at the `SEED_MID_USDC` that `plan up 48` prints (0.025406 on the 2026-10-13 book). The seed's orders are post-only, so its first bid must sit below the remaining ask, which is why the sweep comes first and why the printed value sits 10 bps under the crossing point. Run `seed simulate` first, as in `deploy/README.md` step 2b. Expected: best bid about 0.025342, best ask 0.025368, mid about 0.025355, +70 bps.

What this fork run did not show: it used a different funded account as the maker, not the deployer. The deployer's own margin balances (the sweep sells part of its ask-side WMON, and the USDC proceeds are expected to sit in Kuru's margin account) determine how much MON the seed needs to wrap, and `seed simulate` reports that or refuses before sending. The seed also leaves the older, lower bids resting. These are arithmetic and fork results, and the effect on the agents is unobserved.

## 5. Step by step for the owner

1. **Check the preconditions** (section 7). Do not move the market while one that blocks a trade is open: the agent will not trade, and the move only starts a two-hour clock.
2. **Status.** `contracts/script/market-activity.sh status up 25`. Read the book, the depth, and the verdict. To use the real recorded window, export the last 25 mids from the worker's database and set `MARKET_ACTIVITY_MIDS_FILE`: on the VPS, `dc exec postgres psql -U <role> -d <db> -At -c "select mid from market_mid_samples where market = '0x46b66f84317941ec371e7791753f35653341aebc' order by tick desc limit 25"` and reverse the order (oldest first). No public API serves these mids.
3. **Plan.** `contracts/script/market-activity.sh plan up 48`. If it prints a taker order, continue with step 4. If it says the move is unreachable, it prints the assisted route of section 4.
4. **Simulate.** `contracts/script/market-activity.sh buy <usdc> simulate`. Read the post-trade bid, ask, mid move, and spread it prints.
5. **Broadcast.** `contracts/script/market-activity.sh buy <usdc> broadcast`, which simulates again, then asks for `BROADCAST` and for the keystore password. For the assisted route, run `wmon-market.sh seed simulate` and `seed broadcast` after the sweep, within the same tick if you can (it is not required: returns add across ticks, and the book stays two-sided in between).
6. **Watch the worker log** on the VPS: `dc logs -f worker`. Each tick prints one line per agent. Expect `none (no-action)` before the move and, at the first tick after it, an agent line that reports a buy `executed (executed)` instead. A line with `failed at observe: rpc` means no whole window yet; `no signed risk policy version is stored` means step 9.5 of `deploy/README.md` is missing.
7. **Watch the indexer and evidence.** `https://api.monadeum.xyz/public/evidence` (the `trades` and `spent` counts rise) and `https://app.monadeum.xyz/evidence`. Check the book with `cast call 0x46b66f84317941eC371E7791753f35653341aeBC "bestBidAsk()(uint256,uint256)" --rpc-url https://testnet-rpc.monad.xyz`.

### What to expect, and in how long

At five-minute ticks: the tick in progress may already have its mid recorded, so the new mid is recorded by the next tick at the latest, and an agent can propose `long` at that tick, about 5 to 15 minutes after the move including the bundler and Kuru fill. The signal stays positive for 24 ticks, 2 hours, then the step leaves the window, the signal falls to -0.0002 or below, and the agent proposes `flat`. The `flat` exit is considered once 24 ticks have passed since its buy, which is also about 2 hours. Each agent's own buy raises the mid a little further. At one-hour ticks, scale to up to two hours before the buy and about 24 hours before the exit. These are derived from the code, not observed: no tick has run against the live deployment (`ARCHITECTURE.md` section 11, "Not verified live").

### How to stop

- Stop the agents: set `WORKER_TICK_RUNNER=disabled` in `deploy/.env.testnet` and `dc up -d worker` (`deploy/README.md`, step 9). A tick whose operation was already sent is reconciled when the runner is enabled again.
- Stop moving the market: run nothing further. The strategy reacts to change, not level: once the step leaves the window the signal is flat again and a still book produces no more entries. The mid stays at its new level until someone trades or reseeds. To return to the earlier level, a sell sweep and a reseed at the old `SEED_MID_USDC` do it, and that is itself a move the agents see as a fall.
- An open position is closed only if the agent's account has WMON marked as a traded asset on its spend policy (section 7).

## 6. Risks and limits

- **No result is evidence.** See section 1. A demonstration trade that makes money on this book proves nothing; one that loses proves nothing.
- **Agents' own trades move the mid.** After the first agent buys 0.1 USDC, the ask side is thinner. With several agents, the asks can run out and the book goes one-sided; the signal and TradingModule then refuse, until it is reseeded (`ARCHITECTURE.md` section 11, "Not verified live").
- **Real, small testnet cost.** The taker spends testnet USDC and testnet MON for gas (the wrapper caps the fee at 110 gwei with a 2 gwei tip, as `wmon-market.sh` does, and the 2026-10-13 estimate for the buy was 473716 gas, about 0.052 MON at that cap; Monad charges the gas limit, so treat it as the amount reserved).
- **Self-matching.** Using the deployer as the taker trades against its own orders; see section 3.
- **Quote drift.** The router's quote is read at one block; the order's floor (50 bps below it) bounds what changes before inclusion, and an order that would fill past the floor reverts.
- **Hard limits.** 2 USDC per buy, 100 WMON per sell, compiled in. The agents' own limits are the signed policy's caps (1 USDC per action, 5 USDC per rolling day).
- **Unverified here.** The strategy's reaction on the live deployment; the deployer-as-maker reseed; gas on Monad's client; whether Kuru's engine treats a self-match the way Foundry's EVM did.

## 7. What the tick runner needs to trade, checked on 2026-10-13

For the first agent account `0x604bd1f3ec0001abbd58404595005faf925a3955` and the live deployment. Verified means read on chain or from the public API on that date. Needs the owner means it is state on the VPS or at a vendor that no public read exposes.

| # | Precondition | Status | Evidence |
| --- | --- | --- | --- |
| 1 | The market exists, is registered at the router, and is two-sided | Verified | `bestBidAsk` returned 0.025116 and 0.025242; `verifiedMarket` nonzero |
| 2 | The agent account is deployed | Verified | `eth_getCode` returns the proxy; `deployed` event in `/public/evidence`, block 70200443 |
| 3 | The settlement asset's balance is above 0 | Verified | USDC `balanceOf` = 1000000 (1 USDC). That the worker's principal job has counted it as funded: needs the owner |
| 4 | Spend caps are set | Verified | `limits` = (1000000, 5000000); `windowTotal` = 0 |
| 5 | The router's swap selector is allowed | Verified | `isAllowed(account, router, 0xffa5210a)` = true |
| 6 | `approve` on USDC is allowed | Verified | `isAllowed(account, USDC, 0x095ea7b3)` = true |
| 7 | WMON is marked a traded asset, and `approve` on WMON is allowed | **Not verified: false** | `isTradedAsset(account, WMON)` = false and `isAllowed(account, WMON, 0x095ea7b3)` = false. The account was deployed on 2026-10-11, before `WALLETS_TRADED_ASSETS` held WMON (`deploy/README.md`, step 2b). A buy needs neither, so an entry is not blocked by this; the close is: a `flat` on an open WMON position fails at the spend policy and the position stays open. Needs the owner: create a new agent now, or reissue this one's permissions |
| 8 | A session key exists and the Kernel permission is installed | Needs the owner | Installed on the first operation; no public read shows it (`PermissionInstalled` is not in `/public/evidence`, and the RPC limits `eth_getLogs` to 100 blocks) |
| 9 | A signed risk policy version is in effect, covering WMON/USDC | Needs the owner | `dc --profile operator run --rm policy show` on the VPS (`deploy/README.md`, step 9.5) |
| 10 | The tick runner is enabled, the genome is committed, the paymaster sponsors | Needs the owner | Worker log lines; ZeroDev dashboard; the first agent's genome document |
| 11 | 25 consecutive tick mids are recorded | Needs the owner | `market_mid_samples` rows (section 5, step 2) |
| 12 | The signal is above the entry threshold | **Not met: this is what blocks a trade today** | A static book gives a signal of -0.0002; `status` prints it |

**What blocks a trade today.** With the market untouched, the strategy's signal is flat (-0.0002) on every tick, so every agent proposes `flat`, which is no action with nothing open. That is the blocker this tool addresses. Beyond it, precondition 7 would block the exit and preconditions 8 to 11 cannot be read from outside the VPS. The first agent can therefore be expected to enter on a trigger and then be unable to close.

## 8. Disclosure

For the hackathon submission and the README:

> The WMON/USDC market on which the Monadeum agents trade on Monad testnet is created, seeded, and, from time to time, deliberately moved by the team through `contracts/script/market-activity.sh`, so that the agents' tick, signal, risk, execution, and evidence pipeline can be demonstrated end to end. Its prices are set by the team, so every testnet trade, profit, and loss on it is a demonstration of the plumbing and is not evidence of any strategy's skill or performance.

Do not describe a testnet P&L as a result, a backtest, or a track record.
