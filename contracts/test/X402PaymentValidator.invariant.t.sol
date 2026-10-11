// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {X402PaymentValidator} from "../src/X402PaymentValidator.sol";
import {MockEIP3009Token, MockKernelValidatorAccount} from "./utils/X402Mocks.sol";
import {X402TestBase} from "./utils/X402TestBase.sol";

/// Drives a fully compromised x402 key: it signs whatever it likes (in-bounds payments, over-cap and long-window
/// transfers, unlisted payees, reused and out-of-range slots, random nonces, lying fields, permits of any amount),
/// anyone submits each to the token, and the account itself may call the validator's install functions directly
/// (a session key through a mistaken allowlist entry). The invariants bound what can leave the account.
contract X402Handler is Test {
    X402PaymentValidator internal immutable validator;
    MockEIP3009Token internal immutable token;
    MockKernelValidatorAccount internal immutable account;
    Vm.Wallet internal key;
    address[3] internal pool;

    uint256 public accepted;
    uint256 public attempts;

    constructor(
        X402PaymentValidator validator_,
        MockEIP3009Token token_,
        MockKernelValidatorAccount account_,
        Vm.Wallet memory key_,
        address[3] memory pool_
    ) {
        validator = validator_;
        token = token_;
        account = account_;
        key = key_;
        pool = pool_;
    }

    function pay(uint8 payee, uint256 value, uint256 backdate, uint256 window, uint256 slot, bool randomNonce)
        external
    {
        attempts++;
        address to = pool[payee % 3];
        value = bound(value, 0, 3e6);
        backdate = bound(backdate, 0, 2 hours);
        window = bound(window, 1, 3 hours);
        slot = bound(slot, 0, 8);
        uint256 validAfter = block.timestamp - backdate;
        uint256 validBefore = validAfter + window;
        bytes32 nonce = randomNonce
            ? keccak256(abi.encode(attempts, value))
            : validator.nonceFor(address(account), validAfter / 1 hours, slot);
        bytes32 digest = _twa(to, value, validAfter, validBefore, nonce);
        bytes memory sig = _sig(digest, abi.encode(to, value, validAfter, validBefore, slot));
        try token.transferWithAuthorization(address(account), to, value, validAfter, validBefore, nonce, sig) {
            accepted++;
        } catch {}
    }

    /// Lying fields: they describe a small in-bounds payment, the signed digest is a large transfer to anyone.
    function payWithLie(uint8 payee, uint256 value, uint256 slot) external {
        attempts++;
        address to = pool[payee % 3];
        value = bound(value, 1, 1_000e6);
        slot = bound(slot, 0, 3);
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = validAfter + 60;
        bytes32 nonce = validator.nonceFor(address(account), validAfter / 1 hours, slot);
        bytes32 digest = _twa(to, value, validAfter, validBefore, nonce);
        bytes memory sig = _sig(digest, abi.encode(pool[0], uint256(1), validAfter, validBefore, slot));
        try token.transferWithAuthorization(address(account), to, value, validAfter, validBefore, nonce, sig) {
            accepted++;
        } catch {}
    }

    function permit(uint8 spender, uint256 value, uint256 seed) external {
        attempts++;
        address s = pool[spender % 3];
        uint256 deadline = block.timestamp + 1 days;
        bytes32 structHash = keccak256(
            abi.encode(token.PERMIT_TYPEHASH(), address(account), s, value, token.nonces(address(account)), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        bytes memory sig =
            _sig(digest, abi.encode(pool[0], uint256(1), block.timestamp - 1, block.timestamp + 60, seed % 4));
        try token.permit(address(account), s, value, deadline, sig) {
            accepted++;
        } catch {}
    }

    /// The account calls the validator's install and uninstall functions directly with a widened configuration.
    function tamper(bool uninstallFirst) external {
        address[] memory p = new address[](1);
        p[0] = pool[2];
        bytes memory wide = abi.encode(pool[2], type(uint128).max, type(uint32).max, uint32(3600), p);
        if (uninstallFirst) {
            try account.call(address(validator), abi.encodeCall(validator.onUninstall, (""))) {} catch {}
        }
        try account.call(address(validator), abi.encodeCall(validator.onInstall, (wide))) {} catch {}
    }

    function warp(uint256 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 3 hours));
    }

    function _twa(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
                address(account),
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
    }

    function _sig(bytes32 digest, bytes memory fields) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, account.wrappedHash(digest));
        return abi.encodePacked(bytes1(0x01), address(validator), fields, r, s, v);
    }
}

contract X402PaymentValidatorInvariantTest is X402TestBase {
    X402Handler internal handler;
    uint256 internal bound24;

    function setUp() public override {
        super.setUp();
        bound24 = validator.maxOutflowPer24h(address(account));
        handler = new X402Handler(validator, token, account, x402Key, [nansen, defillama, attacker]);
        targetContract(address(handler));
    }

    /// Every movement out of the account goes to a listed payee, for at most maxValue.
    function invariant_onlyListedPayeesWithinMaxValue() public view {
        uint256 n = token.movementCount();
        for (uint256 i = 0; i < n; ++i) {
            MockEIP3009Token.Movement memory m = token.movement(i);
            assertEq(m.from, address(account));
            assertTrue(m.to == nansen || m.to == defillama, "paid an unlisted address");
            assertGt(m.value, 0);
            assertLe(m.value, MAX_VALUE, "over maxValue");
        }
    }

    /// No 24-hour period sees more than the install-time maxOutflowPer24h leave the account.
    function invariant_rolling24hOutflowWithinBound() public view {
        uint256 n = token.movementCount();
        for (uint256 i = 0; i < n; ++i) {
            uint256 start = token.movement(i).timestamp;
            uint256 sum = 0;
            for (uint256 j = i; j < n; ++j) {
                MockEIP3009Token.Movement memory m = token.movement(j);
                if (m.timestamp >= start + 24 hours) break;
                sum += m.value;
            }
            assertLe(sum, bound24, "24h outflow over bound");
        }
    }

    /// No permit ever succeeds, so no allowance is ever granted.
    function invariant_noAllowanceEverGranted() public view {
        assertEq(token.allowance(address(account), nansen), 0);
        assertEq(token.allowance(address(account), defillama), 0);
        assertEq(token.allowance(address(account), attacker), 0);
        assertEq(token.nonces(address(account)), 0, "a permit consumed a nonce");
    }

    /// The configuration is never widened by direct calls from the account.
    function invariant_configurationUnchanged() public view {
        X402PaymentValidator.Config memory c = validator.config(address(account));
        assertTrue(c.live);
        assertEq(c.signer, x402Key.addr);
        assertEq(c.maxValue, MAX_VALUE);
        assertEq(c.paymentsPerEpoch, SLOTS);
        assertEq(c.maxValidity, MAX_VALIDITY);
        assertFalse(validator.isPayee(address(account), attacker));
    }

    /// Conservation: what left the account is exactly what the listed payees hold.
    function invariant_balancesConserved() public view {
        assertEq(token.balanceOf(address(account)) + token.balanceOf(nansen) + token.balanceOf(defillama), BALANCE);
        assertEq(token.balanceOf(attacker), 0);
    }
}
