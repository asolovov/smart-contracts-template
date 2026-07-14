import fc from "fast-check";
import { network } from "hardhat";
import { keccak256, toBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { buildDigest, DOMAIN_NAME, DOMAIN_VERSION, ATTESTATION_TYPES } from "../helpers/eip712.js";

/// Property-based tests state an *invariant* and let fast-check hunt for a counterexample across
/// thousands of random inputs — including the adversarial edges (0, ±1, min/max, boundary
/// decimals) a hand-written table always forgets. They complement the example-based tests in
/// `test/unit/`; they do not replace them.
///
/// When one fails, fast-check prints the shrunk minimal counterexample. Paste it straight into a
/// unit test as a permanent regression before you fix the bug.

const TOPIC: Hex = keccak256(toBytes("ETH/USD"));
const RUNS = 500;

/// Sign the attestation with a raw private key (viem `PrivateKeyAccount`), so a property run can
/// mint fresh signers without touching the Hardhat wallet list.
async function signWith(
  account: PrivateKeyAccount,
  domain: { chainId: bigint; verifyingContract: `0x${string}` },
  message: { reqId: bigint; topic: Hex; value: bigint; observedAt: bigint },
): Promise<Hex> {
  return account.signTypedData({
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: Number(domain.chainId),
      verifyingContract: domain.verifyingContract,
    },
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message,
  });
}

describe("SignatureLib (property-based)", () => {
  it("buildDigest: the contract and viem agree on every sampled input", async () => {
    const conn = await network.create();
    const harness = await conn.viem.deployContract("SignatureLibHarness", []);
    const pub = await conn.viem.getPublicClient();
    const chainId = BigInt(await pub.getChainId());

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 0n, max: (1n << 80n) - 1n }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.bigInt({ min: -(1n << 200n), max: 1n << 200n }),
        fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }),
        async (reqId, topicBytes, value, observedAt) => {
          const topic = `0x${Buffer.from(topicBytes).toString("hex")}` as Hex;
          const onChain = await harness.read.buildDigest([reqId, topic, value, observedAt, chainId, harness.address]);
          const offChain = buildDigest(
            { chainId, verifyingContract: harness.address },
            { reqId, topic, value, observedAt },
          );
          return onChain === offChain;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("verifySignatures: a quorum of k distinct authorized signers passes iff k >= threshold", async () => {
    const conn = await network.create();
    const harness = await conn.viem.deployContract("SignatureLibHarness", []);
    const pub = await conn.viem.getPublicClient();
    const chainId = BigInt(await pub.getChainId());
    const domain = { chainId, verifyingContract: harness.address };

    const accounts: PrivateKeyAccount[] = Array.from({ length: 5 }, () => privateKeyToAccount(generatePrivateKey()));
    const addrs = accounts.map((a) => a.address);

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }), // how many authorized signers actually sign
        fc.integer({ min: 1, max: 5 }), // required threshold
        fc.bigInt({ min: -(1n << 128n), max: 1n << 128n }),
        async (k, threshold, value) => {
          const message = { reqId: 1n, topic: TOPIC, value, observedAt: 1_800_000_000n };
          const digest = buildDigest(domain, message);
          const sigs = await Promise.all(accounts.slice(0, k).map((a) => signWith(a, domain, message)));

          const ok = await harness.read.verifySignatures([digest, sigs, addrs, BigInt(threshold)]);
          return ok === k >= threshold;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("verifySignatures: duplicating one signer's signature never manufactures a quorum", async () => {
    const conn = await network.create();
    const harness = await conn.viem.deployContract("SignatureLibHarness", []);
    const pub = await conn.viem.getPublicClient();
    const chainId = BigInt(await pub.getChainId());
    const domain = { chainId, verifyingContract: harness.address };

    const accounts: PrivateKeyAccount[] = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()));
    const addrs = accounts.map((a) => a.address);

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 20 }), // how many times to repeat the one signature
        fc.integer({ min: 2, max: 3 }), // threshold strictly above 1
        async (copies, threshold) => {
          const message = { reqId: 1n, topic: TOPIC, value: 1n, observedAt: 1n };
          const digest = buildDigest(domain, message);
          const sig = await signWith(accounts[0], domain, message);

          const ok = await harness.read.verifySignatures([
            digest,
            Array.from({ length: copies }, () => sig),
            addrs,
            BigInt(threshold),
          ]);
          // One distinct signer can never clear a threshold above 1, no matter how many copies.
          return ok === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("scaleTo: round-tripping up then back down is the identity", async () => {
    const conn = await network.create();
    const harness = await conn.viem.deployContract("SignatureLibHarness", []);

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
        fc.integer({ min: 0, max: 18 }),
        fc.integer({ min: 0, max: 18 }),
        async (value, from, to) => {
          const up = await harness.read.scaleTo([value, from, to]);
          const back = await harness.read.scaleTo([up, to, from]);
          // Scaling up is lossless, so scaling back down must recover the original exactly.
          // (Scaling DOWN first would truncate, and this identity would not hold — which is
          // itself the reason `scaleTo` is documented as truncating.)
          return to >= from ? back === value : true;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("scaleTo: never changes the sign of a non-zero value", async () => {
    const conn = await network.create();
    const harness = await conn.viem.deployContract("SignatureLibHarness", []);

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 30 }),
        async (value, from, to) => {
          const out = await harness.read.scaleTo([value, from, to]);
          if (value === 0n) return out === 0n;
          if (out === 0n) return to < from; // truncation to zero is only legal when scaling down
          return value > 0n === out > 0n;
        },
      ),
      { numRuns: RUNS },
    );
  });
});
