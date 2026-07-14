import { expect } from "chai";
import { network } from "hardhat";

import { signAttestationBy, type AttestationMessage } from "../helpers/eip712.js";
import { deploySystem } from "../helpers/fixtures.js";

/// # test/security/
///
/// One file per *class of attack* the system claims to defend against. These are not unit tests
/// of a function; they are executable statements of a security property, written from the
/// attacker's side: "given a captured payload, here is what I try, and here is why it fails."
///
/// The convention that makes this directory pull its weight:
///
///   * When a review or an audit produces a finding, land the failing test HERE first — a test
///     that demonstrates the bug against the unfixed code. Then fix the code and invert the
///     assertion. The test becomes the permanent proof that the finding cannot regress.
///   * Name the file after the attack (`ReplayProtection`, `AccessControl`, `FeeAccounting`),
///     not after the contract.
///   * Comment each test with *why* the attack fails, not just that it does. The next person to
///     touch the guard needs to know what they would be removing.
///
/// The two tests below are the ones every M-of-N attestation system needs and the ones most
/// often missing: replaying a payload whose per-request guard does not apply, and reusing a
/// signature that a naive design would treat as still valid.
describe("Security: replay protection", () => {
  it("a captured heartbeat payload cannot be replayed, even though reqId 0 is exempt from the per-request guard", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const vault = await conn.viem.getContractAt("ExampleVault", sys.vault);
    const domain = { chainId: sys.chainId, verifyingContract: sys.vault };

    // A legitimate heartbeat lands.
    const heartbeat: AttestationMessage = {
      reqId: 0n,
      topic: sys.topic,
      value: 3000_00000000n,
      observedAt: 1_800_000_000n,
    };
    const sigs = await signAttestationBy(sys.signers.slice(0, 2), domain, heartbeat);
    await vault.write.submitValue([0n, heartbeat.value, heartbeat.observedAt, sigs]);
    expect(await vault.read.latestRecordId()).to.equal(1n);

    // The attacker now has the calldata: a valid 2-of-3 quorum over a real observation. They
    // replay it verbatim, hoping to pin a stale price in place while the market moves.
    //
    // The per-reqId guard does NOT save us here — `fulfilled[0]` is deliberately never set,
    // because heartbeats must be allowed to recur. What stops the replay is the strictly-
    // monotonic `observedAt` gate: the resubmitted payload carries the SAME `observedAt` as the
    // record already stored, and `observedAt <= latestObservedAt` reverts.
    //
    // Remove that gate and this test is the one that goes red.
    await conn.viem.assertions.revertWithCustomError(
      vault.write.submitValue([0n, heartbeat.value, heartbeat.observedAt, sigs]),
      vault,
      "StaleObservation",
    );

    expect(await vault.read.latestRecordId()).to.equal(1n);
  });

  it("an older-but-validly-signed observation cannot overwrite a newer one (out-of-order delivery)", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const vault = await conn.viem.getContractAt("ExampleVault", sys.vault);
    const domain = { chainId: sys.chainId, verifyingContract: sys.vault };

    // Signers attest at t=100 and t=200. Both signatures are genuine.
    const older: AttestationMessage = { reqId: 0n, topic: sys.topic, value: 100n, observedAt: 1_800_000_100n };
    const newer: AttestationMessage = { reqId: 0n, topic: sys.topic, value: 200n, observedAt: 1_800_000_200n };
    const olderSigs = await signAttestationBy(sys.signers.slice(0, 2), domain, older);
    const newerSigs = await signAttestationBy(sys.signers.slice(0, 2), domain, newer);

    // The newer one lands first — mempool ordering is not something you control.
    await vault.write.submitValue([0n, newer.value, newer.observedAt, newerSigs]);

    // The older one arrives late. It is perfectly signed and would pass every signature check.
    // Accepting it would move the recorded value BACKWARDS in time — the vault would report a
    // stale value as current. The monotonic gate is what makes late delivery a no-op instead of
    // a rollback.
    await conn.viem.assertions.revertWithCustomError(
      vault.write.submitValue([0n, older.value, older.observedAt, olderSigs]),
      vault,
      "StaleObservation",
    );

    expect((await vault.read.latestRecord())[1].value).to.equal(200n);
  });

  it("a settled request cannot be settled twice, even with a fresh signed payload", async () => {
    const conn = await network.create();
    const sys = await deploySystem(conn);
    const vault = await conn.viem.getContractAt("ExampleVault", sys.vault, { client: { wallet: sys.user } });
    const domain = { chainId: sys.chainId, verifyingContract: sys.vault };

    await vault.write.requestUpdate({ value: sys.fee });

    const first: AttestationMessage = { reqId: 1n, topic: sys.topic, value: 100n, observedAt: 1_800_000_100n };
    await vault.write.submitValue([
      1n,
      first.value,
      first.observedAt,
      await signAttestationBy(sys.signers.slice(0, 2), domain, first),
    ]);

    // Everything about this second payload is legitimate — newer observation, valid quorum. The
    // ONLY thing wrong with it is that request #1 was already paid for once and settled once.
    // Without `fulfilled[reqId]`, a colluding relayer could keep re-settling a single paid
    // request forever, and any consumer keying off `reqId` would see it resolve more than once.
    const second: AttestationMessage = { reqId: 1n, topic: sys.topic, value: 200n, observedAt: 1_800_000_200n };
    await conn.viem.assertions.revertWithCustomError(
      vault.write.submitValue([
        1n,
        second.value,
        second.observedAt,
        await signAttestationBy(sys.signers.slice(0, 2), domain, second),
      ]),
      vault,
      "ReqIdAlreadyFulfilled",
    );
  });
});
