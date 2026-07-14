// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  ISignerSet
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice M-of-N authorized signer registry. Holds the signer set and the verification
///         threshold that `ExampleVault` consults when validating a `submitValue` call.
/// @dev    Template note: this is the "who is allowed to attest" primitive. Swap the
///         owner-managed model for a governance-managed one by changing only the
///         implementation — consumers depend on this interface, not on `SignerSet`.
interface ISignerSet {
    /// @notice Emitted when a signer is added to the authorized set.
    /// @param signer The address granted signing rights.
    event SignerAdded(address indexed signer);

    /// @notice Emitted when a signer is removed from the authorized set.
    /// @param signer The address whose signing rights were revoked.
    event SignerRemoved(address indexed signer);

    /// @notice Emitted when the verification threshold changes.
    /// @param oldThreshold Previous threshold value.
    /// @param newThreshold New threshold value (must satisfy `0 < t <= signers.length`).
    event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold);

    /// @notice Authorize `signer` to co-sign attestations. Owner-only.
    /// @param signer Address to add.
    function addSigner(address signer) external;

    /// @notice Revoke `signer`'s authorization. Owner-only.
    /// @param signer Address to remove.
    function removeSigner(address signer) external;

    /// @notice Set the M-of-N verification threshold. Owner-only.
    /// @param newThreshold Number of valid signatures required (`0 < t <= signers.length`).
    function setThreshold(uint256 newThreshold) external;

    /// @notice The current authorized signer set.
    /// @return Array of authorized signer addresses, in insertion order.
    function getSigners() external view returns (address[] memory);

    /// @notice The current verification threshold.
    /// @return Number of distinct authorized signatures required to accept an attestation.
    function getThreshold() external view returns (uint256);

    /// @notice Whether `account` is an authorized signer.
    /// @param account Address to check.
    /// @return `true` if authorized.
    function isSigner(address account) external view returns (bool);
}
