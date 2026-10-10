// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentReallocation} from "../../src/AgentReallocation.sol";
import {IAgentReallocation} from "../../src/IAgentReallocation.sol";
import {MockERC20} from "./Mocks.sol";

/// Shared fixture: a six-decimal settlement asset, owner A with agents a1, a2, a3 and owner B with agents b1, b2, all
/// registered with a principal of 100 units and holding 100 units. Evaluation 1 is open, and owner A has a policy at
/// the protocol bounds naming a1 and a2 (a3 is registered but not covered). Owner B has no policy.
abstract contract ReallocationTestBase is Test {
    uint256 internal constant UNIT = 1e6;
    uint256 internal constant PRINCIPAL = 100e6;
    uint256 internal constant FLOOR = 60_000; // 0.06 of a six-decimal asset

    // Computed independently of the contract, so a change to its hashing fails a test.
    bytes32 internal constant POLICY_TYPEHASH = keccak256(
        "ReallocationPolicy(address owner,address[] agents,uint16 capBps,uint32 slotCeilingBps,uint256 capitalFloor,uint256 nonce)"
    );
    bytes32 internal constant REVOKE_TYPEHASH = keccak256("RevokeReallocationPolicy(address owner,uint256 nonce)");

    MockERC20 internal token;
    AgentReallocation internal realloc;
    address internal admin;
    address internal operator;

    uint256 internal ownerAKey;
    uint256 internal ownerBKey;
    address internal ownerA;
    address internal ownerB;
    address internal a1;
    address internal a2;
    address internal a3;
    address internal b1;
    address internal b2;

    bytes32 internal policyA;

    function setUp() public virtual {
        token = new MockERC20();
        admin = makeAddr("admin");
        operator = makeAddr("operator");
        realloc = new AgentReallocation(address(token), admin, operator);

        (ownerA, ownerAKey) = makeAddrAndKey("ownerA");
        (ownerB, ownerBKey) = makeAddrAndKey("ownerB");
        a1 = makeAddr("a1");
        a2 = makeAddr("a2");
        a3 = makeAddr("a3");
        b1 = makeAddr("b1");
        b2 = makeAddr("b2");

        _register(a1, ownerA);
        _register(a2, ownerA);
        _register(a3, ownerA);
        _register(b1, ownerB);
        _register(b2, ownerB);

        vm.prank(operator);
        realloc.advanceEvaluation();

        policyA = _commit(ownerA, _agents(a1, a2), 2_000, 40_000, FLOOR);
    }

    function _register(address account, address owner) internal {
        vm.prank(operator);
        realloc.registerAgent(account, owner, PRINCIPAL);
        token.mint(account, PRINCIPAL);
    }

    function _agents(address x, address y) internal pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = x;
        list[1] = y;
    }

    function _agents(address x, address y, address z) internal pure returns (address[] memory list) {
        list = new address[](3);
        list[0] = x;
        list[1] = y;
        list[2] = z;
    }

    function _policy(address owner, address[] memory agents, uint16 capBps, uint32 ceilingBps, uint256 floor)
        internal
        view
        returns (IAgentReallocation.Policy memory)
    {
        return IAgentReallocation.Policy({
            owner: owner,
            agents: agents,
            capBps: capBps,
            slotCeilingBps: ceilingBps,
            capitalFloor: floor,
            nonce: realloc.policyNonce(owner)
        });
    }

    function _commit(address owner, address[] memory agents, uint16 capBps, uint32 ceilingBps, uint256 floor)
        internal
        returns (bytes32)
    {
        IAgentReallocation.Policy memory p = _policy(owner, agents, capBps, ceilingBps, floor);
        vm.prank(owner);
        return realloc.commitPolicy(p);
    }

    function _hash(IAgentReallocation.Policy memory p) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POLICY_TYPEHASH,
                p.owner,
                keccak256(abi.encodePacked(p.agents)),
                p.capBps,
                p.slotCeilingBps,
                p.capitalFloor,
                p.nonce
            )
        );
    }

    function _domain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Monadeum Reallocation"),
                keccak256("1"),
                block.chainid,
                address(realloc)
            )
        );
    }

    function _sign(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", _domain(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _credits(address sink, uint256 amount) internal pure returns (IAgentReallocation.Credit[] memory c) {
        c = new IAgentReallocation.Credit[](1);
        c[0] = IAgentReallocation.Credit(sink, amount);
    }

    function _credits(address s1, uint256 x1, address s2, uint256 x2)
        internal
        pure
        returns (IAgentReallocation.Credit[] memory c)
    {
        c = new IAgentReallocation.Credit[](2);
        c[0] = IAgentReallocation.Credit(s1, x1);
        c[1] = IAgentReallocation.Credit(s2, x2);
    }

    /// The source approves exactly the total and calls reallocate, as its session key would in one batch.
    function _move(address source, bytes32 policyHash, IAgentReallocation.Credit[] memory credits)
        internal
        returns (uint256)
    {
        uint256 total;
        for (uint256 i = 0; i < credits.length; ++i) {
            total += credits[i].amount;
        }
        uint256 evaluation = realloc.currentEvaluation();
        vm.prank(source);
        token.approve(address(realloc), total);
        vm.prank(source);
        return realloc.reallocate(evaluation, policyHash, credits);
    }

    /// As `_move`, expecting the reallocate call to revert with `err`.
    function _moveReverts(
        address source,
        bytes32 policyHash,
        IAgentReallocation.Credit[] memory credits,
        bytes memory err
    ) internal {
        uint256 total;
        for (uint256 i = 0; i < credits.length; ++i) {
            total += credits[i].amount;
        }
        uint256 evaluation = realloc.currentEvaluation();
        vm.prank(source);
        token.approve(address(realloc), total);
        vm.expectRevert(err);
        vm.prank(source);
        realloc.reallocate(evaluation, policyHash, credits);
    }

    function _setBalance(address account, uint256 amount) internal {
        uint256 bal = token.balanceOf(account);
        if (amount > bal) {
            token.mint(account, amount - bal);
        } else {
            vm.prank(account);
            token.transfer(address(0xdead), bal - amount);
        }
    }

    function _advance() internal {
        vm.prank(operator);
        realloc.advanceEvaluation();
    }
}
