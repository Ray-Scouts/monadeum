// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentCommitments} from "../src/AgentCommitments.sol";
import {IAgentCommitments} from "../src/IAgentCommitments.sol";
import {DeployAgentCommitments} from "../script/DeployAgentCommitments.s.sol";

contract AgentCommitmentsTest is Test {
    AgentCommitments internal commitments;
    address internal account = makeAddr("account");
    bytes32 internal constant GENOME = keccak256("genome");
    bytes32 internal constant STRATEGY = keccak256("strategy");

    function setUp() public {
        commitments = new AgentCommitments();
    }

    function test_commitRecordsTheCallersHashesAndEmits() public {
        vm.expectEmit(true, false, false, true, address(commitments));
        emit IAgentCommitments.AgentCommitted(account, GENOME, STRATEGY);
        vm.prank(account);
        commitments.commit(GENOME, STRATEGY);
        IAgentCommitments.Commitment memory c = commitments.commitmentOf(account);
        assertEq(c.genomeHash, GENOME);
        assertEq(c.strategyVersionHash, STRATEGY);
    }

    function test_noCommitmentReadsAsZero() public view {
        IAgentCommitments.Commitment memory c = commitments.commitmentOf(account);
        assertEq(c.genomeHash, bytes32(0));
        assertEq(c.strategyVersionHash, bytes32(0));
    }

    function test_commitmentIsWriteOnce() public {
        vm.prank(account);
        commitments.commit(GENOME, STRATEGY);
        vm.prank(account);
        vm.expectRevert(abi.encodeWithSelector(IAgentCommitments.AlreadyCommitted.selector, account));
        commitments.commit(keccak256("other genome"), STRATEGY);
        vm.prank(account);
        vm.expectRevert(abi.encodeWithSelector(IAgentCommitments.AlreadyCommitted.selector, account));
        commitments.commit(GENOME, keccak256("other strategy"));
        assertEq(commitments.commitmentOf(account).genomeHash, GENOME);
        assertEq(commitments.commitmentOf(account).strategyVersionHash, STRATEGY);
    }

    function test_zeroHashesAreRejected() public {
        vm.startPrank(account);
        vm.expectRevert(IAgentCommitments.ZeroHash.selector);
        commitments.commit(bytes32(0), STRATEGY);
        vm.expectRevert(IAgentCommitments.ZeroHash.selector);
        commitments.commit(GENOME, bytes32(0));
        vm.stopPrank();
        assertEq(commitments.commitmentOf(account).genomeHash, bytes32(0));
    }

    /// No caller can write, or overwrite, another account's commitment.
    function testFuzz_onlyTheCallersOwnSlotIsWritten(address caller, address other, bytes32 g, bytes32 s) public {
        vm.assume(caller != other);
        vm.assume(g != bytes32(0) && s != bytes32(0));
        vm.prank(other);
        commitments.commit(GENOME, STRATEGY);
        vm.prank(caller);
        commitments.commit(g, s);
        assertEq(commitments.commitmentOf(caller).genomeHash, g);
        assertEq(commitments.commitmentOf(caller).strategyVersionHash, s);
        assertEq(commitments.commitmentOf(other).genomeHash, GENOME);
        assertEq(commitments.commitmentOf(other).strategyVersionHash, STRATEGY);
    }
}

contract DeployAgentCommitmentsTest is Test {
    function test_refusesAnyChainButMonadTestnet() public {
        DeployAgentCommitments script = new DeployAgentCommitments();
        vm.chainId(143);
        vm.expectRevert(abi.encodeWithSelector(DeployAgentCommitments.WrongChain.selector, uint256(143)));
        script.run();
    }

    function test_verifyAcceptsAFreshDeployment() public {
        DeployAgentCommitments script = new DeployAgentCommitments();
        script.verify(new AgentCommitments());
    }
}
