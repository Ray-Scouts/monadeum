// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title IAgentReallocation
/// @notice Owner-scoped reallocation and retirement (EVOLUTION.md sections 3.1, 3.3 and 6; ARCHITECTURE.md sections 5
/// and 16.5). One deployment serves every agent, with the settlement asset fixed at deployment.
///
/// What it does: moves settlement-asset capital from one existing agent smart account (the source) to one or more
/// existing agent smart accounts of the same owner (the sinks), in one call that either completes every transfer or
/// reverts, and records retirement status changes. It never deploys an account, never mints or burns, and never holds
/// a balance: each credit is one `transferFrom(source, sink, amount)` on the settlement asset.
///
/// Who calls what:
/// - The source account calls `reallocate`, so a source is only ever debited by an operation it executes itself. With
///   the spend policy (ARCHITECTURE.md section 16.3) the source's session key submits one batched operation:
///   `approve(thisContract, total)` on the settlement asset, which the spend policy counts against the source's
///   per-transaction and daily caps and whose spender passes the recipient rule because this contract is allowlisted,
///   then `reallocate(...)`, which the spend policy counts as 0. The approval is the only way this contract can pull
///   from the source, so every reallocated amount has already passed the source's spend caps.
/// - The owner's root wallet commits and revokes the reallocation policy, directly or by an EIP-712 signature a relayer
///   submits, so an owner who holds no native gas token can still sign it (ARCHITECTURE.md section 7).
/// - The operator registers agents (account, owner, principal), updates principal, retires agents, and advances the
///   evaluation sequence number. The admin replaces the operator. Their trust assumptions are in ARCHITECTURE.md
///   section 16.5 and THREAT-MODEL.md section 8.
///
/// Rules checked on every `reallocate`, at execution time, from on-chain state only:
/// 1. `evaluation` equals the current evaluation sequence number, and the source has not been debited in it.
/// 2. Source and every sink are registered, Active, and have the same owner. A sink is never the source.
/// 3. That owner's policy is in force, `policyHash` equals its on-chain commitment, and it names source and every sink.
/// 4. The total debit is at most `capBps` of the source's balance before the move, and leaves the source at or above
///    the policy's capital floor. Each sink ends at or below `slotCeilingBps` of its principal.
/// 5. Each transfer moves exactly its amount: the source loses the total and each sink gains its amount.
/// The policy's `capBps`, `slotCeilingBps` and `capitalFloor` are never looser than the protocol constants
/// (EVOLUTION.md section 3.1 item 8), which `commitPolicy` checks and `reallocate` checks again.
interface IAgentReallocation {
    enum Status {
        Unregistered,
        Active,
        Retired
    }

    struct Agent {
        address owner; // the owner's root wallet; set once at registration, never changed
        Status status;
        uint256 principal; // settlement-asset base units: the owner's deposits to the agent minus withdrawals from it
    }

    /// The owner's reallocation policy. Its EIP-712 struct hash is the on-chain commitment (ARCHITECTURE.md 16.5).
    struct Policy {
        address owner;
        address[] agents; // the agents taking part; at least two
        uint16 capBps; // at most REALLOCATION_CAP_BPS
        uint32 slotCeilingBps; // at most SLOT_CEILING_BPS, in basis points of principal (40000 = 4x)
        uint256 capitalFloor; // settlement-asset base units; at least capitalFloor()
        uint256 nonce; // must equal policyNonce(owner); every commit or revoke consumes one
    }

    struct Credit {
        address sink;
        uint256 amount; // settlement-asset base units, nonzero
    }

    // --- events (ARCHITECTURE.md section 9) ----------------------------------------------------------------------

    /// One per credit. A move with several sinks emits one event per sink, all with the same source and evaluation.
    event Reallocated(
        address indexed owner, address indexed source, address indexed sink, uint256 amount, uint256 evaluation
    );
    event AgentRegistered(address indexed account, address indexed owner, uint256 principal);
    event PrincipalSet(address indexed account, uint256 principal);
    event AgentRetired(address indexed account, address indexed owner, address indexed by);
    event PolicyCommitted(address indexed owner, bytes32 policyHash, uint256 nonce);
    event PolicyRevoked(address indexed owner, uint256 nonce);
    event EvaluationAdvanced(uint256 evaluation);
    event OperatorSet(address indexed operator);
    event AdminProposed(address indexed admin);
    event AdminTransferred(address indexed admin);

    // --- errors ----------------------------------------------------------------------------------------------------

    error NotAdmin();
    error NotOperator();
    error NotOwnerOrOperator();
    error NotPolicyOwner();
    error NotOwnersAgent(address owner, address account);
    error ZeroAddress();
    error UnsupportedDecimals(uint8 decimals);
    error AgentAlreadyRegistered(address account);
    error AgentNotActive(address account);
    error OwnerMismatch(address source, address sink);
    error SinkIsSource(address account);
    error PolicyNotInForce(address owner);
    error PolicyHashMismatch(bytes32 given, bytes32 committed);
    error AgentNotCovered(address account);
    error WrongEvaluation(uint256 given, uint256 current);
    error AlreadyDebited(address source, uint256 evaluation);
    error EmptyMove();
    error ZeroAmount();
    error CapExceeded(uint256 total, uint256 cap);
    error BelowFloor(uint256 remaining, uint256 floor);
    error AboveCeiling(address sink, uint256 balance, uint256 ceiling);
    error BoundLooserThanProtocol();
    error TooFewAgents();
    error BadNonce(uint256 given, uint256 expected);
    error BadSignature();
    error TransferFailed();
    error BalanceMismatch();

    // --- reallocation ----------------------------------------------------------------------------------------------

    /// Debits `msg.sender` (the source) once for `evaluation` and credits each sink, atomically. Returns the total.
    function reallocate(uint256 evaluation, bytes32 policyHash, Credit[] calldata credits)
        external
        returns (uint256 total);

    // --- owner policy ----------------------------------------------------------------------------------------------

    function commitPolicy(Policy calldata policy) external returns (bytes32 policyHash); // msg.sender == owner
    function commitPolicyBySig(Policy calldata policy, bytes calldata signature) external returns (bytes32);
    function revokePolicy() external; // msg.sender is the owner
    function revokePolicyBySig(address owner, uint256 nonce, bytes calldata signature) external;

    // --- operator --------------------------------------------------------------------------------------------------

    function registerAgent(address account, address owner, uint256 principal) external;
    function setPrincipal(address account, uint256 principal) external;
    function advanceEvaluation() external returns (uint256 evaluation);

    /// Operator or the agent's owner. One way: a retired agent is never reactivated. Moves no capital.
    function retire(address account) external;

    // --- views -----------------------------------------------------------------------------------------------------

    function settlementAsset() external view returns (address);
    function capitalFloor() external view returns (uint256); // 0.06 of the settlement asset, in base units
    function agent(address account) external view returns (Agent memory);
    function currentEvaluation() external view returns (uint256);
    function lastDebitEvaluation(address source) external view returns (uint256);
    function policyCommitment(address owner) external view returns (bytes32);
    function policyNonce(address owner) external view returns (uint256);
    function isCovered(address owner, address account) external view returns (bool);
    function hashPolicy(Policy calldata policy) external pure returns (bytes32);
    function domainSeparator() external view returns (bytes32);
}
