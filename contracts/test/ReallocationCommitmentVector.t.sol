// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentReallocation} from "../src/AgentReallocation.sol";
import {IAgentReallocation} from "../src/IAgentReallocation.sol";
import {MockERC20} from "./utils/Mocks.sol";

/// Fixed cross-implementation vector for the owner reallocation policy commitment (ARCHITECTURE.md sections 16.4 and
/// 16.5). libs/commitment/test/reallocation-policy.test.ts asserts the same literals, and produced SIGNATURE with
/// viem's signTypedData, so a change to either side's encoding fails a test on both sides.
contract ReallocationCommitmentVectorTest is Test {
    uint256 internal constant CHAIN_ID = 10143;
    address internal constant CONTRACT = 0x000000000000000000000000000000000000A110;
    uint256 internal constant OWNER_KEY = 0xA11CE;
    address internal constant AGENT_1 = 0x0000000000000000000000000000000000000a01;
    address internal constant AGENT_2 = 0x0000000000000000000000000000000000000a02;
    address internal constant OWNER = 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7;

    bytes32 internal constant STRUCT_HASH = 0x1153cf2b0ec916128544d8b04edbb9f2cc616d0e030a2552333efe22ad9bc200;
    bytes32 internal constant DOMAIN_SEPARATOR = 0x700a4ac718cc5571341cc5e413d29a96a8d6de0367c35fd803c51bd5dd931406;
    bytes32 internal constant DIGEST = 0x2cde780a0465cf73e37442db86402816f9f342c7208a5427bf61c58d52fa2b24;
    bytes32 internal constant REVOKE_STRUCT_HASH = 0xdfdaa732c7b796071e007ffed1e1b721153bdfc9e184847fd8508144154416c8;
    bytes internal constant SIGNATURE =
        hex"f638c40d40a36177d288ae56dc186d53930c554c52c8463284a790fb2a10f2f4648ddaca6f58d3d1eecd6dcbfc7e14faf8dbd5ee88aeebba081c4ab1e51b100c1b";

    AgentReallocation internal realloc;
    address internal owner;

    function setUp() public {
        vm.chainId(CHAIN_ID);
        MockERC20 token = new MockERC20();
        address operator = makeAddr("operator");
        deployCodeTo(
            "AgentReallocation.sol:AgentReallocation", abi.encode(address(token), makeAddr("admin"), operator), CONTRACT
        );
        realloc = AgentReallocation(CONTRACT);
        owner = vm.addr(OWNER_KEY);
        vm.startPrank(operator);
        realloc.registerAgent(AGENT_1, owner, 100e6);
        realloc.registerAgent(AGENT_2, owner, 100e6);
        vm.stopPrank();
    }

    function _policy() internal view returns (IAgentReallocation.Policy memory p) {
        p.owner = owner;
        p.agents = new address[](2);
        p.agents[0] = AGENT_1;
        p.agents[1] = AGENT_2;
        p.capBps = 1_500;
        p.slotCeilingBps = 30_000;
        p.capitalFloor = 60_000;
        p.nonce = 0;
    }

    function test_vectorMatchesLibsCommitment() public view {
        IAgentReallocation.Policy memory p = _policy();
        assertEq(owner, OWNER);
        assertEq(realloc.hashPolicy(p), STRUCT_HASH);
        assertEq(realloc.domainSeparator(), DOMAIN_SEPARATOR);
        assertEq(keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, STRUCT_HASH)), DIGEST);
        assertEq(keccak256(abi.encode(realloc.REVOKE_TYPEHASH(), owner, uint256(1))), REVOKE_STRUCT_HASH);
    }

    /// The signature libs/commitment produced with viem is accepted, and commits exactly STRUCT_HASH.
    function test_viemSignatureIsAccepted() public {
        assertEq(realloc.commitPolicyBySig(_policy(), SIGNATURE), STRUCT_HASH);
        assertEq(realloc.policyCommitment(owner), STRUCT_HASH);
        assertTrue(realloc.isCovered(owner, AGENT_1) && realloc.isCovered(owner, AGENT_2));
    }

    /// The selector the wallets module's README names for the session-key allowlist.
    function test_reallocateSelector() public pure {
        assertEq(IAgentReallocation.reallocate.selector, bytes4(0x4c329bba));
    }
}
