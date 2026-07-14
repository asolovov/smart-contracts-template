import { expect } from "chai";
import { network } from "hardhat";
import { getAddress, parseEther, zeroAddress } from "viem";

import { lower } from "../helpers/address.js";
import { signAttestationBy, type AttestationMessage } from "../helpers/eip712.js";
import { deploySystem, DEFAULT_DECIMALS, type DeployedSystem, type NetworkConnection } from "../helpers/fixtures.js";
import { expectRevertWithMessage } from "../helpers/reverts.js";

const VALUE = 3450_00000000n; // 3450.00000000 at 8 decimals

/// Sign an attestation with `count` of the fixture's authorized signers.
async function quorumSigs(sys: DeployedSystem, message: AttestationMessage, count = 2) {
  return signAttestationBy(
    sys.signers.slice(0, count),
    { chainId: sys.chainId, verifyingContract: sys.vault },
    message,
  );
}

async function vaultOf(conn: NetworkConnection, sys: DeployedSystem) {
  return conn.viem.getContractAt("ExampleVault", sys.vault);
}

/// A timestamp comfortably in the past but non-zero. `maxAge` is disabled by default in the
/// fixture, so any strictly-increasing sequence works.
function ts(offset = 0): bigint {
  return 1_800_000_000n + BigInt(offset);
}

describe("ExampleVault", () => {
  describe("construction", () => {
    it("stores its wiring and ships with age gating disabled", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      expect(await vault.read.topic()).to.equal(sys.topic);
      expect(await vault.read.decimals()).to.equal(DEFAULT_DECIMALS);
      expect(await vault.read.requestFee()).to.equal(sys.fee);
      expect(lower(await vault.read.signerSet())).to.equal(lower(sys.signerSet));
      expect(await vault.read.maxAge()).to.equal(2n ** 256n - 1n);
      expect(await vault.read.latestRecordId()).to.equal(0n);
      expect(await vault.read.accruedFees()).to.equal(0n);
    });

    it("rejects a zero signer set", async () => {
      const conn = await network.create();
      const wallets = await conn.viem.getWalletClients();
      await expectRevertWithMessage(
        () =>
          conn.viem.deployContract("ExampleVault", [
            wallets[0].account!.address,
            zeroAddress,
            `0x${"11".repeat(32)}`,
            8,
            0n,
          ]),
        "ZeroSignerSet",
      );
    });
  });

  describe("requestUpdate", () => {
    it("assigns sequential ids from 1, accrues the fee, and emits UpdateRequested", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await conn.viem.getContractAt("ExampleVault", sys.vault, { client: { wallet: sys.user } });

      await vault.write.requestUpdate({ value: sys.fee });
      await vault.write.requestUpdate({ value: sys.fee });

      expect(await vault.read.nextReqId()).to.equal(2n);
      expect(await vault.read.accruedFees()).to.equal(sys.fee * 2n);

      const events = await vault.getEvents.UpdateRequested({}, { fromBlock: 0n });
      expect(events).to.have.length(2);
      expect(events[0].args.reqId).to.equal(1n);
      expect(events[1].args.reqId).to.equal(2n);
      expect(getAddress(events[0].args.requester!)).to.equal(getAddress(sys.userAddress));
    });

    it("refunds the overpayment and keeps exactly the fee", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await conn.viem.getContractAt("ExampleVault", sys.vault, { client: { wallet: sys.user } });
      const pub = await conn.viem.getPublicClient();

      const before = await pub.getBalance({ address: sys.userAddress });
      const hash = await vault.write.requestUpdate({ value: sys.fee + parseEther("1") });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await pub.getBalance({ address: sys.userAddress });

      // The caller is out exactly the fee plus gas — the surplus ether came back.
      expect(before - after).to.equal(sys.fee + gas);
      expect(await pub.getBalance({ address: sys.vault })).to.equal(sys.fee);
      expect(await vault.read.accruedFees()).to.equal(sys.fee);
    });

    it("reverts when msg.value is below the fee", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await conn.viem.getContractAt("ExampleVault", sys.vault, { client: { wallet: sys.user } });

      await conn.viem.assertions.revertWithCustomError(
        vault.write.requestUpdate({ value: sys.fee - 1n }),
        vault,
        "InsufficientFee",
      );
    });

    it("reverts with RefundFailed when the caller cannot receive the refund", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);
      // A contract with no `receive()` — the only way to make the refund `call` fail.
      const hostile = await conn.viem.deployContract("NonPayableCaller", []);

      await conn.viem.assertions.revertWithCustomError(
        hostile.write.callRequestUpdate([sys.vault], { value: sys.fee + 1n }),
        vault,
        "RefundFailed",
      );
    });

    it("does not attempt a refund when the fee is paid exactly (no-refund branch)", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const hostile = await conn.viem.deployContract("NonPayableCaller", []);

      // Same contract that cannot receive ETH — but with no surplus there is nothing to send back,
      // so the call must succeed. This pins the `refund > 0` guard.
      await hostile.write.callRequestUpdate([sys.vault], { value: sys.fee });

      const vault = await vaultOf(conn, sys);
      expect(await vault.read.nextReqId()).to.equal(1n);
    });
  });

  describe("submitValue", () => {
    it("records a value on a valid quorum and emits ValueSubmitted", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      const message: AttestationMessage = { reqId: 1n, topic: sys.topic, value: VALUE, observedAt: ts() };
      await vault.write.submitValue([message.reqId, message.value, message.observedAt, await quorumSigs(sys, message)]);

      expect(await vault.read.latestRecordId()).to.equal(1n);
      expect(await vault.read.fulfilled([1n])).to.equal(true);

      const [recordId, record] = await vault.read.latestRecord();
      expect(recordId).to.equal(1n);
      expect(record.value).to.equal(VALUE);
      expect(record.observedAt).to.equal(message.observedAt);
      expect(record.recordedAt > 0n).to.equal(true);

      const events = await vault.getEvents.ValueSubmitted({}, { fromBlock: 0n });
      expect(events[0].args.value).to.equal(VALUE);
      expect(events[0].args.recordId).to.equal(1n);
    });

    it("is permissionless — the signatures authorize, not msg.sender", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      // Relayed by an account that is NOT a signer and NOT the owner.
      const asOutsider = await conn.viem.getContractAt("ExampleVault", sys.vault, {
        client: { wallet: sys.outsider },
      });

      const message: AttestationMessage = { reqId: 0n, topic: sys.topic, value: VALUE, observedAt: ts() };
      await asOutsider.write.submitValue([0n, message.value, message.observedAt, await quorumSigs(sys, message)]);

      expect(await asOutsider.read.latestRecordId()).to.equal(1n);
    });

    it("rejects a sub-threshold quorum (1 of the required 2)", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      const message: AttestationMessage = { reqId: 1n, topic: sys.topic, value: VALUE, observedAt: ts() };
      const sigs = await quorumSigs(sys, message, 1);

      await conn.viem.assertions.revertWithCustomError(
        vault.write.submitValue([message.reqId, message.value, message.observedAt, sigs]),
        vault,
        "InsufficientSignatures",
      );
    });

    it("rejects the same signer counted twice (duplicate signatures are not a quorum)", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      const message: AttestationMessage = { reqId: 1n, topic: sys.topic, value: VALUE, observedAt: ts() };
      const [one] = await quorumSigs(sys, message, 1);

      await conn.viem.assertions.revertWithCustomError(
        vault.write.submitValue([message.reqId, message.value, message.observedAt, [one, one]]),
        vault,
        "InsufficientSignatures",
      );
    });

    it("ignores signatures from unauthorized signers", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      const message: AttestationMessage = { reqId: 1n, topic: sys.topic, value: VALUE, observedAt: ts() };
      const domain = { chainId: sys.chainId, verifyingContract: sys.vault };
      // One real signer + the outsider: a well-formed signature over the right digest, from the
      // wrong key. It must not count toward the quorum.
      const sigs = await signAttestationBy([sys.signers[0], sys.outsider], domain, message);

      await conn.viem.assertions.revertWithCustomError(
        vault.write.submitValue([message.reqId, message.value, message.observedAt, sigs]),
        vault,
        "InsufficientSignatures",
      );
    });

    it("rejects a signature bound to a different vault (cross-contract replay)", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      const message: AttestationMessage = { reqId: 1n, topic: sys.topic, value: VALUE, observedAt: ts() };
      // Signed against the registry's address instead of the vault's — same payload, wrong domain.
      const sigs = await signAttestationBy(
        sys.signers.slice(0, 2),
        { chainId: sys.chainId, verifyingContract: sys.registry },
        message,
      );

      await conn.viem.assertions.revertWithCustomError(
        vault.write.submitValue([message.reqId, message.value, message.observedAt, sigs]),
        vault,
        "InsufficientSignatures",
      );
    });

    it("rejects a signature bound to a different chain (cross-chain replay)", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      const message: AttestationMessage = { reqId: 1n, topic: sys.topic, value: VALUE, observedAt: ts() };
      const sigs = await signAttestationBy(
        sys.signers.slice(0, 2),
        { chainId: sys.chainId + 1n, verifyingContract: sys.vault },
        message,
      );

      await conn.viem.assertions.revertWithCustomError(
        vault.write.submitValue([message.reqId, message.value, message.observedAt, sigs]),
        vault,
        "InsufficientSignatures",
      );
    });

    it("tolerates a malformed signature alongside a valid quorum", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      const message: AttestationMessage = { reqId: 1n, topic: sys.topic, value: VALUE, observedAt: ts() };
      const good = await quorumSigs(sys, message, 2);
      const garbage = ("0x" + "ff".repeat(65)) as `0x${string}`;

      // Garbage must be skipped, not fatal: one bad relayed signature cannot brick a real quorum.
      await vault.write.submitValue([message.reqId, message.value, message.observedAt, [garbage, ...good]]);

      expect(await vault.read.latestRecordId()).to.equal(1n);
    });

    it("rejects a second settlement of the same reqId", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      const first: AttestationMessage = { reqId: 1n, topic: sys.topic, value: VALUE, observedAt: ts(1) };
      await vault.write.submitValue([first.reqId, first.value, first.observedAt, await quorumSigs(sys, first)]);

      // A *fresh* observation, correctly signed — only the reqId is reused. The per-reqId guard
      // must still reject it, independently of the monotonic-timestamp guard.
      const second: AttestationMessage = { reqId: 1n, topic: sys.topic, value: VALUE + 1n, observedAt: ts(2) };
      await conn.viem.assertions.revertWithCustomError(
        vault.write.submitValue([second.reqId, second.value, second.observedAt, await quorumSigs(sys, second)]),
        vault,
        "ReqIdAlreadyFulfilled",
      );
    });

    it("allows repeated heartbeat (reqId == 0) pushes with advancing observations", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      for (let i = 1; i <= 3; i++) {
        const m: AttestationMessage = { reqId: 0n, topic: sys.topic, value: VALUE + BigInt(i), observedAt: ts(i) };
        await vault.write.submitValue([0n, m.value, m.observedAt, await quorumSigs(sys, m)]);
      }

      expect(await vault.read.latestRecordId()).to.equal(3n);
      // The heartbeat sentinel is never marked fulfilled — that's what lets it recur.
      expect(await vault.read.fulfilled([0n])).to.equal(false);
    });

    it("enforces maxAge once the owner enables it", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);
      const pub = await conn.viem.getPublicClient();

      await vault.write.setMaxAge([60n]);

      const now = (await pub.getBlock()).timestamp;
      const stale: AttestationMessage = { reqId: 0n, topic: sys.topic, value: VALUE, observedAt: now - 3600n };

      await conn.viem.assertions.revertWithCustomError(
        vault.write.submitValue([0n, stale.value, stale.observedAt, await quorumSigs(sys, stale)]),
        vault,
        "ObservationTooOld",
      );

      // A fresh observation under the same policy sails through.
      const fresh: AttestationMessage = { reqId: 0n, topic: sys.topic, value: VALUE, observedAt: now };
      await vault.write.submitValue([0n, fresh.value, fresh.observedAt, await quorumSigs(sys, fresh)]);
      expect(await vault.read.latestRecordId()).to.equal(1n);
    });
  });

  describe("admin", () => {
    it("setRequestFee / setMaxAge / setSignerSet: owner-only, and each emits", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);
      const newSet = await conn.viem.deployContract("SignerSet", [sys.ownerAddress, sys.signerAddresses, 3n]);

      await vault.write.setRequestFee([123n]);
      await vault.write.setMaxAge([600n]);
      await vault.write.setSignerSet([newSet.address]);

      expect(await vault.read.requestFee()).to.equal(123n);
      expect(await vault.read.maxAge()).to.equal(600n);
      expect(lower(await vault.read.signerSet())).to.equal(lower(newSet.address));

      expect(await vault.getEvents.RequestFeeChanged({ fromBlock: 0n })).to.have.length(1);
      expect(await vault.getEvents.MaxAgeChanged({ fromBlock: 0n })).to.have.length(1);
      expect(await vault.getEvents.SignerSetChanged({}, { fromBlock: 0n })).to.have.length(1);
    });

    it("setSignerSet: rejects the zero address", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      await conn.viem.assertions.revertWithCustomError(vault.write.setSignerSet([zeroAddress]), vault, "ZeroSignerSet");
    });

    it("admin setters reject non-owner callers", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);
      const asStranger = await conn.viem.getContractAt("ExampleVault", sys.vault, {
        client: { wallet: sys.outsider },
      });

      await conn.viem.assertions.revertWithCustomError(
        asStranger.write.setRequestFee([1n]),
        vault,
        "OwnableUnauthorizedAccount",
      );
      await conn.viem.assertions.revertWithCustomError(
        asStranger.write.setMaxAge([1n]),
        vault,
        "OwnableUnauthorizedAccount",
      );
      await conn.viem.assertions.revertWithCustomError(
        asStranger.write.withdrawFees([sys.outsiderAddress]),
        vault,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("withdrawFees", () => {
    it("sends the accrued fees to the recipient and zeroes the accounting", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);
      const pub = await conn.viem.getPublicClient();
      const asUser = await conn.viem.getContractAt("ExampleVault", sys.vault, { client: { wallet: sys.user } });

      await asUser.write.requestUpdate({ value: sys.fee });
      await asUser.write.requestUpdate({ value: sys.fee });

      const recipient = sys.outsiderAddress;
      const before = await pub.getBalance({ address: recipient });
      await vault.write.withdrawFees([recipient]);
      const after = await pub.getBalance({ address: recipient });

      expect(after - before).to.equal(sys.fee * 2n);
      expect(await vault.read.accruedFees()).to.equal(0n);
      expect(await pub.getBalance({ address: sys.vault })).to.equal(0n);
      expect(await vault.getEvents.FeesWithdrawn({}, { fromBlock: 0n })).to.have.length(1);
    });

    it("reverts on a zero recipient, and when there is nothing to withdraw", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      await conn.viem.assertions.revertWithCustomError(vault.write.withdrawFees([zeroAddress]), vault, "ZeroRecipient");
      await conn.viem.assertions.revertWithCustomError(
        vault.write.withdrawFees([sys.ownerAddress]),
        vault,
        "NothingToWithdraw",
      );
    });

    it("reverts with WithdrawFailed when the recipient rejects the transfer", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);
      const asUser = await conn.viem.getContractAt("ExampleVault", sys.vault, { client: { wallet: sys.user } });
      const hostile = await conn.viem.deployContract("NonPayableCaller", []);

      await asUser.write.requestUpdate({ value: sys.fee });

      await conn.viem.assertions.revertWithCustomError(
        vault.write.withdrawFees([hostile.address]),
        vault,
        "WithdrawFailed",
      );

      // The revert rolled the `accruedFees = 0` write back — the money is still owed.
      expect(await vault.read.accruedFees()).to.equal(sys.fee);
    });
  });

  describe("reads", () => {
    it("getRecord / latestRecord revert with NoRecord before anything is written", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      await expectRevertWithMessage(() => vault.read.latestRecord(), "NoRecord");
      await expectRevertWithMessage(() => vault.read.getRecord([1n]), "NoRecord");
    });

    it("getRecord returns historical records after newer ones land", async () => {
      const conn = await network.create();
      const sys = await deploySystem(conn);
      const vault = await vaultOf(conn, sys);

      for (let i = 1; i <= 2; i++) {
        const m: AttestationMessage = { reqId: 0n, topic: sys.topic, value: BigInt(i) * 100n, observedAt: ts(i) };
        await vault.write.submitValue([0n, m.value, m.observedAt, await quorumSigs(sys, m)]);
      }

      expect((await vault.read.getRecord([1n])).value).to.equal(100n);
      expect((await vault.read.getRecord([2n])).value).to.equal(200n);
      expect((await vault.read.latestRecord())[1].value).to.equal(200n);
    });
  });
});
