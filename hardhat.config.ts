import { configVariable, type HardhatUserConfig } from "hardhat/config";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import "dotenv/config";

// Hardhat v3 rejects empty strings at config-validation time, so we fall back to a public Sepolia
// RPC when SEPOLIA_RPC_URL isn't set (e.g. in CI). The config then validates cleanly without a
// private endpoint, and ad-hoc developers get a working-but-rate-limited default. For real
// deploys, point SEPOLIA_RPC_URL at your own endpoint in `.env`.
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

// Secrets go through `configVariable`, NOT `process.env`, and the difference matters. A
// configuration variable is resolved lazily, at the moment it is used, through a hook chain: the
// keystore plugin answers first, and `process.env` is the fallback. So both of these work, and
// neither is read during `compile` or `test`:
//
//   .env             DEPLOYER_PRIVATE_KEY=0x...
//   keystore         npx hardhat keystore set DEPLOYER_PRIVATE_KEY
//
// Read `process.env.DEPLOYER_PRIVATE_KEY` here instead and the keystore silently does nothing —
// the plugin only ever supplies values to `configVariable`.
const DEPLOYER_PRIVATE_KEY = configVariable("DEPLOYER_PRIVATE_KEY");
const ETHERSCAN_API_KEY = configVariable("ETHERSCAN_API_KEY");

const config: HardhatUserConfig = {
  // Deploys are plain TypeScript under `script/deploy/` — the runbook is in `deployments/README.md`.
  // Add `@nomicfoundation/hardhat-ignition-viem` here if you want resumable, declarative
  // deployments instead.
  plugins: [hardhatViem, hardhatViemAssertions, hardhatNetworkHelpers, hardhatMocha, hardhatKeystore, hardhatVerify],
  solidity: {
    profiles: {
      default: {
        // Pinned, not floating. Every `.sol` file declares `pragma solidity 0.8.24;`
        // exactly, and `.solhint.json` enforces it. Bumping the compiler is a
        // deliberate, single-commit change across the repo.
        version: "0.8.24",
        settings: {
          optimizer: {enabled: true, runs: 200},
          evmVersion: "cancun",
        },
      },
    },
  },
  paths: {
    sources: "src",
    tests: "test",
    cache: "cache",
    artifacts: "artifacts",
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // Adding a chain? Two places, and the NAMES MUST MATCH: the key here, and the `name` of the
    // matching entry in `NETWORKS` in `config/deployment.ts`. `script/deploy/verifyAll.sh <name>`
    // uses the same string for both `--network` and `deployments/<name>/`.
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: SEPOLIA_RPC_URL,
      // Lazily resolved (keystore, then `.env`) — never read during `compile` or `test`, so CI
      // needs no secrets. Attempting a write with no key set fails with a clear message naming
      // the variable, rather than silently signing with nothing.
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
  },
  verify: {
    etherscan: {
      apiKey: ETHERSCAN_API_KEY,
    },
  },
};

export default config;
