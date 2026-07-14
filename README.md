# smart-contracts-template

[![CI](https://github.com/asolovov/smart-contracts-template/actions/workflows/ci.yml/badge.svg)](https://github.com/asolovov/smart-contracts-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Solidity 0.8.24](https://img.shields.io/badge/Solidity-0.8.24-blue.svg)](https://docs.soliditylang.org/en/v0.8.24/)

> A Solidity starter shaped like a project that has already shipped: Hardhat 3 + viem +
> TypeScript, four-layer tests, static analysis, a real deploy pipeline, and a worked example
> of the patterns that keep money-handling contracts safe.

Most Solidity templates give you a `Counter` and a `README`. This one gives you a small but
complete system — an M-of-N attested value store with fees, a registry, and a consumer — so
that every directory has something real in it, CI is green from the first commit, and the
patterns you need on day one are already there to copy rather than invent.

**Click "Use this template" on GitHub**, then work through
[Making it yours](#making-it-yours).

---

## What you get

| | |
|---|---|
| **Solidity 0.8.24**, pinned | Same version in `hardhat.config.ts`, every `pragma`, `.solhint.json`, and CI. Never floating. |
| **Hardhat 3** + **viem** + TypeScript | Strict TS everywhere — tests, scripts, config. No `ethers`, no JS. |
| **OpenZeppelin v5** | `Ownable2Step`, `ReentrancyGuard`, `ECDSA`, `SafeCast`. |
| **Four test layers** | unit · integration · property (`fast-check`) · security regression. 73 tests, 100% line + statement coverage on every contract. |
| **Solhint + Prettier + Slither** | All three wired, all three enforced in CI. |
| **4-job CI** | compile · test · lint/format/typecheck · Slither. Actions pinned to SHAs. |
| **Deploy pipeline** | Deploy → verify on Etherscan → smoke-test the live system → commit the artefacts. |
| **`AGENTS.md`** | House rules for AI coding agents, so they write code that looks like the rest of the repo. |

## Quickstart

```sh
npm ci
npx hardhat compile
npx hardhat test          # 73 passing
npm run verify:all        # compile + typecheck + lint + format + tests — run before every commit
```

No `.env`, no RPC, no keys needed for any of the above — the local Hardhat network needs no
secrets. `.env` only matters when you deploy.

Static analysis needs Python and solc:

```sh
pip install slither-analyzer solc-select && solc-select install 0.8.24
npm run slither
```

No `solc-select use` needed — the script addresses the 0.8.24 artifact directly and leaves your
global solc selection alone.

## The example system

Three contracts, one library, one consumer. The domain is deliberately generic — it is the
skeleton of anything that follows *"someone pays to request something, work happens off-chain,
and a quorum of signers settles the answer on-chain"*: price oracles, bridges, ZK-verifier
callbacks, randomness beacons, attestation services.

```
                  requestUpdate() ── pays fee ──►┌──────────────┐
   user ──► ExampleConsumer ──resolves topic──►  │ ExampleVault │ ◄── submitValue(sigs[])
                    │                            └──────────────┘         │
                    │                                   │                 │
                    └──► ExampleRegistry ───────────────┘        SignerSet (M-of-N)
                         topic → vault                            verified via SignatureLib
```

| Contract | What it demonstrates |
|---|---|
| `SignerSet` | An owner-managed M-of-N set. `Ownable2Step`, custom errors, O(1) membership via a mapping with the array kept only for enumeration, swap-and-pop removal, and a refusal to strand the threshold above the set size. |
| `ExampleRegistry` | `topic → vault` directory. Repointing a topic is how you ship a fix **without a proxy** — consumers that resolve through the registry follow a migration for free. |
| `ExampleVault` | The one that handles money and trusts off-chain signers. Replay protection (two independent guards), reentrancy-safe refunds, explicit ether accounting, and a freshness policy. |
| `SignatureLib` | EIP-712 done correctly: `abi.encode` (never `encodePacked`), a digest bound to both `chainId` and the verifying contract, deduplicated signer recovery, and a `SafeCast` that turns a silent sign-flip into a revert. |
| `ExampleConsumer` | How a third party integrates: resolve through the registry, read, check `recordedAt` before trusting the value. |

Every non-obvious line carries a comment explaining **why** — those comments are the actual
payload of this template. Read `src/core/ExampleVault.sol` first; its header lists the four
things that most often go wrong in a contract like it, and the code shows the fix for each.

## Layout

```
src/
  interfaces/     ISignerSet, IExampleVault, IExampleRegistry — consumers depend on these, not on impls
  core/           SignerSet, ExampleRegistry, ExampleVault
  libs/           SignatureLib — stateless, pure, harness-testable
  consumers/      ExampleConsumer — reference integration
  test/           Solidity test helpers (harness, hostile contract). Never deployed.
test/
  unit/           One file per contract. Every branch, every revert.
  integration/    Contracts driven together, as the outside world drives them.
  property/       fast-check invariants over thousands of random inputs.
  security/       One file per class of attack. See the header of ReplayProtection for the convention.
  helpers/        Fixtures, EIP-712 signing, revert matchers.
script/deploy/    generateSigners · deployAll · verifyAll.sh · smokeTest
config/
  topics.ts       WHAT gets deployed — the topic table.
  deployment.ts   HOW — signer count, quorum, fee, known chains.
  eip712.ts       The EIP-712 domain. The only TS definition; tests and smokeTest import it.
deployments/      Committed addresses + ABIs, one directory per network.
```

## Deploying

```sh
cp .env.example .env      # SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY
npx hardhat compile

npx hardhat run script/deploy/deployAll.ts --network sepolia   # deploy + write deployments/sepolia/
sh script/deploy/verifyAll.sh sepolia                          # verify on Etherscan
npx hardhat run script/deploy/smokeTest.ts --network sepolia   # prove the LIVE system works

git add deployments/sepolia && git commit -m "chore: deploy to sepolia"
```

`--network` is real, not decorative: the scripts take the network from the flag, ask the chain
who it is, and look the chain id up in `config/deployment.ts`. To deploy elsewhere, add the chain
in two places — `networks` in `hardhat.config.ts` and `NETWORKS` in `config/deployment.ts`. You do
not edit the scripts.

Run the smoke test every time. CI proves the code is correct; only the smoke test proves the thing
you just put on-chain is *wired* correctly. Full runbook: [`deployments/README.md`](./deployments/README.md).

## Making it yours

1. **Take the author's name off it.** In order of how much it will embarrass you:
   - The **CI badge** at the top of this README points at `asolovov/smart-contracts-template`. Left
     alone it reports *this* repo's build status on *your* project — permanently green no matter
     how broken your code is. Repoint it at your repo or delete it.
   - `@author` tags in every `.sol` file, `author` + `name` in `package.json`, the copyright line
     in `LICENSE`, and the link at the bottom of `CHANGELOG.md`.
2. **Rename the EIP-712 domain.** Two places, and they must agree:
   `SignatureLib.DOMAIN_NAME` (Solidity) and `DOMAIN_NAME` in `config/eip712.ts` (TypeScript, and
   the only TS definition — the tests and the smoke test both import it). The domain scopes
   signatures to *your* protocol; two protocols sharing a name and version share a signature
   namespace. If you change only one side, `test/unit/SignatureLib.test.ts` goes red immediately —
   that test exists precisely to catch this.
3. **Replace the example contracts.** Keep `SignerSet` (it is generic), rework `ExampleVault` into
   whatever you are building, and swap `int256 value` for your payload.
4. **Update `slither-all.sol`.** Add your contracts to it. Anything missing from that file is
   silently invisible to static analysis, and nothing will tell you.
5. **Rewrite `config/topics.ts`** (what gets deployed) and **`config/deployment.ts`** (signer
   count, quorum, fee, chains).
6. **Update `AGENTS.md`** — it tells coding agents the house rules. Stale rules are worse than none.
7. Set a real `maxAge` before you go anywhere near mainnet. It ships **disabled** so the tests are
   deterministic.
8. Delete this section, and rewrite `CHANGELOG.md`'s `[Unreleased]` block as your own.

## Conventions

- **Solidity is pinned, not floating.** `pragma solidity 0.8.24;` exactly — not `^0.8.24`. A
  caret means a contract you audited under one compiler can be deployed under another.
- **Custom errors, never revert strings.** Cheaper, and they carry the values that explain the
  failure.
- **NatSpec on every external symbol**, and a `why` comment on every non-obvious line. If a
  Slither *finding* is intentional, suppress it **inline**, on the line, next to a comment
  explaining the reasoning — never by widening `slither.config.json`, where the reasoning has
  nowhere to live. (The config does disable two *detector categories* wholesale —
  `naming-convention` and `solc-version` — because they fire on every file and say nothing about
  this code. That is a policy choice made once, not a finding swept under the rug.)
- **Interfaces are the dependency.** Contracts depend on `ISignerSet`, not `SignerSet`.
- **Checks-Effects-Interactions, plus `nonReentrant`.** Both. Not either.
- **Never derive accounting from `address(this).balance`** — it can be inflated by
  `selfdestruct` with no code executed. Track what you are owed in a variable.
- Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`).

## Testing

Four layers, each answering a question the others cannot:

- **`test/unit/`** — is this function correct? Every branch, every revert, every event.
- **`test/integration/`** — are the contracts correct *together*? Wiring, migrations, rotations.
- **`test/property/`** — is the invariant true for inputs I didn't think of? `fast-check`
  generates thousands and shrinks any failure to a minimal counterexample. When one fails, paste
  the counterexample into a unit test as a permanent regression, *then* fix the bug.
- **`test/security/`** — does the attack still fail? One file per class of attack, written from
  the attacker's side. When a review finds a bug, the failing test lands here first, against the
  unfixed code; then you fix the code and invert the assertion.

Coverage: `npm run coverage`.

## Security notes

This is a **template**, not an audited system. Before it holds anything of value:

- `maxAge` ships disabled (`type(uint256).max`). **Set it.**
- The deploy script generates every signer key on one machine. That is a testnet convenience and
  an N-of-N failure mode wearing an M-of-N costume. In production, each signer generates their
  own key in their own HSM/KMS and gives you only the address.
- The owner is a single EOA. Use a multisig or a timelock for anything real.
- Get an audit. `npm run slither` finding nothing is a floor, not a ceiling.

## License

[MIT](./LICENSE). `@openzeppelin/contracts` is imported under MIT and remains the property of its
authors.

---

### Built by Andrei Solovov

Senior blockchain engineer — Solidity, Go, EVM infrastructure.

- GitHub — <https://github.com/asolovov>
- LinkedIn — <https://www.linkedin.com/in/andrei-solovov/>
