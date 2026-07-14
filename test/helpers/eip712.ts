// Signing helpers for the tests.
//
// The domain itself lives in `config/eip712.ts` — the single TypeScript definition, shared with
// the smoke test and with any off-chain service you write. This file only wraps it in the
// ergonomics a test wants.

import { hashTypedData, type Hex } from "viem";

import { ATTESTATION_TYPES, eip712Domain, type AttestationMessage, type DomainParams } from "../../config/eip712.js";
import type { HardhatWalletClient } from "./fixtures.js";

export { DOMAIN_NAME, DOMAIN_VERSION, ATTESTATION_TYPES } from "../../config/eip712.js";
export type { AttestationMessage, DomainParams } from "../../config/eip712.js";

/// Compute the digest off-chain, exactly as `SignatureLib.buildDigest` does on-chain.
export function buildDigest(domain: DomainParams, message: AttestationMessage): Hex {
  return hashTypedData({
    domain: eip712Domain(domain),
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message,
  });
}

/// Produce one signer's 65-byte signature over the attestation.
export async function signAttestation(
  walletClient: HardhatWalletClient,
  account: `0x${string}`,
  domain: DomainParams,
  message: AttestationMessage,
): Promise<Hex> {
  return walletClient.signTypedData({
    account,
    domain: eip712Domain(domain),
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message,
  });
}

/// Collect signatures from several signers over the same attestation.
export async function signAttestationBy(
  signers: HardhatWalletClient[],
  domain: DomainParams,
  message: AttestationMessage,
): Promise<Hex[]> {
  return Promise.all(signers.map((s) => signAttestation(s, s.account.address, domain, message)));
}
