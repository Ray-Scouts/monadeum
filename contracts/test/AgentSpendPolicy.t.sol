// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {PolicyTestBase} from "./utils/PolicyTestBase.sol";
import {AgentSpendPolicy} from "../src/AgentSpendPolicy.sol";
import {IAgentSpendPolicy} from "../src/IAgentSpendPolicy.sol";
import {PackedUserOperation} from "../src/kernel/IKernelModules.sol";

contract AgentSpendPolicyTest is PolicyTestBase {
    // --- deployment and views ---------------------------------------------------------------------------------------

    function test_constructor_rejectsZeroSettlementAsset() public {
        vm.expectRevert(AgentSpendPolicy.ZeroSettlementAsset.selector);
        new AgentSpendPolicy(address(0));
    }

    function test_views_reflectConfiguration() public {
        assertEq(policy.settlementAsset(), asset);
        IAgentSpendPolicy.Limits memory l = policy.limits(account);
        assertEq(l.perTxCap, PER_TX_CAP);
        assertEq(l.dailyCap, DAILY_CAP);
        assertTrue(policy.isAllowed(account, router, SWAP));
        assertFalse(policy.isAllowed(account, router, REALLOCATE));
        assertTrue(policy.isRecipientAllowed(account, router));
        assertTrue(policy.isRecipientAllowed(account, repro));
        assertFalse(policy.isRecipientAllowed(account, asset), "settlement asset is never a recipient");
        assertFalse(policy.isRecipientAllowed(account, address(policy)));
        assertFalse(policy.isRecipientAllowed(account, account));
        assertFalse(policy.isRecipientAllowed(account, makeAddr("stranger")));
        assertEq(policy.windowTotal(account), 0);
    }

    // --- owner functions --------------------------------------------------------------------------------------------

    function test_setLimits_isPerAccountAndEmits() public {
        address other = makeAddr("other");
        vm.expectEmit(true, false, false, true, address(policy));
        emit IAgentSpendPolicy.LimitsSet(other, 1, 2);
        vm.prank(other);
        policy.setLimits(IAgentSpendPolicy.Limits({perTxCap: 1, dailyCap: 2}));
        assertEq(policy.limits(other).perTxCap, 1);
        assertEq(policy.limits(account).perTxCap, PER_TX_CAP, "other accounts unaffected");
    }

    function test_setAllowed_emitsAndTracksRecipients() public {
        address other = makeAddr("other");
        vm.expectEmit(true, true, true, true, address(policy));
        emit IAgentSpendPolicy.CallAllowed(other, router, SWAP, true);
        vm.startPrank(other);
        policy.setAllowed(router, SWAP, true);
        policy.setAllowed(router, SWAP, true); // idempotent, must not double count
        policy.setAllowed(router, REALLOCATE, true);
        assertTrue(policy.isRecipientAllowed(other, router));
        policy.setAllowed(router, SWAP, false);
        assertTrue(policy.isRecipientAllowed(other, router), "one selector still allowed");
        policy.setAllowed(router, REALLOCATE, false);
        assertFalse(policy.isRecipientAllowed(other, router));
        policy.setAllowed(router, REALLOCATE, false); // idempotent, must not underflow
        vm.stopPrank();
        assertFalse(policy.isAllowed(other, router, SWAP));
    }

    function test_setAllowed_rejectsUncountedSettlementSelectors() public {
        bytes4[3] memory bad = [TRANSFER_FROM, INCREASE_ALLOWANCE, bytes4(0)];
        for (uint256 i = 0; i < bad.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.UncountedSettlementSelector.selector, bad[i]));
            vm.prank(account);
            policy.setAllowed(asset, bad[i], true);
            vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.UncountedSettlementSelector.selector, bad[i]));
            vm.prank(account);
            policy.setAllowed(asset, bad[i], false);
        }
    }

    function testFuzz_setAllowed_settlementAssetAdmitsOnlyTransferAndApprove(bytes4 selector) public {
        vm.prank(account);
        if (selector == TRANSFER || selector == APPROVE) {
            policy.setAllowed(asset, selector, true);
            assertTrue(policy.isAllowed(account, asset, selector));
        } else {
            vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.UncountedSettlementSelector.selector, selector));
            policy.setAllowed(asset, selector, true);
        }
    }

    // --- check: allowlist and self-protection ----------------------------------------------------------------------

    function test_check_countsTransferAndApprove() public view {
        assertEq(policy.check(account, _one(_transfer(router, 40e6))), 40e6);
        assertEq(policy.check(account, _one(_approve(repro, 60e6))), 60e6);
        assertEq(policy.check(account, _two(_approve(router, 30e6), _transfer(repro, 70e6))), 100e6);
    }

    function test_check_uncountedCallsCountZero() public view {
        assertEq(policy.check(account, _one(_swap())), 0);
        assertEq(policy.check(account, _two(_approve(router, 100e6), _swap())), 100e6);
    }

    function test_check_emptyOperationCountsZero() public view {
        assertEq(policy.check(account, new IAgentSpendPolicy.Call[](0)), 0);
    }

    function testFuzz_check_rejectsNonAllowlistedTargetRegardlessOfAmount(address target, uint256 amount, bytes4 sel)
        public
    {
        vm.assume(target != asset && target != router && target != repro);
        bytes[3] memory datas = [
            abi.encodeWithSelector(TRANSFER, router, amount),
            abi.encodeWithSelector(APPROVE, router, amount),
            abi.encodeWithSelector(sel, amount)
        ];
        for (uint256 i = 0; i < datas.length; ++i) {
            IAgentSpendPolicy.Call memory c = IAgentSpendPolicy.Call({target: target, value: 0, data: datas[i]});
            vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, target, bytes4(datas[i])));
            policy.check(account, _one(c));
            // Also inside a batch that is otherwise valid and tiny.
            vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, target, bytes4(datas[i])));
            policy.check(account, _two(_transfer(router, 1), c));
        }
    }

    function testFuzz_check_rejectsNonAllowlistedSelectorOnAllowlistedTarget(bytes4 sel, uint256 amount) public {
        vm.assume(sel != SWAP);
        IAgentSpendPolicy.Call memory c =
            IAgentSpendPolicy.Call({target: router, value: 0, data: abi.encodeWithSelector(sel, amount)});
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, router, sel));
        policy.check(account, _one(c));
    }

    function test_check_rejectsAccountWithoutAllowlist() public {
        address fresh = makeAddr("fresh");
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, asset, TRANSFER));
        policy.check(fresh, _one(_transfer(router, 0)));
    }

    function test_check_rejectsPolicyAndAccountTargetsEvenIfAllowlisted() public {
        bytes4 setLimitsSel = IAgentSpendPolicy.setLimits.selector;
        bytes4 installSel = bytes4(keccak256("installModule(uint256,address,bytes)"));
        vm.startPrank(account);
        policy.setAllowed(address(policy), setLimitsSel, true);
        policy.setAllowed(account, installSel, true);
        vm.stopPrank();

        IAgentSpendPolicy.Call memory toPolicy = IAgentSpendPolicy.Call({
            target: address(policy),
            value: 0,
            data: abi.encodeWithSelector(setLimitsSel, type(uint128).max, type(uint128).max)
        });
        vm.expectRevert(
            abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, address(policy), setLimitsSel)
        );
        policy.check(account, _one(toPolicy));

        IAgentSpendPolicy.Call memory toAccount =
            IAgentSpendPolicy.Call({target: account, value: 0, data: abi.encodeWithSelector(installSel, 1)});
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, account, installSel));
        policy.check(account, _one(toAccount));
    }

    function test_check_rejectsCalldataShorterThanSelector() public {
        vm.prank(account);
        policy.setAllowed(router, bytes4(0), true);
        IAgentSpendPolicy.Call memory c = IAgentSpendPolicy.Call({target: router, value: 0, data: hex"0000"});
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, router, bytes4(0)));
        policy.check(account, _one(c));
        c.data = "";
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, router, bytes4(0)));
        policy.check(account, _one(c));
    }

    function testFuzz_check_rejectsNativeValue(uint256 value) public {
        vm.assume(value != 0);
        IAgentSpendPolicy.Call memory c = _swap();
        c.value = value;
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.NativeValueNotAllowed.selector, value));
        policy.check(account, _one(c));
        IAgentSpendPolicy.Call memory t = _transfer(router, 1);
        t.value = value;
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.NativeValueNotAllowed.selector, value));
        policy.check(account, _one(t));
    }

    // --- check: counted call decoding and recipient rule -----------------------------------------------------------

    function test_check_rejectsUndecodableCountedCall() public {
        IAgentSpendPolicy.Call memory c = _transfer(router, 1);
        c.data = abi.encodePacked(TRANSFER, bytes32(uint256(uint160(router))), bytes31(0)); // 67 bytes
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, asset, TRANSFER));
        policy.check(account, _one(c));

        // Recipient word with dirty upper bits.
        c.data = abi.encodePacked(TRANSFER, bytes32((uint256(1) << 160) | uint256(uint160(router))), uint256(1));
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, asset, TRANSFER));
        policy.check(account, _one(c));
    }

    /// `setAllowed` refuses these entries, so they cannot be reached through the contract's own functions. This
    /// writes one into storage directly to show that `check` refuses it as well, independently of `setAllowed`, so
    /// the self-protection rule does not rest on a single check.
    function test_check_rejectsUncountedSettlementSelectorEvenIfStored() public {
        bytes4[2] memory sels = [TRANSFER_FROM, INCREASE_ALLOWANCE];
        for (uint256 i = 0; i < sels.length; ++i) {
            vm.store(address(policy), _allowedSlot(asset, sels[i], account), bytes32(uint256(1)));
            assertTrue(policy.isAllowed(account, asset, sels[i]), "entry written");
            IAgentSpendPolicy.Call memory c = IAgentSpendPolicy.Call({
                target: asset, value: 0, data: abi.encodeWithSelector(sels[i], account, router, uint256(1))
            });
            vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, asset, sels[i]));
            policy.check(account, _one(c));
        }
    }

    // --- check: ERC-7562 associated storage ------------------------------------------------------------------------

    /// Every storage slot the validation path reads must be associated with the account (ERC-7562): the account is
    /// the innermost mapping key. This records the slots `checkUserOpPolicy` actually reads for an operation that
    /// exercises every read in `_check` (limits, allowlist entries, the recipient rule) and requires each to be one
    /// of the slots derived with the account as innermost key, with no writes and no other contract touched.
    function test_validation_readsOnlyAccountAssociatedStorage() public {
        IAgentSpendPolicy.Call[] memory calls = _two(_transfer(router, 10e6), _swap());
        bytes memory callData = abi.encodeWithSelector(
            bytes4(keccak256("execute(bytes32,bytes)")), bytes32(bytes1(0x01)), abi.encode(calls)
        );
        PackedUserOperation memory op;
        op.sender = account;
        op.callData = callData;

        bytes32[4] memory expected = [
            keccak256(abi.encode(account, uint256(0))), // _limits[account]
            _allowedSlot(asset, TRANSFER, account),
            _allowedSlot(router, SWAP, account),
            keccak256(abi.encode(account, keccak256(abi.encode(router, uint256(2))))) // _allowedSelectorCount[router][account]
        ];

        vm.record();
        vm.prank(account);
        policy.checkUserOpPolicy(bytes32(0), op);
        (bytes32[] memory reads, bytes32[] memory writes) = vm.accesses(address(policy));
        (, bytes32[] memory assetWrites) = vm.accesses(asset);

        assertEq(writes.length, 0, "validation writes nothing");
        assertEq(assetWrites.length, 0, "validation touches no other contract");
        for (uint256 i = 0; i < reads.length; ++i) {
            bool found;
            for (uint256 j = 0; j < expected.length; ++j) {
                if (reads[i] == expected[j]) found = true;
            }
            assertTrue(found, "read outside the account's associated storage");
        }
        for (uint256 j = 0; j < expected.length; ++j) {
            bool found;
            for (uint256 i = 0; i < reads.length; ++i) {
                if (reads[i] == expected[j]) found = true;
            }
            assertTrue(found, "expected read did not happen, so the slot derivation above is stale");
        }
    }

    function _allowedSlot(address target, bytes4 selector, address who) internal pure returns (bytes32) {
        bytes32 outer = keccak256(abi.encode(target, uint256(1)));
        bytes32 middle = keccak256(abi.encode(selector, outer));
        return keccak256(abi.encode(who, middle));
    }

    function test_check_ignoresTrailingBytesLikeAbiDecoding() public view {
        IAgentSpendPolicy.Call memory c = _transfer(router, 5);
        c.data = abi.encodePacked(c.data, hex"deadbeef");
        assertEq(policy.check(account, _one(c)), 5);
    }

    function testFuzz_check_rejectsRecipientWithoutAllowedSelector(address recipient, uint256 amount, bool viaApprove)
        public
    {
        vm.assume(recipient != router && recipient != repro && recipient != asset);
        IAgentSpendPolicy.Call memory c = viaApprove ? _approve(recipient, amount) : _transfer(recipient, amount);
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.RecipientNotAllowed.selector, recipient));
        policy.check(account, _one(c));
    }

    function test_check_rejectsRecipientThatIsAssetPolicyOrAccount() public {
        // Give each a selector so only the explicit exclusion can reject them.
        vm.startPrank(account);
        policy.setAllowed(address(policy), SWAP, true);
        policy.setAllowed(account, SWAP, true);
        vm.stopPrank();
        address[3] memory excluded = [asset, address(policy), account];
        for (uint256 i = 0; i < excluded.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.RecipientNotAllowed.selector, excluded[i]));
            policy.check(account, _one(_transfer(excluded[i], 1)));
            vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.RecipientNotAllowed.selector, excluded[i]));
            policy.check(account, _one(_approve(excluded[i], 1)));
        }
    }

    function test_check_recipientRuleFollowsAllowlistRemoval() public {
        vm.prank(account);
        policy.setAllowed(repro, REALLOCATE, false);
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.RecipientNotAllowed.selector, repro));
        policy.check(account, _one(_approve(repro, 1)));
    }

    // --- check: per-transaction cap --------------------------------------------------------------------------------

    function testFuzz_check_perTxCapOnSingleCall(uint256 amount) public {
        if (amount <= PER_TX_CAP) {
            assertEq(policy.check(account, _one(_transfer(router, amount))), amount);
        } else {
            vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, amount, PER_TX_CAP));
            policy.check(account, _one(_transfer(router, amount)));
        }
    }

    /// Mirrors the issue #18 spike's batched case: two calls, each within the cap, in one operation. The native
    /// combination let that batch through; here the cap applies to the sum.
    function test_check_perTxCapAppliesToBatchSum() public {
        IAgentSpendPolicy.Call[] memory batch = _two(_transfer(router, 60e6), _transfer(router, 60e6));
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, 120e6, PER_TX_CAP));
        policy.check(account, batch);

        batch = _two(_transfer(router, 50e6), _approve(repro, 50e6));
        assertEq(policy.check(account, batch), 100e6, "sum equal to the cap passes");
    }

    function testFuzz_check_perTxCapOnBatchSum(uint64[6] memory amounts, uint8 n) public {
        n = uint8(bound(n, 1, 6));
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](n);
        uint256 sum;
        for (uint256 i = 0; i < n; ++i) {
            uint256 a = uint256(amounts[i]) % (uint256(PER_TX_CAP) + 1);
            calls[i] = i % 2 == 0 ? _transfer(router, a) : _approve(repro, a);
            sum += a;
        }
        if (sum <= PER_TX_CAP) {
            assertEq(policy.check(account, calls), sum);
        } else {
            vm.expectPartialRevert(IAgentSpendPolicy.PerTxCapExceeded.selector);
            policy.check(account, calls);
        }
    }

    function test_check_hugeAmountsDoNotOverflow() public {
        IAgentSpendPolicy.Call[] memory batch = _two(_transfer(router, 1), _transfer(router, type(uint256).max));
        vm.expectRevert(
            abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, type(uint256).max, PER_TX_CAP)
        );
        policy.check(account, batch);
    }

    function test_check_failsClosedWhenLimitsNeverSet() public {
        address fresh = makeAddr("fresh");
        vm.startPrank(fresh);
        policy.setAllowed(asset, TRANSFER, true);
        policy.setAllowed(router, SWAP, true);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, 1, 0));
        policy.check(fresh, _one(_transfer(router, 1)));
        // Even a counted call for 0 fails closed, while an uncounted allowlisted call still passes.
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, 0, 0));
        policy.check(fresh, _one(_transfer(router, 0)));
        assertEq(policy.check(fresh, _one(_swap())), 0);
    }

    // --- record: rolling daily cap ---------------------------------------------------------------------------------

    function test_record_addsToWindowAndEmits() public {
        vm.expectEmit(true, false, false, true, address(policy));
        emit IAgentSpendPolicy.Spent(account, 40e6, 40e6);
        _record(account, _one(_transfer(router, 40e6)));
        vm.expectEmit(true, false, false, true, address(policy));
        emit IAgentSpendPolicy.Spent(account, 0, 40e6);
        _record(account, _one(_swap()));
        assertEq(policy.windowTotal(account), 40e6);
    }

    function test_record_isKeyedByMsgSender() public {
        address other = makeAddr("other");
        _configure(other, PER_TX_CAP, DAILY_CAP);
        _record(other, _one(_transfer(router, 10e6)));
        assertEq(policy.windowTotal(other), 10e6);
        assertEq(policy.windowTotal(account), 0);
    }

    function test_record_rejectsAtDailyCap() public {
        _record(account, _one(_transfer(router, 100e6)));
        _record(account, _one(_transfer(router, 100e6)));
        _record(account, _one(_transfer(router, 100e6)));
        assertEq(policy.windowTotal(account), DAILY_CAP);
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.DailyCapExceeded.selector, DAILY_CAP + 1, DAILY_CAP));
        vm.prank(account);
        policy.record(_one(_transfer(router, 1)));
        // Zero-count operations still pass at the cap.
        _record(account, _one(_swap()));
    }

    function test_record_runsTheValidationRulesAgain() public {
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, 101e6, PER_TX_CAP));
        vm.prank(account);
        policy.record(_one(_transfer(router, 101e6)));
        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.RecipientNotAllowed.selector, stranger));
        vm.prank(account);
        policy.record(_one(_transfer(stranger, 1)));
    }

    function test_record_failsClosedWhenLimitsNeverSet() public {
        address fresh = makeAddr("fresh");
        vm.startPrank(fresh);
        policy.setAllowed(asset, TRANSFER, true);
        policy.setAllowed(router, SWAP, true);
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, 1, 0));
        policy.record(_one(_transfer(router, 1)));
        vm.stopPrank();
    }

    function test_record_loweringDailyCapBlocksFurtherSpend() public {
        _record(account, _one(_transfer(router, 100e6)));
        vm.prank(account);
        policy.setLimits(IAgentSpendPolicy.Limits({perTxCap: PER_TX_CAP, dailyCap: 50e6}));
        vm.expectRevert(abi.encodeWithSelector(IAgentSpendPolicy.DailyCapExceeded.selector, 101e6, 50e6));
        vm.prank(account);
        policy.record(_one(_transfer(router, 1e6)));
    }

    /// The window at hour h covers buckets h - 24 through h: spend made at any second of hour h0 stays counted until
    /// the last second of hour h0 + 24 and is dropped at the first second of hour h0 + 25.
    function test_window_boundaryAtHour25() public {
        uint256 h0Start = (block.timestamp / 1 hours) * 1 hours;
        vm.warp(h0Start + 1800);
        _record(account, _one(_transfer(router, 100e6)));
        _record(account, _one(_transfer(router, 100e6)));
        _record(account, _one(_transfer(router, 100e6)));

        // Exactly 24 hours later, and the last second of hour h0 + 24: still counted.
        vm.warp(h0Start + 1800 + 24 hours);
        assertEq(policy.windowTotal(account), DAILY_CAP);
        vm.warp(h0Start + 25 hours - 1);
        assertEq(policy.windowTotal(account), DAILY_CAP);
        vm.expectPartialRevert(IAgentSpendPolicy.DailyCapExceeded.selector);
        vm.prank(account);
        policy.record(_one(_transfer(router, 1)));

        // First second of hour h0 + 25: dropped.
        vm.warp(h0Start + 25 hours);
        assertEq(policy.windowTotal(account), 0);
        _record(account, _one(_transfer(router, 100e6)));
        assertEq(policy.windowTotal(account), 100e6);
    }

    /// Spending late in one day and early in the next is the pattern that moved more than the nominal bound under
    /// the fixed native window in issue #18. The rolling window rejects it.
    function test_window_lateThenEarlyBurstIsBounded() public {
        uint256 dayStart = (block.timestamp / 1 days + 1) * 1 days;
        vm.warp(dayStart - 10 minutes);
        _record(account, _one(_transfer(router, 100e6)));
        _record(account, _one(_transfer(router, 100e6)));
        _record(account, _one(_transfer(router, 100e6)));
        vm.warp(dayStart + 10 minutes);
        vm.expectPartialRevert(IAgentSpendPolicy.DailyCapExceeded.selector);
        vm.prank(account);
        policy.record(_one(_transfer(router, 1)));
    }

    function test_window_bucketSlotReuseDropsStaleHour() public {
        _record(account, _one(_transfer(router, 100e6)));
        // 25 hours later the same slot index is reused; the old amount must not leak into the new hour.
        vm.warp(block.timestamp + 25 hours);
        _record(account, _one(_transfer(router, 30e6)));
        assertEq(policy.windowTotal(account), 30e6);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        assertEq(policy.windowTotal(account), 30e6);
    }

    /// Fuzzed sequence of spends over several simulated days, compared against an independent model of the rule,
    /// plus the property the rule exists for: no 24-hour period ever holds more than dailyCap.
    function testFuzz_window_matchesModelAcrossDays(uint256 seed) public {
        uint256 steps = 40;
        uint256[] memory times = new uint256[](steps);
        uint256[] memory spent = new uint256[](steps);
        uint256 accepted;
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < steps; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            // Mostly short steps, sometimes multi-hour jumps, sometimes landing exactly on an hour boundary.
            uint256 kind = seed % 5;
            if (kind == 0) t += (seed >> 8) % 60;
            else if (kind == 1) t += (seed >> 8) % 3 hours;
            else if (kind == 2) t = ((t / 1 hours) + 1 + (seed >> 8) % 24) * 1 hours;
            else if (kind == 3) t = ((t / 1 hours) + 25) * 1 hours - 1;
            else t += (seed >> 8) % 2 days;
            vm.warp(t);
            uint256 amount = (seed >> 64) % (uint256(PER_TX_CAP) + 1);

            uint256 modelWindow = _modelWindow(times, spent, accepted, t);
            assertEq(policy.windowTotal(account), modelWindow, "window total matches model");

            vm.prank(account);
            try policy.record(_one(_transfer(router, amount))) {
                assertLe(modelWindow + amount, DAILY_CAP, "accepted only within the cap");
                times[accepted] = t;
                spent[accepted] = amount;
                ++accepted;
            } catch (bytes memory reason) {
                assertGt(modelWindow + amount, DAILY_CAP, "rejected only above the cap");
                assertEq(
                    reason,
                    abi.encodeWithSelector(IAgentSpendPolicy.DailyCapExceeded.selector, modelWindow + amount, DAILY_CAP)
                );
            }
        }
        // No 24-hour period [s, s + 24h) holds more than the cap. The maximum is attained with s at a spend time.
        for (uint256 i = 0; i < accepted; ++i) {
            uint256 inPeriod;
            for (uint256 j = 0; j < accepted; ++j) {
                if (times[j] >= times[i] && times[j] < times[i] + 24 hours) inPeriod += spent[j];
            }
            assertLe(inPeriod, DAILY_CAP, "rolling 24h spend within dailyCap");
        }
    }

    function _modelWindow(uint256[] memory times, uint256[] memory spent, uint256 n, uint256 t)
        internal
        pure
        returns (uint256 sum)
    {
        uint256 h = t / 1 hours;
        for (uint256 i = 0; i < n; ++i) {
            uint256 hi = times[i] / 1 hours;
            if (hi + 24 >= h) sum += spent[i];
        }
    }
}
