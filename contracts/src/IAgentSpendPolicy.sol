// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title IAgentSpendPolicy
/// @notice On-chain spend policy for agent smart accounts, specified in ARCHITECTURE.md section 16.3.
/// This file is the authoritative interface. The section quotes an excerpt of it; a change to either updates both
/// in the same pull request. Issue #25 implements it.
///
/// One deployment serves every agent account, keyed by account address. The settlement asset is fixed at deployment.
/// The daily-cap state exists because no native rolling cap does, which issue #18's testnet run confirmed.
///
/// Phases:
/// - Validation (`check`): the call allowlist at (target, selector) granularity, the recipient rule, a zero native
///   value, and the per-transaction cap over the sum of every call in the operation. No time-dependent reads.
/// - Execution (`record`): the rolling daily cap. ERC-7562 forbids TIMESTAMP during validation, so a daily-cap
///   breach reverts in execution and still pays gas.
///
/// Counting: only `transfer(address,uint256)` and `approve(address,uint256)` on the settlement asset count, each
/// for its full `amount`. Every other allowlisted call counts 0. This is the same rule as the off-chain RiskModule
/// (ARCHITECTURE.md section 16.1, libs/risk).
///
/// Recipient rule: the first argument of a counted call (the `to` of `transfer`, the `spender` of `approve`) must be
/// an address on which the account has at least one allowed selector, and must not be the settlement asset, the
/// policy contract, or the account itself. With the MVP allowlist that means Kuru's router and the owner-scoped
/// reallocation contract (AgentReallocation), the same set the RiskModule's `recipient-not-allowed` rule uses. There
/// is no separate recipient list to configure, so the two cannot drift apart.
///
/// Self-protection, independent of how the allowlist is configured: `check` rejects any call whose target is the
/// policy contract or the account itself, and `setAllowed` rejects any selector on the settlement asset other than
/// `transfer` and `approve`, so no allowlist entry can move the settlement asset uncounted.
///
/// Fail-closed default: an account whose limits were never set has both caps at 0, so any counted call fails.
///
/// Integration with ZeroDev Kernel v3.1 (implemented in AgentSpendPolicy, checked against Kernel's source, a test
/// double, and the deployed Kernel v3.1 contracts on a fork of Monad testnet, not yet through a bundler;
/// ARCHITECTURE.md section 16.3 holds the current status):
/// - The implementation is installed on the session key's permission as a policy and as that validator's hook.
/// - The policy entry point (Kernel's user-operation policy check) decodes `userOp.callData` into `Call[]` and
///   calls `check(account, calls)`. It accepts only `execute` with call type single or batch, optionally wrapped
///   in `executeUserOp` when the hook is set. It rejects delegatecall, any other call type, and any other
///   account selector (module installation, upgrade, fallback), because each of those could run code outside
///   this policy.
/// - The hook entry point (Kernel's pre-execution check, called by the account, so msg.sender is the account)
///   decodes the same calldata into `Call[]` and calls `record(calls)`.
/// - Validation-phase storage reads must satisfy ERC-7562's associated-storage rule: the account address is the
///   innermost mapping key of every per-account mapping `check` reads.
/// - x402 payments settle through an EIP-3009 authorization the account signs, so they reach the account through
///   ERC-1271 `isValidSignature`, not through `check`. This interface does not bound them; the separate
///   X402PaymentValidator does (ARCHITECTURE.md section 16.3, "x402 signature path").
interface IAgentSpendPolicy {
    struct Limits {
        uint128 perTxCap; // settlement-asset base units, applied to the sum over one operation
        uint128 dailyCap; // settlement-asset base units, over any 24 hour period, per the window rule
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    event LimitsSet(address indexed account, uint128 perTxCap, uint128 dailyCap);
    event CallAllowed(address indexed account, address indexed target, bytes4 indexed selector, bool allowed);
    event Spent(address indexed account, uint256 amount, uint256 windowTotal);

    /// Target and selector not allowed for the account, calldata shorter than a selector, a counted call whose
    /// arguments do not decode, or a target equal to the policy contract or the account itself.
    error CallNotAllowed(address target, bytes4 selector);
    /// The `to` of a counted `transfer` or the `spender` of a counted `approve` fails the recipient rule.
    error RecipientNotAllowed(address recipient);
    error NativeValueNotAllowed(uint256 value);
    error PerTxCapExceeded(uint256 amount, uint256 cap);
    error DailyCapExceeded(uint256 windowTotal, uint256 cap);
    /// Raised by `setAllowed` for a selector on the settlement asset other than `transfer` and `approve`.
    error UncountedSettlementSelector(bytes4 selector);

    /// Validation phase. No time-dependent reads. Receives every call in the operation, single or batched.
    /// Reverts with one of the errors above, or returns the total the operation counts; perTxCap applies to it.
    function check(address account, Call[] calldata calls) external view returns (uint256 total);

    /// Execution phase, from the account's pre-execution hook. msg.sender is the account.
    /// Recomputes the total from the calls, never trusts a caller-supplied amount. Adds it to the current hour's
    /// bucket and reverts with DailyCapExceeded if the window total would exceed dailyCap. Emits Spent.
    function record(Call[] calldata calls) external;

    function settlementAsset() external view returns (address);
    function limits(address account) external view returns (Limits memory);
    function isAllowed(address account, address target, bytes4 selector) external view returns (bool);
    function isRecipientAllowed(address account, address recipient) external view returns (bool);

    /// Sum of the account's hourly buckets h - 24 through h, where h is the current hour. Covers 24 to 25 hours,
    /// so it can over-count by up to one hour of spend and never under-counts. The RiskModule reads this value as
    /// Ledger.spentInWindow.
    function windowTotal(address account) external view returns (uint256);

    /// Owner only: msg.sender is the account, reachable through the root-wallet validator, never a session key,
    /// per the self-protection rule.
    function setLimits(Limits calldata newLimits) external;
    function setAllowed(address target, bytes4 selector, bool allowed) external;
}
