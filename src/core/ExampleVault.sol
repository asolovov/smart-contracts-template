// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IExampleVault} from "../interfaces/IExampleVault.sol";
import {ISignerSet} from "../interfaces/ISignerSet.sol";
import {SignatureLib} from "../libs/SignatureLib.sol";

/// @title  ExampleVault
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice One instance per topic. Holds ETH (request fees) and quorum-attested state.
///         See `IExampleVault` for the request → attest → submit lifecycle.
///
/// @dev    This contract is the template's worked example of the four things that most
///         often go wrong in a contract that takes money and trusts off-chain signers:
///
///         1. **Replay of a signed payload.** Two independent guards: `fulfilled[reqId]`
///            (one settlement per paid request) and a strictly-monotonic `observedAt`
///            (any new record must be *newer* than the last one). The second is what
///            protects heartbeat pushes, which are exempt from the first by design.
///
///         2. **Reentrancy on the refund.** `requestUpdate` sends ETH back to an untrusted
///            `msg.sender`. All state is written *before* the call, and the function is
///            `nonReentrant` on top. Checks-Effects-Interactions plus a guard, not either alone.
///
///         3. **Ether accounting.** `accruedFees` is tracked explicitly rather than read from
///            `address(this).balance`, because the balance can be inflated by `selfdestruct`
///            or a coinbase payout with no code executed. Never let a forced balance change
///            move your accounting.
///
///         4. **Freshness.** `maxAge` bounds how stale an attestation may be. It ships
///            *disabled* (`type(uint256).max`) so the template's tests are deterministic —
///            **set a real value in production** via `setMaxAge`.
contract ExampleVault is IExampleVault, Ownable2Step, ReentrancyGuard {
    /// @notice Reverts when `msg.value` is below `requestFee`.
    error InsufficientFee(uint256 sent, uint256 required);

    /// @notice Reverts when the excess-fee refund to the caller fails.
    error RefundFailed();

    /// @notice Reverts when a paid request has already been settled.
    error ReqIdAlreadyFulfilled(uint256 reqId);

    /// @notice Reverts when fewer than `threshold` distinct authorized signers signed the digest.
    error InsufficientSignatures();

    /// @notice Reverts when `observedAt` does not strictly exceed the latest record's
    ///         `observedAt`. This is the replay guard that covers heartbeat (`reqId == 0`)
    ///         pushes, which the per-reqId guard deliberately does not.
    error StaleObservation(uint256 observedAt, uint256 latestObservedAt);

    /// @notice Reverts when `observedAt` is older than `maxAge` relative to block time.
    error ObservationTooOld(uint256 observedAt, uint256 currentMaxAge);

    /// @notice Reverts on attempts to install the zero signer set.
    error ZeroSignerSet();

    /// @notice Reverts on attempts to withdraw fees to the zero address.
    error ZeroRecipient();

    /// @notice Reverts when there are no accrued fees to withdraw.
    error NothingToWithdraw();

    /// @notice Reverts when the fee withdrawal transfer fails (recipient rejected the ETH).
    error WithdrawFailed();

    /// @notice Reverts on reads when the requested record does not exist.
    error NoRecord();

    /// @notice Canonical topic this vault publishes values for.
    bytes32 public immutable override topic;

    /// @notice Decimal places the recorded value is expressed in.
    uint8 public immutable override decimals;

    /// @notice Active signer set used to validate `submitValue` calls.
    ISignerSet public override signerSet;

    /// @notice Per-request fee, in wei.
    uint256 public override requestFee;

    /// @notice Freshness policy. `type(uint256).max` disables age gating.
    uint256 public override maxAge;

    /// @notice Fees collected and not yet withdrawn, in wei.
    /// @dev    Tracked explicitly — see the contract-level note on ether accounting.
    uint256 public accruedFees;

    /// @notice Id of the most recent record. `0` means nothing has been recorded yet.
    uint64 public latestRecordId;

    /// @notice The most recently assigned request id. `0` means no request has been made yet.
    /// @dev    Do not read this to learn the id of a request you just sent — on a public chain
    ///         someone else's `requestUpdate` can land between your call and your read. Take the
    ///         id from the `UpdateRequested` event in your own transaction receipt.
    uint256 public lastReqId;

    /// @notice Per-request settlement flag. Never set for `reqId == 0` (the heartbeat sentinel).
    mapping(uint256 => bool) public fulfilled;

    /// @dev Record storage. Read via `getRecord` / `latestRecord`.
    mapping(uint64 => Record) private _records;

    /// @notice Deploy a vault bound to one topic and one signer set.
    /// @param initialOwner Owner that may tune the fee, the freshness policy, and the signer set.
    /// @param signerSet_   Initial signer set. Must be non-zero.
    /// @param topic_       Canonical topic identifier.
    /// @param decimals_    Decimal places of the recorded value.
    /// @param requestFee_  Initial per-request fee, in wei.
    constructor(
        address initialOwner,
        ISignerSet signerSet_,
        bytes32 topic_,
        uint8 decimals_,
        uint256 requestFee_
    ) Ownable(initialOwner) {
        if (address(signerSet_) == address(0)) revert ZeroSignerSet();

        signerSet = signerSet_;
        topic = topic_;
        decimals = decimals_;
        requestFee = requestFee_;
        // Age gating off by default. Tighten in production with `setMaxAge`.
        maxAge = type(uint256).max;
    }

    /// @inheritdoc IExampleVault
    function requestUpdate() external payable override nonReentrant returns (uint256 reqId) {
        uint256 fee = requestFee;
        if (msg.value < fee) revert InsufficientFee(msg.value, fee);

        unchecked {
            // A uint256 counter; overflow is not reachable in any real lifetime.
            reqId = ++lastReqId;
            accruedFees += fee;
        }
        emit UpdateRequested(reqId, msg.sender);

        // Effects are complete. The refund below is the only interaction, and it runs under
        // `nonReentrant` — a malicious `receive()` that calls back in gets the guard's revert.
        uint256 refund;
        unchecked {
            refund = msg.value - fee;
        }
        if (refund > 0) {
            // slither-disable-next-line low-level-calls
            (bool ok, ) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @inheritdoc IExampleVault
    function submitValue(
        uint256 reqId,
        int256 value,
        uint256 observedAt,
        bytes[] calldata signatures
    ) external override {
        // Guard 1 — one settlement per paid request. `reqId == 0` is the heartbeat sentinel and
        // is exempt: heartbeats recur by design.
        if (reqId != 0 && fulfilled[reqId]) revert ReqIdAlreadyFulfilled(reqId);

        // Guard 2 — strict monotonicity of the attested observation time. This is what stops a
        // captured heartbeat payload from being replayed forever, independently of `maxAge`.
        // On the first submission `_records[0].observedAt == 0`, so the check degenerates to
        // `observedAt > 0`, which is exactly right.
        uint256 latestObservedAt = _records[latestRecordId].observedAt;
        /// @dev Slither's `timestamp` detector flags this comparison, but neither side is
        ///      `block.timestamp` — both are signer-attested observation times. Comparing them is
        ///      the entire point of the guard, and a proposer cannot influence either value.
        // slither-disable-next-line timestamp
        if (observedAt <= latestObservedAt) {
            revert StaleObservation(observedAt, latestObservedAt);
        }

        // Guard 3 — absolute freshness, when enabled.
        _requireFresh(observedAt);

        // The signatures are the authorization — `msg.sender` is irrelevant and anyone may relay.
        // The digest binds chainId and this contract's address, so a signature is not portable
        // to another chain or another vault.
        bytes32 digest = SignatureLib.buildDigest(reqId, topic, value, observedAt, block.chainid, address(this));
        ISignerSet set = signerSet;
        if (!SignatureLib.verifySignatures(digest, signatures, set.getSigners(), set.getThreshold())) {
            revert InsufficientSignatures();
        }

        if (reqId != 0) {
            fulfilled[reqId] = true;
        }

        uint64 newRecordId;
        unchecked {
            newRecordId = latestRecordId + 1;
        }
        latestRecordId = newRecordId;
        _records[newRecordId] = Record({value: value, observedAt: observedAt, recordedAt: block.timestamp});

        emit ValueSubmitted(reqId, newRecordId, value, observedAt);
    }

    /// @inheritdoc IExampleVault
    function setRequestFee(uint256 newFee) external override onlyOwner {
        uint256 old = requestFee;
        requestFee = newFee;
        emit RequestFeeChanged(old, newFee);
    }

    /// @inheritdoc IExampleVault
    function setMaxAge(uint256 newMaxAge) external override onlyOwner {
        uint256 old = maxAge;
        maxAge = newMaxAge;
        emit MaxAgeChanged(old, newMaxAge);
    }

    /// @inheritdoc IExampleVault
    function setSignerSet(ISignerSet newSignerSet) external override onlyOwner {
        if (address(newSignerSet) == address(0)) revert ZeroSignerSet();
        ISignerSet old = signerSet;
        signerSet = newSignerSet;
        emit SignerSetChanged(address(old), address(newSignerSet));
    }

    /// @inheritdoc IExampleVault
    function withdrawFees(address payable to) external override onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroRecipient();

        uint256 amount = accruedFees;
        if (amount == 0) revert NothingToWithdraw();

        // Zero the balance BEFORE the transfer. Combined with `nonReentrant` this is belt and
        // braces, but the ordering is the part that must never be inverted.
        accruedFees = 0;

        // slither-disable-next-line low-level-calls
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit FeesWithdrawn(to, amount);
    }

    /// @dev Revert when `observedAt` is older than the `maxAge` policy allows. A no-op while age
    ///      gating is disabled (`maxAge == type(uint256).max`), which is the shipped default.
    function _requireFresh(uint256 observedAt) private view {
        uint256 currentMaxAge = maxAge;
        if (currentMaxAge == type(uint256).max) return;

        uint256 nowTs = block.timestamp;
        /// @dev Slither flags every `block.timestamp` comparison as miner-manipulable. Here it is
        ///      intentional and safe: `maxAge` is a policy window measured in minutes-to-hours,
        ///      orders of magnitude above the ~15s a proposer can skew.
        // slither-disable-next-line timestamp
        if (observedAt < nowTs && nowTs - observedAt > currentMaxAge) {
            revert ObservationTooOld(observedAt, currentMaxAge);
        }
    }

    /// @inheritdoc IExampleVault
    function getRecord(uint64 recordId) external view override returns (Record memory) {
        Record memory r = _records[recordId];
        /// @dev `recordedAt == 0` is the existence check: `submitValue` always writes a non-zero
        ///      `block.timestamp`, so a zero here unambiguously means "never written". Slither
        ///      flags this as a strict timestamp equality; intentional.
        // slither-disable-next-line incorrect-equality,timestamp
        if (r.recordedAt == 0) revert NoRecord();
        return r;
    }

    /// @inheritdoc IExampleVault
    function latestRecord() external view override returns (uint64 recordId, Record memory record) {
        uint64 latest = latestRecordId;
        if (latest == 0) revert NoRecord();
        return (latest, _records[latest]);
    }
}
