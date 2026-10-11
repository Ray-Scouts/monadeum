// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {AgentReallocation} from "../src/AgentReallocation.sol";
import {AgentSpendPolicy} from "../src/AgentSpendPolicy.sol";
import {X402PaymentValidator} from "../src/X402PaymentValidator.sol";

/// Deploys AgentSpendPolicy, AgentReallocation, and X402PaymentValidator on Monad testnet (chain 10143) and nowhere
/// else. Mainnet stays behind the audit gate (SECURITY.md section 3).
///
/// Inputs, all from the environment, none with a default here (`script/deploy-testnet.sh` sets the decided values):
/// - `MONADEUM_SETTLEMENT_ASSET`: the settlement asset (testnet USDC), the constructor argument of all three contracts.
/// - `MONADEUM_SETTLEMENT_DECIMALS`: the decimals the asset must report (6 for USDC).
/// - `MONADEUM_REALLOCATION_OPERATOR`, `MONADEUM_REALLOCATION_ADMIN`: AgentReallocation's roles. Each must be a Safe
///   with a threshold of at least 2 and at least 3 owners (ARCHITECTURE.md section 16.5).
/// - `MONADEUM_MIN_EVALUATION_INTERVAL`: AgentReallocation's minimum evaluation spacing in seconds (36000, section 16.5).
/// - `MONADEUM_EXPECTED_DEPLOYER` (optional): refuse to run unless the broadcasting account is this address.
///
/// The broadcasting account comes from Foundry (`--account <keystore>` and `--sender`); this script never reads a
/// private key. It writes the result to `deployments/monad-testnet.latest.json`, which is not committed; the committed
/// record is `deployments/monad-testnet.json`, filled in from it after a broadcast.
contract DeployTestnet is Script {
    uint256 public constant MONAD_TESTNET = 10143;
    /// EIP-3009 `TransferWithAuthorization` type hash, which the x402 payment path relies on.
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint256 public constant MIN_SAFE_THRESHOLD = 2;
    uint256 public constant MIN_SAFE_OWNERS = 3;
    string public constant OUTPUT = "deployments/monad-testnet.latest.json";

    struct Inputs {
        address settlementAsset;
        uint8 settlementDecimals;
        address operator;
        address admin;
        uint256 minEvaluationInterval;
    }

    struct Deployed {
        AgentSpendPolicy spendPolicy;
        AgentReallocation reallocation;
        X402PaymentValidator x402Validator;
    }

    error WrongChain(uint256 chainId);
    error NoCode(string what, address account);
    error WrongDecimals(uint8 expected, uint8 actual);
    error NoEip3009(address asset);
    error WeakSafe(string role, address safe, uint256 threshold, uint256 owners);
    error WrongDeployer(address expected, address actual);
    error PostCondition(string what);

    function inputsFromEnv() public view returns (Inputs memory) {
        uint256 decimals = vm.envUint("MONADEUM_SETTLEMENT_DECIMALS");
        require(decimals <= type(uint8).max, "MONADEUM_SETTLEMENT_DECIMALS out of range");
        return Inputs({
            settlementAsset: vm.envAddress("MONADEUM_SETTLEMENT_ASSET"),
            settlementDecimals: uint8(decimals),
            operator: vm.envAddress("MONADEUM_REALLOCATION_OPERATOR"),
            admin: vm.envAddress("MONADEUM_REALLOCATION_ADMIN"),
            minEvaluationInterval: vm.envUint("MONADEUM_MIN_EVALUATION_INTERVAL")
        });
    }

    function run() external returns (Deployed memory d) {
        Inputs memory inputs = inputsFromEnv();
        check(inputs);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address expected = vm.envOr("MONADEUM_EXPECTED_DEPLOYER", address(0));
        if (expected != address(0) && deployer != expected) revert WrongDeployer(expected, deployer);
        d = deploy(inputs);
        vm.stopBroadcast();

        verify(inputs, d);
        write(inputs, d, deployer);
        console2.log("AgentSpendPolicy     ", address(d.spendPolicy));
        console2.log("AgentReallocation    ", address(d.reallocation));
        console2.log("X402PaymentValidator ", address(d.x402Validator));
        console2.log("deployer             ", deployer);
        console2.log("written to           ", OUTPUT);
    }

    /// Every precondition the chain can show, checked before anything is sent.
    function check(Inputs memory inputs) public view {
        if (block.chainid != MONAD_TESTNET) revert WrongChain(block.chainid);
        if (inputs.settlementAsset.code.length == 0) revert NoCode("settlement asset", inputs.settlementAsset);
        uint8 decimals = _decimals(inputs.settlementAsset);
        if (decimals != inputs.settlementDecimals) revert WrongDecimals(inputs.settlementDecimals, decimals);
        if (_typehash(inputs.settlementAsset) != TRANSFER_WITH_AUTHORIZATION_TYPEHASH) {
            revert NoEip3009(inputs.settlementAsset);
        }
        _checkSafe("operator", inputs.operator);
        _checkSafe("admin", inputs.admin);
        require(inputs.minEvaluationInterval > 0, "MONADEUM_MIN_EVALUATION_INTERVAL must be positive");
    }

    /// The three deployments, in a fixed order, so the addresses follow from the deployer's nonce.
    function deploy(Inputs memory inputs) internal returns (Deployed memory d) {
        d.spendPolicy = new AgentSpendPolicy(inputs.settlementAsset);
        d.reallocation =
            new AgentReallocation(inputs.settlementAsset, inputs.admin, inputs.operator, inputs.minEvaluationInterval);
        d.x402Validator = new X402PaymentValidator(inputs.settlementAsset);
    }

    /// Reads every constructor-set value back from the deployed contracts.
    function verify(Inputs memory inputs, Deployed memory d) public view {
        if (d.spendPolicy.settlementAsset() != inputs.settlementAsset) revert PostCondition("spend policy asset");
        if (d.reallocation.settlementAsset() != inputs.settlementAsset) revert PostCondition("reallocation asset");
        if (d.reallocation.operator() != inputs.operator) revert PostCondition("operator");
        if (d.reallocation.admin() != inputs.admin) revert PostCondition("admin");
        if (d.reallocation.pendingAdmin() != address(0)) revert PostCondition("pending admin");
        if (d.reallocation.minEvaluationInterval() != inputs.minEvaluationInterval) revert PostCondition("interval");
        if (d.reallocation.capitalFloor() != 6 * 10 ** inputs.settlementDecimals / 100) revert PostCondition("floor");
        if (d.reallocation.currentEvaluation() != 0) revert PostCondition("evaluation");
        if (d.x402Validator.settlementAsset() != inputs.settlementAsset) revert PostCondition("x402 asset");
    }

    function write(Inputs memory inputs, Deployed memory d, address deployer) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "AgentSpendPolicy", address(d.spendPolicy));
        vm.serializeAddress(c, "AgentReallocation", address(d.reallocation));
        string memory contracts = vm.serializeAddress(c, "X402PaymentValidator", address(d.x402Validator));

        string memory i = "inputs";
        vm.serializeAddress(i, "settlementAsset", inputs.settlementAsset);
        vm.serializeUint(i, "settlementDecimals", inputs.settlementDecimals);
        vm.serializeAddress(i, "reallocationOperator", inputs.operator);
        vm.serializeAddress(i, "reallocationAdmin", inputs.admin);
        string memory inputJson = vm.serializeUint(i, "minEvaluationInterval", inputs.minEvaluationInterval);

        string memory r = "root";
        vm.serializeUint(r, "chainId", block.chainid);
        vm.serializeString(
            r, "mode", vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? "broadcast" : "simulation (nothing was sent)"
        );
        vm.serializeAddress(r, "deployer", deployer);
        vm.serializeUint(r, "forkBlock", block.number);
        vm.serializeString(r, "inputs", inputJson);
        string memory json = vm.serializeString(r, "contracts", contracts);
        vm.writeJson(json, OUTPUT);
    }

    function _decimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) revert NoCode("decimals()", token);
        return uint8(abi.decode(ret, (uint256)));
    }

    function _typehash(address token) internal view returns (bytes32) {
        (bool ok, bytes memory ret) =
            token.staticcall(abi.encodeWithSignature("TRANSFER_WITH_AUTHORIZATION_TYPEHASH()"));
        if (!ok || ret.length < 32) return bytes32(0);
        return abi.decode(ret, (bytes32));
    }

    /// A Safe's threshold and owner count, read through its public getters. Not proof that the owners are different
    /// people on different devices, which no contract can show; that stays a deployment requirement (16.5).
    function _checkSafe(string memory role, address safe) internal view {
        if (safe.code.length == 0) revert NoCode(role, safe);
        (bool okT, bytes memory t) = safe.staticcall(abi.encodeWithSignature("getThreshold()"));
        (bool okO, bytes memory o) = safe.staticcall(abi.encodeWithSignature("getOwners()"));
        if (!okT || !okO || t.length < 32 || o.length < 64) revert WeakSafe(role, safe, 0, 0);
        uint256 threshold = abi.decode(t, (uint256));
        uint256 owners = abi.decode(o, (address[])).length;
        if (threshold < MIN_SAFE_THRESHOLD || owners < MIN_SAFE_OWNERS) revert WeakSafe(role, safe, threshold, owners);
    }
}
