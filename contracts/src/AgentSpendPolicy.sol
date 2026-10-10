// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IAgentSpendPolicy} from "./IAgentSpendPolicy.sol";
import {IHook, IPolicy, PackedUserOperation} from "./kernel/IKernelModules.sol";

/// @title AgentSpendPolicy
/// @notice Implementation of IAgentSpendPolicy (ARCHITECTURE.md section 16.3), and the Kernel v3.1 policy and hook
/// entry points that drive it. One deployment serves every agent account, keyed by account address.
///
/// Rules, as specified in the interface:
/// - `check` (validation): every call's target and selector must be allowed for the account, the target must not be
///   this contract or the account, the native value must be 0, and a counted call (`transfer` or `approve` on the
///   settlement asset) must decode and name an allowed recipient. The counted amounts are summed over the operation
///   and the sum must not exceed `perTxCap`. No time-dependent reads.
/// - `record` (execution): recomputes the total by running the same rules as `check`, then adds it to the current
///   hour's bucket and reverts with `DailyCapExceeded` if the 25-bucket window total would exceed `dailyCap`.
///
/// Kernel v3.1 integration, per the interface NatSpec. Whether a deployed Kernel v3.1 account drives these entry
/// points as expected has not been run against a real account; see ARCHITECTURE.md section 16.3.
/// - `checkUserOpPolicy` decodes `userOp.callData` (optionally prefixed by the `executeUserOp` selector) as
///   `execute(bytes32 mode, bytes executionCalldata)` with call type single or batch, and runs `check` for the
///   calling account. Any other account selector, call type (delegatecall, static) or exec type reverts.
/// - `preCheck` decodes `msgData` the same way, without the `executeUserOp` prefix, which Kernel strips, and runs
///   `record` for the calling account.
/// - `checkSignaturePolicy` always fails: this contract does not bound ERC-1271 signatures, so a session key holding
///   it as a policy cannot sign for the account unless the owner installs it with Kernel's skip-signature flag. That
///   is an explicit, visible choice at install time, pending the x402 open question in section 16.3.
contract AgentSpendPolicy is IAgentSpendPolicy, IPolicy, IHook {
    /// The account calldata is not `execute(bytes32,bytes)`, optionally wrapped in `executeUserOp`.
    error UnsupportedAccountCall(bytes4 selector);
    /// The execution mode's call type is not single or batch, or its exec type is not default or try.
    error UnsupportedExecMode(bytes32 mode);
    error ZeroSettlementAsset();

    struct Bucket {
        uint64 hour; // block.timestamp / 1 hours at the bucket's last write
        uint192 amount; // counted spend in that hour; bounded by dailyCap, which is a uint128
    }

    bytes4 internal constant TRANSFER_SELECTOR = 0xa9059cbb; // transfer(address,uint256)
    bytes4 internal constant APPROVE_SELECTOR = 0x095ea7b3; // approve(address,uint256)
    bytes4 internal constant EXECUTE_SELECTOR = bytes4(keccak256("execute(bytes32,bytes)"));
    bytes4 internal constant EXECUTE_USER_OP_SELECTOR =
        bytes4(keccak256("executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)"));

    bytes1 internal constant CALLTYPE_SINGLE = 0x00;
    bytes1 internal constant CALLTYPE_BATCH = 0x01;
    bytes1 internal constant EXECTYPE_DEFAULT = 0x00;
    bytes1 internal constant EXECTYPE_TRY = 0x01;

    uint256 internal constant MODULE_TYPE_HOOK = 4;
    uint256 internal constant MODULE_TYPE_POLICY = 5;
    uint256 internal constant POLICY_SUCCESS = 0;
    uint256 internal constant POLICY_FAILED = 1;

    uint256 internal constant BUCKETS = 25;

    address public immutable override settlementAsset;

    // Every per-account mapping read in validation has the account as its innermost key (ERC-7562 associated storage).
    mapping(address account => Limits) internal _limits;
    mapping(address target => mapping(bytes4 selector => mapping(address account => bool))) internal _allowed;
    /// Number of allowed selectors per target, the basis of the derived recipient rule.
    mapping(address target => mapping(address account => uint256)) internal _allowedSelectorCount;
    mapping(address account => Bucket[BUCKETS]) internal _buckets;

    constructor(address settlementAsset_) {
        if (settlementAsset_ == address(0)) revert ZeroSettlementAsset();
        settlementAsset = settlementAsset_;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // IAgentSpendPolicy
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IAgentSpendPolicy
    function check(address account, Call[] calldata calls) external view override returns (uint256 total) {
        return _check(account, calls);
    }

    /// @inheritdoc IAgentSpendPolicy
    function record(Call[] calldata calls) external override {
        _record(msg.sender, calls);
    }

    function limits(address account) external view override returns (Limits memory) {
        return _limits[account];
    }

    function isAllowed(address account, address target, bytes4 selector) external view override returns (bool) {
        return _allowed[target][selector][account];
    }

    function isRecipientAllowed(address account, address recipient) external view override returns (bool) {
        return _isRecipientAllowed(account, recipient);
    }

    /// @inheritdoc IAgentSpendPolicy
    function windowTotal(address account) external view override returns (uint256) {
        return _windowTotal(account, block.timestamp / 1 hours);
    }

    /// @inheritdoc IAgentSpendPolicy
    function setLimits(Limits calldata newLimits) external override {
        _limits[msg.sender] = newLimits;
        emit LimitsSet(msg.sender, newLimits.perTxCap, newLimits.dailyCap);
    }

    /// @inheritdoc IAgentSpendPolicy
    function setAllowed(address target, bytes4 selector, bool allowed) external override {
        if (target == settlementAsset && selector != TRANSFER_SELECTOR && selector != APPROVE_SELECTOR) {
            revert UncountedSettlementSelector(selector);
        }
        if (_allowed[target][selector][msg.sender] != allowed) {
            _allowed[target][selector][msg.sender] = allowed;
            if (allowed) {
                _allowedSelectorCount[target][msg.sender] += 1;
            } else {
                _allowedSelectorCount[target][msg.sender] -= 1;
            }
        }
        emit CallAllowed(msg.sender, target, selector, allowed);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Kernel v3.1 policy and hook entry points
    // ---------------------------------------------------------------------------------------------------------------

    /// Kernel calls this from the account during validation. Reverts with the rule that failed; returns 0 otherwise.
    function checkUserOpPolicy(bytes32, PackedUserOperation calldata userOp)
        external
        payable
        override
        returns (uint256)
    {
        bytes calldata callData = userOp.callData;
        if (callData.length >= 4 && bytes4(callData[:4]) == EXECUTE_USER_OP_SELECTOR) {
            callData = callData[4:];
        }
        _check(msg.sender, _decodeExecute(callData));
        return POLICY_SUCCESS;
    }

    /// ERC-1271 signatures are not bounded by this policy, so it never approves one. See the contract NatSpec.
    function checkSignaturePolicy(bytes32, address, bytes32, bytes calldata) external pure override returns (uint256) {
        return POLICY_FAILED;
    }

    /// Kernel calls this from the account before executing a user operation validated by the session key.
    function preCheck(address, uint256, bytes calldata msgData) external payable override returns (bytes memory) {
        _record(msg.sender, _decodeExecute(msgData));
        return "";
    }

    function postCheck(bytes calldata) external payable override {}

    /// Configuration is per account through `setLimits` and `setAllowed`, never through installation data, so
    /// installation and removal change no state. Limits and allowlist entries persist across reinstallation.
    function onInstall(bytes calldata) external payable override {}

    function onUninstall(bytes calldata) external payable override {}

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == MODULE_TYPE_HOOK || moduleTypeId == MODULE_TYPE_POLICY;
    }

    function isInitialized(address) external pure override returns (bool) {
        return true;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    function _check(address account, Call[] memory calls) internal view returns (uint256 total) {
        uint256 perTxCap = _limits[account].perTxCap;
        for (uint256 i = 0; i < calls.length; ++i) {
            Call memory c = calls[i];
            bytes memory data = c.data;
            bytes4 selector = bytes4(data);

            if (c.target == address(this) || c.target == account) revert CallNotAllowed(c.target, selector);
            if (data.length < 4 || !_allowed[c.target][selector][account]) revert CallNotAllowed(c.target, selector);
            if (c.value != 0) revert NativeValueNotAllowed(c.value);

            if (c.target != settlementAsset) continue; // allowlisted, uncounted

            // setAllowed admits no other selector on the settlement asset; this keeps the rule local.
            if (selector != TRANSFER_SELECTOR && selector != APPROVE_SELECTOR) {
                revert CallNotAllowed(c.target, selector);
            }
            if (data.length < 68) revert CallNotAllowed(c.target, selector);
            uint256 recipientWord = _word(data, 4);
            if (recipientWord > type(uint160).max) revert CallNotAllowed(c.target, selector);
            address recipient = address(uint160(recipientWord));
            if (!_isRecipientAllowed(account, recipient)) revert RecipientNotAllowed(recipient);

            uint256 amount = _word(data, 36);
            // total <= perTxCap holds before this line, so the subtraction cannot underflow. A perTxCap of 0, the
            // value for an account whose limits were never set, fails every counted call, including one for 0.
            if (perTxCap == 0 || amount > perTxCap - total) {
                uint256 reported = amount > type(uint256).max - total ? type(uint256).max : total + amount;
                revert PerTxCapExceeded(reported, perTxCap);
            }
            total += amount;
        }
    }

    function _record(address account, Call[] memory calls) internal {
        uint256 total = _check(account, calls);
        uint256 hour = block.timestamp / 1 hours;
        Bucket storage bucket = _buckets[account][hour % BUCKETS];
        if (bucket.hour != hour) {
            bucket.hour = uint64(hour);
            bucket.amount = 0;
        }
        uint256 newWindowTotal = _windowTotal(account, hour) + total;
        uint256 dailyCap = _limits[account].dailyCap;
        if (newWindowTotal > dailyCap) revert DailyCapExceeded(newWindowTotal, dailyCap);
        // total <= newWindowTotal <= dailyCap <= type(uint128).max, and so is the bucket after the addition.
        bucket.amount += uint192(total);
        emit Spent(account, total, newWindowTotal);
    }

    /// Sum of the buckets written in hours h - 24 through h. A bucket's slot is reused every 25 hours, so a slot
    /// holding an older hour is outside the window and is skipped.
    function _windowTotal(address account, uint256 hour) internal view returns (uint256 sum) {
        Bucket[BUCKETS] storage buckets = _buckets[account];
        for (uint256 i = 0; i < BUCKETS; ++i) {
            Bucket memory b = buckets[i];
            if (b.amount != 0 && hour - b.hour < BUCKETS) sum += b.amount;
        }
    }

    function _isRecipientAllowed(address account, address recipient) internal view returns (bool) {
        return recipient != settlementAsset && recipient != address(this) && recipient != account
            && _allowedSelectorCount[recipient][account] != 0;
    }

    /// Decodes `execute(bytes32 mode, bytes executionCalldata)` into the calls Kernel v3.1 would run.
    /// Single: executionCalldata is abi.encodePacked(target, value, callData). Batch: abi.encode(Execution[]), where
    /// Execution has the same layout as Call. Out-of-bounds offsets revert.
    function _decodeExecute(bytes calldata data) internal pure returns (Call[] memory calls) {
        bytes4 selector = bytes4(data);
        if (data.length < 4 || selector != EXECUTE_SELECTOR) revert UnsupportedAccountCall(selector);
        bytes calldata args = data[4:];
        bytes32 mode = bytes32(args[0:32]);
        uint256 offset = uint256(bytes32(args[32:64]));
        uint256 length = uint256(bytes32(args[offset:offset + 32]));
        bytes calldata exec = args[offset + 32:offset + 32 + length];

        bytes1 callType = mode[0];
        bytes1 execType = mode[1];
        if (execType != EXECTYPE_DEFAULT && execType != EXECTYPE_TRY) revert UnsupportedExecMode(mode);
        if (callType == CALLTYPE_SINGLE) {
            calls = new Call[](1);
            calls[0] =
                Call({target: address(bytes20(exec[0:20])), value: uint256(bytes32(exec[20:52])), data: exec[52:]});
        } else if (callType == CALLTYPE_BATCH) {
            calls = abi.decode(exec, (Call[]));
        } else {
            revert UnsupportedExecMode(mode);
        }
    }

    /// Reads the 32-byte word at `offset` in `data`. Callers check that offset + 32 <= data.length.
    function _word(bytes memory data, uint256 offset) private pure returns (uint256 w) {
        assembly ("memory-safe") {
            w := mload(add(add(data, 0x20), offset))
        }
    }
}
