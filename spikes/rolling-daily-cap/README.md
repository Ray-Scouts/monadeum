# Spike: rolling daily cap on Monad testnet (issue #18)

Throwaway code. It answers one question and is not part of the workspace, CI, or any product package.

## Question

ZeroDev has no native rolling daily value cap (see the research comment on issue #18). The closest native combination is a call policy with a per-call cap `X` plus the reset rate limit policy at `N` UserOps per window. This spike checks, on Monad testnet, whether that combination actually bounds spend at `N * X` per window, and whether a batched UserOp breaks the bound.

## What it does

1. Derives a Kernel v3.1 account owned by `OWNER_PRIVATE_KEY`, with a fresh session key limited by call policy v0.0.4 (native transfers to the owner only, at most `CAP_PER_CALL_MON` each) and the reset rate limit (`RATE_LIMIT_COUNT` UserOps per `WINDOW_SECONDS`).
2. Funds the account from the owner up to `FUND_MON`. The account pays its own gas, so no paymaster policy is involved.
3. Runs these steps through the ZeroDev bundler and records each outcome:

| Step | Expected |
|---|---|
| single transfer above the per-call cap | reject |
| one UserOp batching two capped transfers | reject, if it succeeds the bound is `N * batch * X`, not `N * X` |
| `N` capped single transfers | ok |
| one more inside the same window | reject |
| one more after the window resets | ok |

The script prints a markdown table ready to paste into issue #18 and exits non-zero if any step differs from the expectation.

## Run

Requires Bun, a ZeroDev project with Monad testnet enabled, and a testnet-only key holding a small amount of testnet MON.

```bash
cp .env.example .env
bun install
bun run typecheck
bun run start
```

The default run takes about two minutes because it waits out one window. `.env` is gitignored. Never put a key that holds mainnet assets in it.

## Known limits

- Native MON only. An ERC20 cap through call policy argument rules is not exercised.
- The reset rate limit is not deployed on Monad mainnet as of 2026-09-27, so a passing result here is a testnet result only.
- The session key lives in memory for one run. Revocation is covered by issue #19, not here.
