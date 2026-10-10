#!/usr/bin/env bash
# Regenerates the coverage report in contracts/audit/coverage/ for the contracts in scope.
# Run from anywhere: bash contracts/audit/coverage.sh
# Requires Foundry (forge 1.8.5, the version CI pins). Test and mock files are excluded from the report.
set -euo pipefail

cd "$(dirname "$0")/.."
out="audit/coverage"
mkdir -p "$out"

forge coverage \
  --no-match-coverage '^(test|script)/' \
  --report summary \
  --report lcov \
  --report-file "$out/lcov.info" \
  | sed -n '/^Ran [0-9]* test suites/,$p' > "$out/summary.txt"

cat "$out/summary.txt"
