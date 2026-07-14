// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ISignerSet} from "./ISignerSet.sol";

/// @title  IExampleVault
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Request/fulfill store for an off-chain-attested `int256` value.
///
///         The lifecycle is:
///           1. Anyone calls `requestUpdate()` with `msg.value >= requestFee`. The vault
///              assigns a monotonically increasing `reqId` and emits `UpdateRequested`.
///           2. Off-chain workers observe the event, compute the value, and each sign an
///              EIP-712 `Attestation` over `(reqId, topic, value, observedAt)`.
///           3. Anyone (typically a relayer) calls `submitValue` with `threshold`-many
///              signatures from distinct authorized signers. The vault verifies the
///              quorum on-chain and records a new `Record`.
///
///         `reqId == 0` is the reserved *heartbeat* sentinel: a push update nobody paid
///         for, used to keep the value fresh without a request. It bypasses the per-reqId
///         replay guard (heartbeats are expected to recur) but is still subject to the
///         monotonic `observedAt` gate.
///
/// @dev    Template note: this is the shape of any "pay to request → off-chain compute →
///         attested on-chain settle" flow — oracles, bridges, ZK-verifier callbacks,
///         randomness beacons. Replace `int256 value` with your own payload and the
///         surrounding machinery carries over unchanged.
interface IExampleVault {
    /// @notice A recorded, quorum-attested observation.
    /// @param value      The attested value, scaled to `decimals()`.
    /// @param observedAt Signer-attested observation time (off-chain clock).
    /// @param recordedAt `block.timestamp` at which the submission landed (on-chain clock).
    struct Record {
        int256 value;
        uint256 observedAt;
        uint256 recordedAt;
    }

    /// @notice Emitted when a paid update is requested.
    /// @param reqId     Assigned request id (never `0`).
    /// @param requester Account that paid for and initiated the request.
    event UpdateRequested(uint256 indexed reqId, address indexed requester);

    /// @notice Emitted when a quorum-attested value is recorded.
    /// @param reqId      Request being fulfilled, or `0` for a heartbeat push.
    /// @param recordId   Id of the newly written record.
    /// @param value      The attested value.
    /// @param observedAt Signer-attested observation time.
    event ValueSubmitted(uint256 indexed reqId, uint64 indexed recordId, int256 value, uint256 observedAt);

    /// @notice Emitted when the request fee changes.
    /// @param oldFee Previous fee, in wei.
    /// @param newFee New fee, in wei.
    event RequestFeeChanged(uint256 oldFee, uint256 newFee);

    /// @notice Emitted when the freshness policy changes.
    /// @param oldMaxAge Previous policy.
    /// @param newMaxAge New policy. `type(uint256).max` disables age gating.
    event MaxAgeChanged(uint256 oldMaxAge, uint256 newMaxAge);

    /// @notice Emitted when the authorized signer set is swapped.
    /// @param oldSignerSet Previous signer set.
    /// @param newSignerSet New signer set.
    event SignerSetChanged(address indexed oldSignerSet, address indexed newSignerSet);

    /// @notice Emitted when the owner withdraws accrued fees.
    /// @param to     Recipient of the withdrawal.
    /// @param amount Amount withdrawn, in wei.
    event FeesWithdrawn(address indexed to, uint256 amount);

    /// @notice Pay the current fee and enqueue an update request.
    /// @dev    Any `msg.value` above `requestFee` is refunded to `msg.sender` in the same call.
    /// @return reqId The assigned request id, starting at `1`.
    function requestUpdate() external payable returns (uint256 reqId);

    /// @notice Record a value attested by at least `threshold` distinct authorized signers.
    /// @dev    Permissionless: the signatures are the authorization, not `msg.sender`. Anyone
    ///         may relay a validly-signed payload.
    /// @param reqId      Request being fulfilled, or `0` for a heartbeat push.
    /// @param value      Attested value, already scaled to `decimals()`.
    /// @param observedAt Signer-attested observation time. Must strictly exceed the latest
    ///                   record's `observedAt`.
    /// @param signatures 65-byte ECDSA signatures over the EIP-712 digest. Order-independent;
    ///                   duplicates and signatures from non-signers are ignored, not fatal.
    function submitValue(uint256 reqId, int256 value, uint256 observedAt, bytes[] calldata signatures) external;

    /// @notice Set the per-request fee, in wei. Owner-only.
    /// @param newFee New fee, in wei.
    function setRequestFee(uint256 newFee) external;

    /// @notice Set the maximum tolerated age of `observedAt` relative to block time.
    /// @dev    `type(uint256).max` disables age gating. Owner-only.
    /// @param  newMaxAge New freshness policy, in seconds.
    function setMaxAge(uint256 newMaxAge) external;

    /// @notice Swap the authorized signer set. Owner-only. Must be non-zero.
    /// @param  newSignerSet The signer set to install.
    function setSignerSet(ISignerSet newSignerSet) external;

    /// @notice Withdraw all accrued request fees. Owner-only.
    /// @param to Recipient of the fees. Must be non-zero and must accept ETH.
    function withdrawFees(address payable to) external;

    /// @notice The topic this vault publishes values for (e.g. `keccak256("ETH/USD")`).
    function topic() external view returns (bytes32);

    /// @notice Decimal places the recorded value is expressed in.
    function decimals() external view returns (uint8);

    /// @notice The active signer set.
    function signerSet() external view returns (ISignerSet);

    /// @notice Current per-request fee, in wei.
    function requestFee() external view returns (uint256);

    /// @notice Current freshness policy. `type(uint256).max` means age gating is off.
    function maxAge() external view returns (uint256);

    /// @notice Read a historical record. Reverts with `NoRecord` if `recordId` was never written.
    /// @param  recordId The record to read.
    /// @return The stored record.
    function getRecord(uint64 recordId) external view returns (Record memory);

    /// @notice Read the most recent record. Reverts with `NoRecord` if nothing has been recorded.
    /// @return recordId Id of the most recent record.
    /// @return record   The stored record.
    function latestRecord() external view returns (uint64 recordId, Record memory record);
}
