// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IErc20Min, IKuruOrderBook, IKuruRouter} from "./KuruTestnet.sol";

/// One bounded taker order on the team-owned testnet WMON/USDC market, through Kuru's router, on Monad testnet
/// (chain 10143) and nowhere else (ARCHITECTURE.md section 10, "Testnet market activity"; docs/testnet-market-activity.md).
/// It exists to move a market the team owns and discloses, so the agents' strategy has something to react to. A trade
/// here is not evidence of any strategy's skill: the price is whatever the team sets.
///
/// It builds the same two calls the agents' plans carry (libs/trading `buildSwapCall` and `buildSellCall`): an exact
/// `approve` of the debit token to the router, then `anyToAnySwap` on the one market with no native value. Nothing is
/// invented: the signature is the one in test/fork/WmonMarketFork.t.sol, which runs it against the real router.
///
/// Bounds, all refused before anything is sent (a forge script runs to its end locally first, so a revert here stops a
/// broadcast too):
/// - chain 10143, the market registered at the router and on the configured base and quote;
/// - an order above `HARD_MAX_BUY_QUOTE` or `HARD_MAX_SELL_BASE`, whatever the environment says, or above the lower
///   `MONADEUM_ACTIVITY_MAX_AMOUNT` the wrapper passes;
/// - a pre-trade book that is not two-sided;
/// - a post-trade book that is one-sided, crossed, wider than `MONADEUM_ACTIVITY_MAX_SPREAD_BPS`, or whose mid moved
///   more than `MONADEUM_ACTIVITY_MAX_MOVE_BPS` from the pre-trade mid;
/// - a taker without the debit token, and (optional) a broadcasting account other than `MONADEUM_EXPECTED_TAKER`.
///
/// Inputs, all from the environment (`script/market-activity.sh` sets them):
/// `MONADEUM_KURU_ROUTER`, `MONADEUM_WMON_MARKET`, `MONADEUM_MARKET_BASE`, `MONADEUM_MARKET_QUOTE`,
/// `MONADEUM_ACTIVITY_BUY` (true: spend quote for base; false: sell base for quote), `MONADEUM_ACTIVITY_AMOUNT` (the
/// debit token's base units), `MONADEUM_ACTIVITY_MIN_OUT`, `MONADEUM_ACTIVITY_MAX_AMOUNT`,
/// `MONADEUM_ACTIVITY_MAX_SPREAD_BPS`, `MONADEUM_ACTIVITY_MAX_MOVE_BPS`, `MONADEUM_EXPECTED_TAKER` (optional).
contract MarketActivity is Script {
    uint256 public constant MONAD_TESTNET = 10143;
    uint256 public constant BPS = 10_000;
    /// 2 USDC: about twice what clears all three asks of the seeded ladder (about 1.14 USDC).
    uint256 public constant HARD_MAX_BUY_QUOTE = 2e6;
    /// 100 WMON: a little over one of the seeded bid levels (about 80 WMON each).
    uint256 public constant HARD_MAX_SELL_BASE = 100e18;
    string public constant OUTPUT = "deployments/monad-testnet-market-activity.latest.json";

    struct Inputs {
        address router;
        address market;
        address base;
        address quote;
        bool buy;
        uint256 amount;
        uint256 minOut;
        uint256 maxAmount;
        uint256 maxSpreadBps;
        uint256 maxMoveBps;
    }

    struct Result {
        address taker;
        uint256 preBid;
        uint256 preAsk;
        uint256 postBid;
        uint256 postAsk;
        uint256 out;
        int256 moveBps;
        uint256 spreadBps;
    }

    error WrongChain(uint256 chainId);
    error NoCode(string what, address account);
    error NotOurMarket(string what);
    error WrongTaker(address expected, address actual);
    error AmountRefused(string what, uint256 amount, uint256 limit);
    error Insufficient(string what, uint256 needed, uint256 available);
    error BookRefused(string what);

    function inputsFromEnv() public view returns (Inputs memory) {
        return Inputs({
            router: vm.envAddress("MONADEUM_KURU_ROUTER"),
            market: vm.envAddress("MONADEUM_WMON_MARKET"),
            base: vm.envAddress("MONADEUM_MARKET_BASE"),
            quote: vm.envAddress("MONADEUM_MARKET_QUOTE"),
            buy: vm.envBool("MONADEUM_ACTIVITY_BUY"),
            amount: vm.envUint("MONADEUM_ACTIVITY_AMOUNT"),
            minOut: vm.envUint("MONADEUM_ACTIVITY_MIN_OUT"),
            maxAmount: vm.envUint("MONADEUM_ACTIVITY_MAX_AMOUNT"),
            maxSpreadBps: vm.envUint("MONADEUM_ACTIVITY_MAX_SPREAD_BPS"),
            maxMoveBps: vm.envUint("MONADEUM_ACTIVITY_MAX_MOVE_BPS")
        });
    }

    function run() external returns (Result memory r) {
        Inputs memory i = inputsFromEnv();
        check(i);
        r = execute(i);
        write(i, r);
        console2.log("side                 ", i.buy ? "buy WMON with USDC" : "sell WMON for USDC");
        console2.log("amount in (base units)", i.amount);
        console2.log("amount out           ", r.out);
        console2.log("pre  bid / ask       ", r.preBid, r.preAsk);
        console2.log("post bid / ask       ", r.postBid, r.postAsk);
        console2.log("mid move (bps)       ", r.moveBps);
        console2.log("post spread (bps)    ", r.spreadBps);
        console2.log("taker                ", r.taker);
        console2.log("written to           ", OUTPUT);
    }

    /// The broadcast part: approve exactly the amount, swap, and check the book it leaves.
    function execute(Inputs memory i) public returns (Result memory r) {
        (r.preBid, r.preAsk) = IKuruOrderBook(i.market).bestBidAsk();
        requireTwoSided(r.preBid, r.preAsk, "before the order");
        vm.startBroadcast();
        (, r.taker,) = vm.readCallers();
        address expected = vm.envOr("MONADEUM_EXPECTED_TAKER", address(0));
        if (expected != address(0) && r.taker != expected) revert WrongTaker(expected, r.taker);
        r.out = swap(i, r.taker);
        vm.stopBroadcast();
        (r.postBid, r.postAsk) = IKuruOrderBook(i.market).bestBidAsk();
        (r.moveBps, r.spreadBps) = checkBook(r.preBid, r.preAsk, r.postBid, r.postAsk, i.maxSpreadBps, i.maxMoveBps);
    }

    /// The two calls an agent's plan carries: an exact approval of the debit token to the router, then the swap.
    function swap(Inputs memory i, address taker) internal returns (uint256) {
        address debit = i.buy ? i.quote : i.base;
        uint256 held = IErc20Min(debit).balanceOf(taker);
        if (held < i.amount) revert Insufficient(i.buy ? "USDC" : "WMON", i.amount, held);
        IErc20Min(debit).approve(i.router, i.amount);
        address[] memory path = new address[](1);
        path[0] = i.market;
        bool[] memory isBuy = new bool[](1);
        isBuy[0] = i.buy;
        return IKuruRouter(i.router)
            .anyToAnySwap(path, isBuy, new bool[](1), debit, i.buy ? i.base : i.quote, i.amount, i.minOut);
    }

    /// The market must be the configured WMON/USDC market registered at the router, as the seed script checks.
    function check(Inputs memory i) public view {
        if (block.chainid != MONAD_TESTNET) revert WrongChain(block.chainid);
        if (i.market.code.length == 0) revert NoCode("market", i.market);
        if (i.router.code.length == 0) revert NoCode("router", i.router);
        (uint32 registered,,,,,,,,,,) = IKuruRouter(i.router).verifiedMarket(i.market);
        if (registered == 0) revert NotOurMarket("not registered at the router");
        (,, address base,, address quote,,,,,,) = IKuruOrderBook(i.market).getMarketParams();
        if (base != i.base) revert NotOurMarket("base");
        if (quote != i.quote) revert NotOurMarket("quote");
        checkAmount(i.buy, i.amount, i.maxAmount);
        if (i.minOut == 0) revert AmountRefused("minOut must be positive: an order without a floor is refused", 0, 1);
    }

    /// An order above the compiled ceiling or the wrapper's lower one is refused, whatever the environment says.
    function checkAmount(bool buy, uint256 amount, uint256 maxAmount) public pure {
        uint256 ceiling = buy ? HARD_MAX_BUY_QUOTE : HARD_MAX_SELL_BASE;
        if (amount == 0) revert AmountRefused("amount is zero", amount, ceiling);
        if (amount > ceiling) revert AmountRefused("above the hard maximum", amount, ceiling);
        if (amount > maxAmount) revert AmountRefused("above the configured maximum", amount, maxAmount);
    }

    function requireTwoSided(uint256 bid, uint256 ask, string memory when_) public pure {
        if (bid == 0 || ask == type(uint256).max || bid >= ask) {
            revert BookRefused(string.concat("book is not two-sided ", when_));
        }
    }

    /// The post-trade book: two-sided, within the spread bound, and a mid within the move bound of the pre-trade mid.
    function checkBook(
        uint256 preBid,
        uint256 preAsk,
        uint256 postBid,
        uint256 postAsk,
        uint256 maxSpreadBps,
        uint256 maxMoveBps
    ) public pure returns (int256 moveBps, uint256 spreadBps) {
        requireTwoSided(postBid, postAsk, "after the order");
        uint256 preMid = (preBid + preAsk) / 2;
        uint256 postMid = (postBid + postAsk) / 2;
        spreadBps = (postAsk - postBid) * BPS / postMid;
        if (spreadBps > maxSpreadBps) revert BookRefused("post-trade spread wider than the bound");
        moveBps = (int256(postMid) - int256(preMid)) * int256(BPS) / int256(preMid);
        uint256 abs_ = moveBps < 0 ? uint256(-moveBps) : uint256(moveBps);
        if (abs_ > maxMoveBps) revert BookRefused("post-trade mid moved more than the bound");
    }

    function write(Inputs memory i, Result memory r) internal {
        string memory k = "root";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeString(
            k, "mode", vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? "broadcast" : "simulation (nothing was sent)"
        );
        vm.serializeAddress(k, "market", i.market);
        vm.serializeAddress(k, "taker", r.taker);
        vm.serializeString(k, "side", i.buy ? "buy" : "sell");
        vm.serializeUint(k, "forkBlock", block.number);
        vm.serializeUint(k, "amountIn", i.amount);
        vm.serializeUint(k, "minOut", i.minOut);
        vm.serializeUint(k, "amountOut", r.out);
        vm.serializeUint(k, "preBid", r.preBid);
        vm.serializeUint(k, "preAsk", r.preAsk);
        vm.serializeUint(k, "postBid", r.postBid);
        vm.serializeUint(k, "postAsk", r.postAsk);
        vm.serializeInt(k, "midMoveBps", r.moveBps);
        string memory json = vm.serializeUint(k, "postSpreadBps", r.spreadBps);
        vm.writeJson(json, OUTPUT);
    }
}
