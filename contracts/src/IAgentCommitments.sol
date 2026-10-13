// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title IAgentCommitments
/// @notice Write-once genome and strategy-version commitments of agent accounts (ARCHITECTURE.md section 9, issue #32).
/// This file is the authoritative interface.
///
/// Each agent account commits, for itself, the section 16.4 hash of the genome it was created with and of the strategy
/// plugin build that runs it. The caller is the account: the commitment is one call in the owner-signed operation that
/// deploys the account, so no operator, admin, or other account can write it, and nothing is trusted to the platform's
/// database. A commitment is written once and never changed (EVOLUTION.md section 3.1, item 2: a genome is fixed for
/// the life of its agent); there is no update, delete, admin, or upgrade path.
///
/// This contract stands in for the genome and strategy-version fields of the ERC-8004-compatible identity registry of
/// ARCHITECTURE.md section 9 until that registry exists, the same way AgentReallocation keeps its own registry of
/// owner, principal, and status.
interface IAgentCommitments {
    struct Commitment {
        bytes32 genomeHash;
        bytes32 strategyVersionHash;
    }

    event AgentCommitted(address indexed account, bytes32 genomeHash, bytes32 strategyVersionHash);

    error AlreadyCommitted(address account);
    error ZeroHash();

    /// Commits the caller's genome and strategy-version hashes. Reverts if the caller already committed, or if either
    /// hash is zero (the zero hash is what a reader sees for an account with no commitment).
    function commit(bytes32 genomeHash, bytes32 strategyVersionHash) external;

    /// The account's commitment; both fields are zero when it has none.
    function commitmentOf(address account) external view returns (Commitment memory);
}
