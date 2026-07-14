// EIP-712 signing helpers, mirroring `src/libs/SignatureLib.sol`.
//
// The domain and type definitions here MUST stay byte-identical to the Solidity constants.
// `test/unit/SignatureLib.test.ts` asserts that the digest viem computes from this file
// equals the digest the contract computes on-chain — that cross-check is what keeps a
// silent drift between the two from turning into "signatures mysteriously don't verify".

import { hashTypedData, type Hex, type WalletClient } from "viem";

/// Must equal `SignatureLib.DOMAIN_NAME`. Rename in both places when you fork.
export const DOMAIN_NAME = "EXAMPLE_TEMPLATE";

/// Must equal `SignatureLib.DOMAIN_VERSION`.
export const DOMAIN_VERSION = "1";

/// Must equal `SignatureLib.ATTESTATION_TYPEHASH`'s preimage, field for field and in order.
export const ATTESTATION_TYPES = {
  Attestation: [
    { name: "reqId", type: "uint256" },
    { name: "topic", type: "bytes32" },
    { name: "value", type: "int256" },
    { name: "observedAt", type: "uint256" },
  ],
} as const;

export interface AttestationMessage {
  reqId: bigint;
  topic: Hex;
  value: bigint;
  observedAt: bigint;
}

export interface DomainParams {
  chainId: bigint;
  verifyingContract: `0x${string}`;
}

function domainOf(domain: DomainParams) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: Number(domain.chainId),
    verifyingContract: domain.verifyingContract,
  };
}

/// Compute the digest off-chain, the same way `SignatureLib.buildDigest` does on-chain.
export function buildDigest(domain: DomainParams, message: AttestationMessage): Hex {
  return hashTypedData({
    domain: domainOf(domain),
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message,
  });
}

/// Produce one signer's 65-byte signature over the attestation.
export async function signAttestation(
  walletClient: WalletClient,
  account: `0x${string}`,
  domain: DomainParams,
  message: AttestationMessage,
): Promise<Hex> {
  return walletClient.signTypedData({
    account,
    domain: domainOf(domain),
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message,
  });
}

/// Collect signatures from several signers over the same attestation.
export async function signAttestationBy(
  signers: WalletClient[],
  domain: DomainParams,
  message: AttestationMessage,
): Promise<Hex[]> {
  return Promise.all(signers.map((s) => signAttestation(s, s.account!.address, domain, message)));
}
