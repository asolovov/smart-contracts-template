import { expect } from "chai";
import { network } from "hardhat";
import { getAddress, zeroAddress } from "viem";

import { lower } from "../helpers/address.js";
import { expectRevertWithMessage } from "../helpers/reverts.js";

describe("SignerSet", () => {
  it("constructor: bootstraps with signers + threshold and emits ThresholdChanged", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const owner = wallets[0].account!.address;
    const signers = [wallets[1].account!.address, wallets[2].account!.address, wallets[3].account!.address];

    const set = await conn.viem.deployContract("SignerSet", [owner, signers, 2n]);

    expect(await set.read.getThreshold()).to.equal(2n);
    expect(await set.read.getSigners()).to.have.length(3);
    for (const s of signers) {
      expect(await set.read.isSigner([s])).to.equal(true);
    }
    expect(lower(await set.read.owner())).to.equal(lower(owner));

    const events = await set.getEvents.ThresholdChanged({ fromBlock: 0n });
    expect(events.length).to.be.greaterThan(0);
  });

  it("constructor: allows an empty deploy (no signers, zero threshold) to be populated later", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [], 0n]);

    expect(await set.read.getThreshold()).to.equal(0n);
    expect(await set.read.getSigners()).to.have.length(0);
  });

  it("constructor: reverts on a zero threshold with non-empty signers", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    await expectRevertWithMessage(
      () => conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [wallets[1].account!.address], 0n]),
      "ZeroThreshold",
    );
  });

  it("constructor: reverts when the threshold exceeds the signer count", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    await expectRevertWithMessage(
      () => conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [wallets[1].account!.address], 2n]),
      "ThresholdExceedsSignerCount",
    );
  });

  it("constructor: reverts on a zero-address signer", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    await expectRevertWithMessage(
      () => conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [zeroAddress], 1n]),
      "ZeroSigner",
    );
  });

  it("constructor: reverts on a duplicate signer", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const dup = wallets[1].account!.address;
    await expectRevertWithMessage(
      () => conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [dup, dup], 2n]),
      "SignerAlreadyExists",
    );
  });

  it("addSigner: owner adds, emits SignerAdded, membership flips", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [], 0n]);
    const added = wallets[1].account!.address;

    await set.write.addSigner([added]);

    expect(await set.read.isSigner([added])).to.equal(true);
    expect(await set.read.getSigners()).to.have.length(1);

    const events = await set.getEvents.SignerAdded({}, { fromBlock: 0n });
    expect(getAddress(events[events.length - 1].args.signer!)).to.equal(getAddress(added));
  });

  it("addSigner: rejects a non-owner caller", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [], 0n]);
    const asStranger = await conn.viem.getContractAt("SignerSet", set.address, {
      client: { wallet: wallets[2] },
    });

    await conn.viem.assertions.revertWithCustomError(
      asStranger.write.addSigner([wallets[3].account!.address]),
      set,
      "OwnableUnauthorizedAccount",
    );
  });

  it("removeSigner: swap-and-pop keeps membership correct while reordering the array", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const [a, b, c] = [wallets[1].account!.address, wallets[2].account!.address, wallets[3].account!.address];
    const set = await conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [a, b, c], 1n]);

    // Remove the FIRST element — this is the case that exercises the swap.
    await set.write.removeSigner([a]);

    expect(await set.read.isSigner([a])).to.equal(false);
    expect(await set.read.isSigner([b])).to.equal(true);
    expect(await set.read.isSigner([c])).to.equal(true);

    const remaining = (await set.read.getSigners()).map(lower);
    expect(remaining).to.have.length(2);
    expect(remaining).to.include.members([lower(b), lower(c)]);
    // `c` was swapped into `a`'s slot — proof the array order is NOT stable across removals.
    expect(remaining[0]).to.equal(lower(c));
  });

  it("removeSigner: removing the last element takes the no-swap branch", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const [a, b] = [wallets[1].account!.address, wallets[2].account!.address];
    const set = await conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [a, b], 1n]);

    await set.write.removeSigner([b]);

    expect(await set.read.getSigners()).to.have.length(1);
    expect(lower((await set.read.getSigners())[0])).to.equal(lower(a));
  });

  it("removeSigner: reverts when the address is not in the set", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("SignerSet", [
      wallets[0].account!.address,
      [wallets[1].account!.address],
      1n,
    ]);

    await conn.viem.assertions.revertWithCustomError(
      set.write.removeSigner([wallets[5].account!.address]),
      set,
      "SignerNotFound",
    );
  });

  it("removeSigner: refuses to strand the threshold above the signer count", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const [a, b] = [wallets[1].account!.address, wallets[2].account!.address];
    // 2-of-2: removing either signer would leave threshold=2 > signers=1, an unsatisfiable state.
    const set = await conn.viem.deployContract("SignerSet", [wallets[0].account!.address, [a, b], 2n]);

    await conn.viem.assertions.revertWithCustomError(set.write.removeSigner([a]), set, "ThresholdExceedsSignerCount");

    // The set is untouched — a reverted tx leaves no partial state.
    expect(await set.read.isSigner([a])).to.equal(true);
    expect(await set.read.getSigners()).to.have.length(2);
  });

  it("setThreshold: owner raises and lowers within bounds", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const signers = [wallets[1].account!.address, wallets[2].account!.address, wallets[3].account!.address];
    const set = await conn.viem.deployContract("SignerSet", [wallets[0].account!.address, signers, 1n]);

    await set.write.setThreshold([3n]);
    expect(await set.read.getThreshold()).to.equal(3n);

    await set.write.setThreshold([2n]);
    expect(await set.read.getThreshold()).to.equal(2n);
  });

  it("setThreshold: rejects zero and any value above the signer count", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("SignerSet", [
      wallets[0].account!.address,
      [wallets[1].account!.address],
      1n,
    ]);

    await conn.viem.assertions.revertWithCustomError(set.write.setThreshold([0n]), set, "ZeroThreshold");
    await conn.viem.assertions.revertWithCustomError(set.write.setThreshold([2n]), set, "ThresholdExceedsSignerCount");
  });

  it("Ownable2Step: ownership moves only after the new owner accepts", async () => {
    const conn = await network.create();
    const wallets = await conn.viem.getWalletClients();
    const owner = wallets[0];
    const next = wallets[1];
    const set = await conn.viem.deployContract("SignerSet", [owner.account!.address, [], 0n]);

    await set.write.transferOwnership([next.account!.address]);

    // Still the old owner: a proposal is not a transfer. This is the whole point of 2-step.
    expect(lower(await set.read.owner())).to.equal(lower(owner.account!.address));
    expect(lower(await set.read.pendingOwner())).to.equal(lower(next.account!.address));

    const asNext = await conn.viem.getContractAt("SignerSet", set.address, { client: { wallet: next } });
    await asNext.write.acceptOwnership();

    expect(lower(await set.read.owner())).to.equal(lower(next.account!.address));
  });
});
