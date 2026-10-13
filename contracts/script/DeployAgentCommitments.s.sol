// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {AgentCommitments} from "../src/AgentCommitments.sol";

/// Deploys AgentCommitments on Monad testnet (chain 10143) and nowhere else. It has no constructor arguments, no
/// roles, and no admin, so its address follows from the deployer's nonce alone.
///
/// Optional input: `MONADEUM_EXPECTED_DEPLOYER`, refuse to run unless the broadcasting account is this address. The
/// broadcasting account comes from Foundry (`--account <keystore>` and `--sender`); this script never reads a private
/// key. It writes `deployments/monad-testnet-commitments.latest.json`, which is not committed; after a broadcast, the
/// address and block are copied into `deployments/monad-testnet.json` (deploy/README.md).
contract DeployAgentCommitments is Script {
    uint256 public constant MONAD_TESTNET = 10143;
    string public constant OUTPUT = "deployments/monad-testnet-commitments.latest.json";

    error WrongChain(uint256 chainId);
    error WrongDeployer(address expected, address actual);
    error PostCondition(string what);

    function run() external returns (AgentCommitments commitments) {
        if (block.chainid != MONAD_TESTNET) revert WrongChain(block.chainid);
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address expected = vm.envOr("MONADEUM_EXPECTED_DEPLOYER", address(0));
        if (expected != address(0) && deployer != expected) revert WrongDeployer(expected, deployer);
        commitments = new AgentCommitments();
        vm.stopBroadcast();

        verify(commitments);
        string memory r = "root";
        vm.serializeUint(r, "chainId", block.chainid);
        vm.serializeString(
            r, "mode", vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? "broadcast" : "simulation (nothing was sent)"
        );
        vm.serializeAddress(r, "deployer", deployer);
        vm.serializeUint(r, "forkBlock", block.number);
        vm.writeJson(vm.serializeAddress(r, "AgentCommitments", address(commitments)), OUTPUT);
        console2.log("AgentCommitments ", address(commitments));
        console2.log("deployer         ", deployer);
        console2.log("written to       ", OUTPUT);
    }

    /// The deployed code answers the interface and holds no commitment yet.
    function verify(AgentCommitments commitments) public view {
        if (address(commitments).code.length == 0) revert PostCondition("no code");
        if (commitments.commitmentOf(address(0)).genomeHash != bytes32(0)) revert PostCondition("not empty");
    }
}
