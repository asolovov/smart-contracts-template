// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Slither entry point.
//
// Why this file exists: Slither's Hardhat backend cannot parse Hardhat v3's build-info
// format (`crytic-compile` 0.3.x dies with `KeyError: 'output'`), and pointing Slither at
// `src/` directly yields "no contracts analyzed" because a bare directory isn't a
// recognised project root. So we hand Slither one Solidity translation unit that imports
// everything we want analysed; together with `solc_remaps` in `slither.config.json` that
// gives a clean compile and full coverage.
//
// Hardhat never compiles this file (it's outside `paths.sources`). If you add a contract
// to `src/`, add it here too — otherwise it silently drops out of static analysis.

// solhint-disable-next-line no-unused-import
import {SignerSet} from "./src/core/SignerSet.sol";
// solhint-disable-next-line no-unused-import
import {ExampleRegistry} from "./src/core/ExampleRegistry.sol";
// solhint-disable-next-line no-unused-import
import {ExampleVault} from "./src/core/ExampleVault.sol";
// solhint-disable-next-line no-unused-import
import {SignatureLib} from "./src/libs/SignatureLib.sol";
// solhint-disable-next-line no-unused-import
import {ExampleConsumer} from "./src/consumers/ExampleConsumer.sol";
