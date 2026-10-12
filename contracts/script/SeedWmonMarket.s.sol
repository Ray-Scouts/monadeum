// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IErc20Min, IKuruMarginAccount, IKuruOrderBook, IKuruRouter, IWrappedMon} from "./KuruTestnet.sol";

/// Seeds the testnet WMON/USDC market (CreateWmonMarket.s.sol) with a small two-sided ladder of resting, post-only
/// limit orders around a configured mid price, on Monad testnet (chain 10143) and nowhere else. The orders belong to
/// the broadcasting account; Kuru's order book draws them from that account's balance in Kuru's margin account, so
/// the script wraps MON into WMON, deposits both tokens, then places every order in one `batchUpdate`.
///
/// The price is whatever the mid input says. It is not discovered by any market: the only liquidity is ours, so
/// testnet prices and agents' P&L carry no economic meaning (ARCHITECTURE.md section 10, "Testnet market").
///
/// Inputs, all from the environment (`script/wmon-market.sh` sets the defaults and converts decimals):
/// - `MONADEUM_KURU_ROUTER`, `MONADEUM_WMON_MARKET`, `MONADEUM_MARKET_BASE` (WMON), `MONADEUM_MARKET_QUOTE` (USDC).
/// - `MONADEUM_SEED_MID`: the mid, quote per base at the 1e18 scale (the scale of `bestBidAsk`).
/// - `MONADEUM_SEED_LEVELS`: orders per side.
/// - `MONADEUM_SEED_FIRST_OFFSET_BPS`, `MONADEUM_SEED_STEP_BPS`: level i sits `first + i * step` bps from the mid.
/// - `MONADEUM_SEED_BID_QUOTE_PER_LEVEL`: settlement-asset base units behind each bid.
/// - `MONADEUM_SEED_ASK_BASE_PER_LEVEL`: WMON wei offered at each ask.
/// - `MONADEUM_SEED_MAX_SPREAD_BPS`: refuse a ladder whose inner spread is wider (the MON price source's limit).
/// - `MONADEUM_EXPECTED_DEPLOYER` (optional): refuse to run unless the broadcasting account is this address.
///
/// It writes `deployments/monad-testnet-wmon-seed.latest.json` (not committed).
contract SeedWmonMarket is Script {
    uint256 public constant MONAD_TESTNET = 10143;
    uint256 public constant PRICE_SCALE = 1e18;
    uint256 public constant BPS = 10_000;
    string public constant OUTPUT = "deployments/monad-testnet-wmon-seed.latest.json";

    struct Inputs {
        address router;
        address market;
        address base;
        address quote;
        uint256 mid;
        uint256 levels;
        uint256 firstOffsetBps;
        uint256 stepBps;
        uint256 bidQuotePerLevel;
        uint256 askBasePerLevel;
        uint256 maxSpreadBps;
    }

    /// The market fields the ladder needs, from `getMarketParams`.
    struct Market {
        uint32 pricePrecision;
        uint96 sizePrecision;
        uint256 baseDecimals;
        uint256 quoteDecimals;
        uint32 tickSize;
        uint96 minSize;
        uint96 maxSize;
    }

    struct Ladder {
        uint32[] bidPrices;
        uint96[] bidSizes;
        uint32[] askPrices;
        uint96[] askSizes;
        /// Exactly what the order book debits from the margin account for the bids, settlement-asset base units.
        uint256 quoteNeeded;
        /// Exactly what it debits for the asks, WMON wei.
        uint256 baseNeeded;
    }

    error WrongChain(uint256 chainId);
    error NoCode(string what, address account);
    error NotOurMarket(string what);
    error WrongDeployer(address expected, address actual);
    error BadLadder(string what);
    error Insufficient(string what, uint256 needed, uint256 available);
    error PostCondition(string what);

    function inputsFromEnv() public view returns (Inputs memory) {
        return Inputs({
            router: vm.envAddress("MONADEUM_KURU_ROUTER"),
            market: vm.envAddress("MONADEUM_WMON_MARKET"),
            base: vm.envAddress("MONADEUM_MARKET_BASE"),
            quote: vm.envAddress("MONADEUM_MARKET_QUOTE"),
            mid: vm.envUint("MONADEUM_SEED_MID"),
            levels: vm.envUint("MONADEUM_SEED_LEVELS"),
            firstOffsetBps: vm.envUint("MONADEUM_SEED_FIRST_OFFSET_BPS"),
            stepBps: vm.envUint("MONADEUM_SEED_STEP_BPS"),
            bidQuotePerLevel: vm.envUint("MONADEUM_SEED_BID_QUOTE_PER_LEVEL"),
            askBasePerLevel: vm.envUint("MONADEUM_SEED_ASK_BASE_PER_LEVEL"),
            maxSpreadBps: vm.envUint("MONADEUM_SEED_MAX_SPREAD_BPS")
        });
    }

    /// What a run did: the maker, what it wrapped and deposited, and the book it left.
    struct Result {
        address maker;
        uint256 wrap;
        uint256 quoteDeposit;
        uint256 baseDeposit;
        uint256 bid;
        uint256 ask;
        uint256 spreadBps;
    }

    function run() external returns (Result memory r) {
        Inputs memory inputs = inputsFromEnv();
        Ladder memory ladder = build(inputs, check(inputs));
        r = place(inputs, ladder);
        if (r.bid == 0 || r.ask == type(uint256).max || r.bid >= r.ask) revert PostCondition("book is not two-sided");
        r.spreadBps = (r.ask - r.bid) * BPS / ((r.ask + r.bid) / 2);
        if (r.spreadBps > inputs.maxSpreadBps) revert PostCondition("spread wider than MONADEUM_SEED_MAX_SPREAD_BPS");
        write(inputs, ladder, r);
        console2.log("best bid (1e18 scale)", r.bid);
        console2.log("best ask (1e18 scale)", r.ask);
        console2.log("spread (bps)         ", r.spreadBps);
        console2.log("USDC behind bids     ", ladder.quoteNeeded);
        console2.log("WMON behind asks     ", ladder.baseNeeded);
        console2.log("MON wrapped          ", r.wrap);
        console2.log("maker                ", r.maker);
        console2.log("written to           ", OUTPUT);
    }

    /// The broadcast part: wrap, deposit the shortfalls into Kuru's margin account, and place the ladder.
    function place(Inputs memory inputs, Ladder memory ladder) internal returns (Result memory r) {
        address margin = IKuruRouter(inputs.router).marginAccountAddress();
        vm.startBroadcast();
        (, r.maker,) = vm.readCallers();
        address expected = vm.envOr("MONADEUM_EXPECTED_DEPLOYER", address(0));
        if (expected != address(0) && r.maker != expected) revert WrongDeployer(expected, r.maker);
        (r.wrap, r.quoteDeposit, r.baseDeposit) = shortfalls(inputs, ladder, margin, r.maker);
        if (r.wrap > 0) IWrappedMon(inputs.base).deposit{value: r.wrap}();
        if (r.quoteDeposit > 0) {
            IErc20Min(inputs.quote).approve(margin, r.quoteDeposit);
            IKuruMarginAccount(margin).deposit(r.maker, inputs.quote, r.quoteDeposit);
        }
        if (r.baseDeposit > 0) {
            IWrappedMon(inputs.base).approve(margin, r.baseDeposit);
            IKuruMarginAccount(margin).deposit(r.maker, inputs.base, r.baseDeposit);
        }
        // Post-only: an order that would cross a resting order reverts the whole batch instead of trading.
        IKuruOrderBook(inputs.market)
            .batchUpdate(ladder.bidPrices, ladder.bidSizes, ladder.askPrices, ladder.askSizes, new uint40[](0), true);
        vm.stopBroadcast();
        (r.bid, r.ask) = IKuruOrderBook(inputs.market).bestBidAsk();
    }

    /// The market must be the configured WMON/USDC market registered at the router, as CreateWmonMarket left it.
    function check(Inputs memory inputs) public view returns (Market memory m) {
        if (block.chainid != MONAD_TESTNET) revert WrongChain(block.chainid);
        if (inputs.market.code.length == 0) revert NoCode("market", inputs.market);
        (uint32 registered,,,,,,,,,,) = IKuruRouter(inputs.router).verifiedMarket(inputs.market);
        if (registered == 0) revert NotOurMarket("not registered at the router");
        (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address base,
            uint256 baseDecimals,
            address quote,
            uint256 quoteDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,,
        ) = IKuruOrderBook(inputs.market).getMarketParams();
        if (base != inputs.base) revert NotOurMarket("base");
        if (quote != inputs.quote) revert NotOurMarket("quote");
        m = Market(pricePrecision, sizePrecision, baseDecimals, quoteDecimals, tickSize, minSize, maxSize);
    }

    /// The ladder, computed with the order book's own rounding. Bids round down to a tick and asks up, so every level
    /// is at least its offset away from the mid; a bid's size is the most its quote amount buys at its price.
    function build(Inputs memory inputs, Market memory m) public pure returns (Ladder memory l) {
        if (inputs.levels == 0 || inputs.levels > 20) revert BadLadder("levels must be 1 to 20");
        if (inputs.firstOffsetBps == 0) revert BadLadder("first offset must be positive");
        if (inputs.firstOffsetBps + (inputs.levels - 1) * inputs.stepBps >= BPS) revert BadLadder("offset too wide");
        if (inputs.levels > 1 && inputs.stepBps == 0) revert BadLadder("step must be positive");
        uint256 midTicks = inputs.mid * m.pricePrecision / PRICE_SCALE;
        if (midTicks == 0) revert BadLadder("mid below one price unit");
        l.bidPrices = new uint32[](inputs.levels);
        l.bidSizes = new uint96[](inputs.levels);
        l.askPrices = new uint32[](inputs.levels);
        l.askSizes = new uint96[](inputs.levels);
        uint256 askSize = inputs.askBasePerLevel * m.sizePrecision / 10 ** m.baseDecimals;
        for (uint256 i = 0; i < inputs.levels; i++) {
            uint256 offset = inputs.firstOffsetBps + i * inputs.stepBps;
            uint256 bidRaw = inputs.mid * (BPS - offset) * m.pricePrecision / (BPS * PRICE_SCALE);
            uint256 askRaw = _divUp(inputs.mid * (BPS + offset) * m.pricePrecision, BPS * PRICE_SCALE);
            uint256 bidPrice = bidRaw / m.tickSize * m.tickSize;
            uint256 askPrice = _divUp(askRaw, m.tickSize) * m.tickSize;
            if (bidPrice == 0) revert BadLadder("bid rounds to zero");
            if (askPrice >= type(uint32).max) revert BadLadder("ask above the price range");
            if (i > 0 && (bidPrice >= l.bidPrices[i - 1] || askPrice <= l.askPrices[i - 1])) {
                revert BadLadder("two levels round to one tick: widen the step");
            }
            uint256 bidSize =
                inputs.bidQuotePerLevel * m.pricePrecision * m.sizePrecision / (bidPrice * 10 ** m.quoteDecimals);
            if (bidSize < m.minSize || askSize < m.minSize) revert BadLadder("order below the market's minSize");
            if (bidSize > m.maxSize || askSize > m.maxSize) revert BadLadder("order above the market's maxSize");
            l.bidPrices[i] = uint32(bidPrice);
            l.askPrices[i] = uint32(askPrice);
            l.bidSizes[i] = uint96(bidSize);
            l.askSizes[i] = uint96(askSize);
            // OrderBook.addBuyOrder debits mulDivUp(price, size, sizePrecision) price units, converted down to quote
            // units; addSellOrder debits size * 10^baseDecimals / sizePrecision.
            l.quoteNeeded += _divUp(bidPrice * bidSize, m.sizePrecision) * 10 ** m.quoteDecimals / m.pricePrecision;
            l.baseNeeded += askSize * 10 ** m.baseDecimals / m.sizePrecision;
        }
        if (l.bidPrices[0] >= l.askPrices[0]) revert BadLadder("bid and ask cross");
    }

    /// What must still be wrapped and deposited, given the maker's margin balances and wallet. Refuses before
    /// anything is sent when the maker cannot cover it.
    function shortfalls(Inputs memory inputs, Ladder memory ladder, address margin, address maker)
        public
        view
        returns (uint256 wrap, uint256 quoteDeposit, uint256 baseDeposit)
    {
        uint256 quoteHeld = IKuruMarginAccount(margin).getBalance(maker, inputs.quote);
        uint256 baseHeld = IKuruMarginAccount(margin).getBalance(maker, inputs.base);
        quoteDeposit = ladder.quoteNeeded > quoteHeld ? ladder.quoteNeeded - quoteHeld : 0;
        baseDeposit = ladder.baseNeeded > baseHeld ? ladder.baseNeeded - baseHeld : 0;
        uint256 quoteWallet = IErc20Min(inputs.quote).balanceOf(maker);
        if (quoteWallet < quoteDeposit) revert Insufficient("USDC", quoteDeposit, quoteWallet);
        uint256 wmonWallet = IWrappedMon(inputs.base).balanceOf(maker);
        wrap = baseDeposit > wmonWallet ? baseDeposit - wmonWallet : 0;
        // Gas is paid on top of this; the wrapper prints the balance and the simulated cost before a broadcast.
        if (maker.balance < wrap) revert Insufficient("MON to wrap", wrap, maker.balance);
    }

    function write(Inputs memory inputs, Ladder memory ladder, Result memory res) internal {
        string memory r = "root";
        vm.serializeUint(r, "chainId", block.chainid);
        vm.serializeString(
            r, "mode", vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? "broadcast" : "simulation (nothing was sent)"
        );
        vm.serializeAddress(r, "market", inputs.market);
        vm.serializeAddress(r, "maker", res.maker);
        vm.serializeUint(r, "forkBlock", block.number);
        vm.serializeUint(r, "mid", inputs.mid);
        vm.serializeUint(r, "bestBid", res.bid);
        vm.serializeUint(r, "bestAsk", res.ask);
        vm.serializeUint(r, "spreadBps", res.spreadBps);
        vm.serializeUint(r, "monWrapped", res.wrap);
        vm.serializeUint(r, "quoteDeposited", res.quoteDeposit);
        vm.serializeUint(r, "baseDeposited", res.baseDeposit);
        vm.serializeUint(r, "bidPrices", _u32(ladder.bidPrices));
        vm.serializeUint(r, "bidSizes", _u96(ladder.bidSizes));
        vm.serializeUint(r, "askPrices", _u32(ladder.askPrices));
        string memory json = vm.serializeUint(r, "askSizes", _u96(ladder.askSizes));
        vm.writeJson(json, OUTPUT);
    }

    function _divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    function _u32(uint32[] memory a) internal pure returns (uint256[] memory out) {
        out = new uint256[](a.length);
        for (uint256 i = 0; i < a.length; i++) {
            out[i] = a[i];
        }
    }

    function _u96(uint96[] memory a) internal pure returns (uint256[] memory out) {
        out = new uint256[](a.length);
        for (uint256 i = 0; i < a.length; i++) {
            out[i] = a[i];
        }
    }
}
