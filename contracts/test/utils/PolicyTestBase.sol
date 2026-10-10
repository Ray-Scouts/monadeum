// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentSpendPolicy} from "../../src/AgentSpendPolicy.sol";
import {IAgentSpendPolicy} from "../../src/IAgentSpendPolicy.sol";

/// Shared fixture: one policy, one configured account with the MVP allowlist shape (settlement asset transfer and
/// approve, one router selector, one reproduction selector).
abstract contract PolicyTestBase is Test {
    bytes4 internal constant TRANSFER = 0xa9059cbb;
    bytes4 internal constant APPROVE = 0x095ea7b3;
    bytes4 internal constant TRANSFER_FROM = 0x23b872dd;
    bytes4 internal constant INCREASE_ALLOWANCE = 0x39509351;
    bytes4 internal constant SWAP = bytes4(keccak256("swap(bytes)"));
    bytes4 internal constant REPRODUCE = bytes4(keccak256("reproduce(bytes32)"));

    uint128 internal constant PER_TX_CAP = 100e6;
    uint128 internal constant DAILY_CAP = 300e6;

    AgentSpendPolicy internal policy;
    address internal asset;
    address internal router;
    address internal repro;
    address internal account;

    function setUp() public virtual {
        // Start at a realistic timestamp so hour arithmetic never sits at the zero edge by accident.
        vm.warp(1_790_000_000);
        asset = makeAddr("settlementAsset");
        router = makeAddr("router");
        repro = makeAddr("reproduction");
        account = makeAddr("account");
        policy = new AgentSpendPolicy(asset);
        _configure(account, PER_TX_CAP, DAILY_CAP);
    }

    function _configure(address who, uint128 perTxCap, uint128 dailyCap) internal {
        vm.startPrank(who);
        policy.setLimits(IAgentSpendPolicy.Limits({perTxCap: perTxCap, dailyCap: dailyCap}));
        policy.setAllowed(asset, TRANSFER, true);
        policy.setAllowed(asset, APPROVE, true);
        policy.setAllowed(router, SWAP, true);
        policy.setAllowed(repro, REPRODUCE, true);
        vm.stopPrank();
    }

    function _transfer(address to, uint256 amount) internal view returns (IAgentSpendPolicy.Call memory) {
        return IAgentSpendPolicy.Call({target: asset, value: 0, data: abi.encodeWithSelector(TRANSFER, to, amount)});
    }

    function _approve(address spender, uint256 amount) internal view returns (IAgentSpendPolicy.Call memory) {
        return IAgentSpendPolicy.Call({target: asset, value: 0, data: abi.encodeWithSelector(APPROVE, spender, amount)});
    }

    function _swap() internal view returns (IAgentSpendPolicy.Call memory) {
        return IAgentSpendPolicy.Call({target: router, value: 0, data: abi.encodeWithSelector(SWAP, hex"beef")});
    }

    function _one(IAgentSpendPolicy.Call memory c) internal pure returns (IAgentSpendPolicy.Call[] memory calls) {
        calls = new IAgentSpendPolicy.Call[](1);
        calls[0] = c;
    }

    function _two(IAgentSpendPolicy.Call memory a, IAgentSpendPolicy.Call memory b)
        internal
        pure
        returns (IAgentSpendPolicy.Call[] memory calls)
    {
        calls = new IAgentSpendPolicy.Call[](2);
        calls[0] = a;
        calls[1] = b;
    }

    function _record(address who, IAgentSpendPolicy.Call[] memory calls) internal {
        vm.prank(who);
        policy.record(calls);
    }
}
