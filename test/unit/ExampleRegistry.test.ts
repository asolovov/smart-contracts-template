import { expect } from "chai";
import { network } from "hardhat";
import { getAddress, keccak256, toBytes, zeroAddress, zeroHash } from "viem";

import { lower } from "../helpers/address.js";

const TOPIC_A = keccak256(toBytes("ETH/USD"));
const TOPIC_B = keccak256(toBytes("BTC/USD"));

describe("ExampleRegistry", () => {
  it("registerTopic: first registration stores the vault and emits TopicRegistered", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const registry = await conn.viem.deployContract("ExampleRegistry", [wallets[0].account!.address]);
    const vault = wallets[1].account!.address;

    await registry.write.registerTopic([TOPIC_A, vault]);

    expect(lower(await registry.read.getVault([TOPIC_A]))).to.equal(lower(vault));
    expect(await registry.read.listTopics()).to.deep.equal([TOPIC_A]);

    const events = await registry.getEvents.TopicRegistered({}, { fromBlock: 0n });
    expect(events).to.have.length(1);
    expect(getAddress(events[0].args.vault!)).to.equal(getAddress(vault));
  });

  it("registerTopic: repointing an existing topic emits TopicUpdated, not TopicRegistered", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const registry = await conn.viem.deployContract("ExampleRegistry", [wallets[0].account!.address]);
    const oldVault = wallets[1].account!.address;
    const newVault = wallets[2].account!.address;

    await registry.write.registerTopic([TOPIC_A, oldVault]);
    await registry.write.registerTopic([TOPIC_A, newVault]);

    expect(lower(await registry.read.getVault([TOPIC_A]))).to.equal(lower(newVault));

    // The topic is listed once, not twice — the list is a set, not a log.
    expect(await registry.read.listTopics()).to.deep.equal([TOPIC_A]);

    const updated = await registry.getEvents.TopicUpdated({}, { fromBlock: 0n });
    expect(updated).to.have.length(1);
    expect(getAddress(updated[0].args.oldVault!)).to.equal(getAddress(oldVault));
    expect(getAddress(updated[0].args.newVault!)).to.equal(getAddress(newVault));
  });

  it("listTopics: preserves registration order across several topics", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const registry = await conn.viem.deployContract("ExampleRegistry", [wallets[0].account!.address]);

    await registry.write.registerTopic([TOPIC_A, wallets[1].account!.address]);
    await registry.write.registerTopic([TOPIC_B, wallets[2].account!.address]);

    expect(await registry.read.listTopics()).to.deep.equal([TOPIC_A, TOPIC_B]);
  });

  it("getVault: returns the zero address for an unregistered topic", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const registry = await conn.viem.deployContract("ExampleRegistry", [wallets[0].account!.address]);

    expect(lower(await registry.read.getVault([TOPIC_A]))).to.equal(lower(zeroAddress));
  });

  it("registerTopic: rejects the zero topic and the zero vault", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const registry = await conn.viem.deployContract("ExampleRegistry", [wallets[0].account!.address]);

    await conn.viem.assertions.revertWithCustomError(
      registry.write.registerTopic([zeroHash, wallets[1].account!.address]),
      registry,
      "ZeroTopic",
    );
    await conn.viem.assertions.revertWithCustomError(
      registry.write.registerTopic([TOPIC_A, zeroAddress]),
      registry,
      "ZeroVault",
    );
  });

  it("registerTopic: rejects a non-owner caller", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const registry = await conn.viem.deployContract("ExampleRegistry", [wallets[0].account!.address]);
    const asStranger = await conn.viem.getContractAt("ExampleRegistry", registry.address, {
      client: { wallet: wallets[3] },
    });

    await conn.viem.assertions.revertWithCustomError(
      asStranger.write.registerTopic([TOPIC_A, wallets[1].account!.address]),
      registry,
      "OwnableUnauthorizedAccount",
    );
  });
});
