// Deploy the full stack to a live network and record the result.
//
//   npx hardhat run script/deploy/deployAll.ts --network sepolia
//
// The `--network` flag is real: it sets Hardhat's default network, and `network.create()` below
// picks it up. To deploy somewhere else, add the chain to `networks` in `hardhat.config.ts` and
// to `NETWORKS` in `config/deployment.ts`. You do not edit this script.
//
//   1. Ensure signer keypairs exist on disk (generated on first run).
//   2. Deploy SignerSet(owner = deployer, signers, THRESHOLD).
//   3. Deploy ExampleRegistry(owner = deployer).
//   4. Per topic in `config/topics.ts`: deploy ExampleVault, then registry.registerTopic(...).
//   5. Write deployments/<network>/addresses.json — including every parameter used, so that
//      verifyAll.sh can reconstruct the constructor args instead of re-declaring them.
//   6. Copy the compiled ABIs to deployments/<network>/abis/.
//
// Idempotency: there is none — a re-run deploys fresh contracts. That is a deliberate trade: a
// plain script is far easier to read and audit than a resumable one, and for a handful of
// contracts a re-run costs little. If your deploy grows to dozens of contracts, that is the point
// to adopt Hardhat Ignition.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import type { Hex } from "viem";

import { MIN_DEPLOYER_BALANCE, networkInfo, REQUEST_FEE, THRESHOLD } from "../../config/deployment.js";
import { TOPICS } from "../../config/topics.js";
import { ensureSigners } from "./generateSigners.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ARTIFACTS_DIR = join(REPO_ROOT, "artifacts", "src");

interface VaultRecord {
  symbol: string;
  label: string;
  decimals: number;
  topicId: Hex;
  address: `0x${string}`;
}

/// The shape of `deployments/<network>/addresses.json`. It records not just *what* was deployed
/// but *with which parameters* — `verifyAll.sh` reads `threshold` and `requestFee` straight back
/// out of here to rebuild the constructor args.
interface DeploymentRecord {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: `0x${string}`;
  signerSet: `0x${string}`;
  signerAddresses: `0x${string}`[];
  threshold: string;
  requestFee: string;
  registry: `0x${string}`;
  vaults: VaultRecord[];
}

async function main(): Promise<void> {
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("missing DEPLOYER_PRIVATE_KEY (see .env.example)");

  // No `network:` key — that is what makes `--network` meaningful. Passing one here would
  // override the flag and silently deploy to the wrong chain.
  const conn = await network.create({ chainType: "l1" });
  const [deployer] = await conn.viem.getWalletClients();
  const pub = await conn.viem.getPublicClient();
  const deployerAddr = deployer.account.address;

  // Ask the chain who it is, rather than trusting the flag. An RPC URL pointing at a different
  // chain than you think it does is the most expensive deploy mistake there is, and the cheapest
  // to prevent.
  const chainId = await pub.getChainId();
  const net = networkInfo(chainId);

  console.log(`=== deploy → ${net.name} (chain id ${chainId}) ===`);

  const { addresses: signerAddresses } = ensureSigners();
  console.log("signers:", signerAddresses.join(", "));

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
    network: net.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddr,
    signerSet: signerSet.address,
    signerAddresses,
    threshold: THRESHOLD.toString(),
    requestFee: REQUEST_FEE.toString(),
    registry: registry.address,
    vaults,
  };

  writeArtifacts(record);

  console.log("\n=== summary ===");
  console.log(`signerSet: ${net.explorer}/address/${record.signerSet}`);
  console.log(`registry:  ${net.explorer}/address/${record.registry}`);
  for (const v of vaults) console.log(`  ${v.symbol.padEnd(5)} ${v.address}`);
  console.log(`\nartifacts written to deployments/${net.name}/`);
  console.log(`next:  sh script/deploy/verifyAll.sh ${net.name}`);
  console.log(`then:  npx hardhat run script/deploy/smokeTest.ts --network <your-network-flag>`);
}

/// Persist addresses + ABIs. These files are COMMITTED — they are how off-chain services and
/// frontends learn where the contracts live, and how a future you reconstructs what shipped.
function writeArtifacts(record: DeploymentRecord): void {
  const outDir = join(REPO_ROOT, "deployments", record.network);
  const abiDir = join(outDir, "abis");
  mkdirSync(abiDir, { recursive: true });

  writeFileSync(join(outDir, "addresses.json"), JSON.stringify(record, null, 2) + "\n");

  // `ExampleConsumer` is not deployed by this script — it is a reference integration. Its ABI is
  // published anyway because integrators building their own consumer want it.
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
