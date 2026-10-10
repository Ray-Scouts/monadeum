// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title Kernel v3.1 module interfaces, the subset AgentSpendPolicy implements
/// @notice Declared here to match the ABI of ZeroDev Kernel v3.1 (github.com/zerodevapp/kernel, tag v3.1, commit
/// 03f7f5cf5871cda0070e4223f196f5b577f6cde2): `src/interfaces/IERC7579Modules.sol` and the ERC-4337 v0.7
/// `PackedUserOperation`. They are declared rather than imported so the Foundry project depends on forge-std only.
/// The function signatures, and so the selectors, are what Kernel calls; a mismatch would make Kernel's calls revert,
/// which fails closed. Whether a real Kernel v3.1 account drives these entry points as expected is not verified by
/// this repository's tests, which exercise them with calldata built to Kernel's encoding (see ARCHITECTURE.md 16.3).

/// ERC-4337 v0.7 packed user operation, field order and types as in the EntryPoint v0.7 ABI.
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IModule {
    function onInstall(bytes calldata data) external payable;
    function onUninstall(bytes calldata data) external payable;
    function isModuleType(uint256 moduleTypeId) external view returns (bool);
    function isInitialized(address smartAccount) external view returns (bool);
}

/// Kernel calls `preCheck` from the account, with `msgData` set to the user operation's call data after the
/// `executeUserOp` selector, and `postCheck` after execution with the bytes `preCheck` returned.
interface IHook is IModule {
    function preCheck(address msgSender, uint256 msgValue, bytes calldata msgData)
        external
        payable
        returns (bytes memory hookData);

    function postCheck(bytes calldata hookData) external payable;
}

/// Kernel calls both from the account, for each policy of a permission. A nonzero result's low 160 bits make Kernel
/// revert the validation with `PolicyFailed`.
interface IPolicy is IModule {
    function checkUserOpPolicy(bytes32 id, PackedUserOperation calldata userOp) external payable returns (uint256);

    function checkSignaturePolicy(bytes32 id, address sender, bytes32 hash, bytes calldata sig)
        external
        view
        returns (uint256);
}
