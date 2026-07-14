import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "viem";

import { lower } from "../helpers/address.js";
import { signAttestationBy, type AttestationMessage } from "../helpers/eip712.js";
import { deploySystem } from "../helpers/fixtures.js";

/// Integration tests drive the system the way the outside world does: through the consumer and
/// the registry, across contract boundaries, over a full lifecycle. Unit tests prove each
/// contract is correct in isolation; these prove they are correct *together* — which is where
/// wiring bugs, stale caches, and broken migrations actually live.
describe("End-to-end", () => {
  it("consumer → registry → vault → attested submit → consumer reads the value back", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const pub = await conn.viem.getPublicClient();
    const consumer = await conn.viem.getContractAt("ExampleConsumer", sys.consumer, {
      client: { wallet: sys.user },
    });
    const vault = await conn.viem.getContractAt("ExampleVault", sys.vault);

    // 1. The consumer resolves the vault through the registry — it never held the address.
    expect(lower(await consumer.read.registry())).to.equal(lower(sys.registry));

    // 2. The user over-pays through the consumer. The vault refunds the surplus, the consumer
    //    relays it on, and the user ends up down exactly the fee plus gas.
    const before = await pub.getBalance({ address: sys.userAddress });
    const hash = await consumer.write.requestUpdate([sys.topic], { value: sys.fee + parseEther("0.5") });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    const gas = receipt.gasUsed * receipt.effectiveGasPrice;
    const after = await pub.getBalance({ address: sys.userAddress });

    expect(before - after).to.equal(sys.fee + gas);
    expect(await consumer.read.lastReqId()).to.equal(1n);

    // 3. Two of the three signers attest; anyone relays the result.
    const message: AttestationMessage = {
      reqId: 1n,
      topic: sys.topic,
      value: 3450_00000000n,
      observedAt: 1_800_000_000n,
    };
    const sigs = await signAttestationBy(
      sys.signers.slice(0, 2),
      { chainId: sys.chainId, verifyingContract: sys.vault },
      message,
    );
    await vault.write.submitValue([message.reqId, message.value, message.observedAt, sigs]);

    // 4. The consumer reads the attested value straight back out.
    const [value, recordedAt] = await consumer.read.latestValue([sys.topic]);
    expect(value).to.equal(message.value);
    expect(recordedAt > 0n).to.equal(true);

    // 5. And the fee the user paid is withdrawable by the owner.
    expect(await vault.read.accruedFees()).to.equal(sys.fee);
  });

  it("survives a signer-set rotation: the retired set stops working, the new one takes over", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const wallets = await conn.viem.getWalletClients();
    const vault = await conn.viem.getContractAt("ExampleVault", sys.vault);
    const domain = { chainId: sys.chainId, verifyingContract: sys.vault };

    // The old set works.
    const first: AttestationMessage = { reqId: 0n, topic: sys.topic, value: 100n, observedAt: 1_800_000_001n };
    await vault.write.submitValue([
      0n,
      first.value,
      first.observedAt,
      await signAttestationBy(sys.signers.slice(0, 2), domain, first),
    ]);

    // Rotate to a completely disjoint set of signers.
    const newSigners = [wallets[6], wallets[7], wallets[8]];
    const newSet = await conn.viem.deployContract("SignerSet", [
      sys.ownerAddress,
      newSigners.map((s) => s.account!.address),
      2n,
    ]);
    await vault.write.setSignerSet([newSet.address]);

    // The retired signers' quorum is now worthless — this is the property that makes key
    // rotation a real remediation rather than a gesture.
    const stale: AttestationMessage = { reqId: 0n, topic: sys.topic, value: 200n, observedAt: 1_800_000_002n };
    await conn.viem.assertions.revertWithCustomError(
      vault.write.submitValue([
        0n,
        stale.value,
        stale.observedAt,
        await signAttestationBy(sys.signers.slice(0, 2), domain, stale),
      ]),
      vault,
      "InsufficientSignatures",
    );

    // The new signers work immediately.
    const fresh: AttestationMessage = { reqId: 0n, topic: sys.topic, value: 300n, observedAt: 1_800_000_003n };
    await vault.write.submitValue([
      0n,
      fresh.value,
      fresh.observedAt,
      await signAttestationBy(newSigners.slice(0, 2), domain, fresh),
    ]);

    expect((await vault.read.latestRecord())[1].value).to.equal(300n);
  });

  it("survives a vault migration: the registry repoints and the consumer follows with no redeploy", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const registry = await conn.viem.getContractAt("ExampleRegistry", sys.registry);
    const consumer = await conn.viem.getContractAt("ExampleConsumer", sys.consumer);
    const domain = { chainId: sys.chainId, verifyingContract: sys.vault };

    const old: AttestationMessage = { reqId: 0n, topic: sys.topic, value: 111n, observedAt: 1_800_000_001n };
    const oldVault = await conn.viem.getContractAt("ExampleVault", sys.vault);
    await oldVault.write.submitValue([
      0n,
      old.value,
      old.observedAt,
      await signAttestationBy(sys.signers.slice(0, 2), domain, old),
    ]);
    expect((await consumer.read.latestValue([sys.topic]))[0]).to.equal(111n);

    // Ship a "fixed" vault and repoint the topic at it.
    const newVault = await conn.viem.deployContract("ExampleVault", [
      sys.ownerAddress,
      sys.signerSet,
      sys.topic,
      8,
      0n,
    ]);
    await registry.write.registerTopic([sys.topic, newVault.address]);

    const fresh: AttestationMessage = { reqId: 0n, topic: sys.topic, value: 222n, observedAt: 1_800_000_002n };
    await newVault.write.submitValue([
      0n,
      fresh.value,
      fresh.observedAt,
      await signAttestationBy(
        sys.signers.slice(0, 2),
        { chainId: sys.chainId, verifyingContract: newVault.address },
        fresh,
      ),
    ]);

    // The consumer was never touched, yet it now reads the new vault. That is the whole payoff
    // of resolving through a registry instead of hard-coding an address.
    expect((await consumer.read.latestValue([sys.topic]))[0]).to.equal(222n);
  });

  it("rejects a consumer read of an unregistered topic", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const consumer = await conn.viem.getContractAt("ExampleConsumer", sys.consumer);
    const unknown = ("0x" + "99".repeat(32)) as `0x${string}`;

    await conn.viem.assertions.revertWithCustomError(
      consumer.read.latestValue([unknown]),
      consumer,
      "TopicNotRegistered",
    );
  });
});
