// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {AgentSpendPolicy} from "../../src/AgentSpendPolicy.sol";
import {IAgentSpendPolicy} from "../../src/IAgentSpendPolicy.sol";
import {PackedUserOperation} from "../../src/kernel/IKernelModules.sol";
import {MockERC20} from "../utils/Mocks.sol";

/// The subset of the ERC-4337 v0.7 EntryPoint this test drives.
interface IEntryPointV07 {
    error FailedOp(uint256 opIndex, string reason);
    error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner);

    event UserOperationRevertReason(
        bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason
    );

    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;
    function getNonce(address sender, uint192 key) external view returns (uint256);
    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32);
}

interface IKernelFactoryV31 {
    function createAccount(bytes calldata data, bytes32 salt) external payable returns (address);
}

/// The subset of a Kernel v3.1 account this test reads or calls.
interface IKernelV31 {
    struct ValidationConfig {
        uint32 nonce;
        address hook;
    }

    error PolicyFailed(uint256 i);

    function initialize(
        bytes21 rootValidator,
        address hook,
        bytes calldata validatorData,
        bytes calldata hookData,
        bytes[] calldata initConfig
    ) external;
    function currentNonce() external view returns (uint32);
    function validationConfig(bytes21 vId) external view returns (ValidationConfig memory);
    function isAllowedSelector(bytes21 vId, bytes4 selector) external view returns (bool);
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}

/// Fork test of AgentSpendPolicy against the real ZeroDev Kernel v3.1 bytecode deployed on Monad testnet
/// (chain 10143), driven through the real ERC-4337 v0.7 EntryPoint, the real Kernel factory, ZeroDev's ECDSA root
/// validator, and ZeroDev's ECDSA permission signer. It replaces the test double in KernelIntegration.t.sol with the
/// deployed contracts for every step the double reproduces: account creation, owner configuration through the root
/// validator, enabling a session-key permission with this contract as policy and hook (Kernel's enable mode, the
/// path ZeroDev's SDK uses for v3.1), validation, execution, and the ERC-1271 signature path.
///
/// Opt-in: it runs only when forge is pointed at Monad testnet, and skips otherwise, so a plain `forge test` is
/// unaffected. Run it from contracts/ with:
///   forge test --match-path test/fork/KernelV31Fork.t.sol --fork-url "$MONAD_TESTNET_RPC_URL"
/// and add --fork-block-number to pin a block. Forge selects Monad's EVM variant from the fork's chain id.
///
/// What it does not cover, by construction: no bundler is involved, so ERC-7562 validation-rule enforcement by the
/// bundlers used on Monad is not exercised, and Foundry's EVM is not Monad's client, so equivalence of gas and
/// execution with Monad's own client is assumed, not shown. contracts/audit/README.md lists both as remaining steps.
contract KernelV31ForkTest is Test {
    // Addresses from ZeroDev's SDK constants (@zerodev/sdk 5.5.10, @zerodev/ecdsa-validator 5.4.9,
    // @zerodev/permissions 5.6.3); setUp checks each has code on the fork.
    address internal constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address internal constant KERNEL_V31_FACTORY = 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419;
    address internal constant KERNEL_V31_IMPL = 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D;
    address internal constant ECDSA_VALIDATOR = 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57;
    address internal constant ECDSA_SIGNER = 0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF;

    // Kernel v3.1 constants (src/types/Constants.sol at commit 03f7f5c).
    bytes32 internal constant ENABLE_TYPE_HASH = 0xb17ab1224aca0d4255ef8161acaf2ac121b8faa32a4b2258c912cc5f8308c505;
    bytes1 internal constant MODE_DEFAULT = 0x00;
    bytes1 internal constant MODE_ENABLE = 0x01;
    bytes1 internal constant TYPE_ROOT = 0x00;
    bytes1 internal constant TYPE_PERMISSION = 0x02;

    bytes4 internal constant EXECUTE = 0xe9ae5c53; // execute(bytes32,bytes)
    bytes4 internal constant EXECUTE_USER_OP = 0x8dd7712f; // executeUserOp(PackedUserOperation,bytes32)
    bytes4 internal constant TRANSFER = 0xa9059cbb;
    bytes4 internal constant APPROVE = 0x095ea7b3;
    bytes4 internal constant SWAP = bytes4(keccak256("swap(bytes)"));
    bytes32 internal constant SINGLE = bytes32(0);
    bytes32 internal constant BATCH = bytes32(bytes1(0x01));

    bytes4 internal constant PERMISSION_ID = 0x5e551011;
    uint128 internal constant PER_TX_CAP = 100e6;
    uint128 internal constant DAILY_CAP = 150e6;

    IEntryPointV07 internal entryPoint = IEntryPointV07(ENTRY_POINT_V07);
    AgentSpendPolicy internal policy;
    MockERC20 internal token;
    IKernelV31 internal kernel;
    address internal router;
    Vm.Wallet internal owner;
    Vm.Wallet internal sessionKey;
    address payable internal bundler;
    bool internal enabled;

    function setUp() public {
        if (block.chainid != 10143) {
            vm.skip(true);
            return;
        }
        assertGt(ENTRY_POINT_V07.code.length, 0, "entry point");
        assertGt(KERNEL_V31_FACTORY.code.length, 0, "kernel factory");
        assertGt(KERNEL_V31_IMPL.code.length, 0, "kernel implementation");
        assertGt(ECDSA_VALIDATOR.code.length, 0, "ecdsa validator");
        assertGt(ECDSA_SIGNER.code.length, 0, "ecdsa signer");

        owner = vm.createWallet("owner");
        sessionKey = vm.createWallet("sessionKey");
        bundler = payable(makeAddr("bundler"));
        router = makeAddr("router");
        token = new MockERC20();
        policy = new AgentSpendPolicy(address(token));

        bytes21 rootVId = bytes21(abi.encodePacked(bytes1(0x01), ECDSA_VALIDATOR));
        bytes memory init = abi.encodeCall(
            IKernelV31.initialize, (rootVId, address(0), abi.encodePacked(owner.addr), "", new bytes[](0))
        );
        kernel = IKernelV31(IKernelFactoryV31(KERNEL_V31_FACTORY).createAccount(init, bytes32(uint256(1))));
        token.mint(address(kernel), 1_000e6);

        // Owner configuration, through the root validator: the session key's policy and hook do not run.
        IAgentSpendPolicy.Call[] memory cfg = new IAgentSpendPolicy.Call[](4);
        cfg[0] =
            _policyCall(abi.encodeCall(IAgentSpendPolicy.setLimits, (IAgentSpendPolicy.Limits(PER_TX_CAP, DAILY_CAP))));
        cfg[1] = _policyCall(abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(token), TRANSFER, true)));
        cfg[2] = _policyCall(abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(token), APPROVE, true)));
        cfg[3] = _policyCall(abi.encodeCall(IAgentSpendPolicy.setAllowed, (router, SWAP, true)));
        _handle(_rootOp(abi.encodeWithSelector(EXECUTE, BATCH, abi.encode(cfg))));

        assertEq(policy.limits(address(kernel)).perTxCap, PER_TX_CAP, "owner path configured limits");
        assertTrue(policy.isAllowed(address(kernel), router, SWAP), "owner path configured allowlist");
    }

    // --- tests -----------------------------------------------------------------------------------------------------

    function test_fork_enableModeInstallsPolicyAndHookAndSpends() public {
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](3);
        calls[0] = _tokenCall(APPROVE, router, 40e6);
        calls[1] = IAgentSpendPolicy.Call(router, 0, abi.encodeWithSelector(SWAP, hex"01"));
        calls[2] = _tokenCall(TRANSFER, router, 50e6);
        // The router is an EOA here, so the swap call succeeds without running code.
        _handle(_sessionOp(_wrap(abi.encodeWithSelector(EXECUTE, BATCH, abi.encode(calls)))));

        bytes21 vId = _permissionVId();
        assertEq(kernel.validationConfig(vId).hook, address(policy), "policy installed as the permission's hook");
        assertTrue(kernel.isAllowedSelector(vId, EXECUTE), "execute granted to the permission");
        assertEq(token.balanceOf(router), 50e6, "transfer executed");
        assertEq(token.allowance(address(kernel), router), 40e6, "approve executed");
        assertEq(policy.windowTotal(address(kernel)), 90e6, "preCheck recorded the operation's counted total");
    }

    function test_fork_singleCallAfterEnable() public {
        _enableWithSmallTransfer();
        _handle(
            _sessionOp(
                _wrap(
                    abi.encodeWithSelector(
                        EXECUTE,
                        SINGLE,
                        abi.encodePacked(address(token), uint256(0), abi.encodeWithSelector(TRANSFER, router, 20e6))
                    )
                )
            )
        );
        assertEq(token.balanceOf(router), 21e6);
        assertEq(policy.windowTotal(address(kernel)), 21e6);
    }

    function test_fork_batchOverPerTxCapRejectedInValidation() public {
        _enableWithSmallTransfer();
        IAgentSpendPolicy.Call[] memory calls = new IAgentSpendPolicy.Call[](2);
        calls[0] = _tokenCall(TRANSFER, router, 60e6);
        calls[1] = _tokenCall(TRANSFER, router, 60e6);
        PackedUserOperation memory op = _sessionOp(_wrap(abi.encodeWithSelector(EXECUTE, BATCH, abi.encode(calls))));
        _expectValidationRevert(abi.encodeWithSelector(IAgentSpendPolicy.PerTxCapExceeded.selector, 120e6, PER_TX_CAP));
        _handle(op);
        assertEq(token.balanceOf(router), 1e6, "nothing moved");
    }

    function test_fork_dailyCapBreachRevertsInExecutionAndRecordsNothing() public {
        _enableWithSmallTransfer(); // window total 1e6
        _handle(_sessionOp(_wrap(_singleTransfer(100e6)))); // 101e6
        _handle(_sessionOp(_wrap(_singleTransfer(49e6)))); // 150e6, exactly the daily cap

        PackedUserOperation memory op = _sessionOp(_wrap(_singleTransfer(1)));
        bytes32 hash = entryPoint.getUserOpHash(op);
        vm.expectEmit(true, true, false, true, ENTRY_POINT_V07);
        emit IEntryPointV07.UserOperationRevertReason(
            hash,
            address(kernel),
            op.nonce,
            abi.encodeWithSelector(IAgentSpendPolicy.DailyCapExceeded.selector, uint256(DAILY_CAP) + 1, DAILY_CAP)
        );
        _handle(op); // included: validation passed, execution reverted
        assertEq(policy.windowTotal(address(kernel)), DAILY_CAP, "the reverted operation recorded nothing");
        assertEq(token.balanceOf(router), DAILY_CAP, "the reverted operation moved nothing");
    }

    function test_fork_delegatecallRejectedInValidation() public {
        _enableWithSmallTransfer();
        bytes32 mode = bytes32(bytes1(0xff));
        PackedUserOperation memory op = _sessionOp(
            _wrap(
                abi.encodeWithSelector(EXECUTE, mode, abi.encodePacked(router, abi.encodeWithSelector(SWAP, hex"01")))
            )
        );
        _expectValidationRevert(abi.encodeWithSelector(AgentSpendPolicy.UnsupportedExecMode.selector, mode));
        _handle(op);
    }

    function test_fork_sessionKeyCannotReachPolicyEvenIfAllowlisted() public {
        _enableWithSmallTransfer();
        bytes4 setLimitsSel = IAgentSpendPolicy.setLimits.selector;
        _handle(
            _rootOp(
                abi.encodeWithSelector(
                    EXECUTE,
                    SINGLE,
                    abi.encodePacked(
                        address(policy),
                        uint256(0),
                        abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(policy), setLimitsSel, true))
                    )
                )
            )
        );
        assertTrue(policy.isAllowed(address(kernel), address(policy), setLimitsSel), "mistaken entry present");

        bytes memory raise = abi.encodeCall(
            IAgentSpendPolicy.setLimits, (IAgentSpendPolicy.Limits(type(uint128).max, type(uint128).max))
        );
        PackedUserOperation memory op = _sessionOp(
            _wrap(abi.encodeWithSelector(EXECUTE, SINGLE, abi.encodePacked(address(policy), uint256(0), raise)))
        );
        _expectValidationRevert(
            abi.encodeWithSelector(IAgentSpendPolicy.CallNotAllowed.selector, address(policy), setLimitsSel)
        );
        _handle(op);
        assertEq(policy.limits(address(kernel)).perTxCap, PER_TX_CAP, "caps unchanged");
    }

    /// A close on an ERC-20-base market through the real Kernel: the owner marks the base as a traded asset and allows
    /// its approve through the root validator; the session key approves the router on it, uncounted, and an approve
    /// of the base to anyone else is rejected in validation.
    function test_fork_tradedAssetApproveIsRecipientCheckedAndUncounted() public {
        _enableWithSmallTransfer(); // window total 1e6
        MockERC20 base = new MockERC20();
        base.mint(address(kernel), 5e18);
        IAgentSpendPolicy.Call[] memory cfg = new IAgentSpendPolicy.Call[](2);
        cfg[0] = _policyCall(abi.encodeCall(IAgentSpendPolicy.setTradedAsset, (address(base), true)));
        cfg[1] = _policyCall(abi.encodeCall(IAgentSpendPolicy.setAllowed, (address(base), APPROVE, true)));
        _handle(_rootOp(abi.encodeWithSelector(EXECUTE, BATCH, abi.encode(cfg))));
        assertTrue(policy.isTradedAsset(address(kernel), address(base)), "owner path marked the traded asset");

        IAgentSpendPolicy.Call[] memory close = new IAgentSpendPolicy.Call[](2);
        close[0] = IAgentSpendPolicy.Call(address(base), 0, abi.encodeWithSelector(APPROVE, router, 5e18));
        close[1] = IAgentSpendPolicy.Call(router, 0, abi.encodeWithSelector(SWAP, hex"01"));
        _handle(_sessionOp(_wrap(abi.encodeWithSelector(EXECUTE, BATCH, abi.encode(close)))));
        assertEq(base.allowance(address(kernel), router), 5e18, "close approve executed");
        assertEq(policy.windowTotal(address(kernel)), 1e6, "the traded asset counted nothing");

        address attacker = makeAddr("attacker");
        PackedUserOperation memory op = _sessionOp(
            _wrap(
                abi.encodeWithSelector(
                    EXECUTE,
                    SINGLE,
                    abi.encodePacked(address(base), uint256(0), abi.encodeWithSelector(APPROVE, attacker, 5e18))
                )
            )
        );
        _expectValidationRevert(abi.encodeWithSelector(IAgentSpendPolicy.RecipientNotAllowed.selector, attacker));
        _handle(op);
        assertEq(base.allowance(address(kernel), attacker), 0, "nothing approved");
    }

    function test_fork_sessionKeyErc1271SignatureFailsByDefault() public {
        _enableWithSmallTransfer();
        bytes32 hash = keccak256("x402 authorization stand-in");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionKey, hash);
        bytes memory sig = abi.encodePacked(TYPE_PERMISSION, PERMISSION_ID, hex"ff", r, s, v);
        vm.expectRevert(abi.encodeWithSelector(IKernelV31.PolicyFailed.selector, 0));
        kernel.isValidSignature(hash, sig);
    }

    // --- user operation construction, per Kernel v3.1 and the ZeroDev SDK ----------------------------------------

    function _enableWithSmallTransfer() internal {
        _handle(_sessionOp(_wrap(_singleTransfer(1e6))));
        assertTrue(enabled);
    }

    function _singleTransfer(uint256 amount) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            EXECUTE,
            SINGLE,
            abi.encodePacked(address(token), uint256(0), abi.encodeWithSelector(TRANSFER, router, amount))
        );
    }

    function _wrap(bytes memory inner) internal pure returns (bytes memory) {
        return abi.encodePacked(EXECUTE_USER_OP, inner);
    }

    function _policyCall(bytes memory data) internal view returns (IAgentSpendPolicy.Call memory) {
        return IAgentSpendPolicy.Call(address(policy), 0, data);
    }

    function _tokenCall(bytes4 sel, address to, uint256 amount) internal view returns (IAgentSpendPolicy.Call memory) {
        return IAgentSpendPolicy.Call(address(token), 0, abi.encodeWithSelector(sel, to, amount));
    }

    function _permissionVId() internal pure returns (bytes21) {
        return bytes21(abi.encodePacked(TYPE_PERMISSION, PERMISSION_ID));
    }

    /// Kernel v3.1 nonce: 1 byte mode | 1 byte validation type | 20 bytes identifier | 2 bytes key | 8 bytes sequence.
    function _nonce(bytes1 mode, bytes1 vType, bytes20 id) internal view returns (uint256) {
        uint192 key =
            uint192((uint256(uint8(mode)) << 184) | (uint256(uint8(vType)) << 176) | (uint256(uint160(id)) << 16));
        return entryPoint.getNonce(address(kernel), key);
    }

    function _baseOp(bytes memory callData, uint256 nonce) internal view returns (PackedUserOperation memory op) {
        op.sender = address(kernel);
        op.nonce = nonce;
        op.callData = callData;
        op.accountGasLimits = bytes32((uint256(3_000_000) << 128) | uint256(3_000_000));
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(0); // zero fee: no prefund, so the result does not depend on the account's gas balance
    }

    function _rootOp(bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op = _baseOp(callData, _nonce(MODE_DEFAULT, TYPE_ROOT, bytes20(0)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(owner, entryPoint.getUserOpHash(op));
        op.signature = abi.encodePacked(r, s, v);
    }

    /// The first session-key operation enables the permission (Kernel's enable mode), later ones use default mode.
    function _sessionOp(bytes memory callData) internal returns (PackedUserOperation memory op) {
        bytes1 mode = enabled ? MODE_DEFAULT : MODE_ENABLE;
        op = _baseOp(callData, _nonce(mode, TYPE_PERMISSION, bytes20(PERMISSION_ID)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            sessionKey, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", entryPoint.getUserOpHash(op)))
        );
        bytes memory userOpSig = abi.encodePacked(hex"ff", r, s, v); // 0xff: no per-policy data, signer next
        if (enabled) {
            op.signature = userOpSig;
            return op;
        }
        enabled = true;

        bytes[] memory permission = new bytes[](2);
        permission[0] = abi.encodePacked(bytes2(0), address(policy)); // policy, checked for user ops and signatures
        permission[1] = abi.encodePacked(bytes2(0), ECDSA_SIGNER, sessionKey.addr); // signer, last by Kernel's rule
        bytes memory validatorData = abi.encode(permission);
        bytes memory hookData = hex"00"; // Kernel reads one flag byte; 0x00 skips onInstall when already initialized
        bytes memory selectorData = abi.encodePacked(EXECUTE);
        bytes32 structHash = keccak256(
            abi.encode(
                ENABLE_TYPE_HASH,
                _permissionVId(),
                kernel.currentNonce(),
                address(policy),
                keccak256(validatorData),
                keccak256(hookData),
                keccak256(selectorData)
            )
        );
        (uint8 ev, bytes32 er, bytes32 es) =
            vm.sign(owner, keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash)));
        op.signature = abi.encodePacked(
            address(policy), abi.encode(validatorData, hookData, selectorData, abi.encodePacked(er, es, ev), userOpSig)
        );
    }

    function _domainSeparator() internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = kernel.eip712Domain();
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
    }

    function _expectValidationRevert(bytes memory inner) internal {
        vm.expectRevert(abi.encodeWithSelector(IEntryPointV07.FailedOpWithRevert.selector, 0, "AA23 reverted", inner));
    }

    function _handle(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
    }
}
