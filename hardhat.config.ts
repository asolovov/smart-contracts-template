import type { HardhatUserConfig } from "hardhat/config";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import "dotenv/config";

// Hardhat v3 rejects empty strings at config-validation time, so we fall back to a
// public Sepolia RPC when SEPOLIA_RPC_URL isn't set (e.g. in CI). The config then
// validates cleanly without a private endpoint, and ad-hoc developers get a
// working-but-rate-limited default. For real deploys, point SEPOLIA_RPC_URL at your
// own endpoint in `.env`.
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

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
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: SEPOLIA_RPC_URL,
      // An empty `accounts` array is valid; the network is simply unusable for
      // writes until DEPLOYER_PRIVATE_KEY is set. Keeps `hardhat compile` working
      // in CI with no secrets.
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  verify: {
    etherscan: {
      apiKey: ETHERSCAN_API_KEY,
    },
  },
};

export default config;
