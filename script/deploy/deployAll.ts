// Deploy the full stack to a live network and record the result.
//
//   1. Ensure signer keypairs exist on disk (generated on first run).
//   2. Deploy SignerSet(owner = deployer, signers, threshold).
//   3. Deploy ExampleRegistry(owner = deployer).
//   4. Per topic in `config/topics.ts`: deploy ExampleVault, then registry.registerTopic(...).
//   5. Write deployments/<network>/addresses.json.
//   6. Copy the compiled ABIs to deployments/<network>/abis/.
//
// Run with:  npx hardhat run script/deploy/deployAll.ts --network sepolia
//
// Idempotency: there is none — a re-run deploys fresh contracts. That is a deliberate trade:
// a plain script is far easier to read and audit than a resumable one, and for a handful of
// contracts the cost of a re-run is trivial. If your deploy grows to dozens of contracts or
// you need resumability across a failed run, that is the point to adopt Hardhat Ignition.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import type { Hex } from "viem";

import { TOPICS } from "../../config/topics.js";
import { ensureSigners } from "./generateSigners.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ARTIFACTS_DIR = join(REPO_ROOT, "artifacts", "src");

/// Which network we are deploying to. Must match a key in `hardhat.config.ts#networks`.
const NETWORK = "sepolia";
const EXPECTED_CHAIN_ID = 11155111;

const THRESHOLD = 2n;
const REQUEST_FEE = 0n;

/// Refuse to deploy on fumes: a run that dies halfway leaves a half-wired system on-chain.
const MIN_DEPLOYER_BALANCE = 30_000_000_000_000_000n; // 0.03 ETH

interface VaultRecord {
  symbol: string;
  label: string;
  decimals: number;
  topicId: Hex;
  address: `0x${string}`;
}

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: `0x${string}`;
  signerSet: `0x${string}`;
  signerAddresses: `0x${string}`[];
  threshold: string;
  registry: `0x${string}`;
  vaults: VaultRecord[];
}

async function main(): Promise<void> {
  console.log(`=== smart-contracts-template :: deploy → ${NETWORK} ===`);

  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("missing DEPLOYER_PRIVATE_KEY (see .env.example)");

  const { addresses: signerAddresses } = ensureSigners();
  console.log("signers:", signerAddresses.join(", "));

  const conn = await network.create({ network: NETWORK, chainType: "l1" });
  const [deployer] = await conn.viem.getWalletClients();
  const pub = await conn.viem.getPublicClient();
  const deployerAddr = deployer.account!.address;

  // Guard against a mis-set RPC pointing at the wrong chain — the single most expensive
  // deploy mistake, and the cheapest one to prevent.
  const chainId = await pub.getChainId();
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`unexpected chainId ${chainId}; expected ${EXPECTED_CHAIN_ID} for ${NETWORK}`);
  }

  const balance = await pub.getBalance({ address: deployerAddr });
  console.log(`deployer: ${deployerAddr}`);
  console.log(`balance:  ${balance} wei`);
  if (balance < MIN_DEPLOYER_BALANCE) {
    throw new Error(`deployer balance below the ${MIN_DEPLOYER_BALANCE} wei floor; got ${balance}`);
  }

  console.log("\n--- 1/3 SignerSet ---");
  const signerSet = await conn.viem.deployContract("SignerSet", [deployerAddr, signerAddresses, THRESHOLD]);
  console.log(`  → ${signerSet.address}`);

  console.log("\n--- 2/3 ExampleRegistry ---");
  const registry = await conn.viem.deployContract("ExampleRegistry", [deployerAddr]);
  console.log(`  → ${registry.address}`);

  console.log(`\n--- 3/3 ExampleVault × ${TOPICS.length} ---`);
  const vaults: VaultRecord[] = [];
  for (const topic of TOPICS) {
    process.stdout.write(`  ${topic.symbol.padEnd(5)} `);
    const vault = await conn.viem.deployContract("ExampleVault", [
      deployerAddr,
      signerSet.address,
      topic.topicId,
      topic.decimals,
      REQUEST_FEE,
    ]);
    process.stdout.write(`deployed ${vault.address} ... `);

    const hash = await registry.write.registerTopic([topic.topicId, vault.address]);
    // Wait for the receipt before the next deploy. Without this, the local nonce tracker races
    // the pending register and the RPC rejects the follow-up with "replacement transaction
    // underpriced" — a confusing failure that looks like an RPC problem and is not.
    await pub.waitForTransactionReceipt({ hash });
    process.stdout.write("registered\n");

    vaults.push({
      symbol: topic.symbol,
      label: topic.label,
      decimals: topic.decimals,
      topicId: topic.topicId,
      address: vault.address,
    });
  }

  const record: DeploymentRecord = {
    network: NETWORK,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddr,
    signerSet: signerSet.address,
    signerAddresses,
    threshold: THRESHOLD.toString(),
    registry: registry.address,
    vaults,
  };

  writeArtifacts(record);

  console.log("\n=== summary ===");
  console.log(`signerSet: ${record.signerSet}`);
  console.log(`registry:  ${record.registry}`);
  for (const v of vaults) console.log(`  ${v.symbol.padEnd(5)} ${v.address}`);
  console.log(`\nartifacts written to deployments/${NETWORK}/`);
  console.log(`next: sh script/deploy/verifyAll.sh ${NETWORK}`);
}

/// Persist addresses + ABIs. These files are COMMITTED — they are how off-chain services and
/// the frontend learn where the contracts live, and how a future you reconstructs what shipped.
function writeArtifacts(record: DeploymentRecord): void {
  const outDir = join(REPO_ROOT, "deployments", record.network);
  const abiDir = join(outDir, "abis");
  mkdirSync(abiDir, { recursive: true });

  writeFileSync(join(outDir, "addresses.json"), JSON.stringify(record, null, 2) + "\n");

  const contracts: Array<[string, string]> = [
    ["SignerSet", "core"],
    ["ExampleRegistry", "core"],
    ["ExampleVault", "core"],
    ["ExampleConsumer", "consumers"],
  ];

  for (const [name, subdir] of contracts) {
    const artifactPath = join(ARTIFACTS_DIR, subdir, `${name}.sol`, `${name}.json`);
    if (!existsSync(artifactPath)) {
      console.warn(`[abi] missing ${artifactPath} — run \`npx hardhat compile\` first; skipping`);
      continue;
    }
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { abi: unknown };
    writeFileSync(join(abiDir, `${name}.json`), JSON.stringify({ abi: artifact.abi }, null, 2) + "\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
