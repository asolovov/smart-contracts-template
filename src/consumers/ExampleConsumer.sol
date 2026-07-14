// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IExampleRegistry} from "../interfaces/IExampleRegistry.sol";
import {IExampleVault} from "../interfaces/IExampleVault.sol";

/// @title  ExampleConsumer
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Reference integration: how a third-party contract reads from and requests
///         updates against the system, resolving the vault through the registry rather
///         than hard-coding its address.
/// @dev    Deliberately thin. A real consumer adds its own access control, validates the
///         freshness of what it reads (`recordedAt`), and does something with the value
///         beyond returning it. The point of this file is the *resolution* pattern:
///         hold the registry, look the vault up by topic, and you survive a vault
///         migration for free.
contract ExampleConsumer {
    /// @notice Reverts when the topic is not registered in the registry.
    error TopicNotRegistered(bytes32 topic);

    /// @notice Reverts when the refund relayed back by the vault cannot be forwarded on.
    error RefundForwardFailed();

    /// @notice Reverts on attempts to construct against the zero registry.
    error ZeroRegistry();

    /// @notice Registry this consumer resolves vaults through.
    IExampleRegistry public immutable registry;

    /// @notice Most recent `reqId` this consumer received from a vault.
    uint256 public lastReqId;

    /// @notice Wire the consumer to a registry. Vaults are resolved through it, never hard-coded.
    /// @param  registry_ Registry to resolve topics against. Must be non-zero.
    constructor(IExampleRegistry registry_) {
        if (address(registry_) == address(0)) revert ZeroRegistry();
        registry = registry_;
    }

    /// @notice Pay for and enqueue an update on the vault registered for `topic`.
    /// @dev    Any refund the vault returns (over-payment above its fee) is relayed on to the
    ///         original caller. The `lastReqId` write happens after the external call — safe
    ///         because the vault is `nonReentrant` and never reads this field, but it is
    ///         exactly the kind of ordering to justify in a comment rather than leave implicit.
    /// @param  topic Topic to request an update for.
    /// @return reqId The request id assigned by the vault.
    function requestUpdate(bytes32 topic) external payable returns (uint256 reqId) {
        IExampleVault vault = _resolve(topic);

        uint256 balanceBefore = address(this).balance - msg.value;
        reqId = vault.requestUpdate{value: msg.value}();
        // slither-disable-next-line reentrancy-benign
        lastReqId = reqId;

        uint256 refund = address(this).balance - balanceBefore;
        if (refund > 0) {
            // slither-disable-next-line low-level-calls
            (bool ok, ) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundForwardFailed();
        }
    }

    /// @notice Read the latest attested value for `topic`.
    /// @dev    Reverts (via the vault's `NoRecord`) when nothing has been recorded yet — a
    ///         production consumer decides for itself whether that is fatal or a fallback path.
    /// @param  topic Topic to read.
    /// @return value      Latest attested value, scaled to the vault's `decimals()`.
    /// @return recordedAt `block.timestamp` at which it was recorded — check this against your
    ///                    own staleness tolerance before trusting `value`.
    function latestValue(bytes32 topic) external view returns (int256 value, uint256 recordedAt) {
        IExampleVault vault = _resolve(topic);
        // slither-disable-next-line unused-return
        (, IExampleVault.Record memory record) = vault.latestRecord();
        return (record.value, record.recordedAt);
    }

    /// @notice Accept refunds relayed back from the vault.
    receive() external payable {}

    /// @dev Resolve `topic` to its vault, reverting if unregistered.
    function _resolve(bytes32 topic) private view returns (IExampleVault) {
        address vault = registry.getVault(topic);
        if (vault == address(0)) revert TopicNotRegistered(topic);
        return IExampleVault(vault);
    }
}
