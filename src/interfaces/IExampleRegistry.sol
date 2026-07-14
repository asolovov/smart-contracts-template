// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  IExampleRegistry
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Directory mapping a canonical `topic` (e.g. `keccak256("ETH/USD")`) to the
///         `ExampleVault` deployed for it. One well-known address that downstream
///         consumers and off-chain services resolve everything else through.
/// @dev    Template note: a registry like this is what keeps deploys upgradeable without
///         proxies — repoint a topic at a fresh vault and consumers follow, as long as
///         they resolve through the registry rather than hard-coding vault addresses.
interface IExampleRegistry {
    /// @notice Emitted the first time a `topic` is registered.
    /// @param topic Canonical topic identifier.
    /// @param vault Vault handling this topic.
    event TopicRegistered(bytes32 indexed topic, address indexed vault);

    /// @notice Emitted when an already-registered `topic` is repointed at a new vault.
    /// @param topic    Canonical topic identifier.
    /// @param oldVault Previous vault address.
    /// @param newVault New vault address.
    event TopicUpdated(bytes32 indexed topic, address indexed oldVault, address indexed newVault);

    /// @notice Register `topic`, or repoint it at a new vault. Owner-only.
    /// @param topic Canonical topic identifier. Must be non-zero.
    /// @param vault Vault address. Must be non-zero.
    function registerTopic(bytes32 topic, address vault) external;

    /// @notice Look up the vault for `topic`.
    /// @param topic Canonical topic identifier.
    /// @return Vault address, or `address(0)` if unregistered.
    function getVault(bytes32 topic) external view returns (address);

    /// @notice List every registered topic, in registration order.
    function listTopics() external view returns (bytes32[] memory);
}
