# deployments/

One subdirectory per network. **These files are committed** — they are how off-chain services,
frontends, and a future you learn where the contracts live and what shape they are.

| File / dir | Written by | Read by |
|---|---|---|
| `addresses.json` | `script/deploy/deployAll.ts` | off-chain services, frontends, `smokeTest.ts`, `verifyAll.sh` |
| `abis/*.json` | `script/deploy/deployAll.ts` (copied from `artifacts/`) | anything that needs to encode a call — viem, ethers, Go bindings |
| `.verify-args/` | `script/deploy/verifyAll.sh` | `hardhat verify` (constructor args). Transient, gitignored. |

There is deliberately **no `<network>/` directory in the template**. It appears the first time
you deploy. Committing an empty one would suggest a deployment exists when none does.

## Deploying

```sh
cp .env.example .env          # set SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY
npx hardhat compile
npx hardhat run script/deploy/deployAll.ts --network sepolia
sh script/deploy/verifyAll.sh sepolia
npx hardhat run script/deploy/smokeTest.ts --network sepolia   # ALWAYS run this
git add deployments/sepolia && git commit -m "chore: deploy to sepolia"
```

## Deploying to a different chain

The scripts are not hardcoded to Sepolia. `--network` sets Hardhat's default network, the scripts
ask the chain for its id, and look that id up in `config/deployment.ts`. Adding a chain is two
entries and no script edits:

1. `hardhat.config.ts` → a new key under `networks` (url, chainId, accounts).
2. `config/deployment.ts` → a new entry in `NETWORKS`, keyed by chain id, giving the directory
   name and the explorer URL.

**The two names must match.** The key in `hardhat.config.ts#networks` and the `name` in `NETWORKS`
are used interchangeably — `sh script/deploy/verifyAll.sh <name>` passes the same string to
`--network` and to `deployments/<name>/`.

An unknown chain id fails loudly rather than writing artefacts into a directory you did not mean.
That check is deliberate: an RPC URL quietly pointing at a different chain than you think it does
is the most expensive deploy mistake there is.

Deploy parameters — signer count, quorum threshold, request fee, the minimum deployer balance —
all live in `config/deployment.ts`. `deployAll.ts` records every one of them it used into
`addresses.json`, and `verifyAll.sh` reads them back from there, so the constructor args used to
verify can never drift from the ones used to deploy.

The smoke test is not optional. A green CI proves the code is correct; only the smoke test
proves the thing you just put on-chain is *wired* correctly — right owner, right signer set,
reachable through the registry, able to accept a real attestation. Run it before you tell
anyone the deploy is done.

## Redeploying

The scripts do not resume or upgrade in place; a re-run deploys fresh contracts. Two ways to
ship a change:

1. **Full redeploy.** Wipe the network directory, re-run `deployAll.ts`, commit the new
   `addresses.json`. Downstream services need a config refresh. Simplest, and the right default
   on a testnet.
2. **Repoint one topic.** Deploy a single new `ExampleVault` and call
   `registry.registerTopic(topic, newVault)` — it accepts overwrites and emits `TopicUpdated`.
   Consumers that resolve through the registry follow automatically with no redeploy. Note in
   the CHANGELOG which topic moved and to what address.

## Signer keys

`deployAll.ts` generates signer keypairs into `.signers/` (gitignored) on first run. That is a
**testnet convenience, not a production pattern** — it puts every key of an M-of-N set on one
machine, which is an N-of-N failure mode wearing an M-of-N costume. In production each signer
is an independent operator who generates their key in their own HSM/KMS and gives you only the
address; you pass those addresses to the `SignerSet` constructor and never see a private key.
