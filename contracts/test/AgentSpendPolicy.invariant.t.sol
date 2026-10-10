// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AgentSpendPolicy} from "../src/AgentSpendPolicy.sol";
import {IAgentSpendPolicy} from "../src/IAgentSpendPolicy.sol";

/// Drives the policy with fuzzed operation sequences for one account: random batches over a pool of targets that
/// mixes allowlisted and non-allowlisted addresses, random selectors, recipients and amounts, allowlist changes by
/// the owner, and time jumps across hour and day boundaries. It keeps an independent model of the allowlist and the
/// accepted spend, and counts every case where the contract accepted what the model says it must reject.
contract SpendPolicyHandler is Test {
    bytes4 internal constant TRANSFER = 0xa9059cbb;
    bytes4 internal constant APPROVE = 0x095ea7b3;
    bytes4 internal constant SWAP = bytes4(keccak256("swap(bytes)"));
    bytes4 internal constant REALLOCATE = bytes4(keccak256("reallocate(bytes32)"));

    uint128 public constant PER_TX_CAP = 100e6;
    uint128 public constant DAILY_CAP = 300e6;

    AgentSpendPolicy public immutable policy;
    address public immutable account;
    address public immutable asset;
    address[] internal targets;
    bytes4[] internal selectors;

    address public immutable tradedToken;

    // Model of the allowlist and the traded assets, maintained independently of the contract's own bookkeeping.
    mapping(address => mapping(bytes4 => bool)) internal modelAllowed;
    mapping(address => bool) internal modelTraded;

    // Ghost state.
    uint256[] public spendTimes;
    uint256[] public spendAmounts;
    uint256 public allowlistViolations; // accepted a call outside the allowlist, or targeting the policy or account
    uint256 public recipientViolations; // accepted a counted call to a recipient the rule forbids
    uint256 public valueViolations; // accepted nonzero native value
    uint256 public perTxViolations; // accepted an operation whose counted total exceeds perTxCap
    uint256 public dailyViolations; // record accepted spend that takes the model window above dailyCap
    uint256 public totalMismatches; // check returned a total different from the model's
    uint256 public recordWithoutCheck; // record accepted an operation check rejects
    uint256 public tradedViolations; // setTradedAsset accepted a token it must refuse
    uint256 public accepted;
    uint256 public rejected;

    constructor(AgentSpendPolicy policy_, address account_, address asset_, address router, address repro) {
        policy = policy_;
        account = account_;
        asset = asset_;
        targets.push(asset_);
        targets.push(router);
        targets.push(repro);
        targets.push(makeAddr("stranger"));
        targets.push(makeAddr("otherStranger"));
        targets.push(address(policy_));
        targets.push(account_);
        tradedToken = makeAddr("tradedAsset");
        targets.push(tradedToken);
        selectors.push(TRANSFER);
        selectors.push(APPROVE);
        selectors.push(SWAP);
        selectors.push(REALLOCATE);
        selectors.push(0x23b872dd); // transferFrom
        selectors.push(bytes4(keccak256("setLimits((uint128,uint128))")));

        vm.startPrank(account_);
        policy_.setLimits(IAgentSpendPolicy.Limits(PER_TX_CAP, DAILY_CAP));
        _setAllowed(asset_, TRANSFER, true);
        _setAllowed(asset_, APPROVE, true);
        _setAllowed(router, SWAP, true);
        _setAllowed(repro, REALLOCATE, true);
        // Allowlist entries on the policy and the account must never let a call through.
        _setAllowed(address(policy_), selectors[5], true);
        _setAllowed(account_, SWAP, true);
        // The base of the agent's market: recipient-checked, uncounted, never a recipient.
        policy_.setTradedAsset(tradedToken, true);
        modelTraded[tradedToken] = true;
        _setAllowed(tradedToken, APPROVE, true);
        _setAllowed(tradedToken, TRANSFER, true);
        vm.stopPrank();
    }

    function _setAllowed(address target, bytes4 sel, bool allowed) internal {
        policy.setAllowed(target, sel, allowed);
        modelAllowed[target][sel] = allowed;
    }

    // --- actions ---------------------------------------------------------------------------------------------------

    function operate(uint256 seed, uint8 n) external {
        n = uint8(bound(n, 1, 3));
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](n);
        for (uint256 i = 0; i < n; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            calls[i] = _randomCall(seed);
        }
        (bool modelOk, uint256 modelTotal) = _modelCheck(calls);

        bool checkOk;
        uint256 total;
        try policy.check(account, calls) returns (uint256 t) {
            checkOk = true;
            total = t;
        } catch {}

        if (checkOk) {
            _auditAccepted(calls, total);
            if (!modelOk || total != modelTotal) ++totalMismatches;
        }

        uint256 windowBefore = _modelWindow(block.timestamp);
        vm.prank(account);
        try policy.record(calls) {
            if (!checkOk) ++recordWithoutCheck;
            if (windowBefore + total > DAILY_CAP) ++dailyViolations;
            spendTimes.push(block.timestamp);
            spendAmounts.push(total);
            ++accepted;
        } catch {
            ++rejected;
        }
    }

    function warp(uint256 seed) external {
        uint256 kind = seed % 4;
        uint256 t = block.timestamp;
        if (kind == 0) t += bound(seed >> 8, 0, 30 minutes);
        else if (kind == 1) t = (t / 1 hours + 1) * 1 hours; // first second of the next hour
        else if (kind == 2) t = (t / 1 hours + 25) * 1 hours - 1; // last second of hour h + 24
        else t += bound(seed >> 8, 0, 3 days);
        vm.warp(t);
    }

    function toggleAllowed(uint256 targetSeed, uint256 selectorSeed, bool allowed) external {
        address target = targets[targetSeed % targets.length];
        bytes4 sel = selectors[selectorSeed % selectors.length];
        vm.prank(account);
        try policy.setAllowed(target, sel, allowed) {
            modelAllowed[target][sel] = allowed;
        } catch {
            // Only the token-selector rules may refuse an allowlist change: the settlement asset and a traded asset
            // admit only transfer and approve, and no other target may hold either.
            bool tokenSel = sel == TRANSFER || sel == APPROVE;
            bool expected = target == asset ? !tokenSel : tokenSel != modelTraded[target];
            require(expected, "unexpected setAllowed revert");
        }
    }

    /// Marks or unmarks any pool target as a traded asset; the contract must refuse the asset, the policy, the
    /// account, and any target with a selector allowed.
    function toggleTraded(uint256 targetSeed, bool isTraded) external {
        address target = targets[targetSeed % targets.length];
        bool anyAllowed;
        for (uint256 i = 0; i < selectors.length; ++i) {
            if (modelAllowed[target][selectors[i]]) anyAllowed = true;
        }
        bool mustRefuse = target == asset || target == address(policy) || target == account || anyAllowed;
        vm.prank(account);
        try policy.setTradedAsset(target, isTraded) {
            if (mustRefuse) ++tradedViolations;
            modelTraded[target] = isTraded;
        } catch {
            require(mustRefuse, "unexpected setTradedAsset revert");
        }
    }

    // --- model -----------------------------------------------------------------------------------------------------

    /// Three in four calls are shaped like legitimate agent calls (a counted call to the router or the reallocation
    /// contract, or an uncounted router or reallocation call), so accepted spend actually accumulates; the rest are
    /// drawn from the whole pool, including non-allowlisted targets, foreign selectors, and nonzero native value.
    function _randomCall(uint256 seed) internal view returns (IAgentSpendPolicy.Call memory c) {
        uint256 raw = seed >> 64;
        uint256 amountKind = (seed >> 56) % 4;
        uint256 amount = amountKind == 0
            ? raw % 1e6
            : amountKind == 1 ? raw % (uint256(PER_TX_CAP) + 1) : amountKind == 2 ? PER_TX_CAP + raw % 10 : raw;
        if ((seed >> 4) % 4 != 0) {
            uint256 shape = (seed >> 8) % 5;
            address recipient = targets[1 + (seed >> 48) % 2];
            if (shape == 0) {
                c = IAgentSpendPolicy.Call(asset, 0, abi.encodeWithSelector(TRANSFER, recipient, amount % 60e6));
            } else if (shape == 1) {
                c = IAgentSpendPolicy.Call(asset, 0, abi.encodeWithSelector(APPROVE, recipient, amount % 60e6));
            } else if (shape == 4) {
                // A close: approve the router on the traded asset, any amount, uncounted.
                c = IAgentSpendPolicy.Call(tradedToken, 0, abi.encodeWithSelector(APPROVE, recipient, raw));
            } else if (shape == 2) {
                c = IAgentSpendPolicy.Call(targets[1], 0, abi.encodeWithSelector(SWAP, recipient, amount));
            } else {
                c = IAgentSpendPolicy.Call(targets[2], 0, abi.encodeWithSelector(REALLOCATE, recipient, amount));
            }
            return c;
        }
        c.target = targets[seed % targets.length];
        bytes4 sel = (seed >> 8) % 8 == 0 ? bytes4(uint32(seed >> 16)) : selectors[(seed >> 8) % selectors.length];
        address anyRecipient = targets[(seed >> 48) % targets.length];
        c.data = abi.encodeWithSelector(sel, anyRecipient, amount);
        c.value = (seed >> 40) % 16 == 0 ? 1 + (seed >> 200) % 1 ether : 0;
    }

    function _isCounted(IAgentSpendPolicy.Call memory c) internal view returns (bool) {
        return c.target == asset;
    }

    /// A call on the settlement asset or a traded asset decodes a recipient that must pass the rule.
    function _isTokenCall(IAgentSpendPolicy.Call memory c) internal view returns (bool) {
        return c.target == asset || modelTraded[c.target];
    }

    function _recipientOk(address r) internal view returns (bool) {
        if (r == asset || r == address(policy) || r == account || modelTraded[r]) return false;
        for (uint256 i = 0; i < selectors.length; ++i) {
            if (modelAllowed[r][selectors[i]]) return true;
        }
        return false; // random selectors are never allowlisted by toggleAllowed
    }

    function _modelCheck(IAgentSpendPolicy.Call[] memory calls) internal view returns (bool ok, uint256 total) {
        for (uint256 i = 0; i < calls.length; ++i) {
            IAgentSpendPolicy.Call memory c = calls[i];
            bytes4 sel = bytes4(c.data);
            if (c.target == address(policy) || c.target == account) return (false, 0);
            if (!modelAllowed[c.target][sel]) return (false, 0);
            if (c.value != 0) return (false, 0);
            if (_isTokenCall(c)) {
                if (sel != TRANSFER && sel != APPROVE) return (false, 0);
                (address r, uint256 a) = _args(c.data);
                if (!_recipientOk(r)) return (false, 0);
                if (!_isCounted(c)) continue;
                if (a > PER_TX_CAP - total) return (false, 0);
                total += a;
            }
        }
        return (true, total);
    }

    function _auditAccepted(IAgentSpendPolicy.Call[] memory calls, uint256 total) internal {
        if (total > PER_TX_CAP) ++perTxViolations;
        for (uint256 i = 0; i < calls.length; ++i) {
            IAgentSpendPolicy.Call memory c = calls[i];
            if (c.target == address(policy) || c.target == account || !modelAllowed[c.target][bytes4(c.data)]) {
                ++allowlistViolations;
            }
            if (c.value != 0) ++valueViolations;
            if (_isTokenCall(c)) {
                (address r,) = _args(c.data);
                if (!_recipientOk(r)) ++recipientViolations;
            }
        }
    }

    function _args(bytes memory data) internal pure returns (address r, uint256 a) {
        assembly {
            r := mload(add(data, 36))
            a := mload(add(data, 68))
        }
    }

    function _modelWindow(uint256 t) public view returns (uint256 sum) {
        uint256 h = t / 1 hours;
        for (uint256 i = 0; i < spendTimes.length; ++i) {
            if (spendTimes[i] / 1 hours + 24 >= h) sum += spendAmounts[i];
        }
    }

    function spendCount() external view returns (uint256) {
        return spendTimes.length;
    }
}

contract AgentSpendPolicyInvariantTest is StdInvariant, Test {
    AgentSpendPolicy internal policy;
    SpendPolicyHandler internal handler;
    address internal account;

    function setUp() public {
        vm.warp(1_790_000_000);
        address asset = makeAddr("settlementAsset");
        account = makeAddr("account");
        policy = new AgentSpendPolicy(asset);
        handler = new SpendPolicyHandler(policy, account, asset, makeAddr("router"), makeAddr("reallocation"));

        bytes4[] memory sels = new bytes4[](4);
        sels[0] = SpendPolicyHandler.operate.selector;
        sels[1] = SpendPolicyHandler.warp.selector;
        sels[2] = SpendPolicyHandler.toggleAllowed.selector;
        sels[3] = SpendPolicyHandler.toggleTraded.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    /// THREAT-MODEL.md invariant 1, per-transaction part: no accepted operation counts more than perTxCap.
    function invariant_perTxCapNeverExceeded() public view {
        assertEq(handler.perTxViolations(), 0);
        for (uint256 i = 0; i < handler.spendCount(); ++i) {
            assertLe(handler.spendAmounts(i), handler.PER_TX_CAP());
        }
    }

    /// THREAT-MODEL.md invariant 1, daily part: no 24-hour period holds more than dailyCap of accepted spend.
    function invariant_rolling24hSpendWithinDailyCap() public view {
        assertEq(handler.dailyViolations(), 0);
        uint256 n = handler.spendCount();
        for (uint256 i = 0; i < n; ++i) {
            uint256 start = handler.spendTimes(i);
            uint256 sum;
            for (uint256 j = 0; j < n; ++j) {
                uint256 t = handler.spendTimes(j);
                if (t >= start && t < start + 24 hours) sum += handler.spendAmounts(j);
            }
            assertLe(sum, handler.DAILY_CAP());
        }
    }

    /// Contract allowlist: a call to any target or selector outside the configured allowlist, or to the policy or
    /// the account, is never accepted, whatever its amount.
    function invariant_allowlistAlwaysEnforced() public view {
        assertEq(handler.allowlistViolations(), 0);
    }

    /// The recipient rule holds for every call on the settlement asset and on a traded asset, a traded asset is never
    /// a recipient, and nonzero native value is never accepted.
    function invariant_recipientRuleAndNativeValueEnforced() public view {
        assertEq(handler.recipientViolations(), 0);
        assertEq(handler.valueViolations(), 0);
    }

    /// `setTradedAsset` never marks the settlement asset, the policy, the account, or a target with a selector
    /// allowed, so the token rules cannot change under an existing allowlist entry.
    function invariant_tradedAssetMarkingRefusesWhatItMust() public view {
        assertEq(handler.tradedViolations(), 0);
    }

    function invariant_checkAgreesWithModel() public view {
        assertEq(handler.totalMismatches(), 0);
        assertEq(handler.recordWithoutCheck(), 0);
    }

    function invariant_windowTotalMatchesModel() public view {
        assertEq(policy.windowTotal(account), handler._modelWindow(block.timestamp));
    }
}
