// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {IAgentReallocation} from "./IAgentReallocation.sol";

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title AgentReallocation
/// @notice Implementation of IAgentReallocation. See the interface NatSpec for the rules and ARCHITECTURE.md section
/// 16.5 for how owner, principal, retirement and the evaluation sequence number are read on-chain.
///
/// Capital is read as the account's settlement-asset balance at execution. Positions an agent holds in other assets are
/// not counted, which keeps the cap and the floor conservative on a source and can under-count a sink's capital
/// against the slot ceiling (ARCHITECTURE.md section 16.5, known gap).
contract AgentReallocation is IAgentReallocation {
    /// EVOLUTION.md section 3.1: reallocation_cap = 0.2 of source capital per evaluation.
    uint16 public constant REALLOCATION_CAP_BPS = 2_000;
    /// EVOLUTION.md section 3.1: slot_ceiling = 4 times principal.
    uint32 public constant SLOT_CEILING_BPS = 40_000;
    /// EVOLUTION.md section 6: capital floor = 0.06 of the settlement asset, scaled by its decimals at deployment.
    uint256 public constant CAPITAL_FLOOR_NUMERATOR = 6;
    uint256 public constant CAPITAL_FLOOR_DENOMINATOR = 100;
    uint256 internal constant BPS = 10_000;

    bytes32 public constant POLICY_TYPEHASH = keccak256(
        "ReallocationPolicy(address owner,address[] agents,uint16 capBps,uint32 slotCeilingBps,uint256 capitalFloor,uint256 nonce)"
    );
    bytes32 public constant REVOKE_TYPEHASH = keccak256("RevokeReallocationPolicy(address owner,uint256 nonce)");
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("Monadeum Reallocation");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    /// secp256k1n / 2; a signature with a larger s is the malleable twin of a valid one and is rejected.
    uint256 internal constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct PolicyState {
        bytes32 hash; // 0 when no policy is in force
        uint256 nonce; // the nonce of the committed policy, which keys its coverage set
        uint16 capBps;
        uint32 slotCeilingBps;
        uint256 capitalFloor;
    }

    address public immutable override settlementAsset;
    /// Minimum seconds between two evaluation advances (ARCHITECTURE.md section 16.5). Fixed at deployment.
    uint256 public immutable override minEvaluationInterval;
    uint256 public immutable override capitalFloor;

    address public admin;
    address public pendingAdmin;
    address public operator;

    uint256 public override currentEvaluation;
    uint256 public override lastEvaluationAt;

    mapping(address account => Agent) internal _agents;
    mapping(address source => uint256) public override lastDebitEvaluation;
    mapping(address owner => PolicyState) internal _policies;
    mapping(address owner => uint256) public override policyNonce;
    mapping(address owner => mapping(uint256 nonce => mapping(address account => bool))) internal _covered;

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address settlementAsset_, address admin_, address operator_, uint256 minEvaluationInterval_) {
        if (settlementAsset_ == address(0) || admin_ == address(0) || operator_ == address(0)) revert ZeroAddress();
        _requireContract(admin_);
        _requireContract(operator_);
        if (minEvaluationInterval_ == 0) revert ZeroEvaluationInterval();
        minEvaluationInterval = minEvaluationInterval_;
        // The decimals value is read from the token, never assumed (ARCHITECTURE.md section 16).
        (bool ok, bytes memory ret) = settlementAsset_.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) revert UnsupportedDecimals(0);
        uint256 decimals = abi.decode(ret, (uint256));
        if (decimals < 2 || decimals > 36) revert UnsupportedDecimals(uint8(decimals > 255 ? 255 : decimals));
        settlementAsset = settlementAsset_;
        capitalFloor = CAPITAL_FLOOR_NUMERATOR * 10 ** decimals / CAPITAL_FLOOR_DENOMINATOR;
        admin = admin_;
        operator = operator_;
        emit AdminTransferred(admin_);
        emit OperatorSet(operator_);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Reallocation
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IAgentReallocation
    function reallocate(uint256 evaluation, bytes32 policyHash, Credit[] calldata credits)
        external
        override
        returns (uint256 total)
    {
        Bounds memory b = _authorize(msg.sender, evaluation, policyHash, credits);
        total = b.total;

        IERC20Minimal token = IERC20Minimal(settlementAsset);
        uint256 sourceBefore = token.balanceOf(msg.sender);
        uint256 cap = sourceBefore * b.capBps / BPS;
        if (total > cap) revert CapExceeded(total, cap);
        // total <= cap <= sourceBefore, so this cannot underflow.
        if (sourceBefore - total < b.floor) revert BelowFloor(sourceBefore - total, b.floor);

        lastDebitEvaluation[msg.sender] = evaluation;

        for (uint256 i = 0; i < credits.length; ++i) {
            _credit(token, b, msg.sender, credits[i], evaluation);
        }
        if (token.balanceOf(msg.sender) != sourceBefore - total) revert BalanceMismatch();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Owner policy
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IAgentReallocation
    function commitPolicy(Policy calldata policy) external override returns (bytes32) {
        if (msg.sender != policy.owner) revert NotPolicyOwner();
        return _commit(policy);
    }

    /// @inheritdoc IAgentReallocation
    function commitPolicyBySig(Policy calldata policy, bytes calldata signature) external override returns (bytes32) {
        _verify(policy.owner, hashPolicy(policy), signature);
        return _commit(policy);
    }

    /// @inheritdoc IAgentReallocation
    function revokePolicy() external override {
        _revoke(msg.sender, policyNonce[msg.sender]);
    }

    /// @inheritdoc IAgentReallocation
    function revokePolicyBySig(address owner, uint256 nonce, bytes calldata signature) external override {
        _verify(owner, keccak256(abi.encode(REVOKE_TYPEHASH, owner, nonce)), signature);
        _revoke(owner, nonce);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Operator and admin
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IAgentReallocation
    function registerAgent(address account, address owner, uint256 principal) external override onlyOperator {
        if (account == address(0) || owner == address(0)) revert ZeroAddress();
        if (_agents[account].status != Status.Unregistered) revert AgentAlreadyRegistered(account);
        _agents[account] = Agent({owner: owner, status: Status.Active, principal: principal});
        emit AgentRegistered(account, owner, principal);
    }

    /// @inheritdoc IAgentReallocation
    function setPrincipal(address account, uint256 principal) external override onlyOperator {
        Agent storage a = _agents[account];
        if (a.status != Status.Active) revert AgentNotActive(account);
        a.principal = principal;
        emit PrincipalSet(account, principal);
    }

    /// @inheritdoc IAgentReallocation
    function advanceEvaluation() external override onlyOperator returns (uint256 evaluation) {
        if (currentEvaluation != 0) {
            uint256 nextAllowedAt = lastEvaluationAt + minEvaluationInterval;
            if (block.timestamp < nextAllowedAt) revert EvaluationTooSoon(nextAllowedAt);
        }
        lastEvaluationAt = block.timestamp;
        evaluation = ++currentEvaluation;
        emit EvaluationAdvanced(evaluation);
    }

    /// @inheritdoc IAgentReallocation
    function retire(address account) external override {
        Agent storage a = _agents[account];
        if (msg.sender != operator && msg.sender != a.owner) revert NotOwnerOrOperator();
        if (a.status != Status.Active) revert AgentNotActive(account);
        a.status = Status.Retired;
        emit AgentRetired(account, a.owner, msg.sender);
    }

    function setOperator(address operator_) external onlyAdmin {
        if (operator_ == address(0)) revert ZeroAddress();
        _requireContract(operator_);
        operator = operator_;
        emit OperatorSet(operator_);
    }

    /// Proposing address(0) cancels a pending proposal; any other address must be a contract.
    function proposeAdmin(address admin_) external onlyAdmin {
        if (admin_ != address(0)) _requireContract(admin_);
        pendingAdmin = admin_;
        emit AdminProposed(admin_);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin || msg.sender == address(0)) revert NotAdmin();
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminTransferred(msg.sender);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    function agent(address account) external view override returns (Agent memory) {
        return _agents[account];
    }

    function policyCommitment(address owner) external view override returns (bytes32) {
        return _policies[owner].hash;
    }

    function isCovered(address owner, address account) external view override returns (bool) {
        PolicyState storage p = _policies[owner];
        return p.hash != bytes32(0) && _covered[owner][p.nonce][account];
    }

    /// EIP-712 struct hash of the policy. This is the on-chain commitment, and the value a planner passes as
    /// `policyHash` to `reallocate`.
    function hashPolicy(Policy calldata policy) public pure override returns (bytes32) {
        return keccak256(
            abi.encode(
                POLICY_TYPEHASH,
                policy.owner,
                keccak256(abi.encodePacked(policy.agents)),
                policy.capBps,
                policy.slotCeilingBps,
                policy.capitalFloor,
                policy.nonce
            )
        );
    }

    function domainSeparator() public view override returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    struct Bounds {
        address owner;
        uint256 capBps;
        uint256 ceilingBps;
        uint256 floor;
        uint256 total;
    }

    /// Every rule that does not depend on balances: evaluation, one debit per source, registration, status, owner,
    /// policy in force with the given hash, coverage, and the policy bounds. Returns the bounds and the total debit.
    function _authorize(address source, uint256 evaluation, bytes32 policyHash, Credit[] calldata credits)
        internal
        view
        returns (Bounds memory b)
    {
        uint256 current = currentEvaluation;
        if (evaluation == 0 || evaluation != current) revert WrongEvaluation(evaluation, current);
        if (lastDebitEvaluation[source] == evaluation) revert AlreadyDebited(source, evaluation);
        if (credits.length == 0) revert EmptyMove();

        Agent storage src = _agents[source];
        if (src.status != Status.Active) revert AgentNotActive(source);
        b.owner = src.owner;

        PolicyState storage p = _policies[b.owner];
        bytes32 committed = p.hash;
        if (committed == bytes32(0)) revert PolicyNotInForce(b.owner);
        if (policyHash != committed) revert PolicyHashMismatch(policyHash, committed);
        uint256 nonce = p.nonce;
        if (!_covered[b.owner][nonce][source]) revert AgentNotCovered(source);
        b.capBps = p.capBps;
        b.ceilingBps = p.slotCeilingBps;
        b.floor = p.capitalFloor;
        // commitPolicy already refuses looser bounds; checked again so no stored state can loosen them.
        if (b.capBps > REALLOCATION_CAP_BPS || b.ceilingBps > SLOT_CEILING_BPS || b.floor < capitalFloor) {
            revert BoundLooserThanProtocol();
        }

        for (uint256 i = 0; i < credits.length; ++i) {
            address sink = credits[i].sink;
            if (credits[i].amount == 0) revert ZeroAmount();
            if (sink == source) revert SinkIsSource(sink);
            Agent storage dst = _agents[sink];
            if (dst.status != Status.Active) revert AgentNotActive(sink);
            if (dst.owner != b.owner) revert OwnerMismatch(source, sink);
            if (!_covered[b.owner][nonce][sink]) revert AgentNotCovered(sink);
            b.total += credits[i].amount;
        }
    }

    /// One transfer from the source to a sink, checked to move exactly `amount` and to leave the sink at or below its
    /// slot ceiling.
    function _credit(IERC20Minimal token, Bounds memory b, address source, Credit calldata c, uint256 evaluation)
        internal
    {
        uint256 sinkBefore = token.balanceOf(c.sink);
        _transferFrom(source, c.sink, c.amount);
        uint256 sinkAfter = token.balanceOf(c.sink);
        if (sinkAfter != sinkBefore + c.amount) revert BalanceMismatch();
        uint256 ceiling = _agents[c.sink].principal * b.ceilingBps / BPS;
        if (sinkAfter > ceiling) revert AboveCeiling(c.sink, sinkAfter, ceiling);
        emit Reallocated(b.owner, source, c.sink, c.amount, evaluation);
    }

    /// The operator and admin roles must be held by multisig contracts. Code presence is all the chain can check: it
    /// refuses a plain key, not a contract with a single signer, so the threshold remains a deployment requirement.
    function _requireContract(address account) internal view {
        if (account.code.length == 0) revert RoleNotContract(account);
    }

    function _commit(Policy calldata policy) internal returns (bytes32 policyHash) {
        address owner = policy.owner;
        if (owner == address(0)) revert ZeroAddress();
        uint256 expected = policyNonce[owner];
        if (policy.nonce != expected) revert BadNonce(policy.nonce, expected);
        if (
            policy.capBps == 0 || policy.capBps > REALLOCATION_CAP_BPS || policy.slotCeilingBps == 0
                || policy.slotCeilingBps > SLOT_CEILING_BPS || policy.capitalFloor < capitalFloor
        ) revert BoundLooserThanProtocol();
        if (policy.agents.length < 2) revert TooFewAgents();
        for (uint256 i = 0; i < policy.agents.length; ++i) {
            address a = policy.agents[i];
            Agent storage rec = _agents[a];
            if (rec.status != Status.Active) revert AgentNotActive(a);
            if (rec.owner != owner) revert NotOwnersAgent(owner, a);
            _covered[owner][expected][a] = true;
        }
        policyHash = hashPolicy(policy);
        policyNonce[owner] = expected + 1;
        _policies[owner] = PolicyState({
            hash: policyHash,
            nonce: expected,
            capBps: policy.capBps,
            slotCeilingBps: policy.slotCeilingBps,
            capitalFloor: policy.capitalFloor
        });
        emit PolicyCommitted(owner, policyHash, expected);
    }

    function _revoke(address owner, uint256 nonce) internal {
        uint256 expected = policyNonce[owner];
        if (nonce != expected) revert BadNonce(nonce, expected);
        policyNonce[owner] = expected + 1;
        delete _policies[owner];
        emit PolicyRevoked(owner, nonce);
    }

    /// Reverts unless `signature` is `signer`'s EIP-712 signature over `structHash` in this contract's domain.
    function _verify(address signer, bytes32 structHash, bytes calldata signature) internal view {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        address recovered = _recover(digest, signature);
        if (recovered == address(0) || recovered != signer) revert BadSignature();
    }

    /// ECDSA recovery for a 65-byte (r, s, v) signature from an externally owned account. Returns address(0), which
    /// never equals a policy owner, for any malformed or malleable signature. ERC-1271 owners are not supported.
    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }

    function _transferFrom(address from, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) =
            settlementAsset.call(abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount));
        if (!ok || (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool))))) revert TransferFailed();
    }
}
