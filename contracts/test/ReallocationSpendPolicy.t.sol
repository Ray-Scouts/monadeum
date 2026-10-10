// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentReallocation} from "../src/AgentReallocation.sol";
import {AgentSpendPolicy} from "../src/AgentSpendPolicy.sol";
import {IAgentReallocation} from "../src/IAgentReallocation.sol";
import {IAgentSpendPolicy} from "../src/IAgentSpendPolicy.sol";
import {PackedUserOperation} from "../src/kernel/IKernelModules.sol";
import {MockERC20, MockKernelAccount} from "./utils/Mocks.sol";

/// How a reallocation passes through the source's spend policy (ARCHITECTURE.md sections 16.3 and 16.5). The source is
/// a Kernel test double whose session-key operations run the spend policy as policy and hook. A move is one batched
/// operation: `approve(reallocation, total)` on the settlement asset, which the spend policy counts, then
/// `reallocate(...)`, which it counts as 0. Not a deployed Kernel account; see Mocks.sol.
contract ReallocationSpendPolicyTest is Test {
    bytes4 internal constant EXECUTE = bytes4(keccak256("execute(bytes32,bytes)"));
    bytes4 internal constant TRANSFER = 0xa9059cbb;
    bytes4 internal constant APPROVE = 0x095ea7b3;
    bytes32 internal constant BATCH = bytes32(bytes1(0x01));

    uint128 internal constant PER_TX_CAP = 30e6;
    uint128 internal constant DAILY_CAP = 50e6;

    MockERC20 internal token;
    AgentSpendPolicy internal spend;
    AgentReallocation internal realloc;
    MockKernelAccount internal source;
    address internal sink;
    address internal owner;
    address internal operator;
    bytes32 internal policyHash;

    function setUp() public {
        vm.warp(1_790_000_000);
        token = new MockERC20();
        spend = new AgentSpendPolicy(address(token));
        operator = makeAddr("operator");
        realloc = new AgentReallocation(address(token), makeAddr("admin"), operator);
        source = new MockKernelAccount(address(spend), address(spend));
        sink = makeAddr("sink");
        owner = makeAddr("owner");

        vm.startPrank(operator);
        realloc.registerAgent(address(source), owner, 100e6);
        realloc.registerAgent(sink, owner, 100e6);
        realloc.advanceEvaluation();
        vm.stopPrank();
        token.mint(address(source), 1_000e6); // reallocation cap is 200 units, so the spend caps bind first
        token.mint(sink, 10e6);

        address[] memory agents = new address[](2);
        agents[0] = address(source);
        agents[1] = sink;
        uint256 floor = realloc.capitalFloor();
        vm.prank(owner);
        policyHash = realloc.commitPolicy(
            IAgentReallocation.Policy({
                owner: owner, agents: agents, capBps: 2_000, slotCeilingBps: 40_000, capitalFloor: floor, nonce: 0
            })
        );

        // The MVP allowlist shape: settlement-asset transfer and approve, and the reallocation entry point.
        _owner(abi.encodeCall(IAgentSpendPolicy.setLimits, (IAgentSpendPolicy.Limits(PER_TX_CAP, DAILY_CAP))));
        _owner(abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(token), TRANSFER, true)));
        _owner(abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(token), APPROVE, true)));
        _owner(
            abi.encodeCall(
                IAgentSpendPolicy.setAllowed, (address(realloc), IAgentReallocation.reallocate.selector, true)
            )
        );
    }

    // --- helpers ---------------------------------------------------------------------------------------------------

    function _owner(bytes memory data) internal {
        source.ownerCall(address(spend), data);
    }

    function _moveOp(uint256 approveAmount, uint256 amount) internal view returns (PackedUserOperation memory op) {
        IAgentReallocation.Credit[] memory credits = new IAgentReallocation.Credit[](1);
        credits[0] = IAgentReallocation.Credit(sink, amount);
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](2);
        calls[0] =
            IAgentSpendPolicy.Call(address(token), 0, abi.encodeWithSelector(APPROVE, address(realloc), approveAmount));
        calls[1] = IAgentSpendPolicy.Call(
            address(realloc),
            0,
            abi.encodeCall(IAgentReallocation.reallocate, (realloc.currentEvaluation(), policyHash, credits))
        );
        op = _op(calls);
    }

    function _op(IAgentSpendPolicy.Call[] memory calls) internal view returns (PackedUserOperation memory op) {
        op.sender = address(source);
        op.callData = abi.encodePacked(
            MockKernelAccount.executeUserOp.selector, abi.encodeWithSelector(EXECUTE, BATCH, abi.encode(calls))
        );
    }

    function _single(address target, bytes memory data) internal view returns (PackedUserOperation memory) {
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](1);
        calls[0] = IAgentSpendPolicy.Call(target, 0, data);
        return _op(calls);
    }

    // --- tests -----------------------------------------------------------------------------------------------------

    /// The approval is counted in full against the window, and the reallocate call adds nothing.
    function test_batchedMoveIsCountedOnceByTheSpendPolicy() public {
        PackedUserOperation memory op = _moveOp(20e6, 20e6);
        assertEq(spend.check(address(source), _calls(op)), 20e6);
        source.handleSessionKeyOp(op);
        assertEq(spend.windowTotal(address(source)), 20e6);
        assertEq(token.balanceOf(address(source)), 980e6);
        assertEq(token.balanceOf(sink), 30e6);
    }

    function test_approveAbovePerTxCapIsRejectedInValidation() public {
        PackedUserOperation memory op = _moveOp(PER_TX_CAP + 1, PER_TX_CAP + 1);
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, PER_TX_CAP + 1, PER_TX_CAP));
        source.validateOnly(op);
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, PER_TX_CAP + 1, PER_TX_CAP));
        source.handleSessionKeyOp(op);
        assertEq(token.balanceOf(sink), 10e6);
    }

    function test_movesAcrossEvaluationsShareTheDailyCap() public {
        source.handleSessionKeyOp(_moveOp(30e6, 30e6));
        vm.prank(operator);
        realloc.advanceEvaluation();
        PackedUserOperation memory op = _moveOp(25e6, 25e6);
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.DailyCapExceeded.selector, 55e6, DAILY_CAP));
        source.handleSessionKeyOp(op);
        assertEq(token.balanceOf(sink), 40e6);
        assertEq(spend.windowTotal(address(source)), 30e6);
    }

    /// Within the spend caps, the reallocation contract's own bounds still apply, and a reverted move is not counted.
    function test_reallocationBoundsStillBindUnderTheSpendCaps() public {
        vm.prank(operator);
        realloc.setPrincipal(sink, 5e6); // ceiling 20 units, sink holds 10
        source.handleSessionKeyOp(_moveOp(10e6, 10e6));
        vm.prank(operator);
        realloc.advanceEvaluation();
        PackedUserOperation memory op = _moveOp(1, 1);
        vm.expectRevert(MockKernelAccount.ExecutionReverted.selector);
        source.handleSessionKeyOp(op);
        assertEq(spend.windowTotal(address(source)), 10e6);
    }

    /// A second move in the same evaluation fails even though the spend caps would allow it.
    function test_oneDebitPerEvaluationUnderTheSpendPolicy() public {
        PackedUserOperation memory op = _moveOp(5e6, 5e6);
        source.handleSessionKeyOp(op);
        vm.expectRevert(MockKernelAccount.ExecutionReverted.selector);
        source.handleSessionKeyOp(op);
    }

    /// The session key cannot route around the contract's bounds by paying the sink directly: the sink is not an
    /// allowlisted recipient.
    function test_directTransferToSinkIsRejectedByTheRecipientRule() public {
        PackedUserOperation memory op = _single(address(token), abi.encodeWithSelector(TRANSFER, sink, 1e6));
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.RecipientNotAllowed.selector, sink));
        source.validateOnly(op);
    }

    /// Only `reallocate` is allowlisted, so a session key cannot reach the owner or operator functions.
    function test_sessionKeyCannotReachOwnerOrOperatorFunctions() public {
        bytes[] memory datas = new bytes[](4);
        datas[0] = abi.encodeCall(IAgentReallocation.revokePolicy, ());
        datas[1] = abi.encodeCall(IAgentReallocation.retire, (sink));
        datas[2] = abi.encodeCall(IAgentReallocation.registerAgent, (sink, owner, 1));
        datas[3] = abi.encodeCall(IAgentReallocation.advanceEvaluation, ());
        for (uint256 i = 0; i < datas.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, address(realloc), bytes4(datas[i]))
            );
            source.validateOnly(_single(address(realloc), datas[i]));
        }
    }

    /// Without the allowlist entry, the reallocation contract is not an allowed spender.
    function test_unlistedReallocationContractIsNotAnAllowedSpender() public {
        _owner(
            abi.encodeCall(
                IAgentSpendPolicy.setAllowed, (address(realloc), IAgentReallocation.reallocate.selector, false)
            )
        );
        PackedUserOperation memory op = _moveOp(1e6, 1e6);
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.RecipientNotAllowed.selector, address(realloc)));
        source.validateOnly(op);
    }

    function _calls(PackedUserOperation memory op) internal pure returns (IAgentSpendPolicy.Call[] memory) {
        bytes memory cd = op.callData;
        // Strip executeUserOp (4) and execute (4) selectors, then decode (mode, executionCalldata).
        bytes memory args = new bytes(cd.length - 8);
        for (uint256 i = 0; i < args.length; ++i) {
            args[i] = cd[i + 8];
        }
        (, bytes memory exec) = abi.decode(args, (bytes32, bytes));
        return abi.decode(exec, (IAgentSpendPolicy.Call[]));
    }
}
