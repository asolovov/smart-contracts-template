// Post-deploy smoke test: prove the LIVE deployment actually works, end to end.
//
//   npx hardhat run script/deploy/smokeTest.ts --network sepolia
//
// A green CI run tells you the code is correct. It tells you nothing about whether the thing you
// just deployed is wired correctly, owned by the right account, or reachable through the registry.
// That is what this script is for — run it immediately after every deploy, before you tell anyone
// the deployment is done.
//
// It walks the path a real integration walks:
//   1. Resolve every topic through the registry.
//   2. Check each vault's on-chain config matches `config/topics.ts`.
//   3. Send a real `requestUpdate` and take the assigned id from the receipt.
//   4. Sign an attestation with the local signer keys and land a real `submitValue`.
//   5. Read the value back out.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import { decodeEventLog, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Abi, Log } from "viem";

import { networkInfo } from "../../config/deployment.js";
// The domain is defined once, in config/eip712.ts, and shared with the test helpers. Redeclaring
// it here is how a fork ends up with a smoke test that signs under the OLD domain name and fails
// on-chain with an opaque `InsufficientSignatures` after the gas has been spent.
import { ATTESTATION_TYPES, eip712Domain } from "../../config/eip712.js";
import { TOPICS } from "../../config/topics.js";
import { ensureSigners } from "./generateSigners.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

interface Deployment {
  network: string;
  chainId: number;
  registry: `0x${string}`;
  threshold: string;
}

async function main(): Promise<void> {
  const conn = await network.create({ chainType: "l1" });
  const pub = await conn.viem.getPublicClient();
  const chainId = await pub.getChainId();
  const net = networkInfo(chainId);

  const deployment = JSON.parse(
    readFileSync(join(REPO_ROOT, "deployments", net.name, "addresses.json"), "utf8"),
  ) as Deployment;

  // Guard against smoke-testing one network's deployment against another's RPC.
  if (deployment.chainId !== chainId) {
    throw new Error(
      `deployments/${net.name} was deployed to chain ${deployment.chainId}, but the RPC is on ${chainId}`,
    );
  }

  console.log(`=== smoke test :: ${net.name} (chain id ${chainId}) ===\n`);

  const registry = await conn.viem.getContractAt("ExampleRegistry", deployment.registry);

  // 1 + 2 — every topic resolves, and the vault behind it is configured as intended.
  console.log("--- registry resolution ---");
  const onChainTopics = await registry.read.listTopics();
  if (onChainTopics.length !== TOPICS.length) {
    throw new Error(`registry lists ${onChainTopics.length} topics; config declares ${TOPICS.length}`);
  }

  for (const expected of TOPICS) {
    const vaultAddr = await registry.read.getVault([expected.topicId]);
    if (vaultAddr === zeroAddress) {
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
  const vaultAddr = await registry.read.getVault([target.topicId]);
  const vault = await conn.viem.getContractAt("ExampleVault", vaultAddr);

  console.log(`\n--- requestUpdate on ${target.label} ---`);
  const fee = await vault.read.requestFee();
  const reqHash = await vault.write.requestUpdate({ value: fee });
  const receipt = await pub.waitForTransactionReceipt({ hash: reqHash });

  // Take the id from OUR transaction's own event, not from a follow-up `lastReqId()` read. On a
  // public testnet somebody else's request can land between the two, and we would then sign an
  // attestation for a request that is not ours.
  const reqId = reqIdFromReceipt(receipt.logs, vault.abi, vaultAddr);
  console.log(`  reqId ${reqId} (tx ${reqHash})`);

  // 4 — sign with the local keys and land a real submission.
  console.log("\n--- submitValue (quorum of local signers) ---");
  const { privateKeys } = ensureSigners();
  const threshold = Number(deployment.threshold);
  const observedAt = BigInt(Math.floor(Date.now() / 1000));
  const value = 1234_00000000n;

  const domain = eip712Domain({ chainId: BigInt(chainId), verifyingContract: vaultAddr });
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
  console.log(`\n  ${net.explorer}/address/${vaultAddr}`);

  console.log("\n=== smoke test PASSED ===");
}

/// Pull the `reqId` out of the `UpdateRequested` event emitted by our own `requestUpdate` tx.
function reqIdFromReceipt(logs: readonly Log[], abi: Abi, vault: `0x${string}`): bigint {
  for (const log of logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "UpdateRequested") {
        return (decoded.args as unknown as { reqId: bigint }).reqId;
      }
    } catch {
      // A log from this address that isn't one of our events — skip it rather than fail.
    }
  }
  throw new Error("requestUpdate tx emitted no UpdateRequested event");
}

main().catch((err) => {
  console.error("\n=== smoke test FAILED ===");
  console.error(err);
  process.exit(1);
});
