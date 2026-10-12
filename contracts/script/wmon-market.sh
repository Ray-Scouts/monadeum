#!/usr/bin/env bash
# Creates and seeds the testnet WMON/USDC market on Kuru's documented testnet router (ARCHITECTURE.md section 10,
# TradingModule, "Testnet market"; deploy/README.md, step 2b). Monad testnet (chain 10143) only. Usage, from anywhere:
#
#   contracts/script/wmon-market.sh create simulate    # dry run of deployProxy; sends nothing, needs no key
#   contracts/script/wmon-market.sh create broadcast   # sends deployProxy; Foundry prompts for the keystore password
#   contracts/script/wmon-market.sh seed simulate      # dry run of wrap, deposits, and the order ladder
#   contracts/script/wmon-market.sh seed broadcast     # sends them
#
# `seed simulate` needs the market to exist on chain. Before `create broadcast`, it can only be simulated on a fork
# where the market was created first (deploy/README.md, step 2b, shows the anvil commands).
#
# The deployer is a Foundry keystore account (`cast wallet import`), never a private key in a file or on the command
# line. Every value below can be overridden from the environment; the defaults are the decided values.
set -euo pipefail

cd "$(dirname "$0")/.."

step="${1:-}"
mode="${2:-}"
if [[ "$step" != "create" && "$step" != "seed" ]] || [[ "$mode" != "simulate" && "$mode" != "broadcast" ]]; then
  echo "usage: $0 create|seed simulate|broadcast" >&2
  exit 2
fi

RPC_URL="${MONAD_TESTNET_RPC_URL:-https://testnet-rpc.monad.xyz}"
ACCOUNT="${DEPLOYER_ACCOUNT:-monadeum-testnet-deployer}"
DEPLOYER="${DEPLOYER_ADDRESS:-0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3}"
export MONADEUM_EXPECTED_DEPLOYER="$DEPLOYER"

# Kuru's documented testnet router, and the order-book implementation it deploys today, which the pinned SDK
# (kuru-sdk 0.0.95) decodes. FACT, on chain 2026-10-11 (docs/testnet-trading-options.md, section 2.3).
export MONADEUM_KURU_ROUTER="${MONADEUM_KURU_ROUTER:-0x7EFbE105Ca7415dE98F96622173458ac1c054630}"
export MONADEUM_KURU_ORDERBOOK_IMPLEMENTATION="${MONADEUM_KURU_ORDERBOOK_IMPLEMENTATION:-0x72caE0a99C19B574e8a6De558F43fc1D019c9374}"
# Base: Wrapped MON (Monad docs, testnet). Quote: the settlement asset, Circle's testnet USDC.
export MONADEUM_MARKET_BASE="${MONADEUM_MARKET_BASE:-0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541}"
export MONADEUM_MARKET_QUOTE="${MONADEUM_MARKET_QUOTE:-0x534b2f3A21130d7a60830c2Df862319e593943A3}"
export MONADEUM_MARKET_BASE_DECIMALS="${MONADEUM_MARKET_BASE_DECIMALS:-18}"
export MONADEUM_MARKET_QUOTE_DECIMALS="${MONADEUM_MARKET_QUOTE_DECIMALS:-6}"
# Market parameters (ARCHITECTURE.md section 10, "Testnet market", gives the reasoning). Everything but minSize mirrors
# Kuru's mainnet MON/USDC market as read on 2026-10-11: price precision 1e8, size precision 1e10, tick 100 (0.000001
# USDC), max size 2e18, fees 0. minSize is 1e9 size units (0.1 WMON) instead of 2e12 (200 MON) so a seed from a few
# MON is placeable; it binds resting limit orders only, not the router's market orders agents send. The AMM spread
# must be a nonzero multiple of 10 below 500; 10 is the smallest, and the vault stays empty.
export MONADEUM_MARKET_SIZE_PRECISION="${MONADEUM_MARKET_SIZE_PRECISION:-10000000000}"
export MONADEUM_MARKET_PRICE_PRECISION="${MONADEUM_MARKET_PRICE_PRECISION:-100000000}"
export MONADEUM_MARKET_TICK_SIZE="${MONADEUM_MARKET_TICK_SIZE:-100}"
export MONADEUM_MARKET_MIN_SIZE="${MONADEUM_MARKET_MIN_SIZE:-1000000000}"
export MONADEUM_MARKET_MAX_SIZE="${MONADEUM_MARKET_MAX_SIZE:-2000000000000000000}"
export MONADEUM_MARKET_TAKER_FEE_BPS="${MONADEUM_MARKET_TAKER_FEE_BPS:-0}"
export MONADEUM_MARKET_MAKER_FEE_BPS="${MONADEUM_MARKET_MAKER_FEE_BPS:-0}"
export MONADEUM_MARKET_AMM_SPREAD="${MONADEUM_MARKET_AMM_SPREAD:-10}"

chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$chain_id" != "10143" ]]; then
  echo "refusing: $RPC_URL reports chain id $chain_id, not Monad testnet (10143)" >&2
  exit 1
fi

echo "chain id          $chain_id"
echo "deployer          $DEPLOYER (keystore account $ACCOUNT)"
echo "deployer balance  $(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" --ether) MON, nonce $(cast nonce "$DEPLOYER" --rpc-url "$RPC_URL")"
echo "deployer USDC     $(cast call "$MONADEUM_MARKET_QUOTE" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC_URL") base units"
echo "router            $MONADEUM_KURU_ROUTER"

if [[ "$step" == "create" ]]; then
  script="script/CreateWmonMarket.s.sol:CreateWmonMarket"
else
  # The market: from the environment, else the committed record (contracts/deployments/monad-testnet-wmon-market.json).
  if [[ -z "${MONADEUM_WMON_MARKET:-}" ]]; then
    MONADEUM_WMON_MARKET="$(sed -n 's/.*"market": *"\(0x[0-9a-fA-F]\{40\}\)".*/\1/p' deployments/monad-testnet-wmon-market.json | head -1)"
  fi
  export MONADEUM_WMON_MARKET
  # The mid, USDC per MON. REFERENCE, not a measurement of any testnet price: the mid of Kuru's mainnet MON/USDC book
  # (0x065C9d28E428A0db40191a54d33d5b7c71a9C394) read on 2026-10-11, bid 0.026886 and ask 0.026922. Re-read it with:
  #   cast call 0x065C9d28E428A0db40191a54d33d5b7c71a9C394 "bestBidAsk()(uint256,uint256)" --rpc-url https://rpc.monad.xyz
  SEED_MID_USDC="${SEED_MID_USDC:-0.026904}"
  # Three levels a side, 25 bps from the mid and 25 bps apart: a 50 bps inner spread, inside the MON price source's
  # 200 bps limit. 2 USDC behind each bid (6 USDC of the deployer's 20). 15 WMON at each ask (45 WMON, about 1.2 USDC
  # at the reference mid), enough for one buy at the 1 USDC per-transaction cap; it needs that much MON to wrap.
  export MONADEUM_SEED_LEVELS="${SEED_LEVELS:-3}"
  export MONADEUM_SEED_FIRST_OFFSET_BPS="${SEED_FIRST_OFFSET_BPS:-25}"
  export MONADEUM_SEED_STEP_BPS="${SEED_STEP_BPS:-25}"
  export MONADEUM_SEED_MAX_SPREAD_BPS="${SEED_MAX_SPREAD_BPS:-200}"
  SEED_BID_USDC_PER_LEVEL="${SEED_BID_USDC_PER_LEVEL:-2}"
  SEED_ASK_WMON_PER_LEVEL="${SEED_ASK_WMON_PER_LEVEL:-15}"
  export MONADEUM_SEED_MID="$(cast parse-units "$SEED_MID_USDC" 18)"
  export MONADEUM_SEED_BID_QUOTE_PER_LEVEL="$(cast parse-units "$SEED_BID_USDC_PER_LEVEL" 6)"
  export MONADEUM_SEED_ASK_BASE_PER_LEVEL="$(cast parse-units "$SEED_ASK_WMON_PER_LEVEL" 18)"
  echo "market            $MONADEUM_WMON_MARKET"
  echo "mid (reference)   $SEED_MID_USDC USDC per WMON"
  echo "ladder            $MONADEUM_SEED_LEVELS levels, $MONADEUM_SEED_FIRST_OFFSET_BPS bps + $MONADEUM_SEED_STEP_BPS bps steps, $SEED_BID_USDC_PER_LEVEL USDC per bid, $SEED_ASK_WMON_PER_LEVEL WMON per ask"
  script="script/SeedWmonMarket.s.sol:SeedWmonMarket"
fi

# Fee caps. Forge's default max fee is about twice the base fee, and a node admits a transaction only if the sender
# holds gas limit times max fee: for deployProxy that is about 0.33 MON, more than the deployer holds. Monad's base
# fee read 100 gwei on 2026-10-11 and Monad charges the gas limit at the effective price, so a 110 gwei cap with a
# 2 gwei tip bounds deployProxy at about 0.18 MON. Raise GAS_PRICE_GWEI if the base fee has moved.
GAS_PRICE_GWEI="${GAS_PRICE_GWEI:-110}"
PRIORITY_GWEI="${PRIORITY_GWEI:-2}"
fees=(--with-gas-price "${GAS_PRICE_GWEI}gwei" --priority-gas-price "${PRIORITY_GWEI}gwei")

if [[ "$mode" == "simulate" ]]; then
  # --sender makes the dry run use the deployer's real balances and nonce. No key is needed or read.
  forge script "$script" --rpc-url "$RPC_URL" --sender "$DEPLOYER" "${fees[@]}" -vvv
else
  # --slow waits for each transaction to be included before sending the next.
  forge script "$script" --rpc-url "$RPC_URL" --account "$ACCOUNT" --sender "$DEPLOYER" "${fees[@]}" --broadcast --slow -vvv
fi
