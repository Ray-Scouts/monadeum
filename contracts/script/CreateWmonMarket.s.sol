// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IErc20Min, IKuruOrderBook, IKuruRouter} from "./KuruTestnet.sol";

/// Creates the testnet WMON/USDC market on Kuru's documented testnet router through its permissionless `deployProxy`
/// (ARCHITECTURE.md section 10, TradingModule, "Testnet market"), on Monad testnet (chain 10143) and nowhere else.
///
/// Inputs, all from the environment (`script/wmon-market.sh` sets the decided values):
/// - `MONADEUM_KURU_ROUTER`: Kuru's testnet router.
/// - `MONADEUM_KURU_ORDERBOOK_IMPLEMENTATION`: the order-book implementation the router must deploy behind the new
///   market's proxy, the one the Kuru TypeScript SDK 0.0.95 pinned by libs/trading decodes. The script refuses if
///   the router points elsewhere.
/// - `MONADEUM_MARKET_BASE`, `MONADEUM_MARKET_QUOTE`: Wrapped MON and the settlement asset.
/// - `MONADEUM_MARKET_BASE_DECIMALS`, `MONADEUM_MARKET_QUOTE_DECIMALS`: what the two tokens must report (18 and 6).
/// - `MONADEUM_MARKET_SIZE_PRECISION`, `MONADEUM_MARKET_PRICE_PRECISION`, `MONADEUM_MARKET_TICK_SIZE`,
///   `MONADEUM_MARKET_MIN_SIZE`, `MONADEUM_MARKET_MAX_SIZE`, `MONADEUM_MARKET_TAKER_FEE_BPS`,
///   `MONADEUM_MARKET_MAKER_FEE_BPS`, `MONADEUM_MARKET_AMM_SPREAD`: the market parameters.
/// - `MONADEUM_EXPECTED_DEPLOYER` (optional): refuse to run unless the broadcasting account is this address.
///
/// The router derives the market's address from the parameters alone (CREATE2, salt over the parameters, no sender),
/// so the address is known before the broadcast, and a second run with the same parameters finds the market and
/// records it without sending anything. It writes `deployments/monad-testnet-wmon-market.latest.json` (not committed).
contract CreateWmonMarket is Script {
    uint256 public constant MONAD_TESTNET = 10143;
    /// `IOrderBook.OrderBookType.NO_NATIVE`: an ERC-20 base and an ERC-20 quote.
    uint8 public constant NO_NATIVE = 0;
    string public constant OUTPUT = "deployments/monad-testnet-wmon-market.latest.json";
    bytes32 internal constant EIP1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// The eleven fields of `verifiedMarket` and `getMarketParams`, in order.
    struct MarketParams {
        uint32 pricePrecision;
        uint96 sizePrecision;
        address base;
        uint256 baseDecimals;
        address quote;
        uint256 quoteDecimals;
        uint32 tickSize;
        uint96 minSize;
        uint96 maxSize;
        uint256 takerFeeBps;
        uint256 makerFeeBps;
    }

    struct Inputs {
        address router;
        address implementation;
        address base;
        address quote;
        uint8 baseDecimals;
        uint8 quoteDecimals;
        uint96 sizePrecision;
        uint32 pricePrecision;
        uint32 tickSize;
        uint96 minSize;
        uint96 maxSize;
        uint256 takerFeeBps;
        uint256 makerFeeBps;
        uint96 ammSpread;
    }

    error WrongChain(uint256 chainId);
    error NoCode(string what, address account);
    error WrongDecimals(string what, uint8 expected, uint8 actual);
    error WrongImplementation(address expected, address actual);
    error WrongDeployer(address expected, address actual);
    error ExistingMarketDiffers(address market, string what);
    error PostCondition(string what);

    function inputsFromEnv() public view returns (Inputs memory) {
        return Inputs({
            router: vm.envAddress("MONADEUM_KURU_ROUTER"),
            implementation: vm.envAddress("MONADEUM_KURU_ORDERBOOK_IMPLEMENTATION"),
            base: vm.envAddress("MONADEUM_MARKET_BASE"),
            quote: vm.envAddress("MONADEUM_MARKET_QUOTE"),
            baseDecimals: uint8(_bounded("MONADEUM_MARKET_BASE_DECIMALS", type(uint8).max)),
            quoteDecimals: uint8(_bounded("MONADEUM_MARKET_QUOTE_DECIMALS", type(uint8).max)),
            sizePrecision: uint96(_bounded("MONADEUM_MARKET_SIZE_PRECISION", type(uint96).max)),
            pricePrecision: uint32(_bounded("MONADEUM_MARKET_PRICE_PRECISION", type(uint32).max)),
            tickSize: uint32(_bounded("MONADEUM_MARKET_TICK_SIZE", type(uint32).max)),
            minSize: uint96(_bounded("MONADEUM_MARKET_MIN_SIZE", type(uint96).max)),
            maxSize: uint96(_bounded("MONADEUM_MARKET_MAX_SIZE", type(uint96).max)),
            takerFeeBps: vm.envUint("MONADEUM_MARKET_TAKER_FEE_BPS"),
            makerFeeBps: vm.envUint("MONADEUM_MARKET_MAKER_FEE_BPS"),
            ammSpread: uint96(_bounded("MONADEUM_MARKET_AMM_SPREAD", type(uint96).max))
        });
    }

    function run() external returns (address market) {
        Inputs memory inputs = inputsFromEnv();
        check(inputs);
        address predicted = predict(inputs);
        bool existed = predicted.code.length > 0;

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address expected = vm.envOr("MONADEUM_EXPECTED_DEPLOYER", address(0));
        if (expected != address(0) && deployer != expected) revert WrongDeployer(expected, deployer);
        if (existed) {
            market = predicted;
        } else {
            market = deploy(inputs);
        }
        vm.stopBroadcast();

        if (market != predicted) revert PostCondition("market address differs from the router's prediction");
        verify(inputs, market);
        address vault = IKuruRouter(inputs.router).computeVaultAddress(market, address(0), false);
        write(inputs, market, vault, deployer, existed);
        console2.log(existed ? "market already exists, nothing sent" : "market created");
        console2.log("market   ", market);
        console2.log("AMM vault", vault);
        console2.log("deployer ", deployer);
        console2.log("written to", OUTPUT);
    }

    /// Every precondition the chain can show, checked before anything is sent.
    function check(Inputs memory inputs) public view {
        if (block.chainid != MONAD_TESTNET) revert WrongChain(block.chainid);
        if (inputs.router.code.length == 0) revert NoCode("router", inputs.router);
        if (inputs.base.code.length == 0) revert NoCode("base", inputs.base);
        if (inputs.quote.code.length == 0) revert NoCode("quote", inputs.quote);
        uint8 baseDecimals = IErc20Min(inputs.base).decimals();
        if (baseDecimals != inputs.baseDecimals) revert WrongDecimals("base", inputs.baseDecimals, baseDecimals);
        uint8 quoteDecimals = IErc20Min(inputs.quote).decimals();
        if (quoteDecimals != inputs.quoteDecimals) revert WrongDecimals("quote", inputs.quoteDecimals, quoteDecimals);
        address implementation = IKuruRouter(inputs.router).orderBookImplementation();
        if (implementation != inputs.implementation) revert WrongImplementation(inputs.implementation, implementation);
        require(inputs.takerFeeBps == 0 && inputs.makerFeeBps == 0, "the testnet market is decided with zero fees");
        require(inputs.minSize > 0 && inputs.maxSize > inputs.minSize, "size bounds");
    }

    /// The market's address before it exists: the router's own CREATE2 prediction for its current implementation.
    function predict(Inputs memory inputs) public view returns (address) {
        return IKuruRouter(inputs.router)
            .computeAddress(
                inputs.base,
                inputs.quote,
                inputs.sizePrecision,
                inputs.pricePrecision,
                inputs.tickSize,
                inputs.minSize,
                inputs.maxSize,
                inputs.takerFeeBps,
                inputs.makerFeeBps,
                inputs.ammSpread,
                address(0),
                false
            );
    }

    function deploy(Inputs memory inputs) internal returns (address) {
        return IKuruRouter(inputs.router)
            .deployProxy(
                NO_NATIVE,
                inputs.base,
                inputs.quote,
                inputs.sizePrecision,
                inputs.pricePrecision,
                inputs.tickSize,
                inputs.minSize,
                inputs.maxSize,
                inputs.takerFeeBps,
                inputs.makerFeeBps,
                inputs.ammSpread
            );
    }

    /// Reads the market back from the router's registry and from the market itself. An existing market at the
    /// predicted address is held to the same checks, so a market created by someone else with these parameters is
    /// accepted only if it is exactly the market this script would create.
    function verify(Inputs memory inputs, address market) public view {
        if (market.code.length == 0) revert NoCode("market", market);
        _compare(inputs, market, inputs.router, abi.encodeCall(IKuruRouter.verifiedMarket, (market)), "router registry");
        _compare(inputs, market, market, abi.encodeCall(IKuruOrderBook.getMarketParams, ()), "getMarketParams");
        bytes32 slot = vm.load(market, EIP1967_IMPLEMENTATION_SLOT);
        if (address(uint160(uint256(slot))) != inputs.implementation) revert PostCondition("EIP-1967 implementation");
    }

    /// `verifiedMarket(market)` and `getMarketParams()` return the same eleven fields in the same order.
    function _compare(Inputs memory inputs, address market, address target, bytes memory call, string memory what)
        internal
        view
    {
        (bool ok, bytes memory ret) = target.staticcall(call);
        if (!ok) revert ExistingMarketDiffers(market, what);
        MarketParams memory m = abi.decode(ret, (MarketParams));
        if (
            m.pricePrecision != inputs.pricePrecision || m.sizePrecision != inputs.sizePrecision
                || m.base != inputs.base || m.baseDecimals != inputs.baseDecimals || m.quote != inputs.quote
                || m.quoteDecimals != inputs.quoteDecimals || m.tickSize != inputs.tickSize
                || m.minSize != inputs.minSize || m.maxSize != inputs.maxSize || m.takerFeeBps != inputs.takerFeeBps
                || m.makerFeeBps != inputs.makerFeeBps
        ) revert ExistingMarketDiffers(market, what);
    }

    function write(Inputs memory inputs, address market, address vault, address deployer, bool existed) internal {
        string memory p = "params";
        vm.serializeAddress(p, "base", inputs.base);
        vm.serializeAddress(p, "quote", inputs.quote);
        vm.serializeUint(p, "baseDecimals", inputs.baseDecimals);
        vm.serializeUint(p, "quoteDecimals", inputs.quoteDecimals);
        vm.serializeUint(p, "sizePrecision", inputs.sizePrecision);
        vm.serializeUint(p, "pricePrecision", inputs.pricePrecision);
        vm.serializeUint(p, "tickSize", inputs.tickSize);
        vm.serializeUint(p, "minSize", inputs.minSize);
        vm.serializeUint(p, "maxSize", inputs.maxSize);
        vm.serializeUint(p, "takerFeeBps", inputs.takerFeeBps);
        vm.serializeUint(p, "makerFeeBps", inputs.makerFeeBps);
        string memory params = vm.serializeUint(p, "kuruAmmSpread", inputs.ammSpread);

        string memory r = "root";
        vm.serializeUint(r, "chainId", block.chainid);
        vm.serializeString(
            r,
            "mode",
            existed
                ? "existing market found, nothing sent"
                : vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? "broadcast" : "simulation (nothing was sent)"
        );
        vm.serializeString(r, "pair", "WMON/USDC");
        vm.serializeAddress(r, "router", inputs.router);
        vm.serializeAddress(r, "orderBookImplementation", inputs.implementation);
        vm.serializeAddress(r, "market", market);
        vm.serializeAddress(r, "ammVault", vault);
        vm.serializeAddress(r, "deployer", deployer);
        vm.serializeUint(r, "forkBlock", block.number);
        string memory json = vm.serializeString(r, "params", params);
        vm.writeJson(json, OUTPUT);
    }

    function _bounded(string memory name, uint256 max) internal view returns (uint256 value) {
        value = vm.envUint(name);
        require(value <= max, string.concat(name, " out of range"));
    }
}
