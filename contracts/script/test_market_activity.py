"""Tests of contracts/script/market_activity.py against the book read on Monad testnet on 2026-10-13 (block 70625847).

Run from the repository root: python3 -m unittest discover -s contracts/script -p 'test_*.py'
"""

import re
import unittest
from pathlib import Path

import market_activity as m

HERE = Path(__file__).resolve().parent
PRESET = HERE.parent.parent / "libs" / "strategy" / "src" / "presets.ts"
FIXTURE = HERE / "fixtures" / "wmon-book-2026-10-13.env"
BID, ASK = 25116000000000000, 25242000000000000
P = m.Params()


def book() -> m.Book:
    l2 = re.search(r"^L2=(0x[0-9a-f]+)$", FIXTURE.read_text(), re.M).group(1)
    return m.decode_l2(l2)


class DecodeTest(unittest.TestCase):
    def test_decodes_the_seeded_ladder(self):
        b = book()
        self.assertEqual(b.block, 70625847)
        self.assertEqual([lv.price for lv in b.bids], [2511600, 2505300, 2499000])
        self.assertEqual([lv.price for lv in b.asks], [2524200, 2530500, 2536800])
        self.assertEqual([lv.size for lv in b.asks], [150_000_000_000] * 3)  # 15 WMON each at size precision 1e10
        # The decoded best prices are the ones bestBidAsk reports, at the 1e18 scale.
        self.assertEqual(m.to_scale(b.bids[0].price, P), BID)
        self.assertEqual(m.to_scale(b.asks[0].price, P), ASK)

    def test_empty_side_and_malformed(self):
        self.assertEqual(m.decode_l2("0x" + "00" * 31 + "07" + "00" * 32), m.Book(7, (), ()))
        with self.assertRaises(ValueError):
            m.decode_l2("0x1234")

    def test_depth_values(self):
        lv = book().asks[0]
        self.assertEqual(m.base_value(lv, P), 15 * 10**18)
        self.assertEqual(m.quote_value(lv, P), 378630)  # 15 x 0.025242 = 0.37863 USDC


class PresetTest(unittest.TestCase):
    def test_reads_the_conservative_preset(self):
        p = m.read_preset(PRESET)
        self.assertEqual(p["timeHorizon"], 24)
        self.assertEqual(p["executionFrequency"], 24)
        self.assertEqual(p["entryThreshold"], 0.0002)

    def test_rejects_a_file_without_the_preset(self):
        tmp = HERE / "fixtures" / "no-preset.ts"
        tmp.write_text("export const x = 1;\n")
        try:
            with self.assertRaises(ValueError):
                m.read_preset(tmp)
        finally:
            tmp.unlink()


class SignalTest(unittest.TestCase):
    """The same arithmetic as apps/worker/src/market.ts `KuruMidSignal.read` over a window of 25 mids."""

    def test_flat_window_is_below_the_threshold(self):
        mid = m.mid_of(BID, ASK)
        self.assertAlmostEqual(m.signal([mid] * 25, 24, 0.0002), -0.0002, places=12)

    def test_needs_a_whole_window(self):
        self.assertIsNone(m.signal([m.mid_of(BID, ASK)] * 24, 24, 0.0002))

    def test_single_step_threshold_is_48_bps(self):
        self.assertAlmostEqual(m.min_single_step_return(24, 0.0002), 0.0048, places=12)
        mid = 10**16 * 2  # 0.02
        just_under = mid + mid * 47 // 10_000
        just_over = mid + mid * 49 // 10_000
        self.assertLess(m.signal([mid] * 24 + [just_under], 24, 0.0002), 0)
        self.assertGreater(m.signal([mid] * 24 + [just_over], 24, 0.0002), 0)

    def test_two_steps_add_up(self):
        mid = 2 * 10**16
        step = mid * 25 // 10_000
        series = [mid] * 23 + [mid + step, mid + 2 * step]  # two 25 bps steps, 50 bps in all
        self.assertGreater(m.signal(series, 24, 0.0002), 0)

    def test_only_the_last_window_counts(self):
        mid = 2 * 10**16
        old_jump = [mid, mid * 2] + [mid * 2] * 30  # a jump that has left the 25-mid window
        self.assertAlmostEqual(m.signal(old_jump, 24, 0.0002), -0.0002, places=12)


class PlanTest(unittest.TestCase):
    def plan(self, direction, bps):
        return m.plan_move(direction, bps, BID, ASK, book(), P)

    def test_small_up_move_sweeps_one_ask(self):
        pl = self.plan("up", 12)
        self.assertTrue(pl.reachable)
        self.assertEqual((pl.side, pl.levels_taken), ("buy", 1))
        self.assertEqual(pl.amount, 378_631)  # the first ask's 0.37863 USDC, one base unit over
        self.assertEqual(pl.post_ask, 25305000000000000)
        self.assertAlmostEqual(pl.achieved_bps, 12.5, places=1)

    def test_up_25_sweeps_two_asks_and_is_the_most_a_taker_can_do(self):
        pl = self.plan("up", 25)
        self.assertTrue(pl.reachable)
        self.assertEqual(pl.levels_taken, 2)
        self.assertEqual(pl.post_ask, 25368000000000000)
        self.assertAlmostEqual(pl.max_reachable_bps, 25.0, places=1)

    def test_one_more_bp_than_a_taker_can_move_is_unreachable(self):
        pl = self.plan("up", 26)
        self.assertFalse(pl.reachable)
        self.assertEqual(pl.amount, 0)
        self.assertIn("one-sided", pl.note)

    def test_the_entry_threshold_is_out_of_reach_of_a_taker_alone(self):
        self.assertFalse(self.plan("up", 48).reachable)

    def test_down_move_sweeps_a_bid_and_a_sell_is_in_base_units(self):
        pl = self.plan("down", 12)
        self.assertTrue(pl.reachable)
        self.assertEqual((pl.side, pl.levels_taken), ("sell", 1))
        self.assertEqual(pl.amount, m.base_value(book().bids[0], P))
        self.assertEqual(pl.post_bid, 25053000000000000)
        self.assertLess(pl.achieved_bps, 0)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            m.plan_move("sideways", 10, BID, ASK, book(), P)
        with self.assertRaises(ValueError):
            m.plan_move("up", 0, BID, ASK, book(), P)

    def test_mock_book_with_deeper_asks_reaches_the_threshold(self):
        # A mock book with an ask 60 bps above the best: a taker can then clear the 48 bps threshold in one step.
        deep = m.Book(
            1,
            (m.Level(2511600, 10**11),),
            (m.Level(2524200, 10**10), m.Level(2524200 + 2524200 * 120 // 10_000, 10**10)),
        )
        pl = m.plan_move("up", 48, BID, ASK, deep, P)
        self.assertTrue(pl.reachable)
        self.assertGreaterEqual(pl.achieved_bps, 48)

    def test_assisted_hint_is_below_the_remaining_ask(self):
        hint = m.assisted_hint(book(), BID, ASK, P)
        self.assertIn("SEED_MID_USDC=0.025406", hint)
        self.assertIn("+70.0 bps", hint)


class MidsFileTest(unittest.TestCase):
    def test_parses_decimals_and_scaled_integers(self):
        tmp = HERE / "fixtures" / "mids.tmp"
        tmp.write_text("# comment\n1 0.025179\n2 25179000000000000\n")
        try:
            self.assertEqual(m.parse_mids(tmp), [25179000000000000, 25179000000000000])
        finally:
            tmp.unlink()


if __name__ == "__main__":
    unittest.main()
