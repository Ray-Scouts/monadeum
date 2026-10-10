// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// Minimal stand-in for USDC (FiatToken v2.2) signature paths: EIP-3009 `transferWithAuthorization` and
/// `receiveWithAuthorization`, and EIP-2612 `permit`, each in the `bytes signature` form that checks a contract
/// authorizer through ERC-1271 and an externally owned one through ecrecover, as FiatToken v2.2's SignatureChecker
/// does. Domain name "USDC", version "2". It records every transfer so tests can bound outflows.
contract MockEIP3009Token {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    struct Movement {
        address from;
        address to;
        uint256 value;
        uint256 timestamp;
    }

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    mapping(address => uint256) public nonces;
    Movement[] internal _movements;

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USDC"),
                keccak256("2"),
                block.chainid,
                address(this)
            )
        );
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function movementCount() external view returns (uint256) {
        return _movements.length;
    }

    function movement(uint256 i) external view returns (Movement memory) {
        return _movements[i];
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        _authorized(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature);
        _move(from, to, value);
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        require(msg.sender == to, "caller must be the payee");
        _authorized(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature);
        _move(from, to, value);
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, bytes memory signature) external {
        require(deadline >= block.timestamp, "permit is expired");
        bytes32 digest =
            _digest(keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline)));
        require(_isValidSignatureNow(owner, digest, signature), "EIP2612: invalid signature");
        allowance[owner][spender] = value;
    }

    function _authorized(
        bytes32 typeHash,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) internal {
        require(block.timestamp > validAfter, "authorization is not yet valid");
        require(block.timestamp < validBefore, "authorization is expired");
        require(!authorizationState[from][nonce], "authorization is used or canceled");
        bytes32 digest = _digest(keccak256(abi.encode(typeHash, from, to, value, validAfter, validBefore, nonce)));
        require(_isValidSignatureNow(from, digest, signature), "FiatTokenV2: invalid signature");
        authorizationState[from][nonce] = true;
    }

    function _move(address from, address to, uint256 value) internal {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        _movements.push(Movement(from, to, value, block.timestamp));
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _isValidSignatureNow(address signer, bytes32 digest, bytes memory signature) internal view returns (bool) {
        if (signer.code.length == 0) {
            if (signature.length != 65) return false;
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := mload(add(signature, 0x20))
                s := mload(add(signature, 0x40))
                v := byte(0, mload(add(signature, 0x60)))
            }
            address recovered = ecrecover(digest, v, r, s);
            return recovered != address(0) && recovered == signer;
        }
        (bool ok, bytes memory ret) =
            signer.staticcall(abi.encodeWithSignature("isValidSignature(bytes32,bytes)", digest, signature));
        return ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == 0x1626ba7e;
    }
}

/// Test double for the parts of a Kernel v3.1 account an ERC-1271 validator depends on. It is not Kernel. It
/// reproduces, from Kernel v3.1 (tag v3.1, commit 03f7f5c):
/// - `isValidSignature(hash, sig)` in validator mode: `sig` is 0x01 | validator (20) | data, the validation must be
///   installed (hook nonzero), and the account calls
///   `validator.isValidSignatureWithSender(msg.sender, _toWrappedHash(hash), data)` (Kernel.isValidSignature);
/// - `_toWrappedHash(hash)`: the EIP-712 hash of `Kernel(bytes32 hash)` under the account's domain, name "Kernel",
///   version "0.3.1" (ValidationManager._toWrappedHash);
/// - install records the validation with hook address(1) before calling `onInstall`; uninstall clears the hook
///   before calling `onUninstall` and ignores its failure (ValidationManager._installValidation,
///   _uninstallValidation, ModuleLib.uninstallModule);
/// - `validationConfig(vId)` and `eip712Domain()` as views.
contract MockKernelValidatorAccount {
    bytes32 public constant KERNEL_WRAPPER_TYPE_HASH =
        0x1547321c374afde8a591d972a084b071c594c275e36724931ff96c25f2999c83;

    struct ValidationConfig {
        uint32 nonce;
        address hook;
    }

    mapping(bytes21 => ValidationConfig) internal _validation;

    function validationConfig(bytes21 vId) external view returns (ValidationConfig memory) {
        return _validation[vId];
    }

    function eip712Domain()
        external
        view
        returns (bytes1, string memory, string memory, uint256, address, bytes32, uint256[] memory)
    {
        return (hex"0f", "Kernel", "0.3.1", block.chainid, address(this), bytes32(0), new uint256[](0));
    }

    function wrappedHash(bytes32 hash) public view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Kernel"),
                keccak256("0.3.1"),
                block.chainid,
                address(this)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(KERNEL_WRAPPER_TYPE_HASH, hash))));
    }

    /// Owner path (root validator): install a validator module.
    function installValidator(address validator, bytes calldata data) external {
        _validation[_vId(validator)] = ValidationConfig({nonce: 1, hook: address(1)});
        IValidatorLike(validator).onInstall(data);
    }

    /// Owner path (root validator): uninstall a validator module.
    function uninstallValidator(address validator, bytes calldata data) external {
        _validation[_vId(validator)].hook = address(0);
        (bool ok,) = validator.call(abi.encodeWithSelector(IValidatorLike.onUninstall.selector, data));
        ok;
    }

    /// Any call the account makes: an owner operation, or a session-key operation an allowlist let through.
    function call(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        require(signature.length >= 21 && signature[0] == 0x01, "not validator mode");
        address validator = address(bytes20(signature[1:21]));
        require(_validation[_vId(validator)].hook != address(0), "InvalidValidator");
        return IValidatorLike(validator).isValidSignatureWithSender(msg.sender, wrappedHash(hash), signature[21:]);
    }

    function _vId(address validator) internal pure returns (bytes21) {
        return bytes21(abi.encodePacked(bytes1(0x01), validator));
    }
}

interface IValidatorLike {
    function onInstall(bytes calldata data) external payable;
    function onUninstall(bytes calldata data) external payable;
    function isValidSignatureWithSender(address sender, bytes32 hash, bytes calldata data)
        external
        view
        returns (bytes4);
}
