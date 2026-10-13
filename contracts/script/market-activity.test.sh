#!/usr/bin/env bash
# Exercises contracts/script/market-activity.sh offline: every chain read is replaced by a recorded book
# (fixtures/wmon-book-2026-10-13.env) and nothing is sent. Run from anywhere: contracts/script/market-activity.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
sh="$here/market-activity.sh"
export MARKET_ACTIVITY_FIXTURE="$here/fixtures/wmon-book-2026-10-13.env"
failures=0

# expect <description> <expected exit code> <expected output substring> -- <command...>
expect() {
  local what="$1" code="$2" needle="$3"
  shift 4
  local out rc
  out="$("$@" 2>&1)"
  rc=$?
  if [[ "$rc" != "$code" ]]; then
    echo "FAIL  $what: exit $rc, wanted $code"
    echo "$out" | sed 's/^/        /'
    failures=$((failures + 1))
  elif [[ "$out" != *"$needle"* ]]; then
    echo "FAIL  $what: output lacks '$needle'"
    echo "$out" | sed 's/^/        /'
    failures=$((failures + 1))
  else
    echo "ok    $what"
  fi
}

expect "no subcommand prints usage" 2 "usage:" -- "$sh"
expect "unknown subcommand prints usage" 2 "usage:" -- "$sh" frobnicate
expect "status reads the fixture book" 0 "mid               0.025179" -- "$sh" status
expect "status names the preset's window" 0 "timeHorizon        24 ticks" -- "$sh" status
expect "status names the tick length from the deploy config" 0 "tick               5 minutes" -- "$sh" status
expect "status says the recorded mids are not public" 0 "no public API serves them" -- "$sh" status
expect "status of a 25 bps move stays flat" 0 "does NOT cross the entry threshold" -- "$sh" status up 25
expect "status rejects a bad direction" 2 "usage:" -- "$sh" status sideways 10
expect "plan up 12 sweeps one ask" 0 "buy 0.378631 USDC" -- "$sh" plan up 12
expect "plan prints the simulate command" 0 "market-activity.sh buy 0.378631 simulate" -- "$sh" plan up 12
expect "plan up 25 sweeps two asks" 0 "buy 0.758206 USDC" -- "$sh" plan up 25
expect "plan up 48 is unreachable by a taker" 0 "unreachable with one taker order" -- "$sh" plan up 48
expect "plan up 48 prints the assisted route" 0 "SEED_MID_USDC=0.025406" -- "$sh" plan up 48
expect "plan down 12 sells one bid level" 0 "sell 79.63051441 WMON" -- "$sh" plan down 12
expect "plan rejects zero bps" 2 "usage:" -- "$sh" plan up 0
expect "plan rejects a missing direction" 2 "usage:" -- "$sh" plan
expect "buy above the hard maximum is refused" 1 "above the maximum of 2 USDC" -- env MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 2.5 simulate
expect "sell above the hard maximum is refused" 1 "above the maximum of 100 WMON" -- env MARKET_ACTIVITY_DRY_RUN=1 "$sh" sell 100.5 simulate
expect "the maximum cannot be raised by the environment" 1 "above the hard maximum of 2 USDC" -- env MARKET_ACTIVITY_MAX_BUY_USDC=5 MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 3 simulate
expect "the maximum can be lowered" 1 "above the maximum of 0.1 USDC" -- env MARKET_ACTIVITY_MAX_BUY_USDC=0.1 MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 0.5 simulate
expect "a zero size is refused" 1 "rounds to zero" -- env MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 0.0000001 simulate
expect "a non-numeric size prints usage" 2 "usage:" -- env MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy lots simulate
expect "a missing mode prints usage" 2 "usage:" -- env MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 0.5
expect "dry run of a simulate prints the forge command" 0 "dry run, nothing executed" -- env MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 0.378631 simulate
expect "the simulation command carries no key and no broadcast" 0 "forge script script/MarketActivity.s.sol:MarketActivity --rpc-url" -- env MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 0.378631 simulate
expect "dry run of a broadcast shows the confirmation step" 0 "after you type BROADCAST" -- env MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 0.378631 broadcast
expect "the floor is the quote less the slippage bound" 0 "floor 14925038927086500000" -- env MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 0.378631 simulate
expect "a real run with a fixture set is refused" 1 "a fixture is set" -- "$sh" buy 0.378631 simulate

# The simulate command must never contain --broadcast or --account; the broadcast command must.
sim_cmd="$(MARKET_ACTIVITY_DRY_RUN=1 "$sh" buy 0.378631 broadcast 2>&1 | sed -n '/simulation would run/{n;p;}')"
if [[ "$sim_cmd" == *"--broadcast"* || "$sim_cmd" == *"--account"* ]]; then
  echo "FAIL  the simulation command sends or signs: $sim_cmd"
  failures=$((failures + 1))
else
  echo "ok    the simulation command neither signs nor broadcasts"
fi

if [[ "$failures" != 0 ]]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all market-activity.sh checks passed"
