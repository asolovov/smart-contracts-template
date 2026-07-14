// Generate the off-chain signer keypairs the deployment authorizes.
//
// Keys are written to `.signers/` (gitignored) and NEVER enter the repo. This script exists so
// a testnet deploy is reproducible without anyone pasting a private key into a terminal.
//
// PRODUCTION: do not use this. Real signers are independent operators who generate their own
// keys in their own HSM / KMS / Vault and hand you only the ADDRESS. The whole security value
// of M-of-N is that no single party — including you — ever holds a quorum. A script that mints
// every key on one laptop has an N-of-N failure mode wearing an M-of-N costume.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SIGNERS_DIR = join(REPO_ROOT, ".signers");

export const SIGNER_COUNT = 3;

export interface SignerFile {
  address: `0x${string}`;
  privateKey: Hex;
}

export interface Signers {
  addresses: `0x${string}`[];
  privateKeys: Hex[];
}

/// Load the signer keys from `.signers/`, generating them on first run. Idempotent: an existing
/// key file is never overwritten, so re-running a deploy does not silently rotate the set.
export function ensureSigners(count = SIGNER_COUNT): Signers {
  mkdirSync(SIGNERS_DIR, { recursive: true });

  const addresses: `0x${string}`[] = [];
  const privateKeys: Hex[] = [];

  for (let i = 1; i <= count; i++) {
    const path = join(SIGNERS_DIR, `signer${i}.json`);

    if (existsSync(path)) {
      const existing = JSON.parse(readFileSync(path, "utf8")) as SignerFile;
      addresses.push(existing.address);
      privateKeys.push(existing.privateKey);
      continue;
    }

    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const record: SignerFile = { address: account.address, privateKey };
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });

    addresses.push(record.address);
    privateKeys.push(record.privateKey);
    console.log(`[signers] generated ${path} → ${record.address}`);
  }

  return { addresses, privateKeys };
}

// Allow `npx hardhat run script/deploy/generateSigners.ts` as a standalone step.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { addresses } = ensureSigners();
  console.log("signers:");
  for (const a of addresses) console.log(`  ${a}`);
}
