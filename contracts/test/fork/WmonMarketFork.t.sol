// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreateWmonMarket} from "../../script/CreateWmonMarket.s.sol";
import {SeedWmonMarket} from "../../script/SeedWmonMarket.s.sol";
import {IErc20Min, IKuruMarginAccount, IKuruOrderBook, IKuruRouter, IWrappedMon} from "../../script/KuruTestnet.sol";

/// Fork test of the testnet WMON/USDC market path against Kuru's real testnet router and order-book implementation:
/// the create script's checks and prediction, `deployProxy`, the create script's read-back, the seed ladder placed as
/// the seed script places it, and then an agent-shaped taker buying 1 USDC of WMON and closing it through the
/// router's `anyToAnySwap` with zero native value, the calls libs/trading builds.
///
/// Opt-in: it runs only when forge is pointed at Monad testnet, and skips otherwise. From contracts/:
///   forge test --match-path test/fork/WmonMarketFork.t.sol --fork-url "$MONAD_TESTNET_RPC_URL" -vv
/// The maker is the testnet deployer, which holds Circle testnet USDC; its MON is topped up on the fork with
/// `vm.deal`, since the seed needs more MON than it holds today. Foundry's EVM is not Monad's client, so gas figures
/// here are indicative only.
contract WmonMarketForkTest is Test {
    address internal constant ROUTER = 0x7EFbE105Ca7415dE98F96622173458ac1c054630;
    address internal constant IMPLEMENTATION = 0x72caE0a99C19B574e8a6De558F43fc1D019c9374;
    address internal constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    address internal constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    address internal constant DEPLOYER = 0x617940428CABaDF4528EFEDa9C27E1577ba0c1e3;

    CreateWmonMarket internal create;
    SeedWmonMarket internal seed;

    function setUp() public {
        if (block.chainid != 10143) {
            vm.skip(true);
            return;
        }
        create = new CreateWmonMarket();
        seed = new SeedWmonMarket();
    }

    function createInputs() internal pure returns (CreateWmonMarket.Inputs memory) {
        return CreateWmonMarket.Inputs({
            router: ROUTER,
            implementation: IMPLEMENTATION,
            base: WMON,
            quote: USDC,
            baseDecimals: 18,
            quoteDecimals: 6,
            sizePrecision: 1e10,
            pricePrecision: 1e8,
            tickSize: 100,
            minSize: 1e9,
            maxSize: 2e18,
            takerFeeBps: 0,
            makerFeeBps: 0,
            ammSpread: 10
        });
    }

    function seedInputs(address market) internal pure returns (SeedWmonMarket.Inputs memory) {
        return SeedWmonMarket.Inputs({
            router: ROUTER,
            market: market,
            base: WMON,
            quote: USDC,
            mid: 0.026904e18,
            levels: 3,
            firstOffsetBps: 25,
            stepBps: 25,
            bidQuotePerLevel: 2e6,
            askBasePerLevel: 15e18,
            maxSpreadBps: 200
        });
    }

    function test_fork_createSeedBuyAndClose() public {
        CreateWmonMarket.Inputs memory c = createInputs();
        create.check(c);
        address predicted = create.predict(c);
        address market = predicted;
        if (predicted.code.length == 0) {
            vm.prank(DEPLOYER);
            market = IKuruRouter(ROUTER).deployProxy(0, WMON, USDC, 1e10, 1e8, 100, 1e9, 2e18, 0, 0, 10);
        }
        assertEq(market, predicted, "deployProxy lands at the router's prediction");
        create.verify(c, market);

        // Seed as SeedWmonMarket.place does, from the deployer.
        SeedWmonMarket.Inputs memory s = seedInputs(market);
        SeedWmonMarket.Ladder memory ladder = seed.build(s, seed.check(s));
        address margin = IKuruRouter(ROUTER).marginAccountAddress();
        vm.deal(DEPLOYER, 50 ether);
        (uint256 wrap, uint256 quoteDeposit, uint256 baseDeposit) = seed.shortfalls(s, ladder, margin, DEPLOYER);
        vm.startPrank(DEPLOYER);
        IWrappedMon(WMON).deposit{value: wrap}();
        IErc20Min(USDC).approve(margin, quoteDeposit);
        IKuruMarginAccount(margin).deposit(DEPLOYER, USDC, quoteDeposit);
        IWrappedMon(WMON).approve(margin, baseDeposit);
        IKuruMarginAccount(margin).deposit(DEPLOYER, WMON, baseDeposit);
        IKuruOrderBook(market)
            .batchUpdate(ladder.bidPrices, ladder.bidSizes, ladder.askPrices, ladder.askSizes, new uint40[](0), true);
        // An agent's account, funded with 1 USDC.
        address taker = makeAddr("agent");
        (bool ok,) = USDC.call(abi.encodeWithSignature("transfer(address,uint256)", taker, 1e6));
        assertTrue(ok);
        vm.stopPrank();

        (uint256 bid, uint256 ask) = IKuruOrderBook(market).bestBidAsk();
        assertEq(bid, 0.026836e18);
        assertEq(ask, 0.026972e18);

        // Buy: approve exactly the notional, then anyToAnySwap with isBuy true and no native value.
        address[] memory path = new address[](1);
        path[0] = market;
        bool[] memory buy = new bool[](1);
        buy[0] = true;
        bool[] memory noNative = new bool[](1);
        vm.startPrank(taker);
        IErc20Min(USDC).approve(ROUTER, 1e6);
        uint256 got = IKuruRouter(ROUTER).anyToAnySwap(path, buy, noNative, USDC, WMON, 1e6, 36e18);
        assertEq(IErc20Min(USDC).balanceOf(taker), 0);
        assertEq(IErc20Min(WMON).balanceOf(taker), got);
        assertGt(got, 36e18, "1 USDC buys about 37 WMON across the three asks");

        // Close: approve exactly the size on the base, then sell it with isBuy false and no native value.
        bool[] memory sell = new bool[](1);
        IErc20Min(WMON).approve(ROUTER, got);
        uint256 back = IKuruRouter(ROUTER).anyToAnySwap(path, sell, noNative, WMON, USDC, got, 0.98e6);
        vm.stopPrank();
        assertEq(IErc20Min(USDC).balanceOf(taker), back);
        assertGt(back, 0.99e6, "the round trip costs the 50 bps spread plus the levels crossed");
        assertLt(back, 1e6);
    }
}
