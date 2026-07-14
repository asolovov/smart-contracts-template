// The EIP-712 domain, in ONE place.
//
// These constants must match `src/libs/SignatureLib.sol` exactly — the domain name, the version,
// and the field list and order of the `Attestation` struct. If Solidity and TypeScript disagree
// by a single character, every signature still *produces* fine and simply stops *verifying*, and
// the failure surfaces far away as an opaque `InsufficientSignatures`.
//
// So: two places define the domain, and one test pins them together.
// `test/unit/SignatureLib.test.ts` asserts the digest the contract computes equals the digest
// viem computes from this file. If you rename the domain in only one of the two, that test goes
// red immediately instead of your deploy going red expensively.
//
// Everything that signs — the test helpers, the smoke test, and any off-chain service you write —
// imports from here. Do not redeclare these constants anywhere else.

/// Must equal `SignatureLib.DOMAIN_NAME`. **Rename this when you fork the template.**
export const DOMAIN_NAME = "EXAMPLE_TEMPLATE";

/// Must equal `SignatureLib.DOMAIN_VERSION`. Bump on any breaking change to the signed struct.
export const DOMAIN_VERSION = "1";

/// Must equal the preimage of `SignatureLib.ATTESTATION_TYPEHASH`, field for field, in order.
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
  topic: `0x${string}`;
  value: bigint;
  observedAt: bigint;
}

export interface DomainParams {
  chainId: bigint;
  verifyingContract: `0x${string}`;
}

/// Build the `domain` object viem's `signTypedData` / `hashTypedData` expect.
export function eip712Domain(domain: DomainParams) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: Number(domain.chainId),
    verifyingContract: domain.verifyingContract,
  } as const;
}
