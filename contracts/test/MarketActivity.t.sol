// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MarketActivity} from "../script/MarketActivity.s.sol";

/// A token with a balance and an approve that records the allowance, enough for the script's calls.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// A book whose best bid and ask the test sets, standing in for Kuru's order book.
contract MockMarket {
    uint256 public bid;
    uint256 public ask;

    function set(uint256 bid_, uint256 ask_) external {
        bid = bid_;
        ask = ask_;
    }

    function bestBidAsk() external view returns (uint256, uint256) {
        return (bid, ask);
    }
}

/// A router that records the swap it is asked for and moves the mock book to the configured post-trade prices.
contract MockRouter {
    MockMarket public immutable market;
    uint256 public postBid;
    uint256 public postAsk;
    uint256 public out;
    uint256 public lastAmount;
    uint256 public lastMinOut;
    bool public lastIsBuy;
    address public lastDebit;
    address public lastCredit;
    uint256 public calls;

    constructor(MockMarket market_) {
        market = market_;
    }

    function configure(uint256 postBid_, uint256 postAsk_, uint256 out_) external {
        postBid = postBid_;
        postAsk = postAsk_;
        out = out_;
    }

    function anyToAnySwap(
        address[] calldata markets,
        bool[] calldata isBuy,
        bool[] calldata nativeSend,
        address debit,
        address credit,
        uint256 amount,
        uint256 minOut
    ) external payable returns (uint256) {
        require(markets.length == 1 && markets[0] == address(market), "one hop on the market");
        require(isBuy.length == 1 && nativeSend.length == 1 && !nativeSend[0], "no native send");
        require(msg.value == 0, "no native value");
        require(out >= minOut, "below the floor");
        lastAmount = amount;
        lastMinOut = minOut;
        lastIsBuy = isBuy[0];
        lastDebit = debit;
        lastCredit = credit;
        calls += 1;
        market.set(postBid, postAsk);
        return out;
    }
}

/// Offline checks of the taker script (script/MarketActivity.s.sol): its size ceilings, its post-trade book bounds,
/// and, against a mock book and router, the exact two calls it makes. The real router path runs on a fork in
/// test/fork/MarketActivityFork.t.sol.
contract MarketActivityTest is Test {
    uint256 internal constant BID = 0.025116e18;
    uint256 internal constant ASK = 0.025242e18;

    MarketActivity internal script;
    MockToken internal usdc;
    MockToken internal wmon;
    MockMarket internal market;
    MockRouter internal router;

    function setUp() public {
        script = new MarketActivity();
        usdc = new MockToken();
        wmon = new MockToken();
        market = new MockMarket();
        router = new MockRouter(market);
        market.set(BID, ASK);
    }

    function inputs(bool buy, uint256 amount) internal view returns (MarketActivity.Inputs memory i) {
        i.router = address(router);
        i.market = address(market);
        i.base = address(wmon);
        i.quote = address(usdc);
        i.buy = buy;
        i.amount = amount;
        i.minOut = 1;
        i.maxAmount = buy ? 2e6 : 100e18;
        i.maxSpreadBps = 200;
        i.maxMoveBps = 50;
    }

    // ----- ceilings -----

    function test_amountCeilingsAreCompiledIn() public {
        script.checkAmount(true, 2e6, type(uint256).max);
        script.checkAmount(false, 100e18, type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.AmountRefused.selector, "above the hard maximum", 2e6 + 1, 2e6)
        );
        script.checkAmount(true, 2e6 + 1, type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.AmountRefused.selector, "above the hard maximum", 100e18 + 1, 100e18)
        );
        script.checkAmount(false, 100e18 + 1, type(uint256).max);
    }

    function test_configuredMaximumCanOnlyLowerTheCeiling() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.AmountRefused.selector, "above the configured maximum", 1e6, 0.5e6)
        );
        script.checkAmount(true, 1e6, 0.5e6);
        script.checkAmount(true, 0.5e6, 0.5e6);
    }

    function test_zeroAmountRefused() public {
        vm.expectRevert(abi.encodeWithSelector(MarketActivity.AmountRefused.selector, "amount is zero", 0, 2e6));
        script.checkAmount(true, 0, 2e6);
    }

    // ----- post-trade book bounds, with the live book of 2026-10-13 -----

    function test_acceptsASweepOfOneLevel() public view {
        // The plan for a 12 bps move: the best ask 0.025242 to 0.025305, the bid unchanged.
        (int256 move, uint256 spread) = script.checkBook(BID, ASK, BID, 0.025305e18, 200, 50);
        assertEq(move, 12, "mid 0.025179 to 0.025210");
        assertEq(spread, 74);
    }

    function test_acceptsASweepOfTwoLevels() public view {
        (int256 move, uint256 spread) = script.checkBook(BID, ASK, BID, 0.025368e18, 200, 50);
        assertEq(move, 25);
        assertEq(spread, 99);
    }

    function test_acceptsADownMove() public view {
        (int256 move,) = script.checkBook(BID, ASK, 0.025053e18, ASK, 200, 50);
        assertEq(move, -12);
    }

    function test_refusesAOneSidedBook() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.BookRefused.selector, "book is not two-sided after the order")
        );
        script.checkBook(BID, ASK, BID, type(uint256).max, 200, 50);
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.BookRefused.selector, "book is not two-sided after the order")
        );
        script.checkBook(BID, ASK, 0, ASK, 200, 50);
    }

    function test_refusesACrossedBook() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.BookRefused.selector, "book is not two-sided after the order")
        );
        script.checkBook(BID, ASK, ASK, ASK, 200, 50);
    }

    function test_refusesAWideSpread() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.BookRefused.selector, "post-trade spread wider than the bound")
        );
        script.checkBook(BID, ASK, BID, 0.0257e18, 100, 5000);
    }

    function test_refusesAMidMoveBeyondTheBound() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.BookRefused.selector, "post-trade mid moved more than the bound")
        );
        script.checkBook(BID, ASK, BID, 0.025368e18, 200, 24);
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.BookRefused.selector, "post-trade mid moved more than the bound")
        );
        script.checkBook(BID, ASK, 0.02499e18, ASK, 200, 24);
    }

    // ----- execute against the mock book and router -----

    function test_buyMakesTheTwoCallsAnAgentsPlanCarries() public {
        usdc.mint(DEFAULT_SENDER, 1e6);
        router.configure(BID, 0.025305e18, 15e18);
        MarketActivity.Inputs memory i = inputs(true, 378_631);
        i.minOut = 14.9e18;
        MarketActivity.Result memory r = script.execute(i);
        assertEq(r.out, 15e18);
        assertEq(router.calls(), 1);
        assertTrue(router.lastIsBuy());
        assertEq(router.lastDebit(), address(usdc));
        assertEq(router.lastCredit(), address(wmon));
        assertEq(router.lastAmount(), 378_631);
        assertEq(router.lastMinOut(), 14.9e18);
        assertEq(usdc.allowance(r.taker, address(router)), 378_631, "an exact approval, not an unlimited one");
        assertEq(r.postAsk, 0.025305e18);
        assertEq(r.moveBps, 12);
    }

    function test_sellDebitsTheBase() public {
        wmon.mint(DEFAULT_SENDER, 100e18);
        router.configure(0.025053e18, ASK, 1.99e6);
        MarketActivity.Result memory r = script.execute(inputs(false, 79.63e18));
        assertFalse(router.lastIsBuy());
        assertEq(router.lastDebit(), address(wmon));
        assertEq(router.lastCredit(), address(usdc));
        assertEq(wmon.allowance(r.taker, address(router)), 79.63e18);
        assertEq(r.moveBps, -12);
    }

    function test_executeRefusesAnOrderThatEmptiesTheBook() public {
        usdc.mint(DEFAULT_SENDER, 2e6);
        router.configure(BID, type(uint256).max, 45e18);
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.BookRefused.selector, "book is not two-sided after the order")
        );
        script.execute(inputs(true, 1.2e6));
    }

    function test_executeRefusesWhenTheTakerLacksTheDebitToken() public {
        router.configure(BID, 0.025305e18, 15e18);
        vm.expectRevert(abi.encodeWithSelector(MarketActivity.Insufficient.selector, "USDC", 378_631, 0));
        script.execute(inputs(true, 378_631));
        assertEq(router.calls(), 0);
    }

    function test_executeRefusesAOneSidedBookBeforeTrading() public {
        usdc.mint(DEFAULT_SENDER, 1e6);
        market.set(BID, type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(MarketActivity.BookRefused.selector, "book is not two-sided before the order")
        );
        script.execute(inputs(true, 378_631));
        assertEq(router.calls(), 0);
    }

    function test_checkRefusesAnotherChainAndAnUnboundedFloor() public {
        // Foundry's default chain id is 31337, not Monad testnet.
        vm.expectRevert(abi.encodeWithSelector(MarketActivity.WrongChain.selector, block.chainid));
        script.check(inputs(true, 378_631));
    }
}
