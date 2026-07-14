// Post-deploy smoke test: prove the LIVE deployment actually works, end to end.
//
//   npx hardhat run script/deploy/smokeTest.ts --network sepolia
//
// A green CI run tells you the code is correct. It tells you nothing about whether the thing
// you just deployed is wired correctly, owned by the right account, or reachable through the
// registry. That is what this script is for — run it immediately after every deploy, before
// you tell anyone the deployment is done.
//
// It walks the same path a real integration does:
//   1. Resolve every topic through the registry.
//   2. Check the vault's on-chain config matches `config/topics.ts`.
//   3. Send a real `requestUpdate` transaction and confirm the reqId comes back.
//   4. Sign an attestation with the local signer keys and land a real `submitValue`.
//   5. Read the recorded value back out.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { TOPICS } from "../../config/topics.js";
import { ensureSigners } from "./generateSigners.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const NETWORK = "sepolia";

const DOMAIN_NAME = "EXAMPLE_TEMPLATE";
const DOMAIN_VERSION = "1";
const ATTESTATION_TYPES = {
  Attestation: [
    { name: "reqId", type: "uint256" },
    { name: "topic", type: "bytes32" },
    { name: "value", type: "int256" },
    { name: "observedAt", type: "uint256" },
  ],
} as const;

interface Deployment {
  chainId: number;
  registry: `0x${string}`;
  signerSet: `0x${string}`;
  threshold: string;
  vaults: Array<{ symbol: string; topicId: Hex; address: `0x${string}`; decimals: number }>;
}

async function main(): Promise<void> {
  const deployment = JSON.parse(
    readFileSync(join(REPO_ROOT, "deployments", NETWORK, "addresses.json"), "utf8"),
  ) as Deployment;

  const conn = await network.create({ network: NETWORK, chainType: "l1" });
  const pub = await conn.viem.getPublicClient();
  const registry = await conn.viem.getContractAt("ExampleRegistry", deployment.registry);

  console.log(`=== smoke test :: ${NETWORK} (chainId ${deployment.chainId}) ===\n`);

  // 1 + 2 — every topic resolves, and the vault behind it is configured as we intended.
  console.log("--- registry resolution ---");
  const onChainTopics = await registry.read.listTopics();
  if (onChainTopics.length !== TOPICS.length) {
    throw new Error(`registry lists ${onChainTopics.length} topics; config declares ${TOPICS.length}`);
  }

  for (const expected of TOPICS) {
    const vaultAddr = await registry.read.getVault([expected.topicId]);
    if (vaultAddr === "0x0000000000000000000000000000000000000000") {
      throw new Error(`topic ${expected.label} is not registered`);
    }
    const vault = await conn.viem.getContractAt("ExampleVault", vaultAddr);
    const decimals = await vault.read.decimals();
    if (decimals !== expected.decimals) {
      throw new Error(`${expected.label}: on-chain decimals ${decimals} != config ${expected.decimals}`);
    }
    console.log(`  ${expected.symbol.padEnd(5)} → ${vaultAddr} (decimals ${decimals}) ok`);
  }

  // 3 — a real paid request against the first topic.
  const target = TOPICS[0];
  const vaultAddr = (await registry.read.getVault([target.topicId])) as `0x${string}`;
  const vault = await conn.viem.getContractAt("ExampleVault", vaultAddr);

  console.log(`\n--- requestUpdate on ${target.label} ---`);
  const fee = await vault.read.requestFee();
  const reqHash = await vault.write.requestUpdate({ value: fee });
  await pub.waitForTransactionReceipt({ hash: reqHash });
  const reqId = await vault.read.nextReqId();
  console.log(`  reqId ${reqId} (tx ${reqHash})`);

  // 4 — sign with the local keys and land a real submission.
  console.log("\n--- submitValue (quorum of local signers) ---");
  const { privateKeys } = ensureSigners();
  const threshold = Number(deployment.threshold);
  const observedAt = BigInt(Math.floor(Date.now() / 1000));
  const value = 1234_00000000n;

  const domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: deployment.chainId,
    verifyingContract: vaultAddr,
  } as const;
  const message = { reqId, topic: target.topicId, value, observedAt };

  const signatures = await Promise.all(
    privateKeys.slice(0, threshold).map((pk) =>
      privateKeyToAccount(pk).signTypedData({
        domain,
        types: ATTESTATION_TYPES,
        primaryType: "Attestation",
        message,
      }),
    ),
  );

  const subHash = await vault.write.submitValue([reqId, value, observedAt, signatures]);
  await pub.waitForTransactionReceipt({ hash: subHash });
  console.log(`  submitted (tx ${subHash})`);

  // 5 — read it back. If this matches, the whole chain of trust works on the live network.
  const [recordId, record] = await vault.read.latestRecord();
  if (record.value !== value) {
    throw new Error(`read-back mismatch: expected ${value}, got ${record.value}`);
  }
  console.log(`  record #${recordId}: value=${record.value} observedAt=${record.observedAt}`);

  console.log("\n=== smoke test PASSED ===");
}

main().catch((err) => {
  console.error("\n=== smoke test FAILED ===");
  console.error(err);
  process.exit(1);
});
