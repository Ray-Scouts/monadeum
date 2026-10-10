// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IHook, IPolicy, PackedUserOperation} from "../../src/kernel/IKernelModules.sol";

/// Minimal ERC-20 for moving a settlement asset in tests.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// Test double for the parts of a Kernel v3.1 account that drive a session-key permission's policy and hook. It is
/// not Kernel. It reproduces, from Kernel v3.1 (tag v3.1, commit 03f7f5c), the call shapes this contract depends on:
/// - validation calls `policy.checkUserOpPolicy(permissionId, userOp)` from the account, with the full callData
///   (ValidationManager._checkUserOpPolicy), and requires the `executeUserOp` prefix when a hook is set
///   (Kernel.validateUserOp);
/// - execution calls `hook.preCheck(msg.sender, msg.value, userOp.callData[4:])` from the account, then delegatecalls
///   itself with `userOp.callData[4:]`, then `hook.postCheck(context)` (Kernel.executeUserOp);
/// - `execute(mode, executionCalldata)` decodes single as packed (target, value, callData) and batch as
///   abi.encode(Execution[]) (ExecLib.execute). Delegatecall and other call types are not executed here.
contract MockKernelAccount {
    error ValidationFailed();
    error OnlyExecuteUserOp();
    error ExecutionReverted();

    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    IPolicy public immutable policy;
    IHook public immutable hook;

    constructor(address policy_, address hook_) {
        policy = IPolicy(policy_);
        hook = IHook(hook_);
    }

    /// Owner path: stands in for an operation validated by the root validator, which runs neither the session key's
    /// policy nor its hook.
    function ownerCall(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }

    /// Session-key path: validation, then execution, as the EntryPoint would sequence them for one operation.
    function handleSessionKeyOp(PackedUserOperation calldata userOp) external {
        if (bytes4(userOp.callData[0:4]) != this.executeUserOp.selector) revert OnlyExecuteUserOp();
        if (policy.checkUserOpPolicy(bytes32(uint256(1)), userOp) != 0) revert ValidationFailed();
        this.executeUserOp(userOp, bytes32(0));
    }

    function validateOnly(PackedUserOperation calldata userOp) external returns (uint256) {
        return policy.checkUserOpPolicy(bytes32(uint256(1)), userOp);
    }

    function executeUserOp(PackedUserOperation calldata userOp, bytes32) external payable {
        require(msg.sender == address(this), "entrypoint only");
        bytes memory context = hook.preCheck(msg.sender, msg.value, userOp.callData[4:]);
        (bool success,) = address(this).delegatecall(userOp.callData[4:]);
        if (!success) revert ExecutionReverted();
        hook.postCheck(context);
    }

    function execute(bytes32 mode, bytes calldata executionCalldata) external payable {
        require(msg.sender == address(this), "self only");
        bytes1 callType = mode[0];
        if (callType == 0x00) {
            _call(
                address(bytes20(executionCalldata[0:20])),
                uint256(bytes32(executionCalldata[20:52])),
                executionCalldata[52:]
            );
        } else if (callType == 0x01) {
            Execution[] memory execs = abi.decode(executionCalldata, (Execution[]));
            for (uint256 i = 0; i < execs.length; ++i) {
                _call(execs[i].target, execs[i].value, execs[i].callData);
            }
        } else {
            revert("unsupported in mock");
        }
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}
