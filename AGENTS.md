# Project: smart-contracts-template

A Solidity starter built around Hardhat 3 + viem + TypeScript. The example system is an M-of-N
attested value store (`SignerSet` + `ExampleRegistry` + `ExampleVault` + `SignatureLib` +
`ExampleConsumer`) — see `README.md` for what it does and why it exists.

**This is not the Hardhat you may know.** Hardhat 3 is ESM-only, viem-based, has a plugin array
in the config, and `network.connect()` is deprecated in favour of `network.create()`. If you are
about to write `hre.ethers`, `require()`, or `hardhat-waffle`, stop and read
`hardhat.config.ts` and an existing test first.

## Stack (pinned — do not bump casually)

- **Solidity 0.8.24**, exactly. Pinned in `hardhat.config.ts`, in every `pragma`, and in
  `.solhint.json`. Bumping it is a deliberate, single-commit change across all three.
- **Hardhat 3** (ESM), **viem**, **TypeScript 5** in strict mode.
- **OpenZeppelin Contracts v5** — `Ownable2Step`, `ReentrancyGuard`, `ECDSA`, `MessageHashUtils`,
  `SafeCast`.
- **Mocha + chai + fast-check** for tests. **Solhint + Prettier + Slither** for quality.
- Node >= 22.13.

**Do not add** without being asked: ethers.js, Foundry, Truffle, Waffle, hardhat-deploy, a proxy
/ upgradeability framework, or a second test runner.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | `hardhat compile` |
| `npm test` | Full suite (unit + integration + property + security) |
| `npm run coverage` | Coverage report |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Solhint over `src/**/*.sol` |
| `npm run format` / `format:check` | Prettier over Solidity + TS |
| `npm run slither` | Static analysis (needs Python + solc 0.8.24) |
| **`npm run verify:all`** | **compile + typecheck + lint + format:check + test** |

## Self-verification — run before declaring work done

```sh
npm run verify:all
```

Do not report a task complete until that passes. If you touched a `.sol` file, run
`npm run slither` too — a new finding is a failure, not a warning.

## Where things go

| You want to… | Go to |
|---|---|
| Add a contract | `src/core/` (+ its interface in `src/interfaces/`, + an import line in `slither-all.sol`) |
| Add a stateless helper | `src/libs/` — pure/view, no storage |
| Add a test-only contract | `src/test/` — excluded from lint and Slither, never deployed |
| Test one contract's behaviour | `test/unit/<Contract>.test.ts` |
| Test contracts working together | `test/integration/` |
| Test an invariant over random inputs | `test/property/*.property.test.ts` |
| Prove an attack still fails | `test/security/*.security.test.ts` |
| Add a fixture / signing helper | `test/helpers/` |
| Change **what** gets deployed | `config/topics.ts` |
| Change **how** it deploys (quorum, fee, signer count, chains) | `config/deployment.ts` |
| Touch the EIP-712 domain | `config/eip712.ts` **and** `src/libs/SignatureLib.sol` — both, or signatures stop verifying |
| Add a deploy step | `script/deploy/` |

## Solidity rules

- `// SPDX-License-Identifier: MIT` and `pragma solidity 0.8.24;` (exact, no caret) on every file.
- **Custom errors, never `require` with a string.** Include the values that explain the failure:
  `error InsufficientFee(uint256 sent, uint256 required)`.
- **NatSpec on every external/public symbol.** `@notice` for what, `@dev` for why and for the
  constraints a reader cannot see from the code.
- **Comment the *why*, never the *what*.** `// increment the counter` is noise. `// Wait for the
  receipt or the nonce tracker races the pending tx` is the reason the line exists. If a line is
  obvious, it needs no comment; if it is not, the comment must explain the reasoning, not restate
  the syntax.
- **Named imports only**: `import {Ownable2Step} from "..."`. Global imports are a Solhint error.
- **Interfaces are the dependency.** Contracts hold `ISignerSet`, not `SignerSet`.
- **`Ownable2Step`, not `Ownable`.** Two-step transfer; a typo cannot brick the contract.
- **Checks-Effects-Interactions AND `nonReentrant`** on anything that moves ether. Both.
- **Never read `address(this).balance` for accounting.** It can be force-inflated. Track it.
- **EIP-712**: `abi.encode`, never `abi.encodePacked`, for domain and struct hashes. Bind the
  digest to `chainId` and `address(this)`. Deduplicate recovered signers.
- **Slither suppressions go inline**, on the line, next to a comment explaining why the pattern is
  intentional. Never widen `slither.config.json` to silence a finding — the config has nowhere to
  put the reasoning. (The two detector *categories* already disabled there, `naming-convention` and
  `solc-version`, are a deliberate one-time policy choice; do not add more.)
- New contract? **Add it to `slither-all.sol`.** A contract missing from that file is invisible to
  static analysis and nothing will tell you.

## TypeScript / test rules

- ESM. `.js` extensions on relative imports (`../helpers/fixtures.js`) even though the source is
  `.ts` — that is ESM resolution, not a typo.
- `await network.create()` per test for an isolated chain. **Not** `network.connect()` — deprecated.
- Deploy through the fixture in `test/helpers/fixtures.ts`. Need a variant? Mutate the fixture
  from the owner account. Do not fork a second fixture — divergent fixtures are how a suite starts
  lying about the system it claims to cover.
- Assert reverts with `conn.viem.assertions.revertWithCustomError(...)`. Use
  `expectRevertWithMessage` from `test/helpers/reverts.ts` only where that cannot reach —
  constructor reverts, which have no contract handle to decode against.
- `contract.getEvents.Foo()` **only returns events from the latest block.** Pass
  `({}, { fromBlock: 0n })` when you want the whole history. This has bitten this repo already.
- Every new revert path gets its own test. Every new event gets asserted.
- Test names state the behaviour, not the function: "refuses to strand the threshold above the
  signer count", not "test removeSigner".

## Do / Don't

**DO**
- Run `npm run verify:all` before declaring done
- Add a test for every branch you add, including the reverts
- Add new contracts to `slither-all.sol`
- Explain intentional Slither findings inline
- Keep `config/topics.ts` the only place that decides what gets deployed

**DON'T**
- Don't add ethers.js, Foundry, or a second framework
- Don't use `require("...")` strings — custom errors only
- Don't float the pragma (`^0.8.24`)
- Don't silence Slither in the config file
- Don't hard-code a vault address in a consumer — resolve through the registry
- Don't commit `.env` or anything from `.signers/`
- Don't write a comment that restates the code

## PR & commit

- Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`).
- PR title imperative, under 70 chars. Body: summary + test plan (see
  `.github/PULL_REQUEST_TEMPLATE.md`).
- CI must be green: compile, test, lint/format/typecheck, Slither.
