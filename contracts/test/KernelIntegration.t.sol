// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentSpendPolicy} from "../src/AgentSpendPolicy.sol";
import {IAgentSpendPolicy} from "../src/IAgentSpendPolicy.sol";
import {PackedUserOperation} from "../src/kernel/IKernelModules.sol";
import {MockERC20, MockKernelAccount} from "./utils/Mocks.sol";

/// Exercises the Kernel v3.1 policy and hook entry points with calldata built to Kernel's encoding, and an
/// end-to-end flow through MockKernelAccount. None of this runs a real Kernel account; see Mocks.sol.
contract KernelIntegrationTest is Test {
    bytes4 internal constant EXECUTE = bytes4(keccak256("execute(bytes32,bytes)"));
    bytes4 internal constant TRANSFER = 0xa9059cbb;
    bytes4 internal constant APPROVE = 0x095ea7b3;
    bytes4 internal constant SWAP = bytes4(keccak256("swap(bytes)"));
    bytes32 internal constant SINGLE = bytes32(0);
    bytes32 internal constant BATCH = bytes32(bytes1(0x01));

    AgentSpendPolicy internal policy;
    MockERC20 internal token;
    MockKernelAccount internal kernel;
    address internal router;

    function setUp() public {
        vm.warp(1_790_000_000);
        token = new MockERC20();
        policy = new AgentSpendPolicy(address(token));
        kernel = new MockKernelAccount(address(policy), address(policy));
        router = makeAddr("router");
        token.mint(address(kernel), 1_000e6);

        _owner(abi.encodeCall(IAgentSpendPolicy.setLimits, (IAgentSpendPolicy.Limits(100e6, 150e6))));
        _owner(abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(token), TRANSFER, true)));
        _owner(abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(token), APPROVE, true)));
        _owner(abi.encodeCall(IAgentSpendPolicy.setAllowed, (router, SWAP, true)));
    }

    // --- encoding helpers, matching Kernel v3.1 ExecLib -------------------------------------------------------------

    function _owner(bytes memory data) internal {
        kernel.ownerCall(address(policy), data);
    }

    function _single(address target, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXECUTE, SINGLE, abi.encodePacked(target, value, data));
    }

    function _batch(IAgentSpendPolicy.Call[] memory calls) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXECUTE, BATCH, abi.encode(calls));
    }

    function _wrap(bytes memory inner) internal pure returns (bytes memory) {
        return abi.encodePacked(MockKernelAccount.executeUserOp.selector, inner);
    }

    function _op(bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op.sender = address(kernel);
        op.callData = callData;
    }

    function _transferData(address to, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(TRANSFER, to, amount);
    }

    function _tx(address to, uint256 amount) internal view returns (IAgentSpendPolicy.Call memory) {
        return IAgentSpendPolicy.Call(address(token), 0, _transferData(to, amount));
    }

    // --- selectors and module metadata -----------------------------------------------------------------------------

    function test_selectorsMatchKernelAbi() public pure {
        assertEq(EXECUTE, bytes4(0xe9ae5c53), "execute(bytes32,bytes)");
        assertEq(
            MockKernelAccount.executeUserOp.selector, bytes4(0x8dd7712f), "executeUserOp(PackedUserOperation,bytes32)"
        );
    }

    function test_moduleTypes() public view {
        assertTrue(policy.isModuleType(4), "hook");
        assertTrue(policy.isModuleType(5), "policy");
        assertFalse(policy.isModuleType(1), "not a validator");
        assertFalse(policy.isModuleType(2), "not an executor");
        assertTrue(policy.isInitialized(address(kernel)));
    }

    function test_installAndUninstallChangeNoState() public {
        vm.startPrank(address(kernel));
        policy.onInstall(abi.encodePacked(bytes32(uint256(1)), hex"00"));
        policy.onUninstall(abi.encodePacked(bytes32(uint256(1)), hex"00"));
        vm.stopPrank();
        assertEq(policy.limits(address(kernel)).dailyCap, 150e6);
        assertTrue(policy.isAllowed(address(kernel), router, SWAP));
    }

    function test_signaturePolicyAlwaysFails() public view {
        assertEq(policy.checkSignaturePolicy(bytes32(0), address(kernel), keccak256("x"), ""), 1);
    }

    // --- policy entry point: accepted shapes ----------------------------------------------------------------------

    function test_policy_acceptsSingleAndBatchWrappedOrNot() public {
        bytes memory single = _single(address(token), 0, _transferData(router, 10e6));
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](2);
        calls[0] = _tx(router, 10e6);
        calls[1] = IAgentSpendPolicy.Call(router, 0, abi.encodeWithSelector(SWAP, hex"01"));
        bytes memory batch = _batch(calls);

        assertEq(kernel.validateOnly(_op(single)), 0);
        assertEq(kernel.validateOnly(_op(_wrap(single))), 0);
        assertEq(kernel.validateOnly(_op(batch)), 0);
        assertEq(kernel.validateOnly(_op(_wrap(batch))), 0);
    }

    function test_policy_acceptsTryExecType() public {
        bytes32 tryBatch = bytes32(bytes2(0x0101));
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](1);
        calls[0] = _tx(router, 1);
        assertEq(kernel.validateOnly(_op(abi.encodeWithSelector(EXECUTE, tryBatch, abi.encode(calls)))), 0);
    }

    function test_policy_emptyBatchCountsZero() public {
        assertEq(kernel.validateOnly(_op(_batch(new IAgentSpendPolicy.Call[](0)))), 0);
    }

    // --- policy entry point: rejected shapes ----------------------------------------------------------------------

    function test_policy_rejectsDelegatecall() public {
        bytes32 mode = bytes32(bytes1(0xff));
        bytes memory cd = abi.encodeWithSelector(EXECUTE, mode, abi.encodePacked(router, _transferData(router, 1)));
        vm.expectRevert(abi.encodeWithSelector(AgentSpendPolicy.UnsupportedExecMode.selector, mode));
        kernel.validateOnly(_op(_wrap(cd)));
    }

    function testFuzz_policy_rejectsEveryOtherCallType(bytes1 callType, bytes1 execType) public {
        vm.assume(callType != 0x00 && callType != 0x01);
        execType = bytes1(uint8(bound(uint8(execType), 0, 1)));
        bytes32 mode = bytes32(abi.encodePacked(callType, execType, bytes30(0)));
        bytes memory cd =
            abi.encodeWithSelector(EXECUTE, mode, abi.encodePacked(router, uint256(0), _transferData(router, 1)));
        vm.expectRevert(abi.encodeWithSelector(AgentSpendPolicy.UnsupportedExecMode.selector, mode));
        kernel.validateOnly(_op(_wrap(cd)));
    }

    function testFuzz_policy_rejectsUnknownExecType(bytes1 execType) public {
        vm.assume(execType != 0x00 && execType != 0x01);
        bytes32 mode = bytes32(abi.encodePacked(bytes1(0x00), execType, bytes30(0)));
        bytes memory cd =
            abi.encodeWithSelector(EXECUTE, mode, abi.encodePacked(router, uint256(0), _transferData(router, 1)));
        vm.expectRevert(abi.encodeWithSelector(AgentSpendPolicy.UnsupportedExecMode.selector, mode));
        kernel.validateOnly(_op(cd));
    }

    function test_policy_rejectsOtherAccountSelectors() public {
        bytes[6] memory cds = [
            abi.encodeWithSignature("installModule(uint256,address,bytes)", 1, address(0xBEEF), hex""),
            abi.encodeWithSignature("uninstallModule(uint256,address,bytes)", 5, address(policy), hex""),
            abi.encodeWithSignature("upgradeTo(address)", address(0xBEEF)),
            abi.encodeWithSignature("executeFromExecutor(bytes32,bytes)", SINGLE, hex""),
            abi.encodeWithSignature(
                "changeRootValidator(bytes21,address,bytes,bytes)", bytes21(0), address(0), hex"", hex""
            ),
            abi.encodeWithSignature("invalidateNonce(uint32)", uint32(9))
        ];
        for (uint256 i = 0; i < cds.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(AgentSpendPolicy.UnsupportedAccountCall.selector, bytes4(cds[i])));
            kernel.validateOnly(_op(_wrap(cds[i])));
            vm.expectRevert(abi.encodeWithSelector(AgentSpendPolicy.UnsupportedAccountCall.selector, bytes4(cds[i])));
            kernel.validateOnly(_op(cds[i]));
        }
    }

    function test_policy_rejectsEmptyAndShortCallData() public {
        vm.expectRevert(abi.encodeWithSelector(AgentSpendPolicy.UnsupportedAccountCall.selector, bytes4(0)));
        kernel.validateOnly(_op(""));
        vm.expectRevert(abi.encodeWithSelector(AgentSpendPolicy.UnsupportedAccountCall.selector, bytes4(0)));
        kernel.validateOnly(_op(_wrap("")));
    }

    function test_policy_rejectsMalformedExecutionData() public {
        // Offset to executionCalldata points past the end.
        bytes memory cd = abi.encodePacked(EXECUTE, SINGLE, uint256(0x1000));
        vm.expectRevert();
        kernel.validateOnly(_op(cd));
        // Single execution shorter than target + value.
        cd = abi.encodeWithSelector(EXECUTE, SINGLE, abi.encodePacked(router));
        vm.expectRevert();
        kernel.validateOnly(_op(cd));
        // Batch whose array length exceeds the data.
        cd = abi.encodeWithSelector(EXECUTE, BATCH, abi.encode(uint256(0x20), uint256(5)));
        vm.expectRevert();
        kernel.validateOnly(_op(cd));
    }

    function test_policy_appliesCheckRules() public {
        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, stranger, TRANSFER));
        kernel.validateOnly(_op(_wrap(_single(stranger, 0, _transferData(router, 1)))));

        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.RecipientNotAllowed.selector, stranger));
        kernel.validateOnly(_op(_wrap(_single(address(token), 0, _transferData(stranger, 1)))));

        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.NativeValueNotAllowed.selector, 1));
        kernel.validateOnly(_op(_wrap(_single(router, 1, abi.encodeWithSelector(SWAP, hex"")))));

        bytes4 setLimitsSel = IAgentSpendPolicy.setLimits.selector;
        _owner(abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(policy), setLimitsSel, true)));
        bytes memory raise = abi.encodeCall(
            IAgentSpendPolicy.setLimits, (IAgentSpendPolicy.Limits(type(uint128).max, type(uint128).max))
        );
        vm.expectRevert(
            abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, address(policy), setLimitsSel)
        );
        kernel.validateOnly(_op(_wrap(_single(address(policy), 0, raise))));
    }

    function testFuzz_policy_singleMatchesCheck(uint256 amount, bool approve) public {
        bytes memory data = abi.encodeWithSelector(approve ? APPROVE : TRANSFER, router, amount);
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](1);
        calls[0] = IAgentSpendPolicy.Call(address(token), 0, data);
        bytes memory cd = _wrap(_single(address(token), 0, data));
        try policy.check(address(kernel), calls) {
            assertEq(kernel.validateOnly(_op(cd)), 0);
        } catch (bytes memory reason) {
            vm.expectRevert(reason);
            kernel.validateOnly(_op(cd));
        }
    }

    // --- hook entry point ------------------------------------------------------------------------------------------

    function test_hook_recordsForCallingAccount() public {
        vm.prank(address(kernel));
        policy.preCheck(address(0xE4), 0, _single(address(token), 0, _transferData(router, 25e6)));
        assertEq(policy.windowTotal(address(kernel)), 25e6);
    }

    function test_hook_rejectsWrappedAndForeignCallData() public {
        bytes memory inner = _single(address(token), 0, _transferData(router, 1));
        vm.prank(address(kernel));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentSpendPolicy.UnsupportedAccountCall.selector, MockKernelAccount.executeUserOp.selector
            )
        );
        policy.preCheck(address(0xE4), 0, _wrap(inner));

        bytes memory fromExecutor = abi.encodeWithSignature("executeFromExecutor(bytes32,bytes)", SINGLE, hex"");
        vm.prank(address(kernel));
        vm.expectRevert(abi.encodeWithSelector(AgentSpendPolicy.UnsupportedAccountCall.selector, bytes4(fromExecutor)));
        policy.preCheck(address(0xE4), 0, fromExecutor);
    }

    // --- end to end through the mock account -----------------------------------------------------------------------

    /// The issue #18 batched case end to end: two transfers, each under perTxCap, in one operation. Their sum is over
    /// the cap, so validation rejects the operation and nothing moves.
    function test_e2e_batchOverPerTxCapRejectedInValidation() public {
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](2);
        calls[0] = _tx(router, 60e6);
        calls[1] = _tx(router, 60e6);
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, 120e6, 100e6));
        kernel.handleSessionKeyOp(_op(_wrap(_batch(calls))));
        assertEq(token.balanceOf(router), 0);
    }

    function test_e2e_batchWithinCapsMovesFundsAndRecords() public {
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](3);
        calls[0] = _tx(router, 40e6);
        calls[1] = IAgentSpendPolicy.Call(address(token), 0, abi.encodeWithSelector(APPROVE, router, 50e6));
        calls[2] = _tx(router, 10e6);
        kernel.handleSessionKeyOp(_op(_wrap(_batch(calls))));
        assertEq(token.balanceOf(router), 50e6);
        assertEq(token.allowance(address(kernel), router), 50e6);
        assertEq(policy.windowTotal(address(kernel)), 100e6);
    }

    /// The daily cap is enforced in execution: the operation passes validation, then the hook reverts it, and the
    /// transfer does not happen.
    function test_e2e_dailyCapBreachRevertsInExecution() public {
        kernel.handleSessionKeyOp(_op(_wrap(_single(address(token), 0, _transferData(router, 100e6)))));
        bytes memory next = _wrap(_single(address(token), 0, _transferData(router, 60e6)));
        assertEq(kernel.validateOnly(_op(next)), 0, "validation cannot see the daily cap");
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.DailyCapExceeded.selector, 160e6, 150e6));
        kernel.handleSessionKeyOp(_op(next));
        assertEq(token.balanceOf(router), 100e6);

        vm.warp(block.timestamp + 25 hours);
        kernel.handleSessionKeyOp(_op(next));
        assertEq(token.balanceOf(router), 160e6);
    }

    function test_e2e_sessionKeyCannotRaiseOwnCaps() public {
        _owner(
            abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(policy), IAgentSpendPolicy.setLimits.selector, true))
        );
        bytes memory raise = abi.encodeCall(
            IAgentSpendPolicy.setLimits, (IAgentSpendPolicy.Limits(type(uint128).max, type(uint128).max))
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                IAgentSpendPolicy.CallNotAllowed.selector, address(policy), IAgentSpendPolicy.setLimits.selector
            )
        );
        kernel.handleSessionKeyOp(_op(_wrap(_single(address(policy), 0, raise))));
        assertEq(policy.limits(address(kernel)).perTxCap, 100e6);
    }
}
