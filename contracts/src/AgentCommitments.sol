// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {IAgentCommitments} from "./IAgentCommitments.sol";

/// @title AgentCommitments
/// @notice Implementation of IAgentCommitments. See the interface NatSpec for the rules.
contract AgentCommitments is IAgentCommitments {
    mapping(address account => Commitment) private _commitments;

    function commit(bytes32 genomeHash, bytes32 strategyVersionHash) external override {
        if (genomeHash == bytes32(0) || strategyVersionHash == bytes32(0)) revert ZeroHash();
        // genomeHash is never zero once written, so it marks a written commitment.
        if (_commitments[msg.sender].genomeHash != bytes32(0)) revert AlreadyCommitted(msg.sender);
        _commitments[msg.sender] = Commitment({genomeHash: genomeHash, strategyVersionHash: strategyVersionHash});
        emit AgentCommitted(msg.sender, genomeHash, strategyVersionHash);
    }

    function commitmentOf(address account) external view override returns (Commitment memory) {
        return _commitments[account];
    }
}
