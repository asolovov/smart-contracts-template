// Deployment parameters, in ONE place.
//
// Everything the deploy scripts decide lives here: how many signers, how big a quorum, what the
// request fee is, and which chains we know how to deploy to. `config/topics.ts` says *what* gets
// deployed; this file says *how*.
//
// The rule that makes this worth having: a constant duplicated between the deploy script and the
// verification script is a constant that will eventually disagree with itself, and the symptom is
// an Etherscan verification that fails with a constructor-args mismatch for no visible reason.
// So `deployAll.ts` writes every deploy parameter it used into `addresses.json`, and
// `verifyAll.sh` reads them back from there rather than re-declaring them.

/// Number of signer keypairs to generate / authorize.
export const SIGNER_COUNT = 3;

/// The M in M-of-N. Must satisfy `0 < THRESHOLD <= SIGNER_COUNT`.
export const THRESHOLD = 2n;

/// Per-request fee charged by every deployed vault, in wei. `0n` = free.
export const REQUEST_FEE = 0n;

/// Refuse to start a deploy below this balance. A run that dies halfway leaves a half-wired
/// system on-chain, which is far more annoying than a deploy that refuses to start.
export const MIN_DEPLOYER_BALANCE = 30_000_000_000_000_000n; // 0.03 ETH

export interface NetworkInfo {
  /// Directory name under `deployments/`.
  name: string;
  /// Block explorer, for the deploy summary.
  explorer: string;
}

/// Chains this repo knows how to deploy to, keyed by chain id.
///
/// The deploy scripts take the network from the `--network` flag and then look the resulting
/// chain id up here. Adding a chain means: an entry here, plus a matching `networks` entry in
/// `hardhat.config.ts`. Nothing else — no script edits.
export const NETWORKS: Record<number, NetworkInfo> = {
  11155111: { name: "sepolia", explorer: "https://sepolia.etherscan.io" },
};

/// Resolve a chain id to its deployment metadata, failing loudly on an unknown chain.
///
/// This is the guard against the single most expensive deploy mistake: an RPC URL that quietly
/// points at a different chain than you think it does.
export function networkInfo(chainId: number): NetworkInfo {
  const info = NETWORKS[chainId];
  if (info === undefined) {
    const known = Object.entries(NETWORKS)
      .map(([id, n]) => `${n.name} (${id})`)
      .join(", ");
    throw new Error(`unknown chain id ${chainId}. Add it to NETWORKS in config/deployment.ts. Known: ${known}`);
  }
  return info;
}
