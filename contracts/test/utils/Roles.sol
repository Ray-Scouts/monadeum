// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";

Vm constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

// Minimum spacing between evaluations used by the tests. Not the deployment value (ARCHITECTURE.md section 16.5).
uint256 constant TEST_EVALUATION_INTERVAL = 1 hours;

/// An address for the operator or admin role with code at it, standing in for the multisig contract a deployment must
/// use. AgentReallocation refuses a role address with no code. Same address as forge-std's makeAddr(name).
function multisig(string memory name) returns (address account) {
    account = VM.addr(uint256(keccak256(abi.encodePacked(name))));
    VM.etch(account, hex"00");
    VM.label(account, name);
}
