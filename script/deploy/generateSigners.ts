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
import { fileURLToPath, pathToFileURL } from "node:url";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { SIGNER_COUNT } from "../../config/deployment.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SIGNERS_DIR = join(REPO_ROOT, ".signers");

export interface SignerFile {
  address: `0x${string}`;
  privateKey: Hex;
}

export interface Signers {
  addresses: `0x${string}`[];
  privateKeys: Hex[];
}

/// Load the signer keys from `.signers/`, generating any that are missing. Idempotent: an existing
/// key file is never overwritten, so re-running a deploy does not silently rotate the set.
///
/// ONLY the deploy script should call this. Anything that signs against an *existing* deployment
/// must call `loadSigners()` instead — see the warning there.
export function ensureSigners(count = SIGNER_COUNT): Signers {
  // 0700, not the default 0755: the directory holds private keys.
  mkdirSync(SIGNERS_DIR, { recursive: true, mode: 0o700 });

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

/// Load the signer keys from `.signers/`, failing loudly if they are not all there.
///
/// This exists because `ensureSigners()` *generates* what is missing, and `.signers/` is
/// gitignored — so on a fresh clone, a CI runner, or a teammate's laptop it does not exist. Any
/// script that signs against an ALREADY-DEPLOYED system must therefore never call `ensureSigners`:
/// it would mint a brand-new key set, sign with keys the deployed `SignerSet` has never heard of,
/// and fail on-chain with an opaque `InsufficientSignatures` — after the gas has been spent.
///
/// Missing keys are not a thing to paper over. If you deployed from another machine, the keys you
/// need are on that machine.
export function loadSigners(count = SIGNER_COUNT): Signers {
  const addresses: `0x${string}`[] = [];
  const privateKeys: Hex[] = [];

  for (let i = 1; i <= count; i++) {
    const path = join(SIGNERS_DIR, `signer${i}.json`);
    if (!existsSync(path)) {
      throw new Error(
        `missing ${path}. The signer keys used at deploy time are not on this machine — ` +
          `.signers/ is gitignored by design. Copy them across; do NOT regenerate, or your ` +
          `signatures will not match the deployed SignerSet.`,
      );
    }
    const existing = JSON.parse(readFileSync(path, "utf8")) as SignerFile;
    addresses.push(existing.address);
    privateKeys.push(existing.privateKey);
  }

  return { addresses, privateKeys };
}

// Run standalone with:  npx tsx script/deploy/generateSigners.ts
//
// Note this deliberately does NOT use `npx hardhat run`: that task imports the script from
// within the Hardhat CLI process, so `process.argv[1]` stays the CLI's own path and this guard
// would never fire. `pathToFileURL` (rather than string-concatenating "file://") is what makes
// the comparison correct on paths containing spaces.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { addresses } = ensureSigners();
  console.log("signers:");
  for (const a of addresses) console.log(`  ${a}`);
}
