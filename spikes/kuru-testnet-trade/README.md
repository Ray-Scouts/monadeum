# Spike: real Kuru testnet trade with measured gas and fees (issue #20)

Throwaway code. It answers one question and is not part of the workspace, CI, or any product package.

## Question

`ECONOMICS.md` section 1 assumes a Kuru fee of 10 bps plus 5 bps of slippage (15 bps combined) and $0.001 of gas per trade, both unmeasured. This spike makes one real market swap on Kuru testnet and measures, from the receipt and chain state only, what the trade actually cost: gas as Monad charges it, the fee the market charged, and the total cost against the mid price. It also records whether Kuru's router pulls funds only through an allowance, the assumption `ARCHITECTURE.md` section 16.3 makes when it counts a router call as 0.

## Market chosen

`ARCHITECTURE.md` does not name a concrete pair: its worked examples use placeholders (`PAIR_A`, `PAIR_B`). The settlement asset is USDC, so the target is MON/USDC, the market Kuru lists as official on both networks. On testnet that is market `0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9`, MON native as base, Kuru's testnet USDC `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570` (6 decimals) as quote, reached through router `0x7EFbE105Ca7415dE98F96622173458ac1c054630`. Source: `https://docs.kuru.io/contracts/Contract-addresses`, read 2026-10-08. The script confirms the market against the router's own `verifiedMarket` registry before doing anything else. No substitution was needed.

## What a dry run found on 2026-10-08

Read from `https://testnet-rpc.monad.xyz`, no key involved:

| measure | value |
|---|---|
| takerFeeBps / makerFeeBps (`getMarketParams`, matches `verifiedMarket`) | 0 / 0 |
| pricePrecision, sizePrecision, tickSize | 1e8, 1e10, 100 |
| order book | no bids, one ask level: 245.975 MON at 1.001 USDC |
| AMM vault (`getVaultParams`) | zero sizes on both sides |
| quote for 1 USDC (simulated) | 0.999000999 MON, 0 bps against the best ask |
| router swap gas estimate | 389,331 |
| eth_gasPrice / base fee | 102 / 100 gwei |
| cost if Monad charges the limit (estimate + 10%) | 0.0437 MON |

The testnet book is not a live market: one resting ask at a placeholder price, no bids, no USDC transfers in the 6,000 blocks before the read. Two consequences follow, and both are limits of this spike, not findings about Kuru mainnet:

- The swap can only buy MON with USDC. A sell would not fill.
- With no bid there is no mid price, so "fee plus slippage against mid" cannot be measured on testnet. The script reports the cost against the best ask instead, which isolates the fee and price impact but not the half-spread a real trade pays.

For context only, a read-only `getMarketParams` and `bestBidAsk` call against the mainnet MON-USDC market `0x065C9d28E428A0db40191a54d33d5b7c71a9C394` on 2026-10-08 (public RPC `https://rpc.monad.xyz`, no transaction, no key) returned takerFeeBps 0, makerFeeBps 0, best bid 0.023794 and best ask 0.023831 USDC per MON. That is a spread of about 15.5 bps, or about 7.8 bps paid by a small taker against the mid. One snapshot is not a spread estimate; it is a reason to expect the half-spread, not a taker fee, to dominate the 15 bps line. Whether any fee is charged outside the market contract, for example by Kuru Flow or a front end, was not checked and is an open question.

## What it does

1. Refuses any RPC whose chain is not Monad testnet, 10143, before reading a key or writing anything.
2. Reads the market's fee and size parameters on-chain and cross-checks them against the router registry, then prints the best bid, best ask, mid, and the top of the order book.
3. Refuses to run above `MAX_GAS_PRICE_GWEI`.
4. With `DRY_RUN=1`: quotes the swap by simulation from a placeholder address whose quote-token balance and router allowance are supplied through an `eth_call` state override, estimates gas the same way, and stops. Nothing is signed.
5. Live: approves exactly `AMOUNT_IN` of the quote token to the router (never an unbounded amount, matching the counting rule in `ARCHITECTURE.md` section 16.3), quotes from the owner's own state, and submits one `anyToAnySwap` through the router with `minAmountOut` set to the quote less `SLIPPAGE_BPS`.
6. Measures each transaction from chain data: gas limit, gas used, and `effectiveGasPrice` from the transaction and receipt, and the MON actually charged from the owner's native balance at the receipt's block and the block before it, net of the MON the swap credited (the router's `KuruRouterSwap.amountOut`). It then says which rule matched the observed charge, gas limit times price or gas used times price. Monad's documentation states the limit is charged (`https://docs.monad.xyz/developer-essentials/gas-pricing`, read 2026-10-08); the run verifies that rather than assuming it.
7. Measures the trade: quote token in as a balance delta, MON out, the gross fill from the market's `Trade` events, the implied fee from the gap between gross fill and amount received, the effective price, and its distance in bps from the pre-trade best ask and mid, read at the block before the swap. It also reads the router allowance before and after the swap.
8. Prints two markdown tables ready to paste into issue #20, then one comparison line each against the 15 bps and $0.001 assumptions.

## Run

Requires Bun. A dry run needs nothing else:

```bash
bun install
bun run typecheck
bun run dry-run
```

A live run needs a `.env`:

```bash
cp .env.example .env   # then fill in OWNER_PRIVATE_KEY, MON_USD, MON_USD_SOURCE
bun run start
```

`.env` is gitignored. Never put a key that holds mainnet assets in it.

## Steps for the person running it

1. Use a fresh testnet-only key. Fund it with about 0.2 MON of testnet MON from the Monad testnet faucet (`https://faucet.monad.xyz`, not re-checked on 2026-10-08). A swap with approve is expected to cost under 0.1 MON at 100 to 120 gwei.
2. Obtain at least `AMOUNT_IN` (default 1) of the market's quote token, `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570`. This is Kuru's testnet USDC, not Circle's testnet USDC, and it is the step this spike could not resolve: on 2026-10-08 its `mint` reverted for an arbitrary caller, Kuru's documentation names no faucet for it, and no transfers of it appeared in recent blocks. Ask the Kuru team for a small amount, or check whether the Kuru testnet app still offers a faucet. If neither works, set `KURU_MARKET` to another market registered in the router with ask liquidity and an obtainable quote token, and record the substitution in issue #20 as a deviation.
3. Just before running, read MON/USD from a named source and set `MON_USD` and `MON_USD_SOURCE` (source and UTC time). Testnet MON has no price; the mainnet price is what converts gas into the dollar figure `ECONOMICS.md` uses.
4. Run `bun run dry-run`, then `bun run start`, and paste the printed tables into issue #20.

## Known limits

- One trade, one size, on a book that is not a live market. Gas for a fill that walks several price levels or touches the AMM vault will be higher than one fill against one resting order.
- Fee plus slippage against mid is not measurable while the testnet book has no bid. The mainnet figures above are one read-only snapshot, not a measurement of a trade.
- The router path is measured, because the session key's allowlist in `ARCHITECTURE.md` targets the router. Calling the market's `placeAndExecuteMarketBuy` directly would skip one contract hop and likely cost less gas; that is not measured here.
- The gas limit is the estimate plus `GAS_BUFFER_BPS`. If Monad charges the limit, the buffer is paid in full, so the measured cost depends on that setting. The table reports used and limit side by side.
- Approval is counted separately. An agent that approves once per trade pays both rows; one that reuses an allowance pays only the swap row.
- The per-transaction native balance reads at block `n - 1` and `n` need an RPC that serves recent historical state, as the issue #18 spike also required.
- The dry run's state override assumes an OpenZeppelin-style storage layout for the quote token. It probes for it and skips the quote if it is not found.
- Every Kuru address and parameter above was read on 2026-10-08 and is time-sensitive.
