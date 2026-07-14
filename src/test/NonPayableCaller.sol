// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ExampleConsumer} from "../consumers/ExampleConsumer.sol";
import {IExampleVault} from "../interfaces/IExampleVault.sol";

/// @title  NonPayableCaller
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Test-only. Over-pays into the system but implements no `receive()`, so every refund
///         sent back to it fails. That is the only way to reach `ExampleVault.RefundFailed`,
///         `ExampleVault.WithdrawFailed`, and `ExampleConsumer.RefundForwardFailed`.
/// @dev    Failure paths that need a *contract* to misbehave cannot be reached from an EOA. Ship
///         a small hostile contract like this one rather than leaving the branch uncovered — an
///         untested revert path is an untested revert path.
contract NonPayableCaller {
    /// @notice Over-fund the vault directly; its refund to this contract must fail.
    function callRequestUpdate(IExampleVault vault) external payable returns (uint256 reqId) {
        return vault.requestUpdate{value: msg.value}();
    }

    /// @notice Over-fund the vault *through the consumer*; the consumer's refund relay must fail.
    /// @dev    The consumer's error surfaces only if we bubble the revert data back up verbatim.
    ///         A bare `require(ok)` here would swallow `RefundForwardFailed` and the test could
    ///         only assert "it reverted", which is a much weaker claim.
    function callConsumerRequestUpdate(ExampleConsumer consumer, bytes32 topic) external payable {
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, bytes memory data) = address(consumer).call{value: msg.value}(
            abi.encodeCall(ExampleConsumer.requestUpdate, (topic))
        );
        if (!ok) {
            assembly {
                revert(add(data, 0x20), mload(data))
            }
        }
    }
}
