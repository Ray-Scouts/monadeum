// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

/// The parts of Kuru's testnet contracts the WMON/USDC market scripts call, with the signatures shipped in the Kuru
/// TypeScript SDK 0.0.95 that libs/trading pins (`abi/Router.json`, `abi/OrderBook.json`, `abi/MarginAccount.json`)
/// and in Kuru's public contracts (`Kuru-Labs/Kuru-contracts-dex-public`, `contracts/Router.sol`, `OrderBook.sol`).

interface IKuruRouter {
    function deployProxy(
        uint8 _type,
        address _baseAssetAddress,
        address _quoteAssetAddress,
        uint96 _sizePrecision,
        uint32 _pricePrecision,
        uint32 _tickSize,
        uint96 _minSize,
        uint96 _maxSize,
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        uint96 _kuruAmmSpread
    ) external returns (address);

    function computeAddress(
        address _baseAssetAddress,
        address _quoteAssetAddress,
        uint96 _sizePrecision,
        uint32 _pricePrecision,
        uint32 _tickSize,
        uint96 _minSize,
        uint96 _maxSize,
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        uint96 _kuruAmmSpread,
        address oldImplementation,
        bool old
    ) external view returns (address);

    function computeVaultAddress(address _marketAddress, address oldImplementation, bool old)
        external
        view
        returns (address);

    function verifiedMarket(address)
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseAssetDecimals,
            address quoteAsset,
            uint256 quoteAssetDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );

    function orderBookImplementation() external view returns (address);
    function marginAccountAddress() external view returns (address);

    function anyToAnySwap(
        address[] calldata _marketAddresses,
        bool[] calldata _isBuy,
        bool[] calldata _nativeSend,
        address _debitToken,
        address _creditToken,
        uint256 _amount,
        uint256 _minAmountOut
    ) external payable returns (uint256);
}

interface IKuruOrderBook {
    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseAssetDecimals,
            address quoteAsset,
            uint256 quoteAssetDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );

    /// Whole quote units per whole base unit, times 1e18. An empty side reads as 0 (bid) or 2^256 - 1 (ask).
    function bestBidAsk() external view returns (uint256 bid, uint256 ask);

    function batchUpdate(
        uint32[] calldata buyPrices,
        uint96[] calldata buySizes,
        uint32[] calldata sellPrices,
        uint96[] calldata sellSizes,
        uint40[] calldata orderIdsToCancel,
        bool postOnly
    ) external;

    function s_orderIdCounter() external view returns (uint40);
}

interface IKuruMarginAccount {
    function deposit(address _user, address _token, uint256 _amount) external payable;
    function getBalance(address _user, address _token) external view returns (uint256);
}

interface IWrappedMon {
    function deposit() external payable;
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IErc20Min {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}
