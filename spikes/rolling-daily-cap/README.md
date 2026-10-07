# Spike: rolling daily cap on Monad testnet (issue #18)

Throwaway code. It answers one question and is not part of the workspace, CI, or any product package.

## Question

ZeroDev has no native rolling daily value cap (see the research comment on issue #18). The closest native combination is a call policy with a per-call cap `X` plus the reset rate limit policy at `N` UserOps per window. This spike checks, on Monad testnet, three things: whether that combination actually bounds spend at `N * X` per window, whether a batched UserOp breaks the bound, and how much can move inside any window-length span. The last one matters because the documented design in `ARCHITECTURE.md` section 16.3 needs a rolling window, and the reset rate limit is expected to be a fixed one.

## What it does

1. Derives a Kernel v3.1 account owned by `OWNER_PRIVATE_KEY`, with a fresh session key limited by call policy v0.0.4 (native transfers to the owner only, at most `CAP_PER_CALL_MON` each) and the reset rate limit (`RATE_LIMIT_COUNT` UserOps per `WINDOW_SECONDS`).
2. Funds the account from the owner up to `FUND_MON`. The account pays its own gas, so no paymaster policy is involved.
3. Runs three phases through the ZeroDev bundler. Every amount moved is measured as the recipient's on-chain balance change, and every time is a block timestamp, never the local clock. A window reset is detected by retrying one capped transfer every `POLL_SECONDS` until the chain accepts it, so the spike does not assume when a window starts.

| Phase | Steps | Expected |
|---|---|---|
| 1, batching | one transfer above the per-call cap, then one UserOp batching two capped transfers, then capped singles until one is rejected | above-cap: reject. Batch and singles: observed, not asserted. If the window moves more than `N * X`, batching breaks the bound |
| 2, per-window bound | after a reset, `N` capped singles, then one more | `N` ok, then reject |
| 3, boundary | after the next reset, wait half a window in chain time, spend `N`, then spend `N` again as soon as the following window resets | all ok on a fixed window. A rolling cap would reject the second burst |

Phase 1 runs in its own window, so a batch that consumes a rate-limit slot cannot distort the count in phase 2.

The script prints a markdown table ready to paste into issue #18, then one result line per question. It exits non-zero if any asserted step differs from its expectation. A step marked `observe` never fails the run, because its outcome is the finding.

## Run

Requires Bun, a ZeroDev project with Monad testnet enabled, and a testnet-only key holding a small amount of testnet MON.

```bash
cp .env.example .env
bun install
bun run typecheck
bun run start
```

The default run takes about eight to ten minutes, because it waits out several 120 second windows. `.env` is gitignored. Never put a key that holds mainnet assets in it.

## Known limits

- Native MON only. An ERC20 cap through call policy argument rules is not exercised.
- The reset rate limit is not deployed on Monad mainnet as of 2026-09-27, so a passing result here is a testnet result only.
- Phase 3 assumes a window opens no later than the first operation it accepts. If a window is anchored earlier, the late burst may be rejected; that shows as UNEXPECTED and is itself a result to record.
- The window used here is minutes, not 86400 seconds. The spike tests the mechanism, not a day-long run.
- The session key lives in memory for one run. Revocation is covered by issue #19, not here.
