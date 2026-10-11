// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {IModule, PackedUserOperation} from "./kernel/IKernelModules.sol";

/// Kernel v3.1 validator interface (`src/interfaces/IERC7579Modules.sol` at tag v3.1, commit 03f7f5c), declared here
/// so that the files AgentSpendPolicy's audit package covers stay unchanged.
interface IValidator is IModule {
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external payable returns (uint256);
    function isValidSignatureWithSender(address sender, bytes32 hash, bytes calldata data)
        external
        view
        returns (bytes4);
}

/// The parts of a Kernel v3.1 account this validator reads.
interface IKernelAccountView {
    struct ValidationConfig {
        uint32 nonce;
        address hook;
    }

    function validationConfig(bytes21 vId) external view returns (ValidationConfig memory);
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

/// Domain separator of the settlement asset's EIP-712 domain, as USDC (FiatToken v2.2) exposes it.
interface IEIP712DomainSeparator {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @title X402PaymentValidator
/// @notice Kernel v3.1 validator that lets a dedicated x402 key sign, for the account, EIP-3009
/// `transferWithAuthorization` payments within on-chain bounds, and nothing else. Specified in ARCHITECTURE.md
/// section 16.3 ("x402 signature path"). One deployment serves every account; configuration is keyed by account.
///
/// Why a validator and not a policy on a session-key permission: on Kernel v3.1's ERC-1271 path, a permission policy
/// receives the raw hash, and the per-policy data it could use to decode that hash is consumed from a local copy of
/// the signature, after which Kernel requires the original signature to start with the signer prefix 0xff
/// (ValidationManager._checkSignaturePolicy and _checkPermissionPolicy at tag v3.1). A signature that carries policy
/// data therefore always fails, and one that does not gives every policy empty data, so a policy can only ever see a
/// bare 32-byte hash it cannot decode. A validator receives its whole signature (Kernel.isValidSignature, validator
/// mode), so it can carry the authorization's fields.
///
/// What it approves: `isValidSignatureWithSender(sender, wrappedHash, data)` returns the ERC-1271 magic value only when
/// `data = abi.encode(to, value, validAfter, validBefore, slot) || r || s || v` and:
/// - `wrappedHash` equals Kernel's account-domain wrapping of the settlement asset's EIP-712 digest of
///   `TransferWithAuthorization(account, to, value, validAfter, validBefore, nonceFor(account, validAfter / 1 hours,
///   slot))`, so a `permit`, a `receiveWithAuthorization`, another token, another authorizer, or any other typed data
///   is refused;
/// - `to` is a payee the owner listed at install; `0 < value <= maxValue`;
/// - `0 < validBefore - validAfter <= maxValidity <= 1 hour`; `slot < paymentsPerEpoch`;
/// - `(r, s, v)` is the configured x402 key's signature of `wrappedHash`.
/// It never validates a user operation, so the x402 key cannot send one.
///
/// Rate bound without state: an ERC-1271 check is a view call and the transfer never runs through the account, so
/// nothing can be recorded per payment. The settlement asset's nonce registry does the counting: each (account,
/// hour, slot) is one nonce, the asset accepts a nonce once per authorizer, and the validity window ties each
/// authorization to the hour of its `validAfter`. Any 24-hour period can see payments from at most 26 such hours
/// (24 hours plus a validity window of at most one hour touch at most 26 hour boundaries), so at most
/// `26 * paymentsPerEpoch * maxValue` leaves the account through this validator in any 24 hours (`maxOutflowPer24h`).
/// This budget is separate from AgentSpendPolicy's `dailyCap`, and neither path counts the other's payments, so
/// nothing is counted twice; the account's worst case over 24 hours is the sum of the two.
///
/// Self-protection, independent of any allowlist: the configuration changes only while Kernel's own state shows the
/// owner's install or uninstall in progress. `onInstall` requires that Kernel already lists this validator for the
/// calling account (Kernel records the validation before calling `onInstall`) and that no configuration is live;
/// `onUninstall` acts only once Kernel has removed it (Kernel clears the hook before calling `onUninstall`). A call
/// that reaches these functions from the account in any other state, for example a session key through a mistaken
/// allowlist entry, changes nothing: it cannot replace a live configuration, and it cannot retire one Kernel still
/// lists.
contract X402PaymentValidator is IValidator {
    struct Config {
        address signer; // the x402 key
        uint128 maxValue; // settlement-asset base units per authorization
        uint32 paymentsPerEpoch; // distinct nonces per hour
        uint32 maxValidity; // seconds, validBefore - validAfter, at most EPOCH
        bool live;
    }

    event Installed(
        address indexed account,
        address indexed signer,
        uint128 maxValue,
        uint32 paymentsPerEpoch,
        uint32 maxValidity,
        address[] payees
    );
    event Uninstalled(address indexed account);

    error ZeroSettlementAsset();
    /// Kernel does not list this validator for the caller, or a configuration is already live.
    error NotInstalling(address account);
    error InvalidConfig();
    error InvalidPayee(address payee);
    error NotLive(address account);
    error MalformedAuthorization();
    error PayeeNotAllowed(address payee);
    error ValueOutOfBounds(uint256 value, uint256 maxValue);
    error ValidityOutOfBounds(uint256 validAfter, uint256 validBefore);
    error SlotOutOfRange(uint256 slot, uint256 paymentsPerEpoch);
    error DigestMismatch(bytes32 hash, bytes32 expected);

    /// keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
    /// EIP-3009, equal to Monad mainnet USDC's TRANSFER_WITH_AUTHORIZATION_TYPEHASH (read on 2026-10-10).
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    /// keccak256("Kernel(bytes32 hash)"), Kernel v3.1's KERNEL_WRAPPER_TYPE_HASH (src/types/Constants.sol).
    bytes32 public constant KERNEL_WRAPPER_TYPE_HASH =
        0x1547321c374afde8a591d972a084b071c594c275e36724931ff96c25f2999c83;
    bytes32 public constant NONCE_TAG = keccak256("monadeum.x402.nonce.v1");
    uint256 public constant EPOCH = 1 hours;
    /// Hour boundaries a 24-hour period can touch given validity windows of at most one hour, see the contract NatSpec.
    uint256 public constant EPOCHS_PER_24H_BOUND = 26;
    uint256 public constant MAX_PAYEES = 8;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID = 0xffffffff;
    uint256 internal constant MODULE_TYPE_VALIDATOR = 1;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
    uint256 internal constant FIELDS_LENGTH = 5 * 32;
    uint256 internal constant DATA_LENGTH = FIELDS_LENGTH + 65;
    /// secp256k1n / 2: signatures with a higher s are refused, as OpenZeppelin's ECDSA does.
    uint256 internal constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    address public immutable settlementAsset;

    mapping(address account => Config) internal _config;
    /// Payee entries are keyed by an install generation, so an uninstall drops the whole list at once.
    mapping(address account => uint256) internal _generation;
    mapping(uint256 generation => mapping(address payee => mapping(address account => bool))) internal _payee;

    constructor(address settlementAsset_) {
        if (settlementAsset_ == address(0)) revert ZeroSettlementAsset();
        settlementAsset = settlementAsset_;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Kernel v3.1 module and validator entry points
    // ---------------------------------------------------------------------------------------------------------------

    /// `data` is `abi.encode(address signer, uint128 maxValue, uint32 paymentsPerEpoch, uint32 maxValidity,
    /// address[] payees)`. Accepted only during Kernel's install of this validator for the caller.
    function onInstall(bytes calldata data) external payable override {
        if (_config[msg.sender].live || !_listedByKernel(msg.sender)) revert NotInstalling(msg.sender);

        (address signer, uint128 maxValue, uint32 paymentsPerEpoch, uint32 maxValidity, address[] memory payees) =
            abi.decode(data, (address, uint128, uint32, uint32, address[]));
        if (signer == address(0) || maxValue == 0 || paymentsPerEpoch == 0 || maxValidity == 0 || maxValidity > EPOCH) {
            revert InvalidConfig();
        }
        if (payees.length == 0 || payees.length > MAX_PAYEES) revert InvalidConfig();

        uint256 generation = ++_generation[msg.sender];
        for (uint256 i = 0; i < payees.length; ++i) {
            address payee = payees[i];
            if (
                payee == address(0) || payee == msg.sender || payee == settlementAsset || payee == address(this)
                    || _payee[generation][payee][msg.sender]
            ) revert InvalidPayee(payee);
            _payee[generation][payee][msg.sender] = true;
        }
        _config[msg.sender] = Config({
            signer: signer, maxValue: maxValue, paymentsPerEpoch: paymentsPerEpoch, maxValidity: maxValidity, live: true
        });
        emit Installed(msg.sender, signer, maxValue, paymentsPerEpoch, maxValidity, payees);
    }

    /// Acts only once Kernel no longer lists this validator for the caller. Never reverts, so it cannot block the
    /// owner's uninstall; a call while Kernel still lists the validator changes nothing.
    function onUninstall(bytes calldata) external payable override {
        if (!_config[msg.sender].live || _listedByKernel(msg.sender)) return;
        delete _config[msg.sender];
        emit Uninstalled(msg.sender);
    }

    /// The x402 key never sends a user operation.
    function validateUserOp(PackedUserOperation calldata, bytes32) external payable override returns (uint256) {
        return SIG_VALIDATION_FAILED;
    }

    /// Called by the account (Kernel's isValidSignature in validator mode) with Kernel's wrapped hash, so msg.sender
    /// is the account. `sender`, the contract that asked the account, is deliberately not checked: off-chain
    /// verifiers (ERC-6492 validators, eth_call) ask from other addresses, and the digest is bound to the settlement
    /// asset's domain. A bounds failure reverts with the rule that failed; a signature by any key other than the
    /// configured one returns the invalid value. Both make the asset refuse the authorization.
    function isValidSignatureWithSender(address, bytes32 hash, bytes calldata data)
        external
        view
        override
        returns (bytes4)
    {
        Config memory config = _config[msg.sender];
        if (!config.live) revert NotLive(msg.sender);
        if (data.length != DATA_LENGTH) revert MalformedAuthorization();

        bytes32 expected = kernelWrappedHash(msg.sender, _boundedDigest(config, data[0:FIELDS_LENGTH]));
        if (expected != hash) revert DigestMismatch(hash, expected);

        return _recover(hash, data[FIELDS_LENGTH:]) == config.signer ? ERC1271_MAGIC : ERC1271_INVALID;
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    function isInitialized(address account) external view override returns (bool) {
        return _config[account].live;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    /// The EIP-3009 nonce for the account's `slot` in hour `epoch` (`validAfter / 1 hours`).
    function nonceFor(address account, uint256 epoch, uint256 slot) public pure returns (bytes32) {
        return keccak256(abi.encode(NONCE_TAG, account, epoch, slot));
    }

    /// The settlement asset's EIP-712 digest of a `TransferWithAuthorization` from `from`.
    function authorizationDigest(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        return
            keccak256(
                abi.encodePacked("\x19\x01", IEIP712DomainSeparator(settlementAsset).DOMAIN_SEPARATOR(), structHash)
            );
    }

    /// Kernel v3.1's `_toWrappedHash(digest)` for `account`: its EIP-712 typed-data hash of `Kernel(bytes32 hash)`
    /// under the account's own domain, which is what the account passes a validator and what the x402 key signs.
    function kernelWrappedHash(address account, bytes32 digest) public view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            IKernelAccountView(account).eip712Domain();
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), chainId, verifyingContract)
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(KERNEL_WRAPPER_TYPE_HASH, digest))));
    }

    function config(address account) external view returns (Config memory) {
        return _config[account];
    }

    function isPayee(address account, address payee) external view returns (bool) {
        return _config[account].live && _payee[_generation[account]][payee][account];
    }

    /// Upper bound on what a live configuration lets leave the account in any 24 hours: 0 unless live.
    function maxOutflowPer24h(address account) external view returns (uint256) {
        Config memory c = _config[account];
        if (!c.live) return 0;
        return EPOCHS_PER_24H_BOUND * uint256(c.paymentsPerEpoch) * uint256(c.maxValue);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    /// Applies every bound to the authorization's fields and returns the settlement asset's digest they describe,
    /// with `from` fixed to the calling account and the nonce derived from the slot.
    function _boundedDigest(Config memory config, bytes calldata fields) internal view returns (bytes32) {
        (address to, uint256 value, uint256 validAfter, uint256 validBefore, uint256 slot) =
            abi.decode(fields, (address, uint256, uint256, uint256, uint256));
        if (!_payee[_generation[msg.sender]][to][msg.sender]) revert PayeeNotAllowed(to);
        if (value == 0 || value > config.maxValue) revert ValueOutOfBounds(value, config.maxValue);
        if (validBefore <= validAfter || validBefore - validAfter > config.maxValidity) {
            revert ValidityOutOfBounds(validAfter, validBefore);
        }
        if (slot >= config.paymentsPerEpoch) revert SlotOutOfRange(slot, config.paymentsPerEpoch);
        return authorizationDigest(
            msg.sender, to, value, validAfter, validBefore, nonceFor(msg.sender, validAfter / EPOCH, slot)
        );
    }

    /// ecrecover over a 65-byte `r || s || v`, refusing high-s and any v other than 27 or 28. Returns address(0) on
    /// refusal or failure, which never equals a configured signer (onInstall rejects address(0)).
    function _recover(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) return address(0);
        return ecrecover(hash, v, r, s);
    }

    /// Kernel lists a validation as installed while its hook is nonzero; it sets the hook before calling `onInstall`
    /// and clears it before calling `onUninstall`. A caller that is not a Kernel v3.1 account reverts here.
    function _listedByKernel(address account) internal view returns (bool) {
        bytes21 vId = bytes21(abi.encodePacked(bytes1(0x01), address(this)));
        return IKernelAccountView(account).validationConfig(vId).hook != address(0);
    }
}
