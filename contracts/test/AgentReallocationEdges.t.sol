// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {AgentReallocation} from "../src/AgentReallocation.sol";
import {IAgentReallocation} from "../src/IAgentReallocation.sol";
import {MockERC20} from "./utils/Mocks.sol";
import {ReallocationTestBase} from "./utils/ReallocationTestBase.sol";
import {TEST_EVALUATION_INTERVAL} from "./utils/Roles.sol";

/// Takes one base unit more from the sender than it delivers, so the sink sees exactly its amount and only the
/// source's balance check can catch it.
contract MockSenderFeeToken is MockERC20 {
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount + 1;
        balanceOf[to] += amount;
        totalSupply -= 1;
        return true;
    }
}

/// `decimals()` reverts.
contract MockNoDecimalsToken {
    function decimals() external pure returns (uint8) {
        revert("no decimals");
    }
}

/// `decimals()` answers a value no uint8 holds.
contract MockHugeDecimalsToken {
    function decimals() external pure returns (uint256) {
        return 300;
    }
}

/// Paths the main suite did not reach, added with the audit package (contracts/audit/README.md section 13).
contract AgentReallocationEdgesTest is ReallocationTestBase {
    function test_zeroSettlementAssetRejected() public {
        vm.expectRevert(IAgentReallocation.ZeroAddress.selector);
        new AgentReallocation(address(0), admin, operator, TEST_EVALUATION_INTERVAL);
    }

    function test_tokenWithoutDecimalsRejected() public {
        address t = address(new MockNoDecimalsToken());
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.UnsupportedDecimals.selector, uint8(0)));
        new AgentReallocation(t, admin, operator, TEST_EVALUATION_INTERVAL);
    }

    function test_decimalsAboveUint8RangeReportedAs255() public {
        address t = address(new MockHugeDecimalsToken());
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.UnsupportedDecimals.selector, uint8(255)));
        new AgentReallocation(t, admin, operator, TEST_EVALUATION_INTERVAL);
    }

    function test_decimalsAbove36Rejected() public {
        MockERC20 t = new MockERC20();
        t.setDecimals(37);
        vm.expectRevert(abi.encodeWithSelector(IAgentReallocation.UnsupportedDecimals.selector, uint8(37)));
        new AgentReallocation(address(t), admin, operator, TEST_EVALUATION_INTERVAL);
    }

    function test_adminFunctionsRefuseOthersAndZeroOperator() public {
        vm.expectRevert(IAgentReallocation.NotAdmin.selector);
        realloc.proposeAdmin(address(0));
        vm.prank(operator);
        vm.expectRevert(IAgentReallocation.NotAdmin.selector);
        realloc.setOperator(operator);
        vm.prank(admin);
        vm.expectRevert(IAgentReallocation.ZeroAddress.selector);
        realloc.setOperator(address(0));
    }

    function test_sourceDebitedMoreThanTheTotalReverts() public {
        token = new MockSenderFeeToken();
        realloc = new AgentReallocation(address(token), admin, operator, TEST_EVALUATION_INTERVAL);
        vm.startPrank(operator);
        realloc.registerAgent(a1, ownerA, PRINCIPAL);
        realloc.registerAgent(a2, ownerA, PRINCIPAL);
        realloc.advanceEvaluation();
        vm.stopPrank();
        token.mint(a1, PRINCIPAL);
        token.mint(a2, PRINCIPAL);
        policyA = _commit(ownerA, _agents(a1, a2), 2_000, 40_000, FLOOR);
        _moveReverts(
            a1, policyA, _credits(a2, 1e6), abi.encodeWithSelector(IAgentReallocation.BalanceMismatch.selector)
        );
    }
}
