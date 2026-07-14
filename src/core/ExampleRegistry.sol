// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IExampleRegistry} from "../interfaces/IExampleRegistry.sol";

/// @title  ExampleRegistry
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Owner-managed directory of `topic → ExampleVault`. The one address downstream
///         consumers hard-code; everything else is resolved through it.
/// @dev    `registerTopic` deliberately accepts overwrites — repointing a topic at a
///         freshly deployed vault is how you ship a fix without a proxy. The two distinct
///         events (`TopicRegistered` vs `TopicUpdated`) let indexers tell a first-time
///         registration apart from a migration, which matters when consumers cache.
contract ExampleRegistry is IExampleRegistry, Ownable2Step {
    /// @notice Reverts on a zero `topic` — `0x0` is reserved as the "unregistered" sentinel.
    error ZeroTopic();

    /// @notice Reverts on attempts to point a topic at the zero address.
    error ZeroVault();

    /// @dev topic → vault. `address(0)` means unregistered.
    mapping(bytes32 => address) private _vaults;

    /// @dev Registration-ordered list of known topics. Append-only; a topic appears exactly once
    ///      even if its vault is later repointed.
    bytes32[] private _topics;

    /// @notice Deploy the registry under `initialOwner`.
    /// @param  initialOwner Account allowed to register and repoint topics.
    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @inheritdoc IExampleRegistry
    function registerTopic(bytes32 topic, address vault) external onlyOwner {
        if (topic == bytes32(0)) revert ZeroTopic();
        if (vault == address(0)) revert ZeroVault();

        address old = _vaults[topic];
        _vaults[topic] = vault;

        if (old == address(0)) {
            _topics.push(topic);
            emit TopicRegistered(topic, vault);
        } else {
            emit TopicUpdated(topic, old, vault);
        }
    }

    /// @inheritdoc IExampleRegistry
    function getVault(bytes32 topic) external view returns (address) {
        return _vaults[topic];
    }

    /// @inheritdoc IExampleRegistry
    function listTopics() external view returns (bytes32[] memory) {
        return _topics;
    }
}
