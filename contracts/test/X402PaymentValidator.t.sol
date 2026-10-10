// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Test.sol";
import {X402PaymentValidator} from "../src/X402PaymentValidator.sol";
import {PackedUserOperation} from "../src/kernel/IKernelModules.sol";
import {MockKernelValidatorAccount} from "./utils/X402Mocks.sol";
import {X402TestBase} from "./utils/X402TestBase.sol";

contract X402PaymentValidatorTest is X402TestBase {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes4 internal constant INVALID = 0xffffffff;

    // --- the allowed path -------------------------------------------------------------------------------------------

    function test_payment_withinBoundsSettlesThroughTheToken() public {
        uint256 t = block.timestamp;
        _pay(nansen, MAX_VALUE, t - 60, t + 300, 0);
        assertEq(token.balanceOf(nansen), MAX_VALUE);
        assertEq(token.balanceOf(address(account)), BALANCE - MAX_VALUE);
    }

    function test_payment_everySlotOfAnHourOnceThenNoMore() public {
        uint256 t = block.timestamp;
        for (uint256 slot = 0; slot < SLOTS; ++slot) {
            _pay(defillama, 1, t - 1, t + 60, slot);
        }
        assertEq(token.balanceOf(defillama), SLOTS);
        // Any authorization for slot 0 in this hour carries slot 0's nonce, which the token already consumed.
        uint256 validAfter = t - 2;
        bytes32 nonce = _nonce(validAfter, 0);
        assertEq(nonce, _nonce(t - 1, 0), "same hour, same slot, same nonce");
        bytes32 digest = _twaDigest(address(account), defillama, 1, validAfter, t + 60, nonce);
        bytes memory sig = _kernelSig(digest, _fields(defillama, 1, validAfter, t + 60, 0));
        vm.expectRevert("authorization is used or canceled");
        token.transferWithAuthorization(address(account), defillama, 1, validAfter, t + 60, nonce, sig);
    }

    function test_payment_aSlotIsFreshAgainInTheNextHour() public {
        uint256 t = block.timestamp;
        _pay(nansen, 1, t - 1, t + 60, 0);
        vm.warp(t + 1 hours);
        _pay(nansen, 1, t + 1 hours - 1, t + 1 hours + 60, 0);
        assertEq(token.balanceOf(nansen), 2);
    }

    function test_validator_returnsMagicForTheExactDigestAndKey() public {
        uint256 t = block.timestamp;
        bytes32 digest = _twaDigest(address(account), nansen, 5, t, t + 1, _nonce(t, 3));
        assertEq(_check(digest, _data(x402Key, digest, _fields(nansen, 5, t, t + 1, 3))), MAGIC);
    }

    function test_validator_anotherKeyIsInvalid() public {
        uint256 t = block.timestamp;
        bytes32 digest = _twaDigest(address(account), nansen, 5, t, t + 1, _nonce(t, 3));
        Vm.Wallet memory other = vm.createWallet("tradingSessionKey");
        assertEq(_check(digest, _data(other, digest, _fields(nansen, 5, t, t + 1, 3))), INVALID);
    }

    function test_validator_highSOrBadVIsInvalid() public {
        uint256 t = block.timestamp;
        bytes32 digest = _twaDigest(address(account), nansen, 5, t, t + 1, _nonce(t, 3));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(x402Key, account.wrappedHash(digest));
        bytes memory fields = _fields(nansen, 5, t, t + 1, 3);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 highS = bytes32(n - uint256(s));
        uint8 flipped = v == 27 ? 28 : 27;
        assertEq(_check(digest, abi.encodePacked(fields, r, highS, flipped)), INVALID, "malleated twin refused");
        assertEq(_check(digest, abi.encodePacked(fields, r, s, uint8(v + 2))), INVALID, "v outside 27/28 refused");
    }

    // --- what the owner's concern is about: permit and unbounded transfers --------------------------------------

    function test_permitForTheWholeBalanceIsRejected() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes32 structHash =
            keccak256(abi.encode(token.PERMIT_TYPEHASH(), address(account), attacker, BALANCE, 0, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        // Whatever bounded-looking fields the key attaches, the permit digest is not those fields' digest.
        uint256 t = block.timestamp;
        bytes memory fields = _fields(nansen, 1, t, t + 60, 0);
        bytes32 described = account.wrappedHash(_twaDigest(address(account), nansen, 1, t, t + 60, _nonce(t, 0)));
        bytes32 wrapped = account.wrappedHash(digest);
        bytes memory data = _data(x402Key, digest, fields);
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.DigestMismatch.selector, wrapped, described));
        _check(digest, data);

        bytes memory sig = _kernelSig(digest, fields);
        vm.expectRevert("EIP2612: invalid signature");
        token.permit(address(account), attacker, BALANCE, deadline, sig);
        assertEq(token.allowance(address(account), attacker), 0);
    }

    function test_unboundedTransferWithAuthorizationIsRejected() public {
        uint256 t = block.timestamp - 1; // validAfter, already passed so the token reaches the signature check
        bytes32 nonce = _nonce(t, 0);
        // Honest fields for an over-cap value: rejected by the value rule.
        bytes32 digest = _twaDigest(address(account), nansen, BALANCE, t, t + 60, nonce);
        bytes memory honest = _data(x402Key, digest, _fields(nansen, BALANCE, t, t + 60, 0));
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.ValueOutOfBounds.selector, BALANCE, MAX_VALUE));
        _check(digest, honest);

        // Lying fields (a small value) attached to the big transfer's digest: rejected by the digest rule.
        bytes memory lie = _fields(nansen, 1, t, t + 60, 0);
        bytes32 described = account.wrappedHash(_twaDigest(address(account), nansen, 1, t, t + 60, nonce));
        bytes32 wrapped = account.wrappedHash(digest);
        bytes memory lying = _data(x402Key, digest, lie);
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.DigestMismatch.selector, wrapped, described));
        _check(digest, lying);

        bytes memory sig = _kernelSig(digest, lie);
        vm.expectRevert("FiatTokenV2: invalid signature");
        token.transferWithAuthorization(address(account), nansen, BALANCE, t, t + 60, nonce, sig);
        assertEq(token.balanceOf(address(account)), BALANCE);
    }

    function test_transferToAnUnlistedAddressIsRejected() public {
        uint256 t = block.timestamp;
        bytes32 digest = _twaDigest(address(account), attacker, 1, t, t + 60, _nonce(t, 0));
        bytes memory data = _data(x402Key, digest, _fields(attacker, 1, t, t + 60, 0));
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.PayeeNotAllowed.selector, attacker));
        _check(digest, data);
    }

    function test_receiveWithAuthorizationDigestIsRejected() public {
        uint256 t = block.timestamp;
        bytes32 structHash = keccak256(
            abi.encode(
                token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), address(account), nansen, 1, t, t + 60, _nonce(t, 0)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        bytes memory data = _data(x402Key, digest, _fields(nansen, 1, t, t + 60, 0));
        vm.expectPartialRevert(X402PaymentValidator.DigestMismatch.selector);
        _check(digest, data);
    }

    function test_randomNonceAsTheReferenceClientUsesIsRejected() public {
        uint256 t = block.timestamp;
        bytes32 digest = _twaDigest(address(account), nansen, 1, t, t + 60, keccak256("random"));
        bytes memory data = _data(x402Key, digest, _fields(nansen, 1, t, t + 60, 0));
        vm.expectPartialRevert(X402PaymentValidator.DigestMismatch.selector);
        _check(digest, data);
    }

    function test_anotherAuthorizerIsRejected() public {
        uint256 t = block.timestamp;
        address other = makeAddr("otherAccount");
        bytes32 digest = _twaDigest(other, nansen, 1, t, t + 60, validator.nonceFor(other, t / 1 hours, 0));
        bytes memory data = _data(x402Key, digest, _fields(nansen, 1, t, t + 60, 0));
        vm.expectPartialRevert(X402PaymentValidator.DigestMismatch.selector);
        _check(digest, data);
    }

    function test_anotherTokenDomainIsRejected() public {
        uint256 t = block.timestamp;
        bytes32 structHash = keccak256(
            abi.encode(
                token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), address(account), nansen, 1, t, t + 60, _nonce(t, 0)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", keccak256("another token"), structHash));
        bytes memory data = _data(x402Key, digest, _fields(nansen, 1, t, t + 60, 0));
        vm.expectPartialRevert(X402PaymentValidator.DigestMismatch.selector);
        _check(digest, data);
    }

    function test_unwrappedDigestIsRejected() public {
        // A hash that is the raw digest rather than Kernel's wrapping of it does not match.
        uint256 t = block.timestamp;
        bytes32 digest = _twaDigest(address(account), nansen, 1, t, t + 60, _nonce(t, 0));
        bytes memory data = _data(x402Key, digest, _fields(nansen, 1, t, t + 60, 0));
        vm.prank(address(account));
        vm.expectPartialRevert(X402PaymentValidator.DigestMismatch.selector);
        validator.isValidSignatureWithSender(address(token), digest, data);
    }

    // --- each bound -------------------------------------------------------------------------------------------------

    function test_valueZeroIsRejected() public {
        uint256 t = block.timestamp;
        bytes32 digest = _twaDigest(address(account), nansen, 0, t, t + 60, _nonce(t, 0));
        bytes memory data = _data(x402Key, digest, _fields(nansen, 0, t, t + 60, 0));
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.ValueOutOfBounds.selector, 0, MAX_VALUE));
        _check(digest, data);
    }

    function test_validityWindowLongerThanConfiguredIsRejected() public {
        uint256 t = block.timestamp;
        uint256 validBefore = t + MAX_VALIDITY + 1;
        bytes32 digest = _twaDigest(address(account), nansen, 1, t, validBefore, _nonce(t, 0));
        bytes memory data = _data(x402Key, digest, _fields(nansen, 1, t, validBefore, 0));
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.ValidityOutOfBounds.selector, t, validBefore));
        _check(digest, data);
    }

    function test_emptyOrInvertedValidityWindowIsRejected() public {
        uint256 t = block.timestamp;
        bytes32 digest = _twaDigest(address(account), nansen, 1, t, t, _nonce(t, 0));
        bytes memory empty = _data(x402Key, digest, _fields(nansen, 1, t, t, 0));
        bytes memory inverted = _data(x402Key, digest, _fields(nansen, 1, t, t - 1, 0));
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.ValidityOutOfBounds.selector, t, t));
        _check(digest, empty);
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.ValidityOutOfBounds.selector, t, t - 1));
        _check(digest, inverted);
    }

    function test_slotOutOfRangeIsRejected() public {
        uint256 t = block.timestamp;
        bytes32 digest = _twaDigest(address(account), nansen, 1, t, t + 60, _nonce(t, SLOTS));
        bytes memory data = _data(x402Key, digest, _fields(nansen, 1, t, t + 60, SLOTS));
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.SlotOutOfRange.selector, SLOTS, SLOTS));
        _check(digest, data);
    }

    function test_malformedDataIsRejected() public {
        vm.expectRevert(X402PaymentValidator.MalformedAuthorization.selector);
        _check(bytes32(0), "");
        vm.expectRevert(X402PaymentValidator.MalformedAuthorization.selector);
        _check(bytes32(0), abi.encodePacked(_fields(nansen, 1, 2, 3, 0), bytes32(0), bytes32(0)));
        // An address word with dirty upper bits fails abi.decode.
        bytes memory dirty =
            abi.encodePacked(abi.encode(type(uint256).max, 1, 2, 3, 0), bytes32(0), bytes32(0), uint8(27));
        vm.expectRevert();
        _check(bytes32(0), dirty);
    }

    // --- user operations, lifecycle, self-protection ---------------------------------------------------------------

    function test_validateUserOp_alwaysFails() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        vm.prank(address(account));
        assertEq(validator.validateUserOp(op, bytes32(0)), 1);
    }

    function test_notInstalledAccountIsNotLive() public {
        address other = makeAddr("other");
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.NotLive.selector, other));
        validator.isValidSignatureWithSender(address(token), bytes32(0), "");
    }

    function test_uninstallKillsOutstandingAuthorizationsAndDropsPayees() public {
        uint256 t = block.timestamp;
        bytes32 nonce = _nonce(t - 1, 0);
        bytes32 digest = _twaDigest(address(account), nansen, 1, t - 1, t + 60, nonce);
        bytes memory sig = _kernelSig(digest, _fields(nansen, 1, t - 1, t + 60, 0));

        assertTrue(validator.isInitialized(address(account)));
        account.uninstallValidator(address(validator), "");
        assertFalse(validator.isInitialized(address(account)));
        assertFalse(validator.isPayee(address(account), nansen));
        assertEq(validator.maxOutflowPer24h(address(account)), 0);

        vm.expectRevert("FiatTokenV2: invalid signature");
        token.transferWithAuthorization(address(account), nansen, 1, t - 1, t + 60, nonce, sig);

        // Owner reinstall with a new key and only one payee: the old payee list does not come back.
        Vm.Wallet memory rotated = vm.createWallet("rotatedX402Key");
        address[] memory p = new address[](1);
        p[0] = defillama;
        account.installValidator(address(validator), _installData(rotated.addr, MAX_VALUE, SLOTS, MAX_VALIDITY, p));
        assertTrue(validator.isPayee(address(account), defillama));
        assertFalse(validator.isPayee(address(account), nansen));
        assertEq(validator.config(address(account)).signer, rotated.addr);
    }

    /// A session key that reaches the validator from the account (a mistaken allowlist entry) cannot widen it.
    function test_directCallsFromTheAccountCannotWidenALiveConfig() public {
        address[] memory p = new address[](1);
        p[0] = attacker;
        bytes memory wide = _installData(attacker, type(uint128).max, type(uint32).max, 3600, p);

        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.NotInstalling.selector, address(account)));
        account.call(address(validator), abi.encodeCall(validator.onInstall, (wide)));

        // onUninstall while Kernel still lists the validator changes nothing.
        account.call(address(validator), abi.encodeCall(validator.onUninstall, ("")));
        assertTrue(validator.isInitialized(address(account)));

        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.NotInstalling.selector, address(account)));
        account.call(address(validator), abi.encodeCall(validator.onInstall, (wide)));
        assertEq(validator.config(address(account)).signer, x402Key.addr);
        assertFalse(validator.isPayee(address(account), attacker));
    }

    function test_directInstallWhileKernelDoesNotListTheValidatorIsRefused() public {
        account.uninstallValidator(address(validator), "");
        address[] memory p = new address[](1);
        p[0] = attacker;
        bytes memory install = abi.encodeCall(validator.onInstall, (_installData(attacker, 1, 1, 60, p)));
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.NotInstalling.selector, address(account)));
        account.call(address(validator), install);
        assertFalse(validator.isInitialized(address(account)));
    }

    function test_installFromANonKernelCallerReverts() public {
        bytes memory data = _installData(attacker, 1, 1, 60, _payees());
        vm.expectRevert();
        validator.onInstall(data);
    }

    function test_configurationIsPerAccount() public {
        MockKernelValidatorAccount other = new MockKernelValidatorAccount();
        assertFalse(validator.isInitialized(address(other)));
        address[] memory p = new address[](1);
        p[0] = attacker;
        other.installValidator(address(validator), _installData(attacker, 7, 1, 60, p));
        assertTrue(validator.isPayee(address(other), attacker));
        assertFalse(validator.isPayee(address(account), attacker));
        assertEq(validator.config(address(account)).maxValue, MAX_VALUE);
    }

    function test_installValidatesConfiguration() public {
        MockKernelValidatorAccount a = new MockKernelValidatorAccount();
        address[] memory ok = _payees();
        address k = x402Key.addr;
        bytes[7] memory bad = [
            _installData(address(0), MAX_VALUE, SLOTS, MAX_VALIDITY, ok),
            _installData(k, 0, SLOTS, MAX_VALIDITY, ok),
            _installData(k, MAX_VALUE, 0, MAX_VALIDITY, ok),
            _installData(k, MAX_VALUE, SLOTS, 0, ok),
            _installData(k, MAX_VALUE, SLOTS, 3601, ok),
            _installData(k, MAX_VALUE, SLOTS, MAX_VALIDITY, new address[](0)),
            _installData(k, MAX_VALUE, SLOTS, MAX_VALIDITY, new address[](9))
        ];
        for (uint256 i = 0; i < bad.length; ++i) {
            vm.expectRevert(X402PaymentValidator.InvalidConfig.selector);
            a.installValidator(address(validator), bad[i]);
        }

        address[5] memory badPayee = [address(0), address(a), address(token), address(validator), nansen];
        for (uint256 i = 0; i < badPayee.length; ++i) {
            address[] memory p = new address[](i == 4 ? 2 : 1);
            p[0] = badPayee[i];
            if (i == 4) p[1] = nansen; // duplicate
            bytes memory data = _installData(k, MAX_VALUE, SLOTS, MAX_VALIDITY, p);
            vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.InvalidPayee.selector, badPayee[i]));
            a.installValidator(address(validator), data);
        }
        assertFalse(validator.isInitialized(address(a)));
    }

    function test_maxOutflowPer24h() public view {
        assertEq(validator.maxOutflowPer24h(address(account)), 26 * uint256(SLOTS) * MAX_VALUE);
        assertEq(validator.maxOutflowPer24h(attacker), 0);
    }

    function test_moduleType() public view {
        assertTrue(validator.isModuleType(1));
        assertFalse(validator.isModuleType(5));
        assertFalse(validator.isModuleType(4));
    }

    function test_constructorRejectsZeroAsset() public {
        vm.expectRevert(X402PaymentValidator.ZeroSettlementAsset.selector);
        new X402PaymentValidator(address(0));
    }

    function test_constantsMatch() public view {
        assertEq(validator.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH());
        assertEq(validator.KERNEL_WRAPPER_TYPE_HASH(), keccak256("Kernel(bytes32 hash)"));
        assertEq(validator.kernelWrappedHash(address(account), keccak256("x")), account.wrappedHash(keccak256("x")));
        assertEq(_wrap(keccak256("x")), account.wrappedHash(keccak256("x")));
    }

    /// Cross-language vector for libs/x402 (authorization.ts): the nonce of a fixed account, hour, and slot.
    function test_nonceVector() public view {
        bytes32 expected = keccak256(
            abi.encode(keccak256("monadeum.x402.nonce.v1"), 0x1111111111111111111111111111111111111111, 497_222, 3)
        );
        assertEq(validator.nonceFor(0x1111111111111111111111111111111111111111, 497_222, 3), expected);
        assertEq(expected, NONCE_VECTOR);
    }

    bytes32 internal constant NONCE_VECTOR = 0xc1c67eea652684d482617edec0152657c12d7eb312167f0ee10746c74ef5acb1;

    // --- fuzz -------------------------------------------------------------------------------------------------------

    /// The validator accepts an honestly described, correctly signed authorization exactly when every bound holds.
    function testFuzz_acceptsIffWithinBounds(
        uint8 payeeIndex,
        uint256 value,
        uint256 validAfter,
        uint256 window,
        uint256 slot
    ) public {
        address[3] memory pool = [nansen, defillama, attacker];
        address to = pool[payeeIndex % 3];
        value = bound(value, 0, uint256(MAX_VALUE) * 3);
        validAfter = bound(validAfter, 0, type(uint64).max);
        window = bound(window, 0, 2 hours);
        slot = bound(slot, 0, SLOTS * 2);
        uint256 validBefore = validAfter + window;

        bool expected =
            to != attacker && value > 0 && value <= MAX_VALUE && window > 0 && window <= MAX_VALIDITY && slot < SLOTS;
        bytes32 digest = _twaDigest(address(account), to, value, validAfter, validBefore, _nonce(validAfter, slot));
        bytes memory data = _data(x402Key, digest, _fields(to, value, validAfter, validBefore, slot));
        bytes32 wrapped = account.wrappedHash(digest);
        vm.prank(address(account));
        try validator.isValidSignatureWithSender(address(token), wrapped, data) returns (bytes4 r) {
            assertTrue(expected, "accepted an out-of-bounds authorization");
            assertEq(r, MAGIC);
        } catch {
            assertFalse(expected, "rejected an in-bounds authorization");
        }
    }

    /// No hash other than the wrapped digest of the described authorization is accepted.
    function testFuzz_rejectsEveryOtherHash(bytes32 hash, uint256 value, uint256 slot) public {
        value = bound(value, 1, MAX_VALUE);
        slot = bound(slot, 0, SLOTS - 1);
        uint256 t = block.timestamp;
        bytes32 expected = account.wrappedHash(_twaDigest(address(account), nansen, value, t, t + 60, _nonce(t, slot)));
        vm.assume(hash != expected);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(x402Key, hash);
        bytes memory data = abi.encodePacked(_fields(nansen, value, t, t + 60, slot), r, s, v);
        vm.prank(address(account));
        vm.expectRevert(abi.encodeWithSelector(X402PaymentValidator.DigestMismatch.selector, hash, expected));
        validator.isValidSignatureWithSender(address(token), hash, data);
    }

    /// A permit of any amount to any spender is never approved, whatever fields accompany it.
    function testFuzz_permitNeverApproved(address spender, uint256 value, uint256 deadline, uint256 seed) public {
        bytes32 structHash = keccak256(
            abi.encode(
                token.PERMIT_TYPEHASH(), address(account), spender, value, token.nonces(address(account)), deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        uint256 t = block.timestamp;
        bytes memory data = _data(x402Key, digest, _fields(nansen, bound(seed, 1, MAX_VALUE), t, t + 60, seed % SLOTS));
        bytes32 wrapped = account.wrappedHash(digest);
        vm.prank(address(account));
        try validator.isValidSignatureWithSender(address(token), wrapped, data) returns (bytes4 r) {
            assertTrue(r != MAGIC, "permit approved");
        } catch {}
    }
}
