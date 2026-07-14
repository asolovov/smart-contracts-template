// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SignatureLib} from "../libs/SignatureLib.sol";

/// @title  SignatureLibHarness
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Test-only. Re-exposes `SignatureLib`'s `internal` helpers as `external` entry
///         points so the TypeScript suite — especially the `fast-check` property runs —
///         can drive them directly instead of only through `ExampleVault`.
/// @dev    Everything under `src/test/` is excluded from Solhint (`.solhintignore`) and
///         Slither (`slither.config.json` `filter_paths`), and must never be deployed.
///         Keep it in `src/` anyway: Hardhat only compiles what's under `paths.sources`,
///         and a harness that isn't compiled from the same source tree as the library it
///         wraps can silently drift out of sync.
contract SignatureLibHarness {
    /// @notice Expose `SignatureLib.buildDigest`.
    function buildDigest(
        uint256 reqId,
        bytes32 topic,
        int256 value,
        uint256 observedAt,
        uint256 chainId,
        address vault
    ) external pure returns (bytes32 digest) {
        return SignatureLib.buildDigest(reqId, topic, value, observedAt, chainId, vault);
    }

    /// @notice Expose `SignatureLib.verifySignatures`.
    function verifySignatures(
        bytes32 digest,
        bytes[] calldata signatures,
        address[] memory authorizedSigners,
        uint256 threshold
    ) external pure returns (bool ok) {
        return SignatureLib.verifySignatures(digest, signatures, authorizedSigners, threshold);
    }

    /// @notice Expose `SignatureLib.scaleTo`.
    function scaleTo(int256 src, uint8 srcDecimals, uint8 dstDecimals) external pure returns (int256 out) {
        return SignatureLib.scaleTo(src, srcDecimals, dstDecimals);
    }
}
