// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {X402PaymentValidator} from "../../src/X402PaymentValidator.sol";
import {MockEIP3009Token, MockKernelValidatorAccount} from "./X402Mocks.sol";

/// Shared fixture: one X402PaymentValidator, one account double with it installed by the owner, two allowed payees,
/// and a settlement-asset double with EIP-3009 and EIP-2612 signature paths.
abstract contract X402TestBase is Test {
    uint128 internal constant MAX_VALUE = 1e6;
    uint32 internal constant SLOTS = 4;
    uint32 internal constant MAX_VALIDITY = 600;
    uint256 internal constant BALANCE = 1_000e6;

    X402PaymentValidator internal validator;
    MockEIP3009Token internal token;
    MockKernelValidatorAccount internal account;
    Vm.Wallet internal x402Key;
    address internal nansen;
    address internal defillama;
    address internal attacker;
    address internal facilitator;

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        token = new MockEIP3009Token();
        validator = new X402PaymentValidator(address(token));
        x402Key = vm.createWallet("x402Key");
        account = new MockKernelValidatorAccount();
        nansen = makeAddr("nansenPayTo");
        defillama = makeAddr("defillamaPayTo");
        attacker = makeAddr("attacker");
        facilitator = makeAddr("facilitator");
        token.mint(address(account), BALANCE);
        account.installValidator(
            address(validator), _installData(x402Key.addr, MAX_VALUE, SLOTS, MAX_VALIDITY, _payees())
        );
    }

    function _payees() internal view returns (address[] memory p) {
        p = new address[](2);
        p[0] = nansen;
        p[1] = defillama;
    }

    function _installData(address signer, uint128 maxValue, uint32 slots, uint32 maxValidity, address[] memory payees)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(signer, maxValue, slots, maxValidity, payees);
    }

    function _nonce(uint256 validAfter, uint256 slot) internal view returns (bytes32) {
        return validator.nonceFor(address(account), validAfter / 1 hours, slot);
    }

    function _twaDigest(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, validAfter, validBefore, nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
    }

    function _fields(address to, uint256 value, uint256 validAfter, uint256 validBefore, uint256 slot)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(to, value, validAfter, validBefore, slot);
    }

    /// The validator's data: the authorization's fields, then the x402 key's signature of Kernel's wrapped hash.
    function _data(Vm.Wallet memory key, bytes32 digest, bytes memory fields) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, account.wrappedHash(digest));
        return abi.encodePacked(fields, r, s, v);
    }

    /// The ERC-1271 signature the account receives: Kernel v3.1 validator mode, 0x01 | validator | data.
    function _kernelSig(bytes32 digest, bytes memory fields) internal view returns (bytes memory) {
        return abi.encodePacked(bytes1(0x01), address(validator), _data(x402Key, digest, fields));
    }

    /// Signs and settles an authorization the way the platform's payer would: nonce derived from the slot.
    function _pay(address to, uint256 value, uint256 validAfter, uint256 validBefore, uint256 slot) internal {
        bytes32 nonce = _nonce(validAfter, slot);
        bytes32 digest = _twaDigest(address(account), to, value, validAfter, validBefore, nonce);
        bytes memory sig = _kernelSig(digest, _fields(to, value, validAfter, validBefore, slot));
        vm.prank(facilitator);
        token.transferWithAuthorization(address(account), to, value, validAfter, validBefore, nonce, sig);
    }

    /// Calls the validator as Kernel does, from the account, with the wrapped hash. Reverts with the validator's error.
    /// The wrapped hash is computed here, without an external call, so `vm.expectRevert` applies to the validator.
    function _check(bytes32 digest, bytes memory data) internal returns (bytes4) {
        bytes32 wrapped = _wrap(digest);
        vm.prank(address(account));
        return validator.isValidSignatureWithSender(address(token), wrapped, data);
    }

    /// Kernel v3.1's wrapping of `digest` for the account double, computed locally (see MockKernelValidatorAccount).
    function _wrap(bytes32 digest) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Kernel"),
                keccak256("0.3.1"),
                block.chainid,
                address(account)
            )
        );
        return keccak256(
            abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(keccak256("Kernel(bytes32 hash)"), digest)))
        );
    }
}
