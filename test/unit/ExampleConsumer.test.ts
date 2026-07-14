import { expect } from "chai";
import { network } from "hardhat";
import { parseEther, zeroAddress } from "viem";

import { lower } from "../helpers/address.js";
import { deploySystem } from "../helpers/fixtures.js";
import { expectRevertWithMessage } from "../helpers/reverts.js";

/// The consumer's own logic is thin — most of its behaviour is covered end-to-end in
/// `test/integration/`. What lives here is what integration cannot reach: its constructor guard,
/// and the refund-relay failure that needs a hostile contract to provoke.
describe("ExampleConsumer", () => {
  it("constructor: stores the registry", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const consumer = await conn.viem.getContractAt("ExampleConsumer", sys.consumer);

    expect(lower(await consumer.read.registry())).to.equal(lower(sys.registry));
    expect(await consumer.read.lastReqId()).to.equal(0n);
  });

  it("constructor: rejects the zero registry", async () => {
    const conn = await network.create();
    await expectRevertWithMessage(() => conn.viem.deployContract("ExampleConsumer", [zeroAddress]), "ZeroRegistry");
  });

  it("requestUpdate: reverts on an unregistered topic", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const consumer = await conn.viem.getContractAt("ExampleConsumer", sys.consumer);
    const unknown = `0x${"77".repeat(32)}` as `0x${string}`;

    await conn.viem.assertions.revertWithCustomError(
      consumer.write.requestUpdate([unknown], { value: sys.fee }),
      consumer,
      "TopicNotRegistered",
    );
  });

  it("requestUpdate: reverts with RefundForwardFailed when the caller cannot take the refund back", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const consumer = await conn.viem.getContractAt("ExampleConsumer", sys.consumer);
    // A contract with no `receive()`. It over-pays through the consumer; the vault refunds the
    // surplus to the consumer, the consumer tries to relay it on, and that relay fails.
    const hostile = await conn.viem.deployContract("NonPayableCaller", []);

    await conn.viem.assertions.revertWithCustomError(
      hostile.write.callConsumerRequestUpdate([sys.consumer, sys.topic], { value: sys.fee + parseEther("1") }),
      consumer,
      "RefundForwardFailed",
    );
  });
});
