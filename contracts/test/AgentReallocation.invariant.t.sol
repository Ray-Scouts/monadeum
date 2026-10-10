// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AgentReallocation} from "../src/AgentReallocation.sol";
import {IAgentReallocation} from "../src/IAgentReallocation.sol";
import {MockERC20} from "./utils/Mocks.sol";

/// Drives the reallocation contract with fuzzed sequences over three owners and one unregistered account: moves with
/// random sources, sinks (mostly the same owner's, sometimes another owner's, a retired or unregistered account, or the
/// source itself), amounts at and one past each bound, stale and future evaluation numbers, stale and random policy
/// hashes, short approvals and repeated calls in one evaluation; policy commits (direct and signed, tighter and looser
/// than the protocol, wrong nonces, foreign agents), revocations, retirements, principal changes, evaluation advances,
/// and owner deposits and withdrawals. An independent model of every rule predicts each outcome, and every
/// disagreement, in either direction, is counted.
contract ReallocationHandler is Test {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant N = 9; // agents in the pool
    uint256 internal constant NO_OWNER = type(uint256).max;
    bytes32 internal constant POLICY_TYPEHASH = keccak256(
        "ReallocationPolicy(address owner,address[] agents,uint16 capBps,uint32 slotCeilingBps,uint256 capitalFloor,uint256 nonce)"
    );
    bytes32 internal constant REVOKE_TYPEHASH = keccak256("RevokeReallocationPolicy(address owner,uint256 nonce)");

    MockERC20 public immutable token;
    AgentReallocation public immutable realloc;
    address public immutable operator;
    uint256 public immutable floor;

    address[3] public owners;
    uint256[3] internal ownerKeys;
    address[N] public pool;
    uint256[N] public ownerOf; // index into owners, or NO_OWNER

    // --- model ---
    uint8[N] public mStatus; // 0 unregistered, 1 active, 2 retired
    uint256[N] public mPrincipal;
    uint256[N] public mLastDebit;
    uint256 public mEval;
    bool[3] public mActive;
    bytes32[3] public mHash;
    bytes32[3] internal mPrevHash;
    uint256[3] public mNonce;
    uint256[3] internal mCap;
    uint256[3] internal mCeil;
    uint256[3] internal mFloor;
    bool[N][3] internal mCovered;

    // --- ghosts ---
    mapping(uint256 => mapping(uint256 => bool)) internal debited; // agent index => evaluation => debited
    uint256 public acceptedOutsideModel;
    uint256 public rejectedInsideModel;
    uint256 public capViolations;
    uint256 public floorViolations;
    uint256 public ceilingViolations;
    uint256 public crossOwnerMoves;
    uint256 public inactiveMoves;
    uint256 public doubleDebits;
    uint256 public conservationBreaks; // a move whose balance changes are not exactly -total / +amounts
    uint256 public atomicityBreaks; // a rejected move that changed any balance
    uint256 public retirementMovedCapital;
    uint256 public hashMismatches;
    uint256 public accepted;
    uint256 public rejected;

    struct Move {
        uint256 src;
        uint256 owner;
        uint256 evaluation;
        bytes32 policyHash;
        uint256 approveAmount;
        uint256 total;
        IAgentReallocation.Credit[] credits;
        uint256[] sinkIdx;
    }

    constructor(MockERC20 token_, AgentReallocation realloc_, address operator_) {
        token = token_;
        realloc = realloc_;
        operator = operator_;
        floor = realloc_.capitalFloor();
        for (uint256 o = 0; o < 3; ++o) {
            (owners[o], ownerKeys[o]) = makeAddrAndKey(string.concat("owner", vm.toString(o)));
            token.mint(owners[o], 1_000e6);
        }
        // Owner 0: agents 0 to 3; owner 1: 4 and 5; owner 2: 6 and 7; agent 8 is never registered.
        uint8[N] memory ownerMap = [0, 0, 0, 0, 1, 1, 2, 2, 255];
        for (uint256 i = 0; i < N; ++i) {
            pool[i] = makeAddr(string.concat("agent", vm.toString(i)));
            token.mint(pool[i], 100e6);
            if (ownerMap[i] == 255) {
                ownerOf[i] = NO_OWNER;
                continue;
            }
            ownerOf[i] = ownerMap[i];
            vm.prank(operator_);
            realloc_.registerAgent(pool[i], owners[ownerMap[i]], 100e6);
            mStatus[i] = 1;
            mPrincipal[i] = 100e6;
        }
        vm.prank(operator_);
        realloc_.advanceEvaluation();
        mEval = 1;
        // Every owner starts with a policy at the protocol bounds covering all of their agents.
        _commitModelled(0, 0x0f, 2_000, 40_000, floor, false);
        _commitModelled(1, 0x30, 2_000, 40_000, floor, true);
        _commitModelled(2, 0xc0, 2_000, 40_000, floor, false);
    }

    // =================================================================================================================
    // Actions
    // =================================================================================================================

    function reallocate(uint256 seed) external {
        _reallocate(seed);
    }

    /// Same action, so moves are drawn about as often as everything else combined.
    function reallocateAgain(uint256 seed) external {
        _reallocate(seed);
    }

    function advance() external {
        vm.prank(operator);
        realloc.advanceEvaluation();
        ++mEval;
    }

    function commit(uint256 seed) external {
        uint256 o = seed % 3;
        // Usually all of the owner's agents, sometimes a random subset of them, and one time in eight a random mask
        // that may include another owner's or an unregistered agent.
        uint256 mask = (seed >> 8) & 0x1ff;
        uint256 shape = (seed >> 20) % 8;
        if (shape == 0) {
            // keep the raw mask
        } else if (shape < 3) {
            mask &= _ownedMask(o);
        } else {
            mask = _ownedMask(o);
        }
        uint256 kind = (seed >> 24) % 16; // kinds 0, 1, 2 and 4 are looser than the protocol
        uint256 cap = kind == 0 ? 2_001 : kind == 1 ? 0 : 1 + (seed >> 32) % 2_000;
        uint256 ceil = kind == 2 ? 40_001 : kind == 3 ? 40_000 : 1 + (seed >> 48) % 40_000;
        uint256 f = kind == 4 ? floor - 1 : floor + (seed >> 64) % ((seed >> 60) % 4 == 0 ? 100e6 : 1e6);
        _commitModelled(o, mask, cap, ceil, f, (seed >> 96) % 2 == 0);
    }

    function commitWrongNonce(uint256 seed) external {
        uint256 o = seed % 3;
        IAgentReallocation.Policy memory p = _buildPolicy(o, _ownedMask(o), 2_000, 40_000, floor);
        p.nonce = mNonce[o] + 1 + (seed >> 8) % 3;
        vm.prank(owners[o]);
        try realloc.commitPolicy(p) {
            ++acceptedOutsideModel;
        } catch {}
    }

    /// Acts one time in two, so policies are in force for a useful share of a run.
    function revoke(uint256 seed) external {
        if ((seed >> 128) % 2 != 0) return;
        uint256 o = seed % 3;
        uint256 nonce = (seed >> 8) % 4 == 0 ? mNonce[o] + 1 : mNonce[o];
        bool ok = nonce == mNonce[o];
        bool done;
        if ((seed >> 16) % 2 == 0 && nonce == mNonce[o]) {
            vm.prank(owners[o]);
            try realloc.revokePolicy() {
                done = true;
            } catch {}
        } else {
            bytes memory sig = _sign(ownerKeys[o], keccak256(abi.encode(REVOKE_TYPEHASH, owners[o], nonce)));
            try realloc.revokePolicyBySig(owners[o], nonce, sig) {
                done = true;
            } catch {}
        }
        if (done != ok) done ? ++acceptedOutsideModel : ++rejectedInsideModel;
        if (done) {
            mPrevHash[o] = mHash[o];
            mHash[o] = bytes32(0);
            mActive[o] = false;
            ++mNonce[o];
            for (uint256 i = 0; i < N; ++i) {
                mCovered[o][i] = false;
            }
        }
    }

    /// Acts one time in four, so a run keeps enough active agents for moves to happen.
    function retire(uint256 seed) external {
        if ((seed >> 128) % 4 != 0) return;
        uint256 i = seed % N;
        uint256 who = (seed >> 8) % 3;
        address caller = who == 0 ? operator : who == 1 ? _ownerAddr(i, false) : _ownerAddr(i, true);
        bool ok = (caller == operator || (ownerOf[i] != NO_OWNER && caller == owners[ownerOf[i]])) && mStatus[i] == 1;
        uint256[N] memory before = _balances();
        vm.prank(caller);
        try realloc.retire(pool[i]) {
            if (!ok) ++acceptedOutsideModel;
            mStatus[i] = 2;
        } catch {
            if (ok) ++rejectedInsideModel;
        }
        uint256[N] memory afterBal = _balances();
        for (uint256 j = 0; j < N; ++j) {
            if (afterBal[j] != before[j]) ++retirementMovedCapital;
        }
    }

    function setPrincipal(uint256 seed) external {
        uint256 i = seed % N;
        uint256 principal = (seed >> 8) % 300e6;
        bool ok = mStatus[i] == 1;
        vm.prank(operator);
        try realloc.setPrincipal(pool[i], principal) {
            if (!ok) ++acceptedOutsideModel;
            mPrincipal[i] = principal;
        } catch {
            if (ok) ++rejectedInsideModel;
        }
    }

    /// The owner funds one of their agents, whatever its status. Not a reallocation; it moves no capital across owners.
    function deposit(uint256 seed) external {
        uint256 i = seed % 8; // registered agents only
        address o = owners[ownerOf[i]];
        uint256 amount = (seed >> 8) % (token.balanceOf(o) + 1);
        vm.prank(o);
        token.transfer(pool[i], amount);
    }

    /// The owner withdraws from one of their agents, for example from a retired agent.
    function withdraw(uint256 seed) external {
        uint256 i = seed % 8;
        uint256 bal = token.balanceOf(pool[i]);
        // Usually a partial withdrawal; one time in eight, everything.
        uint256 amount = (seed >> 128) % 8 == 0 ? bal : (seed >> 8) % (bal / 4 + 1);
        vm.prank(pool[i]);
        token.transfer(owners[ownerOf[i]], amount);
    }

    // =================================================================================================================
    // Move generation, model and audit
    // =================================================================================================================

    function _reallocate(uint256 seed) internal {
        // One time in four, open a new evaluation first, so sources debited in this one can move again.
        if ((seed >> 248) % 4 == 0) {
            vm.prank(operator);
            realloc.advanceEvaluation();
            ++mEval;
        }
        Move memory m = _buildMove(seed);
        bool ok = _modelOk(m);
        uint256[N] memory before = _balances();
        uint256 ownerBefore = token.balanceOf(owners[0]) + token.balanceOf(owners[1]) + token.balanceOf(owners[2]);

        vm.prank(pool[m.src]);
        token.approve(address(realloc), m.approveAmount);
        vm.prank(pool[m.src]);
        try realloc.reallocate(m.evaluation, m.policyHash, m.credits) returns (uint256 total) {
            ++accepted;
            if (!ok) ++acceptedOutsideModel;
            if (total != m.total) ++conservationBreaks;
            _auditAccepted(m, before);
            mLastDebit[m.src] = m.evaluation;
        } catch {
            ++rejected;
            if (ok) ++rejectedInsideModel;
            uint256[N] memory afterBal = _balances();
            for (uint256 j = 0; j < N; ++j) {
                if (afterBal[j] != before[j]) ++atomicityBreaks;
            }
        }
        uint256 ownerAfter = token.balanceOf(owners[0]) + token.balanceOf(owners[1]) + token.balanceOf(owners[2]);
        if (ownerAfter != ownerBefore) ++conservationBreaks; // a move never touches an owner's wallet
    }

    function _buildMove(uint256 seed) internal view returns (Move memory m) {
        m.src = seed % N;
        m.owner = ownerOf[m.src];
        uint256 k = 1 + (seed >> 8) % 3;
        uint256 kind = (seed >> 12) % 16;
        if (kind >= 4 && kind <= 6) k = 1; // ceiling-bound and zero kinds use one sink
        m.credits = new IAgentReallocation.Credit[](k);
        m.sinkIdx = new uint256[](k);
        uint256 s = seed;
        for (uint256 i = 0; i < k; ++i) {
            s = uint256(keccak256(abi.encode(s, i)));
            m.sinkIdx[i] = _pickSink(m.src, s);
            m.credits[i].sink = pool[m.sinkIdx[i]];
        }

        uint256 bal = token.balanceOf(pool[m.src]);
        uint256 capBps = m.owner != NO_OWNER && mActive[m.owner] ? mCap[m.owner] : 2_000;
        uint256 f = m.owner != NO_OWNER && mActive[m.owner] ? mFloor[m.owner] : floor;
        uint256 cap = bal * capBps / BPS;
        uint256 base;
        if (kind == 0) base = cap; // at the cap
        else if (kind == 1) base = cap + 1; // one past the cap
        else if (kind == 2) base = bal > f ? bal - f : 0; // at the floor
        else if (kind == 3) base = (bal > f ? bal - f : 0) + 1; // one past the floor
        else if (kind == 4) base = _room(m); // at the sink's ceiling
        else if (kind == 5) base = _room(m) + 1; // one past the ceiling
        else if (kind == 6) base = 0;
        else base = 1 + (seed >> 128) % (cap + 1); // anywhere up to one past the cap
        // Split base across the credits; the last credit takes the remainder.
        for (uint256 i = 0; i < k; ++i) {
            m.credits[i].amount = i + 1 == k ? base - (base / k) * (k - 1) : base / k;
            m.total += m.credits[i].amount;
        }

        uint256 ev = (seed >> 40) % 16;
        m.evaluation = ev == 0 ? (mEval == 0 ? 0 : mEval - 1) : ev == 1 ? mEval + 1 : mEval;
        uint256 hv = (seed >> 48) % 16;
        if (m.owner == NO_OWNER) m.policyHash = bytes32(0);
        else if (hv == 0) m.policyHash = mPrevHash[m.owner];
        else if (hv == 1) m.policyHash = keccak256(abi.encode(seed));
        else m.policyHash = mHash[m.owner];
        m.approveAmount = (seed >> 56) % 16 == 0 && m.total > 0 ? m.total - 1 : m.total;
    }

    function _pickSink(uint256 src, uint256 s) internal view returns (uint256) {
        uint256 o = ownerOf[src];
        if (s % 8 != 0 && o != NO_OWNER) {
            // One of the source owner's agents; the source itself only one time in eight.
            uint256 mask = _ownedMask(o);
            if ((s >> 16) % 8 != 0) mask &= ~(uint256(1) << src);
            uint256 n = 0;
            uint256[N] memory idx;
            for (uint256 i = 0; i < N; ++i) {
                if (mask & (1 << i) != 0) idx[n++] = i;
            }
            return idx[(s >> 8) % n];
        }
        return (s >> 8) % N;
    }

    function _room(Move memory m) internal view returns (uint256) {
        uint256 j = m.sinkIdx[0];
        uint256 o = ownerOf[j];
        uint256 ceilBps = o != NO_OWNER && mActive[o] ? mCeil[o] : 40_000;
        uint256 ceiling = mPrincipal[j] * ceilBps / BPS;
        uint256 bal = token.balanceOf(pool[j]);
        return ceiling > bal ? ceiling - bal : 0;
    }

    /// Every rule of the interface NatSpec, from the model's own state; balances are read from the token.
    function _modelOk(Move memory m) internal view returns (bool) {
        if (m.evaluation == 0 || m.evaluation != mEval || mLastDebit[m.src] == m.evaluation) return false;
        if (m.credits.length == 0 || mStatus[m.src] != 1) return false;
        uint256 o = m.owner;
        if (!mActive[o] || m.policyHash != mHash[o] || !mCovered[o][m.src]) return false;
        for (uint256 i = 0; i < m.credits.length; ++i) {
            uint256 j = m.sinkIdx[i];
            if (m.credits[i].amount == 0 || j == m.src || mStatus[j] != 1) return false;
            if (ownerOf[j] != o || !mCovered[o][j]) return false;
        }
        uint256 bal = token.balanceOf(pool[m.src]);
        if (m.total > bal * mCap[o] / BPS || bal - m.total < mFloor[o]) return false;
        if (m.approveAmount < m.total) return false;
        for (uint256 i = 0; i < m.credits.length; ++i) {
            uint256 j = m.sinkIdx[i];
            uint256 received;
            for (uint256 x = 0; x < m.credits.length; ++x) {
                if (m.sinkIdx[x] == j) received += m.credits[x].amount;
            }
            if (token.balanceOf(pool[j]) + received > mPrincipal[j] * mCeil[o] / BPS) return false;
        }
        return true;
    }

    /// Checks an accepted move against the protocol bounds directly, independent of the model's policy state.
    function _auditAccepted(Move memory m, uint256[N] memory before) internal {
        uint256[N] memory afterBal = _balances();
        uint256 srcBefore = before[m.src];
        if (m.total * BPS > srcBefore * 2_000) ++capViolations;
        if (afterBal[m.src] < floor) ++floorViolations;
        if (debited[m.src][m.evaluation]) ++doubleDebits;
        debited[m.src][m.evaluation] = true;
        if (mStatus[m.src] != 1) ++inactiveMoves;

        // Expected balances: the source loses the total, each sink gains its credits, nothing else changes.
        int256[N] memory delta;
        delta[m.src] -= int256(m.total);
        for (uint256 i = 0; i < m.credits.length; ++i) {
            uint256 j = m.sinkIdx[i];
            delta[j] += int256(m.credits[i].amount);
            if (ownerOf[j] != ownerOf[m.src] || ownerOf[j] == NO_OWNER) ++crossOwnerMoves;
            if (mStatus[j] != 1) ++inactiveMoves;
        }
        for (uint256 j = 0; j < N; ++j) {
            if (int256(afterBal[j]) != int256(before[j]) + delta[j]) ++conservationBreaks;
            if (delta[j] > 0 && afterBal[j] > mPrincipal[j] * 4) ++ceilingViolations;
        }
    }

    // =================================================================================================================
    // Policy helpers
    // =================================================================================================================

    function _commitModelled(uint256 o, uint256 mask, uint256 cap, uint256 ceil, uint256 f, bool bySig) internal {
        IAgentReallocation.Policy memory p = _buildPolicy(o, mask, cap, ceil, f);
        bool ok = cap >= 1 && cap <= 2_000 && ceil >= 1 && ceil <= 40_000 && f >= floor && p.agents.length >= 2;
        for (uint256 i = 0; i < N; ++i) {
            if (mask & (1 << i) != 0 && (mStatus[i] != 1 || ownerOf[i] != o)) ok = false;
        }
        bytes32 expected = _policyHash(p);
        bool done;
        bytes32 h;
        if (bySig) {
            try realloc.commitPolicyBySig(p, _sign(ownerKeys[o], expected)) returns (bytes32 r) {
                (done, h) = (true, r);
            } catch {}
        } else {
            vm.prank(owners[o]);
            try realloc.commitPolicy(p) returns (bytes32 r) {
                (done, h) = (true, r);
            } catch {}
        }
        if (done != ok) done ? ++acceptedOutsideModel : ++rejectedInsideModel;
        if (!done) return;
        if (h != expected) ++hashMismatches;
        mPrevHash[o] = mHash[o];
        mHash[o] = expected;
        mActive[o] = true;
        ++mNonce[o];
        mCap[o] = cap;
        mCeil[o] = ceil;
        mFloor[o] = f;
        for (uint256 i = 0; i < N; ++i) {
            mCovered[o][i] = mask & (1 << i) != 0;
        }
    }

    function _buildPolicy(uint256 o, uint256 mask, uint256 cap, uint256 ceil, uint256 f)
        internal
        view
        returns (IAgentReallocation.Policy memory p)
    {
        uint256 n;
        for (uint256 i = 0; i < N; ++i) {
            if (mask & (1 << i) != 0) ++n;
        }
        p.agents = new address[](n);
        n = 0;
        for (uint256 i = 0; i < N; ++i) {
            if (mask & (1 << i) != 0) p.agents[n++] = pool[i];
        }
        p.owner = owners[o];
        p.capBps = uint16(cap);
        p.slotCeilingBps = uint32(ceil);
        p.capitalFloor = f;
        p.nonce = mNonce[o];
    }

    function _policyHash(IAgentReallocation.Policy memory p) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POLICY_TYPEHASH,
                p.owner,
                keccak256(abi.encodePacked(p.agents)),
                p.capBps,
                p.slotCeilingBps,
                p.capitalFloor,
                p.nonce
            )
        );
    }

    function _sign(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Monadeum Reallocation"),
                keccak256("1"),
                block.chainid,
                address(realloc)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    // =================================================================================================================
    // Views
    // =================================================================================================================

    function _ownedMask(uint256 o) internal view returns (uint256 mask) {
        for (uint256 i = 0; i < N; ++i) {
            if (ownerOf[i] == o) mask |= 1 << i;
        }
    }

    function _ownerAddr(uint256 i, bool other) internal view returns (address) {
        uint256 o = ownerOf[i] == NO_OWNER ? 0 : ownerOf[i];
        return owners[other ? (o + 1) % 3 : o];
    }

    function _balances() internal view returns (uint256[N] memory b) {
        for (uint256 i = 0; i < N; ++i) {
            b[i] = token.balanceOf(pool[i]);
        }
    }

    function ownerTotal(uint256 o) external view returns (uint256 total) {
        total = token.balanceOf(owners[o]);
        for (uint256 i = 0; i < N; ++i) {
            if (ownerOf[i] == o) total += token.balanceOf(pool[i]);
        }
    }

    function poolSize() external pure returns (uint256) {
        return N;
    }
}

contract AgentReallocationInvariantTest is StdInvariant, Test {
    MockERC20 internal token;
    AgentReallocation internal realloc;
    ReallocationHandler internal handler;
    uint256 internal supply;

    function setUp() public {
        token = new MockERC20();
        address operator = makeAddr("operator");
        realloc = new AgentReallocation(address(token), makeAddr("admin"), operator);
        handler = new ReallocationHandler(token, realloc, operator);
        supply = token.totalSupply();

        bytes4[] memory sels = new bytes4[](11);
        sels[0] = ReallocationHandler.reallocate.selector;
        sels[1] = ReallocationHandler.reallocateAgain.selector;
        sels[2] = ReallocationHandler.advance.selector;
        sels[3] = ReallocationHandler.commit.selector;
        sels[4] = ReallocationHandler.commitWrongNonce.selector;
        sels[5] = ReallocationHandler.revoke.selector;
        sels[6] = ReallocationHandler.retire.selector;
        sels[7] = ReallocationHandler.setPrincipal.selector;
        sels[8] = ReallocationHandler.deposit.selector;
        sels[9] = ReallocationHandler.withdraw.selector;
        sels[10] = ReallocationHandler.reallocate.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    /// Non-vacuity: a fixed pseudo-random sequence through the handler reaches both outcomes often, with the model
    /// and contract agreeing throughout. If a rule change made every move revert, or every move pass, this fails.
    function test_handlerExercisesBothOutcomes() public {
        for (uint256 i = 0; i < 300; ++i) {
            uint256 seed = uint256(keccak256(abi.encode("seq", i)));
            uint256 action = seed % 20;
            if (action < 12) handler.reallocate(seed >> 8);
            else if (action < 14) handler.commit(seed >> 8);
            else if (action == 14) handler.revoke(seed >> 8);
            else if (action == 15) handler.retire(seed >> 8);
            else if (action == 16) handler.setPrincipal(seed >> 8);
            else if (action == 17) handler.withdraw(seed >> 8);
            else if (action == 18) handler.deposit(seed >> 8);
            else handler.commitWrongNonce(seed >> 8);
        }
        assertGt(handler.accepted(), 9, "too few accepted moves");
        assertGt(handler.rejected(), 30, "too few rejected moves");
        invariant_contractMatchesModel();
        invariant_perOwnerCapitalConserved();
        invariant_sourceBounds();
        invariant_sinkCeiling();
        invariant_retirement();
    }

    /// THREAT-MODEL.md invariant 3, total: no account creation, no minting. Supply is fixed after setup.
    function invariant_totalCapitalConserved() public view {
        assertEq(token.totalSupply(), supply);
        assertEq(token.balanceOf(address(realloc)), 0);
    }

    /// THREAT-MODEL.md invariants 3 and 13, per owner: an owner's wallet plus their agents is unchanged by any move,
    /// retirement, deposit, or withdrawal. Owner 0 has four agents, owners 1 and 2 have two; agent 8 has no owner.
    function invariant_perOwnerCapitalConserved() public view {
        assertEq(handler.ownerTotal(0), 1_000e6 + 4 * 100e6);
        assertEq(handler.ownerTotal(1), 1_000e6 + 2 * 100e6);
        assertEq(handler.ownerTotal(2), 1_000e6 + 2 * 100e6);
        assertEq(token.balanceOf(handler.pool(8)), 100e6);
        assertEq(handler.crossOwnerMoves(), 0);
        assertEq(handler.conservationBreaks(), 0);
        assertEq(handler.atomicityBreaks(), 0);
    }

    /// THREAT-MODEL.md invariant 4: cap per evaluation and capital floor on every source; one debit per evaluation.
    function invariant_sourceBounds() public view {
        assertEq(handler.capViolations(), 0);
        assertEq(handler.floorViolations(), 0);
        assertEq(handler.doubleDebits(), 0);
    }

    /// THREAT-MODEL.md invariant 12: no sink above slot_ceiling times its principal through a move.
    function invariant_sinkCeiling() public view {
        assertEq(handler.ceilingViolations(), 0);
    }

    /// THREAT-MODEL.md invariant 15: a retired or unregistered agent is never a source or sink, and retirement moves
    /// no capital.
    function invariant_retirement() public view {
        assertEq(handler.inactiveMoves(), 0);
        assertEq(handler.retirementMovedCapital(), 0);
    }

    /// The contract and the model agree on every outcome and on the stored state, so the model's rules are the
    /// contract's rules: same owner, policy in force with the given hash and naming both agents, evaluation, bounds.
    function invariant_contractMatchesModel() public view {
        assertEq(handler.acceptedOutsideModel(), 0);
        assertEq(handler.rejectedInsideModel(), 0);
        assertEq(handler.hashMismatches(), 0);
        assertEq(realloc.currentEvaluation(), handler.mEval());
        for (uint256 o = 0; o < 3; ++o) {
            address owner = handler.owners(o);
            assertEq(realloc.policyCommitment(owner), handler.mHash(o));
            assertEq(realloc.policyNonce(owner), handler.mNonce(o));
        }
        for (uint256 i = 0; i < handler.poolSize(); ++i) {
            address a = handler.pool(i);
            assertEq(uint8(realloc.agent(a).status), handler.mStatus(i));
            assertEq(realloc.lastDebitEvaluation(a), handler.mLastDebit(i));
        }
    }
}
