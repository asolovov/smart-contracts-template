import { expect } from "chai";
import { network } from "hardhat";
import { keccak256, toBytes, type Hex } from "viem";

import { buildDigest, signAttestation, type AttestationMessage } from "../helpers/eip712.js";
import { expectRevertWithMessage } from "../helpers/reverts.js";

const TOPIC: Hex = keccak256(toBytes("ETH/USD"));

describe("SignatureLib", () => {
  describe("buildDigest", () => {
    it("the on-chain digest equals viem's hashTypedData — Solidity and TS agree", async () => {
      // This is the single most valuable test in the file. If the Solidity typehash and the TS
      // type definition ever drift apart, every signature silently stops verifying and the
      // failure surfaces far away, as an unexplained `InsufficientSignatures`. Catch it here.
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());

      const message: AttestationMessage = { reqId: 7n, topic: TOPIC, value: -1234n, observedAt: 1_800_000_000n };

      const onChain = await harness.read.buildDigest([
        message.reqId,
        message.topic,
        message.value,
        message.observedAt,
        chainId,
        harness.address,
      ]);
      const offChain = buildDigest({ chainId, verifyingContract: harness.address }, message);

      expect(onChain).to.equal(offChain);
    });

    it("the digest is bound to chainId and to the verifying contract", async () => {
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());
      const other = await conn.viem.deployContract("SignatureLibHarness", []);

      const args = [1n, TOPIC, 100n, 1_800_000_000n] as const;

      const base = await harness.read.buildDigest([...args, chainId, harness.address]);
      const otherChain = await harness.read.buildDigest([...args, chainId + 1n, harness.address]);
      const otherContract = await harness.read.buildDigest([...args, chainId, other.address]);

      expect(base).to.not.equal(otherChain);
      expect(base).to.not.equal(otherContract);
    });
  });

  describe("verifySignatures", () => {
    it("accepts exactly-threshold distinct authorized signers", async () => {
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);
      const wallets = await conn.viem.getWalletClients();
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());
      const domain = { chainId, verifyingContract: harness.address };

      const signers = wallets.slice(1, 4);
      const addrs = signers.map((s) => s.account!.address);
      const message: AttestationMessage = { reqId: 1n, topic: TOPIC, value: 42n, observedAt: 1_800_000_000n };
      const digest = buildDigest(domain, message);

      const sigs = await Promise.all(
        signers.slice(0, 2).map((s) => signAttestation(s, s.account!.address, domain, message)),
      );

      expect(await harness.read.verifySignatures([digest, sigs, addrs, 2n])).to.equal(true);
      expect(await harness.read.verifySignatures([digest, sigs, addrs, 3n])).to.equal(false);
    });

    it("never auto-approves: a zero threshold is false even with valid signatures", async () => {
      // A zero threshold with an empty signature array would otherwise "pass" a naive
      // `validCount >= threshold` check. Refusing it outright is the safe default.
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);
      const wallets = await conn.viem.getWalletClients();
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());
      const domain = { chainId, verifyingContract: harness.address };

      const signer = wallets[1];
      const message: AttestationMessage = { reqId: 1n, topic: TOPIC, value: 1n, observedAt: 1n };
      const digest = buildDigest(domain, message);
      const sig = await signAttestation(signer, signer.account!.address, domain, message);

      expect(await harness.read.verifySignatures([digest, [], [], 0n])).to.equal(false);
      expect(await harness.read.verifySignatures([digest, [sig], [signer.account!.address], 0n])).to.equal(false);
    });

    it("deduplicates: one signer cannot satisfy a 2-of-3 by signing twice", async () => {
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);
      const wallets = await conn.viem.getWalletClients();
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());
      const domain = { chainId, verifyingContract: harness.address };

      const signers = wallets.slice(1, 4);
      const addrs = signers.map((s) => s.account!.address);
      const message: AttestationMessage = { reqId: 1n, topic: TOPIC, value: 1n, observedAt: 1n };
      const digest = buildDigest(domain, message);
      const sig = await signAttestation(signers[0], addrs[0], domain, message);

      expect(await harness.read.verifySignatures([digest, [sig, sig, sig], addrs, 2n])).to.equal(false);
    });

    it("ignores unauthorized signers and malformed signatures without aborting", async () => {
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);
      const wallets = await conn.viem.getWalletClients();
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());
      const domain = { chainId, verifyingContract: harness.address };

      const authorized = wallets.slice(1, 3);
      const addrs = authorized.map((s) => s.account!.address);
      const stranger = wallets[5];
      const message: AttestationMessage = { reqId: 1n, topic: TOPIC, value: 1n, observedAt: 1n };
      const digest = buildDigest(domain, message);

      const good = await Promise.all(authorized.map((s) => signAttestation(s, s.account!.address, domain, message)));
      const strangerSig = await signAttestation(stranger, stranger.account!.address, domain, message);
      const garbage = ("0x" + "ab".repeat(65)) as Hex;

      // A quorum surrounded by noise still verifies.
      expect(
        await harness.read.verifySignatures([digest, [garbage, good[0], strangerSig, good[1]], addrs, 2n]),
      ).to.equal(true);
      // Noise alone does not.
      expect(await harness.read.verifySignatures([digest, [garbage, strangerSig], addrs, 1n])).to.equal(false);
    });

    it("is order-independent", async () => {
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);
      const wallets = await conn.viem.getWalletClients();
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());
      const domain = { chainId, verifyingContract: harness.address };

      const signers = wallets.slice(1, 4);
      const addrs = signers.map((s) => s.account!.address);
      const message: AttestationMessage = { reqId: 1n, topic: TOPIC, value: 1n, observedAt: 1n };
      const digest = buildDigest(domain, message);
      const sigs = await Promise.all(signers.map((s) => signAttestation(s, s.account!.address, domain, message)));

      expect(await harness.read.verifySignatures([digest, sigs, addrs, 3n])).to.equal(true);
      expect(await harness.read.verifySignatures([digest, [...sigs].reverse(), addrs, 3n])).to.equal(true);
    });
  });

  describe("scaleTo", () => {
    it("is the identity when decimals match", async () => {
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);
      expect(await harness.read.scaleTo([12345n, 8, 8])).to.equal(12345n);
    });

    it("scales up and down, truncating toward zero on the way down", async () => {
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);

      expect(await harness.read.scaleTo([123n, 2, 5])).to.equal(123_000n);
      expect(await harness.read.scaleTo([123_456n, 5, 2])).to.equal(123n);
      // Truncation, not rounding — and toward zero on both signs.
      expect(await harness.read.scaleTo([199n, 2, 0])).to.equal(1n);
      expect(await harness.read.scaleTo([-199n, 2, 0])).to.equal(-1n);
    });

    it("reverts rather than silently flipping the sign at diff == 77", async () => {
      // 10**77 exceeds int256.max. Without the SafeCast, the cast wraps to a negative factor and
      // `scaleTo` returns a value with the WRONG SIGN — a silent, catastrophic result. Reverting
      // is the only acceptable behaviour. See the note in SignatureLib.scaleTo.
      const conn = await network.create();
      const harness = await conn.viem.deployContract("SignatureLibHarness", []);

      await expectRevertWithMessage(() => harness.read.scaleTo([1n, 0, 77]), /revert|overflow|SafeCast/i);
    });
  });
});
