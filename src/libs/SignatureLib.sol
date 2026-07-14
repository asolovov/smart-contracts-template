// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title  SignatureLib
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Stateless helpers for off-chain attestation: EIP-712 digest construction,
///         M-of-N signature verification, and integer decimals rescaling.
///
/// @dev    Design rules worth carrying into any fork of this template:
///
///         1. **`abi.encode`, never `abi.encodePacked`, for struct and domain hashes.**
///            `encodePacked` does not delimit dynamic types, so `("a", "bc")` and
///            `("ab", "c")` hash identically. The only `encodePacked`-style concatenation
///            here is the final `\x19\x01` prefix (done inside OZ's `toTypedDataHash`),
///            which packs fixed-size 32-byte words only.
///
///         2. **The digest binds `chainId` and `verifyingContract`.** Without both, a
///            signature harvested on one chain (or one vault) replays against another.
///
///         3. **Deduplicate recovered signers.** Otherwise one signer submitting the same
///            signature `threshold` times trivially satisfies an M-of-N check.
///
///         4. **Recovery failure is skipped, not fatal.** A malformed signature in the
///            array must not brick an otherwise-valid quorum; it just doesn't count.
library SignatureLib {
    /// @notice EIP-712 domain name. **Rename this when you fork the template** — the domain
    ///         is what scopes signatures to your protocol, and two protocols sharing a name
    ///         and version share a signature namespace.
    string internal constant DOMAIN_NAME = "EXAMPLE_TEMPLATE";

    /// @notice EIP-712 domain version. Bump on any breaking change to the signed struct.
    string internal constant DOMAIN_VERSION = "1";

    /// @dev keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    /// @dev keccak256("Attestation(uint256 reqId,bytes32 topic,int256 value,uint256 observedAt)")
    bytes32 internal constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(uint256 reqId,bytes32 topic,int256 value,uint256 observedAt)"
    );

    /// @notice Build the EIP-712 digest that signers sign for an attestation.
    /// @param  reqId      Request being attested. `0` indicates a heartbeat push.
    /// @param  topic      Canonical topic identifier (e.g. `keccak256("ETH/USD")`).
    /// @param  value      Attested value, scaled to the vault's decimals.
    /// @param  observedAt Signer-attested observation time.
    /// @param  chainId    Target chain id — cross-chain replay protection.
    /// @param  vault      Vault that will receive the submission — cross-contract replay protection.
    /// @return digest     32-byte EIP-712 digest.
    function buildDigest(
        uint256 reqId,
        bytes32 topic,
        int256 value,
        uint256 observedAt,
        uint256 chainId,
        address vault
    ) internal pure returns (bytes32 digest) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(DOMAIN_NAME)), keccak256(bytes(DOMAIN_VERSION)), chainId, vault)
        );
        bytes32 structHash = keccak256(abi.encode(ATTESTATION_TYPEHASH, reqId, topic, value, observedAt));
        digest = MessageHashUtils.toTypedDataHash(domainSeparator, structHash);
    }

    /// @notice Verify that at least `threshold` *distinct authorized* signers signed `digest`.
    /// @dev    Per signature: recover the address, skip on recovery error, skip if not in
    ///         `authorizedSigners`, skip if already counted. Short-circuits as soon as the
    ///         quorum is met. Worst case is O(sigs × (signers + sigs)) — deliberate, and fine
    ///         because real signer sets are small (< 10). If yours is not, replace the linear
    ///         scans with a bitmap over signer indices.
    /// @param  digest            Digest produced by `buildDigest`.
    /// @param  signatures        65-byte ECDSA signatures. Order-independent.
    /// @param  authorizedSigners Snapshot of the authorized signer set.
    /// @param  threshold         Minimum count of distinct authorized signers required.
    /// @return ok                `true` iff the quorum is met.
    function verifySignatures(
        bytes32 digest,
        bytes[] calldata signatures,
        address[] memory authorizedSigners,
        uint256 threshold
    ) internal pure returns (bool ok) {
        // A zero threshold would let an empty signature array pass. Never auto-approve.
        if (threshold == 0 || signatures.length < threshold) {
            return false;
        }

        address[] memory counted = new address[](signatures.length);
        uint256 countedLen = 0;
        uint256 validCount = 0;

        for (uint256 i = 0; i < signatures.length; ++i) {
            /// @dev `tryRecover`'s third tuple member carries the offending signature data for
            ///      `InvalidSignatureS` errors; we only need the error discriminant.
            // slither-disable-next-line unused-return
            (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signatures[i]);
            if (err != ECDSA.RecoverError.NoError || signer == address(0)) {
                continue;
            }
            if (!_contains(authorizedSigners, signer)) {
                continue;
            }
            if (_contains(counted, countedLen, signer)) {
                continue;
            }

            counted[countedLen] = signer;
            unchecked {
                ++countedLen;
                ++validCount;
            }
            if (validCount >= threshold) {
                return true;
            }
        }

        return false;
    }

    /// @notice Rescale `src` from `srcDecimals` to `dstDecimals`.
    /// @dev    Scaling up multiplies by `10 ** (dst - src)`; scaling down divides. The
    ///         `10 ** diff` magnitude goes through `SafeCast.toInt256`, which reverts when it
    ///         exceeds `int256.max` — without that cast, `diff == 77` wraps to a *negative*
    ///         factor and silently flips the sign of the result. Multiplication overflow is
    ///         caught by the standard 0.8 checked path. Division truncates toward zero.
    /// @param  src         Source value.
    /// @param  srcDecimals Decimals `src` is expressed in.
    /// @param  dstDecimals Decimals the result should be expressed in.
    /// @return out         Rescaled value.
    function scaleTo(int256 src, uint8 srcDecimals, uint8 dstDecimals) internal pure returns (int256 out) {
        if (srcDecimals == dstDecimals) {
            return src;
        }
        if (srcDecimals < dstDecimals) {
            uint256 diff;
            unchecked {
                diff = uint256(dstDecimals - srcDecimals);
            }
            int256 factor = SafeCast.toInt256(10 ** diff);
            return src * factor;
        }
        uint256 diffDown;
        unchecked {
            diffDown = uint256(srcDecimals - dstDecimals);
        }
        int256 divisor = SafeCast.toInt256(10 ** diffDown);
        return src / divisor;
    }

    /// @dev Linear search over all of `arr`.
    function _contains(address[] memory arr, address target) private pure returns (bool) {
        for (uint256 i = 0; i < arr.length; ++i) {
            if (arr[i] == target) return true;
        }
        return false;
    }

    /// @dev Linear search over the first `len` entries of `arr`.
    function _contains(address[] memory arr, uint256 len, address target) private pure returns (bool) {
        for (uint256 i = 0; i < len; ++i) {
            if (arr[i] == target) return true;
        }
        return false;
    }
}
