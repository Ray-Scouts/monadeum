#!/usr/bin/env python3
"""Pure arithmetic behind contracts/script/market-activity.sh (docs/testnet-market-activity.md). No network, no keys.

The shell script reads the chain with `cast` and hands the raw values here:

- the best bid and ask, at Kuru's `bestBidAsk` scale (quote per base, times 1e18);
- the `getL2Book()` bytes, decoded as Kuru's TypeScript SDK 0.0.95 decodes them (`OrderBook.getL2OrderBook`): a block
  number word, then (price, size) words for each bid best first, a zero word, then (price, size) words for each ask best
  first. Prices are at the market's price precision and sizes at its size precision;
- the strategy parameters, read from libs/strategy/src/presets.ts so the numbers cannot drift from the preset.

The strategy's trigger is the one apps/worker/src/market.ts (`KuruMidSignal.read`) computes: the mean of the last
`timeHorizon` per-tick mid returns minus `entryThreshold`; the agent goes long when that is above 0.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SCALE = 10**18
BPS = 10_000
EMPTY_ASK = 2**256 - 1


@dataclass(frozen=True)
class Params:
    """The market's fixed parameters (contracts/deployments/monad-testnet-wmon-market.json)."""

    price_precision: int = 10**8
    size_precision: int = 10**10
    base_decimals: int = 18
    quote_decimals: int = 6
    tick_size: int = 100


@dataclass(frozen=True)
class Level:
    price: int  # price precision units
    size: int  # size precision units


@dataclass(frozen=True)
class Book:
    block: int
    bids: tuple[Level, ...]  # best (highest) first
    asks: tuple[Level, ...]  # best (lowest) first


def decode_l2(data: str) -> Book:
    h = data[2:] if data.startswith("0x") else data
    if len(h) % 64 != 0 or len(h) < 64:
        raise ValueError("getL2Book data is not a whole number of 32-byte words")
    words = [int(h[i : i + 64], 16) for i in range(0, len(h), 64)]
    block, i = words[0], 1
    sides: list[list[Level]] = [[], []]
    for side in sides:
        while i < len(words):
            price = words[i]
            i += 1
            if price == 0:
                break
            if i >= len(words):
                raise ValueError("getL2Book data ends inside a level")
            side.append(Level(price, words[i]))
            i += 1
    return Book(block, tuple(sides[0]), tuple(sides[1]))


def to_scale(price: int, p: Params) -> int:
    """A price precision price at the 1e18 scale of `bestBidAsk`."""
    return price * SCALE // p.price_precision


def mid_of(bid: int, ask: int) -> int:
    return (bid + ask) // 2


def spread_bps(bid: int, ask: int) -> int:
    return (ask - bid) * BPS // mid_of(bid, ask)


def quote_value(level: Level, p: Params) -> int:
    """The quote base units (USDC, 6 decimals) behind a level, rounded up."""
    num = level.price * level.size * 10**p.quote_decimals
    den = p.price_precision * p.size_precision
    return -(-num // den)


def base_value(level: Level, p: Params) -> int:
    """The base base units (WMON wei) at a level."""
    return level.size * 10**p.base_decimals // p.size_precision


# ---------------------------------------------------------------------------------------------------------------------
# The strategy's trigger
# ---------------------------------------------------------------------------------------------------------------------


def read_preset(path: Path) -> dict[str, float]:
    """timeHorizon, executionFrequency, entryThreshold of the `conservative` preset, parsed from presets.ts."""
    text = path.read_text()
    block = re.search(r"const conservative: GenomePreset = Object\.freeze\(\{(.*?)\}\);", text, re.S)
    if not block:
        raise ValueError("the conservative preset was not found in presets.ts")
    out: dict[str, float] = {}
    for key in ("timeHorizon", "executionFrequency", "entryThreshold", "exitThreshold", "riskTolerance"):
        m = re.search(rf"\b{key}:\s*([0-9.]+)", block.group(1))
        if not m:
            raise ValueError(f"{key} not found in the conservative preset")
        out[key] = float(m.group(1))
    return out


def tick_return(before: int, after: int) -> float:
    """KuruMidSignal's return at 1e18 precision in integers first (truncating division, as BigInt does)."""
    diff = (after - before) * SCALE
    q = abs(diff) // before
    return (q if diff >= 0 else -q) / SCALE / 1.0


def signal(mids: list[int], horizon: int, entry: float) -> float | None:
    """The trailing mean of the last `horizon` returns over `horizon + 1` consecutive tick mids, minus the entry threshold.
    None when fewer than horizon + 1 mids are given, which is when the worker takes no action."""
    if len(mids) < horizon + 1:
        return None
    window = mids[-(horizon + 1) :]
    s = sum(tick_return(window[i - 1], window[i]) for i in range(1, len(window)))
    return s / horizon - entry


def min_single_step_return(horizon: int, entry: float) -> float:
    """On an otherwise flat window, the smallest one-tick mid return that makes the signal positive: horizon * entry."""
    return horizon * entry


# ---------------------------------------------------------------------------------------------------------------------
# Sizing a taker order
# ---------------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Plan:
    direction: str  # "up" (a buy) or "down" (a sell)
    target_bps: int
    reachable: bool
    side: str  # "buy" or "sell"
    amount: int  # quote base units for a buy, base base units for a sell, 0 when no order helps
    levels_taken: int
    post_bid: int
    post_ask: int
    post_mid: int
    achieved_bps: float  # signed change of the mid
    max_reachable_bps: float  # the largest move that leaves the book two-sided, signed
    note: str


def _bps_change(new: int, old: int) -> float:
    return (new - old) * BPS / old


def plan_move(direction: str, bps: int, bid: int, ask: int, book: Book, p: Params) -> Plan:
    """The smallest taker order that moves the mid by at least `bps` basis points and leaves the book two-sided.

    A buy takes asks, so the bid does not move and the mid moves by half of the best ask's move. An order sweeps whole
    levels to change the best price, so the smallest order is the cost of every level cheaper than the target ask:
    anything less leaves the best ask where it is. A sell is the mirror image on the bids. The order is rounded up by one
    base unit; any extra fills the next level and does not move the best price. The result is a plan to verify with the
    router's quote and a simulation, not a promise."""
    if direction not in ("up", "down") or bps <= 0:
        raise ValueError("direction must be up or down and bps positive")
    m0 = mid_of(bid, ask)
    if direction == "up":
        levels = [(to_scale(lv.price, p), lv) for lv in book.asks]
        target_other = 2 * (m0 * (BPS + bps) // BPS) - bid  # the best ask that puts the mid at the target
        side, take_value = "buy", lambda lv: quote_value(lv, p)
        remaining_better = lambda price: price >= target_other  # noqa: E731
    else:
        levels = [(to_scale(lv.price, p), lv) for lv in book.bids]
        target_other = 2 * (-(-m0 * (BPS - bps) // BPS)) - ask  # the best bid that puts the mid at the target
        side, take_value = "sell", lambda lv: base_value(lv, p)
        remaining_better = lambda price: price <= target_other  # noqa: E731

    taken = 0
    amount = 0
    # The largest move that keeps the other side of the level list alive: take every level but the last.
    for idx, (price, lv) in enumerate(levels):
        if remaining_better(price):
            post_other = price
            break
        taken += 1
        amount += take_value(lv)
    else:
        post_other = None

    def mid_after(other: int) -> int:
        return mid_of(bid, other) if direction == "up" else mid_of(other, ask)

    if len(levels) >= 1:
        last_other = levels[-1][0]
        max_move = _bps_change(mid_after(last_other), m0)
    else:
        max_move = 0.0

    if post_other is None:
        note = (
            f"unreachable with one taker order: the {side} side holds {len(levels)} level(s) and the last one "
            f"leaves the mid at {max_move:+.1f} bps; sweeping it as well empties the side and the book is one-sided, "
            "which the signal and TradingModule both refuse"
        )
        return Plan(direction, bps, False, side, 0, 0, bid, ask, m0, 0.0, max_move, note)

    post_bid, post_ask = (bid, post_other) if direction == "up" else (post_other, ask)
    achieved = _bps_change(mid_of(post_bid, post_ask), m0)
    # A buy is one quote base unit over, so rounding in the matching engine cannot leave a dust order on the best level;
    # the extra fills the next level and does not move the best price. A sell is exact: the sizes are whole size units.
    amount = amount + (1 if side == "buy" else 0) if taken else 0
    return Plan(direction, bps, True, side, amount, taken, post_bid, post_ask, mid_of(post_bid, post_ask), achieved, max_move, "")


def assisted_hint(book: Book, bid: int, ask: int, p: Params, first_offset_bps: int = 25) -> str:
    """For an up move a taker cannot reach: sweep every ask but the last, then reseed (`wmon-market.sh seed`) at a higher mid.
    The reseed's orders are post-only, so its first bid must sit strictly below the remaining best ask. The mid is
    therefore capped at remaining_ask / (1 - offset), less 10 bps of margin for the tick rounding. This is arithmetic
    on the book as read, not a simulation, and the seed's own preflight and `seed simulate` are the check."""
    if len(book.asks) < 2:
        return "the book has fewer than two ask levels: a reseed alone is the way to move the mid"
    remaining = to_scale(book.asks[-1].price, p)
    seed_mid = remaining * (BPS - 10) // (BPS - first_offset_bps)  # 10 bps under the crossing point
    new_bid = seed_mid * (BPS - first_offset_bps) // BPS
    new_mid = mid_of(new_bid, remaining)
    return (
        f"sweep the first {len(book.asks) - 1} ask level(s), then reseed with SEED_MID_USDC={seed_mid / SCALE:.6f} "
        f"(first offset {first_offset_bps} bps): the best bid would be about {fmt_price(new_bid)} under the remaining "
        f"ask {fmt_price(remaining)}, so the mid would be about {fmt_price(new_mid)} ({_bps_change(new_mid, mid_of(bid, ask)):+.1f} bps)"
    )


# ---------------------------------------------------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------------------------------------------------


def fmt_price(scaled: int) -> str:
    return f"{scaled / SCALE:.6f}"


def render_depth(book: Book, p: Params) -> list[str]:
    out = []
    for name, levels in (("bids (best first)", book.bids), ("asks (best first)", book.asks)):
        out.append(f"  {name}")
        cum_q = cum_b = 0
        for lv in levels:
            q, b = quote_value(lv, p), base_value(lv, p)
            cum_q += q
            cum_b += b
            out.append(
                f"    {fmt_price(to_scale(lv.price, p))}  {b / 10**p.base_decimals:>10.4f} WMON  "
                f"{q / 10**p.quote_decimals:>8.4f} USDC  cumulative {cum_b / 10**p.base_decimals:.4f} WMON, "
                f"{cum_q / 10**p.quote_decimals:.4f} USDC"
            )
        if not levels:
            out.append("    (empty)")
    return out


def parse_mids(path: Path) -> list[int]:
    """Lines of `tick mid` or just `mid`, oldest first, mid at the 1e18 scale or a decimal such as 0.025179."""
    mids = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        raw = line.split()[-1]
        mids.append(int(raw) if raw.isdigit() else int(round(float(raw) * SCALE)))
    return mids


def cmd_status(a: argparse.Namespace) -> int:
    p = Params()
    bid, ask = int(a.bid), int(a.ask)
    preset = read_preset(Path(a.preset))
    horizon, entry = int(preset["timeHorizon"]), preset["entryThreshold"]
    book = decode_l2(a.l2) if a.l2 else Book(0, (), ())
    print(f"best bid          {fmt_price(bid)} USDC per WMON")
    print(f"best ask          {fmt_price(ask) if ask != EMPTY_ASK else '(empty)'}")
    if bid == 0 or ask == EMPTY_ASK or bid >= ask:
        print("book              NOT two-sided and uncrossed: the worker records no mid and the strategy takes no action")
        return 0
    m0 = mid_of(bid, ask)
    print(f"mid               {fmt_price(m0)}  (the worker's definition, (bid + ask) / 2)")
    print(f"spread            {spread_bps(bid, ask)} bps (the worker refuses a spread above {a.max_spread_bps} bps)")
    print("depth")
    for line in render_depth(book, p):
        print(line)
    print("strategy (conservative preset, libs/strategy/src/presets.ts)")
    print(f"  timeHorizon        {horizon} ticks (the window holds {horizon + 1} consecutive tick mids)")
    print(f"  entryThreshold     {entry} mean return per tick, so the window must sum to {horizon * entry * BPS:.0f} bps")
    print(f"  executionFrequency {int(preset['executionFrequency'])} ticks between position changes")
    print(f"  tick               {a.tick_ms / 60000:g} minutes (WORKER_TICK_INTERVAL_MS={a.tick_ms}), window {horizon * a.tick_ms / 3_600_000:g} h")
    mids = parse_mids(Path(a.mids)) if a.mids else None
    if mids is not None:
        print(f"recorded mids     {len(mids)} supplied; newest {fmt_price(mids[-1])}")
        cur = signal(mids, horizon, entry)
        if cur is None:
            print(f"  signal now      not computable, fewer than {horizon + 1} mids")
        else:
            print(f"  signal now      {cur:+.6f} ({'long' if cur > 0 else 'flat'})")
    else:
        print("recorded mids     not supplied. The worker keeps them in Postgres (market_mid_samples) and no public API serves them;")
        print("                  set MARKET_ACTIVITY_MIDS_FILE (see docs/testnet-market-activity.md). Assuming a flat window below.")
    if a.move:
        direction, bps = a.move.split(":")
        plan = plan_move(direction, int(bps), bid, ask, book, p)
        print(f"move to evaluate  {direction} {bps} bps")
        if not plan.reachable:
            print(f"  {plan.note}")
            moved_mid = None
        else:
            moved_mid = plan.post_mid
            print(f"  an order of the planned size gives mid {fmt_price(moved_mid)} ({plan.achieved_bps:+.1f} bps)")
        if moved_mid is not None:
            window = (mids if mids is not None else [m0] * (horizon + 1)) + [moved_mid]
            sig = signal(window, horizon, entry)
            assert sig is not None
            need = min_single_step_return(horizon, entry) * BPS
            verdict = "CROSSES the entry threshold: agents propose long" if sig > 0 else "does NOT cross the entry threshold: agents stay flat"
            print(f"  signal after    {sig:+.6f}, {verdict}")
            print(f"  a single-tick rise above {need:.0f} bps on a flat window is needed; this one is {plan.achieved_bps:+.1f} bps")
    return 0


def cmd_plan(a: argparse.Namespace) -> int:
    p = Params()
    book = decode_l2(a.l2)
    plan = plan_move(a.direction, int(a.bps), int(a.bid), int(a.ask), book, p)
    preset = read_preset(Path(a.preset))
    need = min_single_step_return(int(preset["timeHorizon"]), preset["entryThreshold"]) * BPS
    print(f"target            {a.direction} {a.bps} bps of mid")
    print(f"side              taker {plan.side}")
    print(f"max reachable     {plan.max_reachable_bps:+.1f} bps (leaves one level on the swept side)")
    if a.direction == "up":
        print(f"entry threshold   a single-tick rise above {need:.0f} bps on a flat window (timeHorizon x entryThreshold)")
    if not plan.reachable:
        print(f"RESULT            {plan.note}")
        if a.direction == "up":
            print(f"assisted          {assisted_hint(book, int(a.bid), int(a.ask), p)}")
        print("PLAN_AMOUNT=0")
        return 0
    unit = "USDC" if plan.side == "buy" else "WMON"
    dec = p.quote_decimals if plan.side == "buy" else p.base_decimals
    print(f"levels swept      {plan.levels_taken}")
    print(f"order             {plan.side} {plan.amount / 10**dec:.{min(dec, 8)}f} {unit}")
    print(f"expected book     bid {fmt_price(plan.post_bid)}  ask {fmt_price(plan.post_ask)}  mid {fmt_price(plan.post_mid)} ({plan.achieved_bps:+.1f} bps)")
    print(f"expected spread   {spread_bps(plan.post_bid, plan.post_ask)} bps")
    print(f"PLAN_AMOUNT={plan.amount}")
    print(f"PLAN_SIDE={plan.side}")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in (("status", cmd_status), ("plan", cmd_plan)):
        sp = sub.add_parser(name)
        sp.add_argument("--bid", required=True)
        sp.add_argument("--ask", required=True)
        sp.add_argument("--l2", default="")
        sp.add_argument("--preset", required=True)
        sp.set_defaults(fn=fn)
        if name == "status":
            sp.add_argument("--max-spread-bps", type=int, default=200)
            sp.add_argument("--tick-ms", type=int, default=300000)
            sp.add_argument("--mids", default="")
            sp.add_argument("--move", default="")
        else:
            sp.add_argument("direction", choices=["up", "down"])
            sp.add_argument("bps")
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
