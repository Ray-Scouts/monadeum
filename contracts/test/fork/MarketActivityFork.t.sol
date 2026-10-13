// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MarketActivity} from "../../script/MarketActivity.s.sol";
import {SeedWmonMarket} from "../../script/SeedWmonMarket.s.sol";
import {IErc20Min, IKuruOrderBook} from "../../script/KuruTestnet.sol";

/// Fork test of the taker script (script/MarketActivity.s.sol) against Kuru's real testnet router and the real
/// WMON/USDC market that the team created on 2026-10-13 (contracts/deployments/monad-testnet-wmon-market.json), plus
/// the "sweep, then reseed higher" sequence that docs/testnet-market-activity.md gives for a move a taker cannot make
/// alone.
///
/// Opt-in: it runs only when forge is pointed at Monad testnet, and skips otherwise. From contracts/:
///   forge test --match-path test/fork/MarketActivityFork.t.sol --fork-url "$MONAD_TESTNET_RPC_URL" -vv
/// The second test also needs the book as seeded (three asks of 15 WMON from 0.025242) and skips if agents or anyone
/// else have since moved it. Foundry's EVM is not Monad's client, so gas is not checked.
contract MarketActivityForkTest is Test {
    address internal constant ROUTER = 0x7EFbE105Ca7415dE98F96622173458ac1c054630;
    address internal constant MARKET = 0x46b66f84317941eC371E7791753f35653341aeBC;
    address internal constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    address internal constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    address internal constant DEPLOYER = 0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3;

    MarketActivity internal activity;

    function setUp() public {
        if (block.chainid != 10143) {
            vm.skip(true);
            return;
        }
        activity = new MarketActivity();
    }

    function inputs(bool buy, uint256 amount, uint256 minOut) internal pure returns (MarketActivity.Inputs memory i) {
        i.router = ROUTER;
        i.market = MARKET;
        i.base = WMON;
        i.quote = USDC;
        i.buy = buy;
        i.amount = amount;
        i.minOut = minOut;
        i.maxAmount = buy ? 2e6 : 100e18;
        i.maxSpreadBps = 200;
        i.maxMoveBps = 50;
    }

    /// Gives the script's default sender USDC from the deployer, which holds Circle's testnet USDC.
    function fund(uint256 usdc) internal {
        vm.prank(DEPLOYER);
        (bool ok,) = USDC.call(abi.encodeWithSignature("transfer(address,uint256)", DEFAULT_SENDER, usdc));
        assertTrue(ok);
    }

    function test_fork_checkAcceptsTheRealMarket() public view {
        activity.check(inputs(true, 378_631, 1));
    }

    function test_fork_buyThenSellThroughTheRealRouter() public {
        fund(2e6);
        (uint256 bid0, uint256 ask0) = IKuruOrderBook(MARKET).bestBidAsk();
        MarketActivity.Result memory buy = activity.execute(inputs(true, 378_631, 1));
        assertGt(buy.out, 0);
        assertEq(IErc20Min(WMON).balanceOf(DEFAULT_SENDER), buy.out);
        assertEq(buy.postBid, bid0, "a taker buy leaves the bid where it was");
        assertGe(buy.postAsk, ask0, "and never lowers the ask");
        // The sell side of the same script: the WMON just bought, sold back, rounded down to the size precision.
        uint256 sellAmount = buy.out / 1e8 * 1e8;
        MarketActivity.Result memory sell = activity.execute(inputs(false, sellAmount, 1));
        assertGt(sell.out, 0);
        assertLe(sell.postBid, buy.postBid, "a taker sell never raises the bid");
    }

    function test_fork_sweepThenReseedMovesTheMidPastTheEntryThreshold() public {
        (uint256 bid0, uint256 ask0) = IKuruOrderBook(MARKET).bestBidAsk();
        if (bid0 != 0.025116e18 || ask0 != 0.025242e18) {
            vm.skip(true);
            return;
        }
        uint256 mid0 = (bid0 + ask0) / 2;
        fund(2e6);
        // Step 1: the two-level sweep `market-activity.sh plan up 25` prints.
        MarketActivity.Result memory sweep = activity.execute(inputs(true, 758_206, 1));
        assertEq(sweep.postAsk, 0.025368e18, "one 15 WMON ask is left");
        // Step 2: reseed higher, as `wmon-market.sh seed` would, with the mid `plan up 48` prints (0.025406). The
        // seed's orders are post-only, so its first bid must sit under the remaining ask. The maker here is the script
        // default sender, funded with USDC and MON, standing in for the deployer.
        vm.deal(DEFAULT_SENDER, 100 ether);
        fund(2e6);
        vm.setEnv("MONADEUM_KURU_ROUTER", vm.toString(ROUTER));
        vm.setEnv("MONADEUM_WMON_MARKET", vm.toString(MARKET));
        vm.setEnv("MONADEUM_MARKET_BASE", vm.toString(WMON));
        vm.setEnv("MONADEUM_MARKET_QUOTE", vm.toString(USDC));
        vm.setEnv("MONADEUM_SEED_MID", vm.toString(uint256(0.025406e18)));
        vm.setEnv("MONADEUM_SEED_LEVELS", "3");
        vm.setEnv("MONADEUM_SEED_FIRST_OFFSET_BPS", "25");
        vm.setEnv("MONADEUM_SEED_STEP_BPS", "25");
        vm.setEnv("MONADEUM_SEED_BID_QUOTE_PER_LEVEL", "500000");
        vm.setEnv("MONADEUM_SEED_ASK_BASE_PER_LEVEL", vm.toString(uint256(15e18)));
        vm.setEnv("MONADEUM_SEED_MAX_SPREAD_BPS", "200");
        SeedWmonMarket seed = new SeedWmonMarket();
        SeedWmonMarket.Result memory r = seed.run();
        (uint256 bid1, uint256 ask1) = IKuruOrderBook(MARKET).bestBidAsk();
        assertEq(bid1, r.bid);
        assertEq(ask1, 0.025368e18, "the remaining ask is still the best");
        assertGt(bid1, 0.0253e18, "the new best bid sits just under it");
        uint256 mid1 = (bid1 + ask1) / 2;
        uint256 moveBps = (mid1 - mid0) * 10_000 / mid0;
        assertGt(moveBps, 48, "past the 48 bps a flat 24-tick window needs (24 x 0.0002)");
    }
}
