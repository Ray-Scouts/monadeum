#!/usr/bin/env bash
# Walks the mid of the testnet WMON/USDC market up in small steps, for end-to-end tests of the tick runner
# (ARCHITECTURE.md section 10, "Testnet market", test price walk). Monad testnet (chain 10143) only. Usage, from anywhere:
#
#   contracts/script/walk-mid.sh simulate    # computes the next step and eth_calls it from the deployer; sends nothing
#   contracts/script/walk-mid.sh broadcast   # asks for the keystore password once, then one batchUpdate per interval
#
# Each step is one batchUpdate from the deployer: it cancels every resting order the deployer owns on the market and
# places the same ladder as the seed (wmon-market.sh seed) around a mid STEP_BPS above the previous one. The funds
# come back from the cancelled orders, so a step wraps and deposits nothing; only gas is spent. The movement is ours,
# so the price, and any agent P&L on it, carries no economic meaning.
set -euo pipefail

mode="${1:-}"
if [[ "$mode" != "simulate" && "$mode" != "broadcast" ]]; then
  echo "usage: $0 simulate|broadcast" >&2
  exit 2
fi

RPC_URL="${MONAD_TESTNET_RPC_URL:-https://testnet-rpc.monad.xyz}"
ACCOUNT="${DEPLOYER_ACCOUNT:-monadeum-testnet-deployer}"
DEPLOYER="${DEPLOYER_ADDRESS:-0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3}"
MARKET="${MONADEUM_WMON_MARKET:-0x46b66f84317941eC371E7791753f35653341aeBC}"
MARGIN="${MONADEUM_KURU_MARGIN_ACCOUNT:-0xd029C2D98ff85D8F64799017fE00a59B1159CE02}"
USDC=0x534b2f3A21130d7a60830c2Df862319e593943A3
WMON=0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541

# Defaults: +3 bps a step every five minutes (one testnet tick), 24 steps, about +0.72 percent over two hours, above
# the conservative preset's 0.0002 per tick entry threshold. The ladder mirrors the seed's defaults.
STEP_BPS="${STEP_BPS:-3}"
STEPS="${STEPS:-24}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-300}"
LEVELS="${SEED_LEVELS:-3}"
FIRST_OFFSET_BPS="${SEED_FIRST_OFFSET_BPS:-25}"
LADDER_STEP_BPS="${SEED_STEP_BPS:-25}"
BID_QUOTE_PER_LEVEL="${BID_QUOTE_PER_LEVEL:-2000000}"   # USDC base units (2 USDC)
ASK_SIZE_PER_LEVEL="${ASK_SIZE_PER_LEVEL:-150000000000}" # size units (15 WMON at size precision 1e10)
MIN_MON_WEI="${MIN_MON_WEI:-300000000000000000}"         # stop below 0.3 MON

# The market's parameters (contracts/deployments/monad-testnet-wmon-market.json). Fixed at creation; checked below.
PRICE_PRECISION=100000000
SIZE_PRECISION=10000000000
TICK=100
MIN_SIZE=1000000000

num() { awk '{print $1}'; }   # strips cast's "[1.5e11]" annotation

[[ "$(cast chain-id --rpc-url "$RPC_URL")" == "10143" ]] || { echo "refusing: not Monad testnet" >&2; exit 1; }
params="$(cast call "$MARKET" "getMarketParams()(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)" --rpc-url "$RPC_URL" | num | tr '\n' ' ')"
read -r pp sp _ _ _ _ tick minsz _ <<<"$params"
if [[ "$pp" != "$PRICE_PRECISION" || "$sp" != "$SIZE_PRECISION" || "$tick" != "$TICK" || "$minsz" != "$MIN_SIZE" ]]; then
  echo "refusing: market parameters differ from the recorded ones: $params" >&2
  exit 1
fi

# The mid, in price units times 1000, from the current best bid and ask (1e18 scale).
read -r bid ask <<<"$(cast call "$MARKET" "bestBidAsk()(uint256,uint256)" --rpc-url "$RPC_URL" | num | tr '\n' ' ')"
if [[ ${#ask} -gt 30 || "$bid" == "0" ]]; then echo "refusing: the book is one-sided" >&2; exit 1; fi
mid1000=$(( (bid / 1000000 + ask / 1000000) / 2 / 10 ))

pwfile=""
cleanup() { [[ -n "$pwfile" ]] && rm -f "$pwfile" "$pwfile.receipt"; return 0; }
trap cleanup EXIT
if [[ "$mode" == "broadcast" ]]; then
  read -rsp "keystore password for $ACCOUNT: " pw; echo
  pwfile="$(mktemp)"; chmod 600 "$pwfile"; printf '%s' "$pw" >"$pwfile"; unset pw
fi

join() { local IFS=,; echo "[$*]"; }

step() {
  # The deployer's live orders, and the funds behind them plus what is free in the margin account.
  local n ids=() me quote base id o owner size price isbuy
  n="$(cast call "$MARKET" "s_orderIdCounter()(uint40)" --rpc-url "$RPC_URL" | num)"
  quote="$(cast call "$MARGIN" "getBalance(address,address)(uint256)" "$DEPLOYER" "$USDC" --rpc-url "$RPC_URL" | num)"
  # WMON wei to size units (1e18 / 1e10 = 1e8 wei each) by dropping eight digits, since wei can exceed bash's int64.
  base="$(cast call "$MARGIN" "getBalance(address,address)(uint256)" "$DEPLOYER" "$WMON" --rpc-url "$RPC_URL" | num)"
  if (( ${#base} > 8 )); then base=$(( 10#${base:0:${#base}-8} )); else base=0; fi
  me="$(echo "$DEPLOYER" | tr 'A-F' 'a-f')"
  for ((id = 1; id <= n; id++)); do
    o="$(cast call "$MARKET" "s_orders(uint40)(address,uint96,uint40,uint40,uint40,uint32,uint32,bool)" "$id" --rpc-url "$RPC_URL" | num | tr '\n' ' ')"
    read -r owner size _ _ _ price _ isbuy <<<"$o"
    [[ "$(echo "$owner" | tr 'A-F' 'a-f')" == "$me" && "$size" != "0" ]] || continue
    ids+=("$id")
    if [[ "$isbuy" == "true" ]]; then
      # A cancel refunds rounding down and a new bid is debited rounding up, so count the refund rounded down.
      quote=$(( quote + price * size / SIZE_PRECISION * 1000000 / PRICE_PRECISION ))
    else
      base=$(( base + size ))
    fi
  done

  mid1000=$(( mid1000 * (10000 + STEP_BPS) / 10000 ))
  # Two quote units a level stay free to absorb the rounding up on the new bids.
  local bq=$(( quote / LEVELS - 2 < BID_QUOTE_PER_LEVEL ? quote / LEVELS - 2 : BID_QUOTE_PER_LEVEL ))
  local as=$(( base / LEVELS < ASK_SIZE_PER_LEVEL ? base / LEVELS : ASK_SIZE_PER_LEVEL ))
  local bp=() bs=() ap=() asz=() i off raw
  for ((i = 0; i < LEVELS; i++)); do
    off=$(( FIRST_OFFSET_BPS + i * LADDER_STEP_BPS ))
    raw=$(( mid1000 * (10000 - off) / 10000000 ))
    bp+=($(( raw / TICK * TICK )))
    raw=$(( (mid1000 * (10000 + off) + 9999999) / 10000000 ))
    ap+=($(( (raw + TICK - 1) / TICK * TICK )))
    bs+=($(( bq * (SIZE_PRECISION / 1000000) * PRICE_PRECISION / bp[i] )))
    asz+=("$as")
    if (( bs[i] < MIN_SIZE || asz[i] < MIN_SIZE )); then echo "refusing: an order is below minSize (funds: $quote USDC units, $base size units)" >&2; return 1; fi
  done
  if (( bp[0] >= ap[0] )); then echo "refusing: bid and ask cross" >&2; return 1; fi

  local args=("$(join "${bp[@]}")" "$(join "${bs[@]}")" "$(join "${ap[@]}")" "$(join "${asz[@]}")" "$(join ${ids[@]+"${ids[@]}"})" true)
  local sig="batchUpdate(uint32[],uint96[],uint32[],uint96[],uint40[],bool)"
  echo "mid $(awk -v m="$mid1000" -v p="$PRICE_PRECISION" 'BEGIN { printf "%.6f", m / 1000 / p }') USDC per WMON, bids ${bp[*]}, asks ${ap[*]}, cancel ${ids[*]+"${ids[*]}"}"
  # set -e does not apply inside a function called with ||, so every chain call checks its own status.
  cast call "$MARKET" "$sig" "${args[@]}" --from "$DEPLOYER" --rpc-url "$RPC_URL" >/dev/null || { echo "refusing: eth_call of the step reverted" >&2; return 1; }
  if [[ "$mode" == "simulate" ]]; then
    echo "eth_call succeeded, estimated gas $(cast estimate "$MARKET" "$sig" "${args[@]}" --from "$DEPLOYER" --rpc-url "$RPC_URL"); nothing sent"
    return 0
  fi

  cast send "$MARKET" "$sig" "${args[@]}" --keystore "$HOME/.foundry/keystores/$ACCOUNT" --password-file "$pwfile" \
    --gas-price 110gwei --priority-gas-price 2gwei --rpc-url "$RPC_URL" --json >"$pwfile.receipt" || { echo "send failed" >&2; return 1; }
  jq -r '"sent \(.transactionHash) block \(.blockNumber) status \(.status) gas \(.gasUsed)"' "$pwfile.receipt"  # cast prints hex quantities
  [[ "$(jq -r .status "$pwfile.receipt")" == "0x1" ]] || { echo "the step reverted on chain" >&2; return 1; }
  echo "book now: $(cast call "$MARKET" "bestBidAsk()(uint256,uint256)" --rpc-url "$RPC_URL" | num | tr '\n' ' ')"
}

if [[ "$mode" == "simulate" ]]; then
  step || exit 1
  exit 0
fi
[[ "$mode" == "broadcast" && -s "$pwfile" ]] || { echo "refusing: no keystore password" >&2; exit 1; }
for ((k = 1; k <= STEPS; k++)); do
  if (( $(cast balance "$DEPLOYER" --rpc-url "$RPC_URL") < MIN_MON_WEI )); then echo "stopping: deployer below the MON reserve"; break; fi
  echo "step $k of $STEPS, $(date -u +%FT%TZ)"
  step || exit 1
  (( k < STEPS )) && sleep "$INTERVAL_SECONDS"
done
