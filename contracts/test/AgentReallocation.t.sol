// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {AgentReallocation} from "../src/AgentReallocation.sol";
import {IAgentReallocation} from "../src/IAgentReallocation.sol";
import {MockERC20, MockFalseToken, MockFeeToken} from "./utils/Mocks.sol";
import {ReallocationTestBase} from "./utils/ReallocationTestBase.sol";
import {TEST_EVALUATION_INTERVAL, multisig} from "./utils/Roles.sol";

contract AgentReallocationTest is ReallocationTestBase {
    // --- constants (EVOLUTION.md sections 3.1 and 6) ---------------------------------------------------------------

    function test_constantsMatchEvolutionDoc() public view {
        assertEq(realloc.REALLOCATION_CAP_BPS(), 2_000); // reallocation_cap 0.2
        assertEq(realloc.SLOT_CEILING_BPS(), 40_000); // slot_ceiling 4
        assertEq(realloc.capitalFloor(), FLOOR); // capital floor 0.06 of a six-decimal asset
        assertEq(realloc.settlementAsset(), address(token));
    }

    function test_capitalFloorScalesWithTokenDecimals() public {
        MockERC20 t18 = new MockERC20();
        t18.setDecimals(18);
        assertEq(new AgentReallocation(address(t18), admin, operator, TEST_EVALUATION_INTERVAL).capitalFloor(), 6e16);
        MockERC20 t2 = new MockERC20();
        t2.setDecimals(2);
        assertEq(new AgentReallocation(address(t2), admin, operator, TEST_EVALUATION_INTERVAL).capitalFloor(), 6);
    }

    function test_constructorRejectsBadInputs() public {
        MockERC20 t1 = new MockERC20();
        t1.setDecimals(1);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.UnsupportedDecimals.selector, uint8(1)));
        new AgentReallocation(address(t1), admin, operator, TEST_EVALUATION_INTERVAL);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.UnsupportedDecimals.selector, uint8(0)));
        new AgentReallocation(makeAddr("eoa"), admin, operator, TEST_EVALUATION_INTERVAL);
        vm.expectRevert(IAgentReallocation.ZeroAddress.selector);
        new AgentReallocation(address(token), address(0), operator, TEST_EVALUATION_INTERVAL);
        vm.expectRevert(IAgentReallocation.ZeroAddress.selector);
        new AgentReallocation(address(token), admin, address(0), TEST_EVALUATION_INTERVAL);
    }

    // --- the happy path ------------------------------------------------------------------------------------------

    function test_moveAtCapTransfersSourceToSinkAndEmits() public {
        uint256 amount = 20e6; // exactly 0.2 of a1's 100 units
        _setAllowance(a1, amount);
        vm.expectEmit(address(realloc));
        emit IAgentReallocation.Reallocated(ownerA, a1, a2, amount, 1);
        vm.prank(a1);
        assertEq(realloc.reallocate(1, policyA, _credits(a2, amount)), amount);
        assertEq(token.balanceOf(a1), PRINCIPAL - amount);
        assertEq(token.balanceOf(a2), PRINCIPAL + amount);
        assertEq(token.balanceOf(address(realloc)), 0);
        assertEq(token.allowance(a1, address(realloc)), 0);
        assertEq(realloc.lastDebitEvaluation(a1), 1);
    }

    function test_oneDebitMayCreditSeveralSinks() public {
        policyA = _commit(ownerA, _agents(a1, a2, a3), 2_000, 40_000, FLOOR);
        _setAllowance(a1, 20e6);
        vm.expectEmit(address(realloc));
        emit IAgentReallocation.Reallocated(ownerA, a1, a2, 12e6, 1);
        vm.expectEmit(address(realloc));
        emit IAgentReallocation.Reallocated(ownerA, a1, a3, 8e6, 1);
        vm.prank(a1);
        realloc.reallocate(1, policyA, _credits(a2, 12e6, a3, 8e6));
        assertEq(token.balanceOf(a1), 80e6);
        assertEq(token.balanceOf(a2), 112e6);
        assertEq(token.balanceOf(a3), 108e6);
    }

    // --- cap -------------------------------------------------------------------------------------------------------

    function test_capPlusOneReverts() public {
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 20e6 + 1),
            abi.encodeWithSelector(IAgentReallocation.CapExceeded.selector, 20e6 + 1, 20e6)
        );
    }

    function test_capAppliesToTheSumOfCredits() public {
        policyA = _commit(ownerA, _agents(a1, a2, a3), 2_000, 40_000, FLOOR);
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 10e6, a3, 10e6 + 1),
            abi.encodeWithSelector(IAgentReallocation.CapExceeded.selector, 20e6 + 1, 20e6)
        );
    }

    function test_ownerTighterCapBinds() public {
        policyA = _commit(ownerA, _agents(a1, a2), 1_000, 40_000, FLOOR);
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 10e6 + 1),
            abi.encodeWithSelector(IAgentReallocation.CapExceeded.selector, 10e6 + 1, 10e6)
        );
        _move(a1, policyA, _credits(a2, 10e6));
    }

    function test_capRoundsDown() public {
        _setBalance(a1, 1e6 + 4); // 0.2 of this is 200000.8 base units
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 200_001),
            abi.encodeWithSelector(IAgentReallocation.CapExceeded.selector, 200_001, 200_000)
        );
        _move(a1, policyA, _credits(a2, 200_000));
    }

    // --- floor -----------------------------------------------------------------------------------------------------

    function test_protocolFloorAtTheBound() public {
        // At a balance of floor / 0.8 the cap and the floor meet: moving the full cap leaves exactly the floor.
        _setBalance(a1, 75_000);
        _move(a1, policyA, _credits(a2, 15_000));
        assertEq(token.balanceOf(a1), FLOOR);
    }

    function test_protocolFloorMinusOneReverts() public {
        _setBalance(a1, 74_998); // cap is floor(14999.6) = 14999, which leaves 59999
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 14_999),
            abi.encodeWithSelector(IAgentReallocation.BelowFloor.selector, FLOOR - 1, FLOOR)
        );
    }

    function test_ownerHigherFloorBinds() public {
        policyA = _commit(ownerA, _agents(a1, a2), 2_000, 40_000, 90e6);
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 10e6 + 1),
            abi.encodeWithSelector(IAgentReallocation.BelowFloor.selector, 90e6 - 1, 90e6)
        );
        _move(a1, policyA, _credits(a2, 10e6));
        assertEq(token.balanceOf(a1), 90e6);
    }

    // --- ceiling ---------------------------------------------------------------------------------------------------

    function test_ceilingAtTheBound() public {
        _setBalance(a2, 390e6);
        _move(a1, policyA, _credits(a2, 10e6));
        assertEq(token.balanceOf(a2), 400e6); // 4 times the principal
    }

    function test_ceilingPlusOneReverts() public {
        _setBalance(a2, 390e6);
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 10e6 + 1),
            abi.encodeWithSelector(IAgentReallocation.AboveCeiling.selector, a2, 400e6 + 1, 400e6)
        );
    }

    function test_ownerTighterCeilingBinds() public {
        policyA = _commit(ownerA, _agents(a1, a2), 2_000, 15_000, FLOOR); // 1.5 times principal
        _setBalance(a2, 140e6);
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 10e6 + 1),
            abi.encodeWithSelector(IAgentReallocation.AboveCeiling.selector, a2, 150e6 + 1, 150e6)
        );
        _move(a1, policyA, _credits(a2, 10e6));
    }

    function test_ceilingCountsDuplicateCreditsToOneSink() public {
        _setBalance(a2, 390e6);
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 5e6, a2, 5e6 + 1),
            abi.encodeWithSelector(IAgentReallocation.AboveCeiling.selector, a2, 400e6 + 1, 400e6)
        );
    }

    function test_principalUpdateMovesTheCeiling() public {
        vm.prank(operator);
        realloc.setPrincipal(a2, 25e6); // ceiling 100 units, a2 already holds 100
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 1),
            abi.encodeWithSelector(IAgentReallocation.AboveCeiling.selector, a2, 100e6 + 1, 100e6)
        );
    }

    // --- one debit per source per evaluation -----------------------------------------------------------------------

    function test_secondDebitInOneEvaluationReverts() public {
        _move(a1, policyA, _credits(a2, 1e6));
        _moveReverts(
            a1, policyA, _credits(a2, 1e6), abi.encodeWithSelector(IAgentReallocation.AlreadyDebited.selector, a1, 1)
        );
        _advance();
        _move(a1, policyA, _credits(a2, 1e6));
    }

    function test_sinkCanStillBeDebitedOnceInTheSameEvaluation() public {
        _move(a1, policyA, _credits(a2, 1e6));
        _move(a2, policyA, _credits(a1, 1e6));
        assertEq(token.balanceOf(a1), PRINCIPAL);
    }

    function test_staleFutureAndZeroEvaluationsRevert() public {
        _advance(); // current is 2
        _setAllowance(a1, 1e6);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.WrongEvaluation.selector, 1, 2));
        vm.prank(a1);
        realloc.reallocate(1, policyA, _credits(a2, 1e6));
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.WrongEvaluation.selector, 3, 2));
        vm.prank(a1);
        realloc.reallocate(3, policyA, _credits(a2, 1e6));
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.WrongEvaluation.selector, 0, 2));
        vm.prank(a1);
        realloc.reallocate(0, policyA, _credits(a2, 1e6));
    }

    function test_nothingMovesBeforeTheFirstEvaluation() public {
        AgentReallocation fresh = new AgentReallocation(address(token), admin, operator, TEST_EVALUATION_INTERVAL);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.WrongEvaluation.selector, 0, 0));
        vm.prank(a1);
        fresh.reallocate(0, policyA, _credits(a2, 1e6));
    }

    // --- owners ----------------------------------------------------------------------------------------------------

    function test_mismatchedOwnersRevert() public {
        _moveReverts(
            a1, policyA, _credits(b1, 1e6), abi.encodeWithSelector(IAgentReallocation.OwnerMismatch.selector, a1, b1)
        );
    }

    function test_ownerCannotNameAnotherOwnersAgent() public {
        IAgentReallocation.Policy memory p = _policy(ownerA, _agents(a1, b1), 2_000, 40_000, FLOOR);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.NotOwnersAgent.selector, ownerA, b1));
        vm.prank(ownerA);
        realloc.commitPolicy(p);
    }

    function test_ownerIsSetOnceAtRegistration() public {
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.AgentAlreadyRegistered.selector, a1));
        vm.prank(operator);
        realloc.registerAgent(a1, ownerB, PRINCIPAL);
        assertEq(realloc.agent(a1).owner, ownerA);
    }

    function test_unregisteredSourceOrSinkReverts() public {
        address stranger = makeAddr("stranger");
        token.mint(stranger, PRINCIPAL);
        _moveReverts(
            stranger,
            policyA,
            _credits(a2, 1e6),
            abi.encodeWithSelector(IAgentReallocation.AgentNotActive.selector, stranger)
        );
        _moveReverts(
            a1,
            policyA,
            _credits(stranger, 1e6),
            abi.encodeWithSelector(IAgentReallocation.AgentNotActive.selector, stranger)
        );
    }

    // --- policy ----------------------------------------------------------------------------------------------------

    function test_noPolicyNoMove() public {
        _moveReverts(
            b1,
            bytes32(0),
            _credits(b2, 1e6),
            abi.encodeWithSelector(IAgentReallocation.PolicyNotInForce.selector, ownerB)
        );
    }

    function test_uncoveredAgentReverts() public {
        _moveReverts(
            a1, policyA, _credits(a3, 1e6), abi.encodeWithSelector(IAgentReallocation.AgentNotCovered.selector, a3)
        );
        _moveReverts(
            a3, policyA, _credits(a1, 1e6), abi.encodeWithSelector(IAgentReallocation.AgentNotCovered.selector, a3)
        );
    }

    function test_revocationTakesEffectImmediately() public {
        vm.prank(ownerA);
        realloc.revokePolicy();
        assertEq(realloc.policyCommitment(ownerA), bytes32(0));
        assertFalse(realloc.isCovered(ownerA, a1));
        _moveReverts(
            a1, policyA, _credits(a2, 1e6), abi.encodeWithSelector(IAgentReallocation.PolicyNotInForce.selector, ownerA)
        );
    }

    function test_replacedPolicyHashAndCoverageNoLongerApply() public {
        bytes32 old = policyA;
        bytes32 replacement = _commit(ownerA, _agents(a2, a3), 2_000, 40_000, FLOOR);
        _moveReverts(
            a1,
            old,
            _credits(a2, 1e6),
            abi.encodeWithSelector(IAgentReallocation.PolicyHashMismatch.selector, old, replacement)
        );
        // a1 was covered by the old policy only.
        _moveReverts(
            a1, replacement, _credits(a2, 1e6), abi.encodeWithSelector(IAgentReallocation.AgentNotCovered.selector, a1)
        );
        _move(a2, replacement, _credits(a3, 1e6));
    }

    function test_committedHashMatchesIndependentEip712Hash() public {
        IAgentReallocation.Policy memory p = _policy(ownerA, _agents(a1, a2, a3), 1_500, 30_000, 1e6);
        bytes32 expected = _hash(p);
        assertEq(realloc.hashPolicy(p), expected);
        vm.prank(ownerA);
        assertEq(realloc.commitPolicy(p), expected);
        assertEq(realloc.policyCommitment(ownerA), expected);
        assertEq(realloc.domainSeparator(), _domain());
    }

    function test_commitRejectsLooserBoundsAndBadShapes() public {
        _commitReverts(
            _policy(ownerA, _agents(a1, a2), 2_001, 40_000, FLOOR), IAgentReallocation.BoundLooserThanProtocol.selector
        );
        _commitReverts(
            _policy(ownerA, _agents(a1, a2), 2_000, 40_001, FLOOR), IAgentReallocation.BoundLooserThanProtocol.selector
        );
        _commitReverts(
            _policy(ownerA, _agents(a1, a2), 2_000, 40_000, FLOOR - 1),
            IAgentReallocation.BoundLooserThanProtocol.selector
        );
        _commitReverts(
            _policy(ownerA, _agents(a1, a2), 0, 40_000, FLOOR), IAgentReallocation.BoundLooserThanProtocol.selector
        );
        _commitReverts(
            _policy(ownerA, _agents(a1, a2), 2_000, 0, FLOOR), IAgentReallocation.BoundLooserThanProtocol.selector
        );
        address[] memory one = new address[](1);
        one[0] = a1;
        _commitReverts(_policy(ownerA, one, 2_000, 40_000, FLOOR), IAgentReallocation.TooFewAgents.selector);
    }

    function test_commitRejectsWrongNonceAndWrongSender() public {
        IAgentReallocation.Policy memory p = _policy(ownerA, _agents(a1, a2), 2_000, 40_000, FLOOR);
        p.nonce = 0; // already consumed by the fixture's commit
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.BadNonce.selector, 0, 1));
        vm.prank(ownerA);
        realloc.commitPolicy(p);
        p.nonce = 1;
        vm.expectRevert(IAgentReallocation.NotPolicyOwner.selector);
        vm.prank(operator);
        realloc.commitPolicy(p);
    }

    function test_commitRejectsRetiredAgent() public {
        vm.prank(ownerA);
        realloc.retire(a3);
        _commitReverts(
            _policy(ownerA, _agents(a1, a3), 2_000, 40_000, FLOOR), IAgentReallocation.AgentNotActive.selector
        );
    }

    function test_policyBySignature() public {
        IAgentReallocation.Policy memory p = _policy(ownerB, _agents(b1, b2), 2_000, 40_000, FLOOR);
        bytes memory sig = _sign(ownerBKey, _hash(p));
        // Anyone may submit it, for example a relayer paying the gas.
        vm.prank(makeAddr("relayer"));
        bytes32 h = realloc.commitPolicyBySig(p, sig);
        _move(b1, h, _credits(b2, 1e6));

        // Replaying the same signed policy after a revocation fails: its nonce is consumed.
        bytes memory revokeSig = _sign(ownerBKey, keccak256(abi.encode(REVOKE_TYPEHASH, ownerB, uint256(1))));
        realloc.revokePolicyBySig(ownerB, 1, revokeSig);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.BadNonce.selector, 0, 2));
        realloc.commitPolicyBySig(p, sig);
        // And a revocation signature cannot be replayed either.
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.BadNonce.selector, 1, 2));
        realloc.revokePolicyBySig(ownerB, 1, revokeSig);
    }

    function test_policySignatureFromAnotherKeyOrMalleableRejected() public {
        IAgentReallocation.Policy memory p = _policy(ownerB, _agents(b1, b2), 2_000, 40_000, FLOOR);
        vm.expectRevert(IAgentReallocation.BadSignature.selector);
        realloc.commitPolicyBySig(p, _sign(ownerAKey, _hash(p)));

        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(ownerBKey, keccak256(abi.encodePacked("\x19\x01", _domain(), _hash(p))));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory twin = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(IAgentReallocation.BadSignature.selector);
        realloc.commitPolicyBySig(p, twin);
        vm.expectRevert(IAgentReallocation.BadSignature.selector);
        realloc.commitPolicyBySig(p, hex"1234");
    }

    function test_signatureForAnotherDeploymentRejected() public {
        AgentReallocation other = new AgentReallocation(address(token), admin, operator, TEST_EVALUATION_INTERVAL);
        vm.startPrank(operator);
        other.registerAgent(b1, ownerB, PRINCIPAL);
        other.registerAgent(b2, ownerB, PRINCIPAL);
        vm.stopPrank();
        IAgentReallocation.Policy memory p = _policy(ownerB, _agents(b1, b2), 2_000, 40_000, FLOOR);
        bytes memory sig = _sign(ownerBKey, _hash(p)); // domain of `realloc`, not `other`
        vm.expectRevert(IAgentReallocation.BadSignature.selector);
        other.commitPolicyBySig(p, sig);
    }

    // --- retirement (THREAT-MODEL.md invariant 15) -----------------------------------------------------------------

    function test_retirementMovesNoCapital() public {
        uint256 before = token.balanceOf(a1);
        vm.expectEmit(address(realloc));
        emit IAgentReallocation.AgentRetired(a1, ownerA, operator);
        vm.prank(operator);
        realloc.retire(a1);
        assertEq(token.balanceOf(a1), before);
        assertEq(uint8(realloc.agent(a1).status), uint8(IAgentReallocation.Status.Retired));
    }

    function test_retiredAgentIsNeitherSourceNorSink() public {
        vm.prank(ownerA);
        realloc.retire(a2);
        _moveReverts(
            a1, policyA, _credits(a2, 1e6), abi.encodeWithSelector(IAgentReallocation.AgentNotActive.selector, a2)
        );
        _moveReverts(
            a2, policyA, _credits(a1, 1e6), abi.encodeWithSelector(IAgentReallocation.AgentNotActive.selector, a2)
        );
    }

    function test_retirementIsOneWayAndRestricted() public {
        vm.expectRevert(IAgentReallocation.NotOwnerOrOperator.selector);
        vm.prank(ownerB);
        realloc.retire(a1);
        vm.expectRevert(IAgentReallocation.NotOwnerOrOperator.selector);
        vm.prank(a1); // the agent's own account, which is what its session key acts as
        realloc.retire(a1);
        vm.prank(ownerA);
        realloc.retire(a1);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.AgentNotActive.selector, a1));
        vm.prank(operator);
        realloc.retire(a1);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.AgentNotActive.selector, a1));
        vm.prank(operator);
        realloc.setPrincipal(a1, 1);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.AgentAlreadyRegistered.selector, a1));
        vm.prank(operator);
        realloc.registerAgent(a1, ownerA, PRINCIPAL);
    }

    // --- shape and atomicity ---------------------------------------------------------------------------------------

    function test_badShapesRevert() public {
        _moveReverts(
            a1,
            policyA,
            new IAgentReallocation.Credit[](0),
            abi.encodeWithSelector(IAgentReallocation.EmptyMove.selector)
        );
        _moveReverts(a1, policyA, _credits(a2, 0), abi.encodeWithSelector(IAgentReallocation.ZeroAmount.selector));
        _moveReverts(
            a1, policyA, _credits(a1, 1e6), abi.encodeWithSelector(IAgentReallocation.SinkIsSource.selector, a1)
        );
    }

    function test_failureOnALaterCreditMovesNothing() public {
        policyA = _commit(ownerA, _agents(a1, a2, a3), 2_000, 40_000, FLOOR);
        _setBalance(a3, 400e6);
        _moveReverts(
            a1,
            policyA,
            _credits(a2, 5e6, a3, 1),
            abi.encodeWithSelector(IAgentReallocation.AboveCeiling.selector, a3, 400e6 + 1, 400e6)
        );
        assertEq(token.balanceOf(a1), PRINCIPAL);
        assertEq(token.balanceOf(a2), PRINCIPAL);
        assertEq(realloc.lastDebitEvaluation(a1), 0);
    }

    function test_insufficientAllowanceMovesNothing() public {
        _setAllowance(a1, 5e6 - 1);
        vm.expectRevert(IAgentReallocation.TransferFailed.selector);
        vm.prank(a1);
        realloc.reallocate(1, policyA, _credits(a2, 5e6));
        assertEq(token.balanceOf(a1), PRINCIPAL);
    }

    function test_nobodyElseCanPullFromASourceAllowance() public {
        _setAllowance(a1, 20e6); // a dangling allowance, for example from a failed try-mode batch
        // Only msg.sender is ever debited, so a2 calling reallocate debits a2, not a1.
        vm.prank(a2);
        token.approve(address(realloc), 1e6);
        vm.prank(a2);
        realloc.reallocate(1, policyA, _credits(a1, 1e6));
        assertEq(token.allowance(a1, address(realloc)), 20e6);
        assertEq(token.balanceOf(a1), PRINCIPAL + 1e6);
    }

    function test_feeOnTransferTokenReverts() public {
        _swapToken(new MockFeeToken());
        _moveReverts(
            a1, policyA, _credits(a2, 1e6), abi.encodeWithSelector(IAgentReallocation.BalanceMismatch.selector)
        );
    }

    function test_falseReturningTokenReverts() public {
        _swapToken(new MockFalseToken());
        _moveReverts(a1, policyA, _credits(a2, 1e6), abi.encodeWithSelector(IAgentReallocation.TransferFailed.selector));
    }

    // --- roles -----------------------------------------------------------------------------------------------------

    function test_operatorAndAdminRoles() public {
        vm.expectRevert(IAgentReallocation.NotOperator.selector);
        realloc.registerAgent(makeAddr("x"), ownerA, 1);
        vm.expectRevert(IAgentReallocation.NotOperator.selector);
        realloc.setPrincipal(a1, 1);
        vm.expectRevert(IAgentReallocation.NotOperator.selector);
        realloc.advanceEvaluation();
        vm.expectRevert(IAgentReallocation.NotAdmin.selector);
        realloc.setOperator(address(this));
        vm.prank(operator);
        vm.expectRevert(IAgentReallocation.ZeroAddress.selector);
        realloc.registerAgent(address(0), ownerA, 1);

        address op2 = multisig("op2");
        vm.prank(admin);
        realloc.setOperator(op2);
        vm.expectRevert(IAgentReallocation.NotOperator.selector);
        vm.prank(operator);
        realloc.advanceEvaluation();
        vm.warp(block.timestamp + TEST_EVALUATION_INTERVAL);
        vm.prank(op2);
        assertEq(realloc.advanceEvaluation(), 2);

        address admin2 = multisig("admin2");
        vm.prank(admin);
        realloc.proposeAdmin(admin2);
        vm.expectRevert(IAgentReallocation.NotAdmin.selector);
        realloc.acceptAdmin();
        vm.prank(admin2);
        realloc.acceptAdmin();
        assertEq(realloc.admin(), admin2);
    }

    // --- evaluation spacing ---------------------------------------------------------------------------------------

    function test_evaluationSpacingAtTheBound() public {
        assertEq(realloc.minEvaluationInterval(), TEST_EVALUATION_INTERVAL);
        uint256 last = realloc.lastEvaluationAt();
        vm.warp(last + TEST_EVALUATION_INTERVAL - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IAgentReallocation.EvaluationTooSoon.selector, last + TEST_EVALUATION_INTERVAL)
        );
        vm.prank(operator);
        realloc.advanceEvaluation();
        vm.warp(last + TEST_EVALUATION_INTERVAL);
        vm.prank(operator);
        assertEq(realloc.advanceEvaluation(), 2);
        assertEq(realloc.lastEvaluationAt(), last + TEST_EVALUATION_INTERVAL);
    }

    function test_firstEvaluationIsNotSpaced() public {
        AgentReallocation fresh = new AgentReallocation(address(token), admin, operator, TEST_EVALUATION_INTERVAL);
        vm.prank(operator);
        assertEq(fresh.advanceEvaluation(), 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAgentReallocation.EvaluationTooSoon.selector, block.timestamp + TEST_EVALUATION_INTERVAL
            )
        );
        vm.prank(operator);
        fresh.advanceEvaluation();
    }

    function test_zeroIntervalRejected() public {
        vm.expectRevert(IAgentReallocation.ZeroEvaluationInterval.selector);
        new AgentReallocation(address(token), admin, operator, 0);
    }

    /// Any interval and any wait: the advance succeeds exactly when the wait reaches the interval.
    function testFuzz_evaluationSpacing(uint256 interval, uint256 wait) public {
        interval = bound(interval, 1, 365 days);
        wait = bound(wait, 0, 2 * interval);
        AgentReallocation fresh = new AgentReallocation(address(token), admin, operator, interval);
        vm.prank(operator);
        fresh.advanceEvaluation();
        uint256 start = block.timestamp;
        vm.warp(start + wait);
        vm.prank(operator);
        try fresh.advanceEvaluation() {
            assertGe(wait, interval);
            assertEq(fresh.currentEvaluation(), 2);
        } catch {
            assertLt(wait, interval);
            assertEq(fresh.currentEvaluation(), 1);
        }
    }

    // --- roles must be contracts ----------------------------------------------------------------------------------

    function test_rolesWithoutCodeRejected() public {
        address key = makeAddr("singleKey");
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.RoleNotContract.selector, key));
        new AgentReallocation(address(token), admin, key, TEST_EVALUATION_INTERVAL);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.RoleNotContract.selector, key));
        new AgentReallocation(address(token), key, operator, TEST_EVALUATION_INTERVAL);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.RoleNotContract.selector, key));
        vm.prank(admin);
        realloc.setOperator(key);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.RoleNotContract.selector, key));
        vm.prank(admin);
        realloc.proposeAdmin(key);
        // Proposing address(0) cancels a pending proposal and needs no code.
        vm.prank(admin);
        realloc.proposeAdmin(address(0));
        assertEq(realloc.pendingAdmin(), address(0));
    }

    // --- fuzz ------------------------------------------------------------------------------------------------------

    /// Any single move is accepted exactly when the model says so, and conserves the owner's total.
    function testFuzz_singleMoveMatchesModelAndConserves(
        uint256 srcBal,
        uint256 sinkBal,
        uint256 principal,
        uint256 amount,
        uint16 capBps,
        uint32 ceilingBps,
        uint256 floor
    ) public {
        srcBal = bound(srcBal, 0, 1e15);
        sinkBal = bound(sinkBal, 0, 1e15);
        principal = bound(principal, 0, 1e15);
        amount = bound(amount, 1, 1e15);
        capBps = uint16(bound(capBps, 1, 2_000));
        ceilingBps = uint32(bound(ceilingBps, 1, 40_000));
        floor = bound(floor, FLOOR, 1e15);
        policyA = _commit(ownerA, _agents(a1, a2), capBps, ceilingBps, floor);
        vm.prank(operator);
        realloc.setPrincipal(a2, principal);
        _setBalance(a1, srcBal);
        _setBalance(a2, sinkBal);

        bool ok = amount <= srcBal * capBps / 10_000 && srcBal - amount >= floor
            && sinkBal + amount <= principal * ceilingBps / 10_000;
        uint256 ownerTotal = token.balanceOf(a1) + token.balanceOf(a2) + token.balanceOf(a3);
        uint256 supply = token.totalSupply();

        vm.prank(a1);
        token.approve(address(realloc), amount);
        vm.prank(a1);
        try realloc.reallocate(1, policyA, _credits(a2, amount)) {
            assertTrue(ok, "accepted outside the bounds");
            assertEq(token.balanceOf(a1), srcBal - amount);
            assertEq(token.balanceOf(a2), sinkBal + amount);
        } catch {
            assertFalse(ok, "rejected inside the bounds");
            assertEq(token.balanceOf(a1), srcBal);
            assertEq(token.balanceOf(a2), sinkBal);
        }
        assertEq(token.balanceOf(a1) + token.balanceOf(a2) + token.balanceOf(a3), ownerTotal);
        assertEq(token.totalSupply(), supply);
    }

    // --- helpers ---------------------------------------------------------------------------------------------------

    function _commitReverts(IAgentReallocation.Policy memory p, bytes4 err) internal {
        vm.expectPartialRevert(err);
        vm.prank(p.owner);
        realloc.commitPolicy(p);
    }

    function _setAllowance(address source, uint256 amount) internal {
        vm.prank(source);
        token.approve(address(realloc), amount);
    }

    /// Rebuilds the fixture on a different settlement asset.
    function _swapToken(MockERC20 t) internal {
        token = t;
        realloc = new AgentReallocation(address(token), admin, operator, TEST_EVALUATION_INTERVAL);
        vm.startPrank(operator);
        realloc.registerAgent(a1, ownerA, PRINCIPAL);
        realloc.registerAgent(a2, ownerA, PRINCIPAL);
        realloc.advanceEvaluation();
        vm.stopPrank();
        token.mint(a1, PRINCIPAL);
        token.mint(a2, PRINCIPAL);
        policyA = _commit(ownerA, _agents(a1, a2), 2_000, 40_000, FLOOR);
    }
}
