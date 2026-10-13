#!/usr/bin/env bash
# Moves the team-owned testnet WMON/USDC market in a controlled, disclosed way so the agents' strategy has something to
# react to (ARCHITECTURE.md section 10, "Testnet market activity"; docs/testnet-market-activity.md). Monad testnet
# (chain 10143) only. The market, its price, and every trade on it are ours: nothing here is evidence of skill.
#
#   contracts/script/market-activity.sh status [up|down <bps>]    # read-only: book, depth, strategy trigger
#   contracts/script/market-activity.sh plan up|down <bps>        # read-only: smallest taker order for that mid move
#   contracts/script/market-activity.sh buy <usdc> simulate       # one taker buy, dry run; sends nothing, needs no key
#   contracts/script/market-activity.sh buy <usdc> broadcast      # simulates first, asks to confirm, then sends
#   contracts/script/market-activity.sh sell <wmon> simulate|broadcast
#
# The taker is a Foundry keystore account (`cast wallet import`), never a private key in a file or on the command line.
# Every value below can be overridden from the environment; the defaults are the decided values.
#
# Safety posture, the same as wmon-market.sh: chain id 10143 guard before anything else; the market is checked against
# the router's registry and the configured tokens; a hard maximum size (2 USDC or 100 WMON) compiled into
# MarketActivity.s.sol that no environment variable can raise; a refusal when the post-trade book is one-sided, wider
# than a spread bound, or has moved the mid more than a move bound; an exact approval, never an unlimited one; and a
# broadcast always runs the simulation first and then asks you to type BROADCAST.
#
# Test and review aids, which send nothing: MARKET_ACTIVITY_FIXTURE=<file> replaces every chain read with the values in
# a file (BID, ASK, L2, QUOTE_OUT), and MARKET_ACTIVITY_DRY_RUN=1 prints the forge commands instead of running them.
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  echo "usage: $0 status [up|down <bps>] | plan up|down <bps> | buy <usdc>|sell <wmon> simulate|broadcast" >&2
  exit 2
}

cmd="${1:-}"
[[ -n "$cmd" ]] || usage

RPC_URL="${MONAD_TESTNET_RPC_URL:-https://testnet-rpc.monad.xyz}"
FIXTURE="${MARKET_ACTIVITY_FIXTURE:-}"
DRY_RUN="${MARKET_ACTIVITY_DRY_RUN:-0}"
HERE="$(pwd)"
PY="python3 $HERE/script/market_activity.py"
PRESET="$HERE/../libs/strategy/src/presets.ts"

# The taker. Defaults to the deployer keystore account the market was created with, which is also the maker of every
# resting order, so a taker trade by it matches against its own orders. A separate funded keystore account is cleaner
# (docs/testnet-market-activity.md, step 1); set TAKER_ACCOUNT and TAKER_ADDRESS together.
ACCOUNT="${TAKER_ACCOUNT:-${DEPLOYER_ACCOUNT:-monadeum-testnet-deployer}}"
TAKER="${TAKER_ADDRESS:-${DEPLOYER_ADDRESS:-0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3}}"
export MONADEUM_EXPECTED_TAKER="$TAKER"

export MONADEUM_KURU_ROUTER="${MONADEUM_KURU_ROUTER:-0x7EFbE105Ca7415dE98F96622173458ac1c054630}"
export MONADEUM_MARKET_BASE="${MONADEUM_MARKET_BASE:-0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541}"
export MONADEUM_MARKET_QUOTE="${MONADEUM_MARKET_QUOTE:-0x534b2f3A21130d7a60830c2Df862319e593943A3}"
if [[ -z "${MONADEUM_WMON_MARKET:-}" ]]; then
  MONADEUM_WMON_MARKET="$(sed -n 's/.*"market": *"\(0x[0-9a-fA-F]\{40\}\)".*/\1/p' deployments/monad-testnet-wmon-market.json | head -1)"
fi
export MONADEUM_WMON_MARKET
MARKET="$MONADEUM_WMON_MARKET"

# Market fixed parameters (contracts/deployments/monad-testnet-wmon-market.json): price precision 1e8, size precision
# 1e10, base 18 and quote 6 decimals. A buy's order-book size is the quote amount at price precision; a sell's is the
# base amount at size precision (kuru-sdk 0.0.95, `CostEstimator`).
PRICE_PRECISION=100000000
SIZE_PRECISION=10000000000

# Bounds. The spread bound is the worker's own (WORKER_MARKET_MAX_SPREAD_BPS, default 200): a wider book yields no
# mid sample at all. The move bound is a starting value: with the seeded ladder no taker order can move the mid by more
# than 25 bps. The slippage bound sets the order's floor from the router's own quote.
MAX_SPREAD_BPS="${MARKET_ACTIVITY_MAX_SPREAD_BPS:-200}"
MAX_MOVE_BPS="${MARKET_ACTIVITY_MAX_MOVE_BPS:-50}"
SLIPPAGE_BPS="${MARKET_ACTIVITY_SLIPPAGE_BPS:-50}"
MAX_BUY_USDC="${MARKET_ACTIVITY_MAX_BUY_USDC:-2}"
MAX_SELL_WMON="${MARKET_ACTIVITY_MAX_SELL_WMON:-100}"
TICK_MS="${MARKET_ACTIVITY_TICK_MS:-$(sed -n 's/^WORKER_TICK_INTERVAL_MS=\([0-9]*\).*/\1/p' ../deploy/.env.testnet.example | head -1)}"
TICK_MS="${TICK_MS:-300000}"

GAS_PRICE_GWEI="${GAS_PRICE_GWEI:-110}"
PRIORITY_GWEI="${PRIORITY_GWEI:-2}"
fees=(--with-gas-price "${GAS_PRICE_GWEI}gwei" --priority-gas-price "${PRIORITY_GWEI}gwei")

is_uint() { [[ "$1" =~ ^[0-9]+$ ]]; }
is_decimal() { [[ "$1" =~ ^[0-9]+(\.[0-9]+)?$ ]]; }

# Chain reads, or the fixture's values.
if [[ -n "$FIXTURE" ]]; then
  # shellcheck disable=SC1090
  source "$FIXTURE"
  echo "fixture           $FIXTURE (no chain read is made)"
else
  chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
  if [[ "$chain_id" != "10143" ]]; then
    echo "refusing: $RPC_URL reports chain id $chain_id, not Monad testnet (10143)" >&2
    exit 1
  fi
  echo "chain id          $chain_id"
  echo "market            $MARKET"
  registered="$(cast call "$MONADEUM_KURU_ROUTER" "verifiedMarket(address)(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)" "$MARKET" --rpc-url "$RPC_URL" | head -1 | awk '{print $1}')"
  if [[ "$registered" == "0" ]]; then
    echo "refusing: $MARKET is not registered at the router $MONADEUM_KURU_ROUTER" >&2
    exit 1
  fi
  ba="$(cast call "$MARKET" "bestBidAsk()(uint256,uint256)" --rpc-url "$RPC_URL")"
  BID="$(echo "$ba" | sed -n 1p | awk '{print $1}')"
  ASK="$(echo "$ba" | sed -n 2p | awk '{print $1}')"
  L2="$(cast call "$MARKET" "getL2Book()(bytes)" --rpc-url "$RPC_URL")"
fi

# The router's own quote: the order book's market order executed from the zero address, which is how the SDK quotes
# (kuru-sdk 0.0.95, `CostEstimator.returnMarketBuyEstimate` and `returnMarketSellEstimate`). Argument: the order's
# amount in the debit token's base units. Prints the credit token's base units.
router_quote() {
  local side="$1" amount="$2" size
  if [[ -n "$FIXTURE" ]]; then echo "${QUOTE_OUT:?the fixture has no QUOTE_OUT}"; return; fi
  if [[ "$side" == "buy" ]]; then
    size="$(python3 -c "print($amount * $PRICE_PRECISION // 10**6)")"
    cast call "$MARKET" "placeAndExecuteMarketBuy(uint96,uint256,bool,bool)(uint256)" "$size" 0 false false --from 0x0000000000000000000000000000000000000000 --rpc-url "$RPC_URL" | awk '{print $1}'
  else
    size="$(python3 -c "print($amount * $SIZE_PRECISION // 10**18)")"
    cast call "$MARKET" "placeAndExecuteMarketSell(uint96,uint256,bool,bool)(uint256)" "$size" 0 false false --from 0x0000000000000000000000000000000000000000 --rpc-url "$RPC_URL" | awk '{print $1}'
  fi
}

# The strategy's last recorded mids, if the owner supplies them (the worker keeps them in Postgres and no public API
# serves them). One mid per line, oldest first, at the 1e18 scale or as a decimal.
mids_args=()
if [[ -n "${MARKET_ACTIVITY_MIDS_FILE:-}" ]]; then mids_args=(--mids "$MARKET_ACTIVITY_MIDS_FILE"); fi

case "$cmd" in
  status)
    move_args=()
    if [[ -n "${2:-}" ]]; then
      [[ "$2" == "up" || "$2" == "down" ]] && is_uint "${3:-}" && [[ "$3" -gt 0 ]] || usage
      move_args=(--move "$2:$3")
    fi
    $PY status --bid "$BID" --ask "$ASK" --l2 "$L2" --preset "$PRESET" --max-spread-bps "$MAX_SPREAD_BPS" --tick-ms "$TICK_MS" ${mids_args[@]+"${mids_args[@]}"} ${move_args[@]+"${move_args[@]}"}
    ;;

  plan)
    direction="${2:-}"
    bps="${3:-}"
    [[ "$direction" == "up" || "$direction" == "down" ]] && is_uint "$bps" && [[ "$bps" -gt 0 ]] || usage
    out="$($PY plan --bid "$BID" --ask "$ASK" --l2 "$L2" --preset "$PRESET" "$direction" "$bps")"
    echo "$out" | grep -v '^PLAN_'
    amount="$(echo "$out" | sed -n 's/^PLAN_AMOUNT=//p')"
    side="$(echo "$out" | sed -n 's/^PLAN_SIDE=//p')"
    if [[ "$amount" == "0" || -z "$side" ]]; then
      echo "no single taker order reaches this move, so no command is printed"
      echo "move the mid with more resting liquidity instead: docs/testnet-market-activity.md, 'Moving the mid beyond a taker order'"
      exit 0
    fi
    quoted="$(router_quote "$side" "$amount")"
    floor="$(python3 -c "print($quoted * (10000 - $SLIPPAGE_BPS) // 10000)")"
    echo "router quote      $quoted base units out for $amount in (floor $floor at $SLIPPAGE_BPS bps slippage)"
    if [[ "$side" == "buy" ]]; then
      size_arg="$(python3 -c "print($amount / 10**6)")"
    else
      size_arg="$(python3 -c "print($amount / 10**18)")"
    fi
    echo "then, from the repository root:"
    echo "  contracts/script/market-activity.sh $side $size_arg simulate"
    echo "  contracts/script/market-activity.sh $side $size_arg broadcast"
    ;;

  buy | sell)
    size="${2:-}"
    mode="${3:-}"
    is_decimal "$size" && [[ "$mode" == "simulate" || "$mode" == "broadcast" ]] || usage
    if [[ "$cmd" == "buy" ]]; then
      decimals=6 hard="$MAX_BUY_USDC" unit=USDC
      [[ "$(python3 -c "print(int($MAX_BUY_USDC > 2))")" == "0" ]] || { echo "refusing: MARKET_ACTIVITY_MAX_BUY_USDC above the hard maximum of 2 USDC" >&2; exit 1; }
    else
      decimals=18 hard="$MAX_SELL_WMON" unit=WMON
      [[ "$(python3 -c "print(int($MAX_SELL_WMON > 100))")" == "0" ]] || { echo "refusing: MARKET_ACTIVITY_MAX_SELL_WMON above the hard maximum of 100 WMON" >&2; exit 1; }
    fi
    # Whole base units, and a sell on a multiple of the size precision (1e8 wei), as the router's quote truncates.
    amount="$(python3 -c "
from decimal import Decimal
a = int(Decimal('$size') * 10**$decimals)
if $decimals == 18:
    a = a // 10**8 * 10**8
print(a)")"
    max_amount="$(python3 -c "from decimal import Decimal; print(int(Decimal('$hard') * 10**$decimals))")"
    if [[ "$amount" == "0" ]]; then echo "refusing: the size rounds to zero base units" >&2; exit 1; fi
    if [[ "$(python3 -c "print(int($amount > $max_amount))")" == "1" ]]; then
      echo "refusing: $size $unit is above the maximum of $hard $unit" >&2
      exit 1
    fi
    quoted="$(router_quote "$cmd" "$amount")"
    if ! is_uint "$quoted" || [[ "$quoted" == "0" ]]; then
      echo "refusing: the router's quote for $size $unit is $quoted (an empty side, or the order is below the market's minSize)" >&2
      exit 1
    fi
    min_out="$(python3 -c "print($quoted * (10000 - $SLIPPAGE_BPS) // 10000)")"
    export MONADEUM_ACTIVITY_BUY="$([[ "$cmd" == "buy" ]] && echo true || echo false)"
    export MONADEUM_ACTIVITY_AMOUNT="$amount"
    export MONADEUM_ACTIVITY_MIN_OUT="$min_out"
    export MONADEUM_ACTIVITY_MAX_AMOUNT="$max_amount"
    export MONADEUM_ACTIVITY_MAX_SPREAD_BPS="$MAX_SPREAD_BPS"
    export MONADEUM_ACTIVITY_MAX_MOVE_BPS="$MAX_MOVE_BPS"
    echo "taker             $TAKER (keystore account $ACCOUNT)"
    echo "order             $cmd $size $unit ($amount base units in), router quote $quoted out, floor $min_out"
    echo "bounds            spread <= $MAX_SPREAD_BPS bps, mid move <= $MAX_MOVE_BPS bps, max $hard $unit"
    script="script/MarketActivity.s.sol:MarketActivity"
    sim=(forge script "$script" --rpc-url "$RPC_URL" --sender "$TAKER" "${fees[@]}" -vvv)
    send=(forge script "$script" --rpc-url "$RPC_URL" --account "$ACCOUNT" --sender "$TAKER" "${fees[@]}" --broadcast --slow -vvv)

    if [[ "$DRY_RUN" == "1" ]]; then
      echo "dry run, nothing executed. The simulation would run:"
      echo "  ${sim[*]}"
      [[ "$mode" == "broadcast" ]] && echo "and, after you type BROADCAST, the broadcast would run:" && echo "  ${send[*]}"
      exit 0
    fi
    [[ -z "$FIXTURE" ]] || { echo "refusing: a fixture is set, which is for review and tests only" >&2; exit 1; }

    echo "--- simulation (nothing is sent; no key is needed or read) ---"
    "${sim[@]}"
    if [[ "$mode" == "simulate" ]]; then
      echo "simulation passed. To send it: $0 $cmd $size broadcast"
      exit 0
    fi
    echo "--- the simulation passed. This sends a real testnet transaction on a market the team owns. ---"
    echo "Disclose it: a trade here is not evidence of any strategy's skill (docs/testnet-market-activity.md)."
    read -r -p "type BROADCAST to send: " answer
    if [[ "$answer" != "BROADCAST" ]]; then
      echo "not confirmed, nothing sent"
      exit 1
    fi
    "${send[@]}"
    ;;

  *)
    usage
    ;;
esac
