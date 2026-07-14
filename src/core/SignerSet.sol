// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {ISignerSet} from "../interfaces/ISignerSet.sol";

/// @title  SignerSet
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice M-of-N authorized signer registry, owner-managed via `Ownable2Step`.
///
/// @dev    Two patterns worth stealing from this file:
///
///         **`Ownable2Step`, not `Ownable`.** Transfer is propose + accept, so a typo'd
///         address cannot silently brick the contract. Use it everywhere you would have
///         reached for plain `Ownable`.
///
///         **The mapping is the source of truth; the array is only for enumeration.**
///         Membership checks hit `_isSigner` in O(1). Removal swaps the last element into
///         the hole and pops, which is O(1) but *reorders* the array — never assume the
///         array index of a signer is stable across removals.
contract SignerSet is ISignerSet, Ownable2Step {
    /// @notice Reverts when an action would leave `threshold > signers.length`.
    error ThresholdExceedsSignerCount(uint256 threshold, uint256 signerCount);

    /// @notice Reverts on a zero threshold — that would make an empty signature array a quorum.
    error ZeroThreshold();

    /// @notice Reverts on attempts to add the zero address.
    error ZeroSigner();

    /// @notice Reverts on attempts to add an already-authorized address.
    error SignerAlreadyExists(address signer);

    /// @notice Reverts on attempts to remove an address that is not in the set.
    error SignerNotFound(address signer);

    /// @dev Enumeration only. Membership is sourced from `_isSigner`.
    address[] private _signers;

    /// @dev O(1) membership oracle.
    mapping(address => bool) private _isSigner;

    /// @dev Index of each signer in `_signers`, stored as `index + 1` so that `0` means absent.
    mapping(address => uint256) private _indexOf;

    /// @dev Current verification threshold (the M in M-of-N).
    uint256 private _threshold;

    /// @notice Bootstrap the signer set.
    /// @dev    Pass empty `initialSigners` *and* a zero `initialThreshold` to deploy an empty
    ///         set the owner populates later. Otherwise `0 < threshold <= signers.length`.
    /// @param  initialOwner     Owner that may add/remove signers and change the threshold.
    /// @param  initialSigners   Signers to authorize at construction.
    /// @param  initialThreshold Initial verification threshold.
    constructor(address initialOwner, address[] memory initialSigners, uint256 initialThreshold) Ownable(initialOwner) {
        for (uint256 i = 0; i < initialSigners.length; ++i) {
            _addSigner(initialSigners[i]);
        }

        // Deliberate escape hatch: an entirely empty deployment is legal.
        if (initialThreshold == 0 && initialSigners.length == 0) {
            return;
        }

        if (initialThreshold == 0) revert ZeroThreshold();
        if (initialThreshold > initialSigners.length) {
            revert ThresholdExceedsSignerCount(initialThreshold, initialSigners.length);
        }

        _threshold = initialThreshold;
        emit ThresholdChanged(0, initialThreshold);
    }

    /// @inheritdoc ISignerSet
    function addSigner(address signer) external onlyOwner {
        _addSigner(signer);
    }

    /// @inheritdoc ISignerSet
    function removeSigner(address signer) external onlyOwner {
        if (!_isSigner[signer]) revert SignerNotFound(signer);

        uint256 indexPlusOne = _indexOf[signer];
        uint256 lastIdx = _signers.length - 1;
        uint256 removedIdx;
        unchecked {
            removedIdx = indexPlusOne - 1;
        }

        // Swap-and-pop. Only touch the moved element's index when it isn't the one leaving.
        if (removedIdx != lastIdx) {
            address moved = _signers[lastIdx];
            _signers[removedIdx] = moved;
            _indexOf[moved] = removedIdx + 1;
        }
        _signers.pop();

        delete _indexOf[signer];
        delete _isSigner[signer];

        // Refuse a removal that would strand the threshold above the set size — that state is
        // unsatisfiable, and every `submitValue` would revert until the owner noticed.
        if (_threshold > _signers.length) {
            revert ThresholdExceedsSignerCount(_threshold, _signers.length);
        }

        emit SignerRemoved(signer);
    }

    /// @inheritdoc ISignerSet
    function setThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0) revert ZeroThreshold();
        if (newThreshold > _signers.length) {
            revert ThresholdExceedsSignerCount(newThreshold, _signers.length);
        }
        uint256 old = _threshold;
        _threshold = newThreshold;
        emit ThresholdChanged(old, newThreshold);
    }

    /// @inheritdoc ISignerSet
    function getSigners() external view returns (address[] memory) {
        return _signers;
    }

    /// @inheritdoc ISignerSet
    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    /// @inheritdoc ISignerSet
    function isSigner(address account) external view returns (bool) {
        return _isSigner[account];
    }

    /// @dev Append `signer`. Reverts on the zero address or a duplicate. Emits `SignerAdded`.
    function _addSigner(address signer) private {
        if (signer == address(0)) revert ZeroSigner();
        if (_isSigner[signer]) revert SignerAlreadyExists(signer);

        _signers.push(signer);
        _isSigner[signer] = true;
        _indexOf[signer] = _signers.length;

        emit SignerAdded(signer);
    }
}
