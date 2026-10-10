// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {AgentSpendPolicy} from "../../src/AgentSpendPolicy.sol";
import {X402PaymentValidator} from "../../src/X402PaymentValidator.sol";
import {PackedUserOperation} from "../../src/kernel/IKernelModules.sol";
import {IEntryPointV07, IKernelFactoryV31, IKernelV31} from "./KernelV31Fork.t.sol";

/// The bytes-signature forms of FiatToken v2.2's EIP-3009 and EIP-2612 entry points, which check a contract
/// authorizer through ERC-1271.
interface IFiatTokenV22 {
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function nonces(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;
    function permit(address owner, address spender, uint256 value, uint256 deadline, bytes memory signature) external;
}

/// Kernel v3.1 validation management, called by the owner through the root validator.
interface IKernelInstall {
    struct ValidationConfig {
        uint32 nonce;
        address hook;
    }

    function installValidations(
        bytes21[] calldata vIds,
        ValidationConfig[] memory configs,
        bytes[] calldata validationData,
        bytes[] calldata hookData
    ) external payable;
    function uninstallValidation(bytes21 vId, bytes calldata deinitData, bytes calldata hookDeinitData) external payable;
}

/// A Kernel policy that approves a signature only when Kernel hands it nonempty per-policy data, and fails every
/// user operation. Used only to show how Kernel v3.1 passes per-policy data on the ERC-1271 path.
contract ApproveOnlyWithDataPolicy {
    function onInstall(bytes calldata) external payable {}
    function onUninstall(bytes calldata) external payable {}

    function isModuleType(uint256 t) external pure returns (bool) {
        return t == 5;
    }

    function isInitialized(address) external pure returns (bool) {
        return true;
    }

    function checkUserOpPolicy(bytes32, PackedUserOperation calldata) external payable returns (uint256) {
        return 1;
    }

    function checkSignaturePolicy(bytes32, address, bytes32, bytes calldata data) external pure returns (uint256) {
        return data.length == 0 ? 1 : 0;
    }
}

/// Fork test of the x402 signature path on Monad mainnet (chain 143), against the real USDC (FiatToken v2.2 proxy
/// at 0x754704Bc059F8C67012fEd69BC8A327a5aafb603) and the real ZeroDev Kernel v3.1 contracts, deployed at the same
/// addresses as on testnet. It shows, without a facilitator or a bundler:
/// - USDC accepts a Kernel account's ERC-1271 signature for `transferWithAuthorization`, and a payment signed by the
///   x402 key settles when X402PaymentValidator approves it;
/// - the same key's signature for a `permit`, for an unbounded `transferWithAuthorization`, or for an unlisted payee
///   is refused, and uninstalling the validator invalidates an authorization already signed;
/// - Kernel v3.1's ERC-1271 permission path cannot carry policy data: a signature that includes it fails with
///   `SignerPrefixNotPresent`, which is why the x402 bounds live in a validator, not a policy (ARCHITECTURE.md 16.3);
/// - with Kernel's skip-signature flag on AgentSpendPolicy instead, a session key's signature makes USDC grant a
///   `permit` for the whole balance to any spender. This is why the flag is never set.
///
/// Opt-in: it runs only when forge is pointed at Monad mainnet, and skips otherwise. From contracts/:
///   forge test --match-path test/fork/X402MainnetFork.t.sol --fork-url "$MONAD_MAINNET_RPC_URL"
/// It moves no real funds: the account's USDC balance is written into the fork's state with `deal`.
contract X402MainnetForkTest is Test {
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address internal constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address internal constant KERNEL_V31_FACTORY = 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419;
    address internal constant ECDSA_VALIDATOR = 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57;
    address internal constant ECDSA_SIGNER = 0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes2 internal constant SKIP_SIGNATURE = 0x0002;
    bytes1 internal constant TYPE_VALIDATOR = 0x01;
    bytes1 internal constant TYPE_PERMISSION = 0x02;
    bytes4 internal constant SKIP_PID = 0x5c1b0001;
    bytes4 internal constant POLICY_PID = 0x402402aa;

    uint128 internal constant MAX_VALUE = 50_000; // 0.05 USDC
    uint32 internal constant SLOTS = 4;
    uint32 internal constant MAX_VALIDITY = 600;
    uint256 internal constant BALANCE = 100e6;

    IEntryPointV07 internal entryPoint = IEntryPointV07(ENTRY_POINT_V07);
    IFiatTokenV22 internal usdc = IFiatTokenV22(USDC);
    X402PaymentValidator internal validator;
    IKernelV31 internal kernel;
    Vm.Wallet internal owner;
    Vm.Wallet internal x402Key;
    address internal payee;
    address internal attacker;
    address internal facilitator;
    address payable internal bundler;

    function setUp() public {
        if (block.chainid != 143) {
            vm.skip(true);
            return;
        }
        assertGt(USDC.code.length, 0, "usdc");
        assertGt(KERNEL_V31_FACTORY.code.length, 0, "kernel factory");
        assertGt(ECDSA_SIGNER.code.length, 0, "ecdsa signer");

        owner = vm.createWallet("owner");
        x402Key = vm.createWallet("x402Key");
        payee = makeAddr("nansenPayTo");
        attacker = makeAddr("attacker");
        facilitator = makeAddr("facilitator");
        bundler = payable(makeAddr("bundler"));
        validator = new X402PaymentValidator(USDC);

        bytes21 rootVId = bytes21(abi.encodePacked(bytes1(0x01), ECDSA_VALIDATOR));
        bytes memory init = abi.encodeCall(
            IKernelV31.initialize, (rootVId, address(0), abi.encodePacked(owner.addr), "", new bytes[](0))
        );
        kernel = IKernelV31(IKernelFactoryV31(KERNEL_V31_FACTORY).createAccount(init, bytes32(uint256(402))));
        deal(USDC, address(kernel), BALANCE);
        assertEq(usdc.balanceOf(address(kernel)), BALANCE, "dealt balance");

        address[] memory payees = new address[](1);
        payees[0] = payee;
        _install(_validatorVId(), abi.encode(x402Key.addr, MAX_VALUE, SLOTS, MAX_VALIDITY, payees));
        assertTrue(validator.isInitialized(address(kernel)), "x402 validator live");
    }

    function test_fork_x402PaymentSettlesThroughUsdcWithErc1271() public {
        uint256 t = block.timestamp;
        (bytes32 nonce, bytes memory sig) = _signPayment(payee, MAX_VALUE, t - 60, t + 300, 0);
        vm.prank(facilitator);
        usdc.transferWithAuthorization(address(kernel), payee, MAX_VALUE, t - 60, t + 300, nonce, sig);
        assertEq(usdc.balanceOf(payee), MAX_VALUE, "payee paid");
        assertTrue(usdc.authorizationState(address(kernel), nonce), "nonce consumed");

        vm.expectRevert("FiatTokenV2: authorization is used or canceled");
        usdc.transferWithAuthorization(address(kernel), payee, MAX_VALUE, t - 60, t + 300, nonce, sig);
    }

    function test_fork_unboundedTransferWithAuthorizationRefused() public {
        uint256 t = block.timestamp;
        // Fields describing a small payment, attached to a signed digest of the whole balance to the attacker.
        bytes32 nonce = validator.nonceFor(address(kernel), (t - 60) / 1 hours, 0);
        bytes32 digest = validator.authorizationDigest(address(kernel), attacker, BALANCE, t - 60, t + 300, nonce);
        bytes memory sig = _validatorSig(digest, abi.encode(payee, uint256(1), t - 60, t + 300, uint256(0)));
        vm.expectRevert("FiatTokenV2: invalid signature");
        usdc.transferWithAuthorization(address(kernel), attacker, BALANCE, t - 60, t + 300, nonce, sig);

        // Honest fields for an unlisted payee.
        (bytes32 n2, bytes memory s2) = _signPayment(attacker, 1, t - 60, t + 300, 1);
        vm.expectRevert("FiatTokenV2: invalid signature");
        usdc.transferWithAuthorization(address(kernel), attacker, 1, t - 60, t + 300, n2, s2);

        // Honest fields over maxValue to the listed payee.
        (bytes32 n3, bytes memory s3) = _signPayment(payee, uint256(MAX_VALUE) + 1, t - 60, t + 300, 2);
        vm.expectRevert("FiatTokenV2: invalid signature");
        usdc.transferWithAuthorization(address(kernel), payee, uint256(MAX_VALUE) + 1, t - 60, t + 300, n3, s3);
        assertEq(usdc.balanceOf(address(kernel)), BALANCE, "nothing moved");
    }

    function test_fork_permitRefusedByTheX402Validator() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes32 digest = _permitDigest(attacker, BALANCE, deadline);
        bytes memory sig = _validatorSig(
            digest, abi.encode(payee, uint256(1), block.timestamp - 60, block.timestamp + 300, uint256(0))
        );
        vm.expectRevert("EIP2612: invalid signature");
        usdc.permit(address(kernel), attacker, BALANCE, deadline, sig);
        assertEq(usdc.allowance(address(kernel), attacker), 0);
    }

    function test_fork_uninstallKillsOutstandingAuthorization() public {
        uint256 t = block.timestamp;
        (bytes32 nonce, bytes memory sig) = _signPayment(payee, 1, t - 60, t + 300, 3);
        _handle(_rootOp(abi.encodeCall(IKernelInstall.uninstallValidation, (_validatorVId(), hex"", hex""))));
        assertFalse(validator.isInitialized(address(kernel)), "uninstalled");
        vm.expectRevert();
        usdc.transferWithAuthorization(address(kernel), payee, 1, t - 60, t + 300, nonce, sig);
    }

    /// Kernel v3.1's ERC-1271 permission path: per-policy data is consumed from a local copy of the signature, and
    /// the original must then start with 0xff, so a signature carrying policy data never validates, even when the
    /// policy approves it.
    function test_fork_permissionPathCannotCarryPolicyData() public {
        Vm.Wallet memory key = vm.createWallet("permissionKey");
        ApproveOnlyWithDataPolicy approving = new ApproveOnlyWithDataPolicy();
        bytes[] memory permission = new bytes[](2);
        permission[0] = abi.encodePacked(bytes2(0), address(approving));
        permission[1] = abi.encodePacked(bytes2(0), ECDSA_SIGNER, key.addr);
        _install(_permissionVId(POLICY_PID), abi.encode(permission));

        bytes32 hash = keccak256("any digest");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _wrapped(hash));
        bytes memory policyData = hex"01";
        bytes memory sig = abi.encodePacked(
            TYPE_PERMISSION, POLICY_PID, bytes1(0x00), uint64(policyData.length), policyData, hex"ff", r, s, v
        );
        // The policy received the data and approved; Kernel then rejects the signature itself.
        vm.expectRevert(bytes4(keccak256("SignerPrefixNotPresent()")));
        kernel.isValidSignature(hash, sig);

        // Without policy data the prefix check passes, but the policy receives an empty byte string and fails.
        bytes memory bare = abi.encodePacked(TYPE_PERMISSION, POLICY_PID, hex"ff", r, s, v);
        vm.expectRevert(abi.encodeWithSelector(IKernelV31.PolicyFailed.selector, 0));
        kernel.isValidSignature(hash, bare);
    }

    /// The reason for the rule: AgentSpendPolicy with Kernel's skip-signature flag lets a session key's ERC-1271
    /// signature authorize a USDC permit of the whole balance to any spender.
    function test_fork_skipSignatureFlagWouldLetASessionKeyPermitTheWholeBalance() public {
        Vm.Wallet memory tradingKey = vm.createWallet("tradingKey");
        AgentSpendPolicy spend = new AgentSpendPolicy(USDC);
        bytes[] memory permission = new bytes[](2);
        permission[0] = abi.encodePacked(SKIP_SIGNATURE, address(spend));
        permission[1] = abi.encodePacked(bytes2(0), ECDSA_SIGNER, tradingKey.addr);
        _install(_permissionVId(SKIP_PID), abi.encode(permission));

        uint256 deadline = block.timestamp + 1 days;
        bytes32 digest = _permitDigest(attacker, BALANCE, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(tradingKey, _wrapped(digest));
        bytes memory sig = abi.encodePacked(TYPE_PERMISSION, SKIP_PID, hex"ff", r, s, v);
        usdc.permit(address(kernel), attacker, BALANCE, deadline, sig);
        assertEq(usdc.allowance(address(kernel), attacker), BALANCE, "whole balance approved to the attacker");
    }

    // --- helpers ----------------------------------------------------------------------------------------------------

    function _signPayment(address to, uint256 value, uint256 validAfter, uint256 validBefore, uint256 slot)
        internal
        view
        returns (bytes32 nonce, bytes memory sig)
    {
        nonce = validator.nonceFor(address(kernel), validAfter / 1 hours, slot);
        bytes32 digest = validator.authorizationDigest(address(kernel), to, value, validAfter, validBefore, nonce);
        sig = _validatorSig(digest, abi.encode(to, value, validAfter, validBefore, slot));
    }

    /// Kernel v3.1 ERC-1271 signature in validator mode: 0x01 | validator | fields | x402 key's signature of the
    /// account-domain wrapped hash.
    function _validatorSig(bytes32 digest, bytes memory fields) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(x402Key, _wrapped(digest));
        return abi.encodePacked(TYPE_VALIDATOR, address(validator), fields, r, s, v);
    }

    function _wrapped(bytes32 hash) internal view returns (bytes32) {
        return validator.kernelWrappedHash(address(kernel), hash);
    }

    function _permitDigest(address spender, uint256 value, uint256 deadline) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, address(kernel), spender, value, usdc.nonces(address(kernel)), deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
    }

    function _validatorVId() internal view returns (bytes21) {
        return bytes21(abi.encodePacked(TYPE_VALIDATOR, address(validator)));
    }

    function _permissionVId(bytes4 pid) internal pure returns (bytes21) {
        return bytes21(abi.encodePacked(TYPE_PERMISSION, pid));
    }

    /// Owner installs a signature-only validation (no hook, no selector grant) through the root validator.
    function _install(bytes21 vId, bytes memory validationData) internal {
        bytes21[] memory vIds = new bytes21[](1);
        vIds[0] = vId;
        IKernelInstall.ValidationConfig[] memory configs = new IKernelInstall.ValidationConfig[](1);
        configs[0] = IKernelInstall.ValidationConfig({nonce: kernel.currentNonce(), hook: address(0)});
        bytes[] memory data = new bytes[](1);
        data[0] = validationData;
        bytes[] memory hookData = new bytes[](1);
        _handle(_rootOp(abi.encodeCall(IKernelInstall.installValidations, (vIds, configs, data, hookData))));
    }

    function _rootOp(bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op.sender = address(kernel);
        op.nonce = entryPoint.getNonce(address(kernel), 0);
        op.callData = callData;
        op.accountGasLimits = bytes32((uint256(3_000_000) << 128) | uint256(3_000_000));
        op.preVerificationGas = 100_000;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(owner, entryPoint.getUserOpHash(op));
        op.signature = abi.encodePacked(r, s, v);
    }

    function _handle(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
    }
}
