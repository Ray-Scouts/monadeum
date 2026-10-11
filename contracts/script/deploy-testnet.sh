#!/usr/bin/env bash
# Deploys AgentSpendPolicy, AgentReallocation, and X402PaymentValidator on Monad testnet (chain 10143) through
# script/DeployTestnet.s.sol. Usage, from anywhere:
#
#   contracts/script/deploy-testnet.sh simulate    # dry run against the testnet RPC; sends nothing, needs no key
#   contracts/script/deploy-testnet.sh broadcast   # sends the three deployments; Foundry prompts for the keystore password
#
# The deployer is a Foundry keystore account (`cast wallet import`), never a private key in a file or on the command
# line. Every value below can be overridden from the environment; the defaults are the decided testnet values
# (ARCHITECTURE.md sections 11 and 16.5, deploy/README.md).
set -euo pipefail

cd "$(dirname "$0")/.."

mode="${1:-}"
if [[ "$mode" != "simulate" && "$mode" != "broadcast" ]]; then
  echo "usage: $0 simulate|broadcast" >&2
  exit 2
fi

RPC_URL="${MONAD_TESTNET_RPC_URL:-https://testnet-rpc.monad.xyz}"
ACCOUNT="${DEPLOYER_ACCOUNT:-monadeum-testnet-deployer}"
DEPLOYER="${DEPLOYER_ADDRESS:-0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3}"
SAFE="0x9671dB7Ab4Afa09fe76402Ce127896b166029897"

export MONADEUM_SETTLEMENT_ASSET="${MONADEUM_SETTLEMENT_ASSET:-0x534b2f3A21130d7a60830c2Df862319e593943A3}"
export MONADEUM_SETTLEMENT_DECIMALS="${MONADEUM_SETTLEMENT_DECIMALS:-6}"
export MONADEUM_REALLOCATION_OPERATOR="${MONADEUM_REALLOCATION_OPERATOR:-$SAFE}"
export MONADEUM_REALLOCATION_ADMIN="${MONADEUM_REALLOCATION_ADMIN:-$SAFE}"
export MONADEUM_MIN_EVALUATION_INTERVAL="${MONADEUM_MIN_EVALUATION_INTERVAL:-36000}"
export MONADEUM_EXPECTED_DEPLOYER="$DEPLOYER"

chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$chain_id" != "10143" ]]; then
  echo "refusing: $RPC_URL reports chain id $chain_id, not Monad testnet (10143)" >&2
  exit 1
fi

echo "chain id          $chain_id"
echo "deployer          $DEPLOYER (keystore account $ACCOUNT)"
echo "deployer balance  $(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" --ether) MON, nonce $(cast nonce "$DEPLOYER" --rpc-url "$RPC_URL")"
echo "settlement asset  $MONADEUM_SETTLEMENT_ASSET ($MONADEUM_SETTLEMENT_DECIMALS decimals)"
echo "operator / admin  $MONADEUM_REALLOCATION_OPERATOR / $MONADEUM_REALLOCATION_ADMIN"
echo "min eval interval $MONADEUM_MIN_EVALUATION_INTERVAL s"

if [[ "$mode" == "simulate" ]]; then
  # --sender makes the dry run use the deployer's real nonce, so the predicted addresses are the ones a broadcast
  # gets if the deployer sends nothing else first. No key is needed or read.
  forge script script/DeployTestnet.s.sol:DeployTestnet --rpc-url "$RPC_URL" --sender "$DEPLOYER" -vvv
else
  # --slow waits for each deployment to be included before sending the next.
  forge script script/DeployTestnet.s.sol:DeployTestnet --rpc-url "$RPC_URL" --account "$ACCOUNT" --sender "$DEPLOYER" --broadcast --slow -vvv
fi
