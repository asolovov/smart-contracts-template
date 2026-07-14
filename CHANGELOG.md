# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Template note.** Keep this file. On a contracts repo the changelog is not paperwork — it is
> the record of what is deployed where, which storage layouts changed, and which findings were
> remediated in which release. Add a `### Deployed` block every time you put something on-chain,
> with the network, chain id, deployer, date, and addresses. Future-you reconstructing an
> incident will read this before reading the code.

## [Unreleased]

### Added

- `SignerSet` — owner-managed M-of-N signer registry (`Ownable2Step`, custom errors, O(1)
  membership, swap-and-pop removal, refuses to strand the threshold above the set size).
- `ExampleRegistry` — `topic → vault` directory. Repointing a topic migrates consumers with no
  redeploy and no proxy.
- `ExampleVault` — request/fulfill store for an off-chain-attested value. Fee handling with
  reentrancy-safe refunds, explicit ether accounting, two independent replay guards (per-request
  and monotonic-observation), and an optional freshness policy.
- `SignatureLib` — EIP-712 digest construction, M-of-N ECDSA verification with signer
  deduplication, and decimals rescaling that reverts rather than silently flipping sign.
- `ExampleConsumer` — reference integration resolving vaults through the registry.
- Test suite: 73 tests across `unit/`, `integration/`, `property/` (fast-check), and `security/`.
- Deploy pipeline: `generateSigners.ts`, `deployAll.ts`, `verifyAll.sh`, `smokeTest.ts`, and the
  committed-artefact convention in `deployments/`.
- CI: compile, test, lint/format/typecheck, Slither. Actions pinned to commit SHAs.
- `AGENTS.md` (+ `CLAUDE.md` pointer) — house rules for AI coding agents.

[Unreleased]: https://github.com/asolovov/smart-contracts-template/commits/main
