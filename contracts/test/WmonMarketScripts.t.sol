// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SeedWmonMarket} from "../script/SeedWmonMarket.s.sol";

/// Offline checks of the seed ladder (script/SeedWmonMarket.s.sol) against the market parameters the create script
/// uses: price precision 1e8, size precision 1e10, tick 100, minSize 1e9, maxSize 2e18, 18 and 6 decimals. The full
/// create, seed, buy, and close path runs on a fork in test/fork/WmonMarketFork.t.sol.
contract WmonMarketScriptsTest is Test {
    SeedWmonMarket internal seed;

    function setUp() public {
        seed = new SeedWmonMarket();
    }

    function market() internal pure returns (SeedWmonMarket.Market memory) {
        return SeedWmonMarket.Market({
            pricePrecision: 1e8,
            sizePrecision: 1e10,
            baseDecimals: 18,
            quoteDecimals: 6,
            tickSize: 100,
            minSize: 1e9,
            maxSize: 2e18
        });
    }

    /// The wrapper's defaults: mid 0.026904, three levels 25 bps apart from 25 bps out, 2 USDC and 15 WMON a level.
    function defaults() internal pure returns (SeedWmonMarket.Inputs memory i) {
        i.mid = 0.026904e18;
        i.levels = 3;
        i.firstOffsetBps = 25;
        i.stepBps = 25;
        i.bidQuotePerLevel = 2e6;
        i.askBasePerLevel = 15e18;
        i.maxSpreadBps = 200;
    }

    function test_defaultLadder() public view {
        SeedWmonMarket.Ladder memory l = seed.build(defaults(), market());
        // 0.026904 * (1 - 0.0025) = 0.02683674, rounded down to the 0.000001 tick; the ask rounds up.
        assertEq(l.bidPrices[0], 2_683_600);
        assertEq(l.askPrices[0], 2_697_200);
        assertEq(l.bidPrices[2], 2_670_200);
        assertEq(l.askPrices[2], 2_710_600);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(l.askSizes[i], 15e10, "15 WMON at size precision 1e10");
            assertGe(l.bidSizes[i], 1e9);
        }
        assertEq(l.baseNeeded, 45e18);
        assertLe(l.quoteNeeded, 6e6, "the bids never need more than the configured quote");
        assertGe(l.quoteNeeded, 6e6 - 3, "and lose at most a base unit a level to rounding");
        // Inner spread: 50 bps of the mid, inside the MON price source's 200 bps limit.
        uint256 spread = (uint256(l.askPrices[0]) - l.bidPrices[0]) * 10_000 / 2_690_400;
        assertEq(spread, 50);
    }

    function test_refusesOrdersBelowMinSize() public {
        SeedWmonMarket.Inputs memory i = defaults();
        i.askBasePerLevel = 0.05e18; // below 0.1 WMON
        vm.expectRevert(abi.encodeWithSelector(SeedWmonMarket.BadLadder.selector, "order below the market's minSize"));
        seed.build(i, market());
    }

    function test_refusesLevelsThatRoundToOneTick() public {
        SeedWmonMarket.Inputs memory i = defaults();
        i.stepBps = 0;
        vm.expectRevert(abi.encodeWithSelector(SeedWmonMarket.BadLadder.selector, "step must be positive"));
        seed.build(i, market());
        i.stepBps = 1;
        i.mid = 0.0001e18; // one bps of 0.0001 is below the 0.000001 tick
        vm.expectRevert(
            abi.encodeWithSelector(SeedWmonMarket.BadLadder.selector, "two levels round to one tick: widen the step")
        );
        seed.build(i, market());
    }

    function test_refusesBadShapes() public {
        SeedWmonMarket.Inputs memory i = defaults();
        i.levels = 0;
        vm.expectRevert(abi.encodeWithSelector(SeedWmonMarket.BadLadder.selector, "levels must be 1 to 20"));
        seed.build(i, market());
        i = defaults();
        i.firstOffsetBps = 0;
        vm.expectRevert(abi.encodeWithSelector(SeedWmonMarket.BadLadder.selector, "first offset must be positive"));
        seed.build(i, market());
        i = defaults();
        i.firstOffsetBps = 9_990;
        vm.expectRevert(abi.encodeWithSelector(SeedWmonMarket.BadLadder.selector, "offset too wide"));
        seed.build(i, market());
    }

    /// Whatever the inputs, a built ladder is strictly ordered, never crosses, and stays within the market's bounds.
    function testFuzz_ladderIsOrderedAndBounded(uint256 mid, uint8 levels, uint16 first, uint16 step, uint64 quote)
        public
        view
    {
        SeedWmonMarket.Inputs memory i = defaults();
        i.mid = bound(mid, 0.001e18, 40e18);
        i.levels = bound(levels, 1, 5);
        i.firstOffsetBps = bound(first, 5, 500);
        i.stepBps = bound(step, 5, 500);
        i.bidQuotePerLevel = bound(quote, 1e6, 100e6);
        try seed.build(i, market()) returns (SeedWmonMarket.Ladder memory l) {
            assertLt(l.bidPrices[0], l.askPrices[0]);
            for (uint256 k = 0; k < i.levels; k++) {
                assertEq(l.bidPrices[k] % 100, 0);
                assertEq(l.askPrices[k] % 100, 0);
                if (k > 0) {
                    assertLt(l.bidPrices[k], l.bidPrices[k - 1]);
                    assertGt(l.askPrices[k], l.askPrices[k - 1]);
                }
            }
            assertLe(l.quoteNeeded, i.bidQuotePerLevel * i.levels);
        } catch {}
    }
}
