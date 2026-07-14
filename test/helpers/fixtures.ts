// Deployment fixtures shared across the suite.
//
// One fixture, one fully-wired system. Tests that need a variant (a different threshold,
// a fee, a tightened `maxAge`) mutate it from the owner account rather than growing a
// second fixture — divergent fixtures are how test suites start lying about the system
// they claim to cover.

import { keccak256, toBytes, type Hex } from "viem";
import type { network } from "hardhat";

export type NetworkConnection = Awaited<ReturnType<typeof network.create>>;

/// Hardhat's wallet clients, unlike a bare viem `WalletClient`, carry a bound `account`. Derive
/// the type from the connection rather than importing viem's — otherwise `account` is
/// `Account | undefined` and every `getContractAt(..., { client: { wallet } })` fails to typecheck.
export type HardhatWalletClient = Awaited<ReturnType<NetworkConnection["viem"]["getWalletClients"]>>[number];

export const DEFAULT_DECIMALS = 8;
export const DEFAULT_FEE = 1_000_000_000_000_000n; // 0.001 ETH
export const DEFAULT_THRESHOLD = 2n;

/// The topic the fixture registers. Any `bytes32` works; hashing a human-readable label is
/// the convention because it is collision-resistant and readable in an explorer.
export const DEMO_TOPIC: Hex = keccak256(toBytes("ETH/USD"));

export interface DeployedSystem {
  signerSet: `0x${string}`;
  registry: `0x${string}`;
  vault: `0x${string}`;
  consumer: `0x${string}`;
  owner: HardhatWalletClient;
  ownerAddress: `0x${string}`;
  signers: HardhatWalletClient[];
  signerAddresses: `0x${string}`[];
  outsider: HardhatWalletClient;
  outsiderAddress: `0x${string}`;
  user: HardhatWalletClient;
  userAddress: `0x${string}`;
  threshold: bigint;
  topic: Hex;
  fee: bigint;
  chainId: bigint;
}

/// Deploy the whole system: SignerSet (3 signers, 2-of-3) → ExampleRegistry → ExampleVault
/// (fee = 0.001 ETH) → ExampleConsumer, with the topic registered.
///
/// `outsider` is an authorized-looking account that is deliberately NOT in the signer set —
/// every quorum test should prove its signature is ignored rather than counted.
export async function deploySystem(conn: NetworkConnection): Promise<DeployedSystem> {
  const wallets = await conn.viem.getWalletClients();
  const [owner, s1, s2, s3, user, outsider] = wallets;

  const ownerAddress = owner.account!.address;
  const signers = [s1, s2, s3];
  const signerAddresses: `0x${string}`[] = signers.map((s) => s.account!.address);

  const signerSet = await conn.viem.deployContract("SignerSet", [ownerAddress, signerAddresses, DEFAULT_THRESHOLD]);

  const registry = await conn.viem.deployContract("ExampleRegistry", [ownerAddress]);

  const vault = await conn.viem.deployContract("ExampleVault", [
    ownerAddress,
    signerSet.address,
    DEMO_TOPIC,
    DEFAULT_DECIMALS,
    DEFAULT_FEE,
  ]);

  await registry.write.registerTopic([DEMO_TOPIC, vault.address]);

  const consumer = await conn.viem.deployContract("ExampleConsumer", [registry.address]);

  const pub = await conn.viem.getPublicClient();
  const chainId = BigInt(await pub.getChainId());

  return {
    signerSet: signerSet.address,
    registry: registry.address,
    vault: vault.address,
    consumer: consumer.address,
    owner,
    ownerAddress,
    signers,
    signerAddresses,
    outsider,
    outsiderAddress: outsider.account!.address,
    user,
    userAddress: user.account!.address,
    threshold: DEFAULT_THRESHOLD,
    topic: DEMO_TOPIC,
    fee: DEFAULT_FEE,
    chainId,
  };
}
