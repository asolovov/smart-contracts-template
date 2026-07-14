// Canonical topic table — the single source of truth for what gets deployed.
//
// The deploy script iterates this list; off-chain services and the frontend can import it to
// stay in lockstep with the chain. Keep it declarative: if adding a topic requires touching
// anything but this file, the deploy script has a hard-coding problem.

import { keccak256, toBytes, type Hex } from "viem";

export interface TopicConfig {
  /// Short symbol, used in logs and as the key in `deployments/<network>/addresses.json`.
  symbol: string;
  /// Human-readable label. The `topicId` is its keccak256 hash.
  label: string;
  /// Decimal places the attested value is expressed in. 8 is the common convention for prices.
  decimals: number;
}

export interface Topic extends TopicConfig {
  /// keccak256(label) — the on-chain identifier.
  topicId: Hex;
}

const CONFIG: TopicConfig[] = [
  { symbol: "ETH", label: "ETH/USD", decimals: 8 },
  { symbol: "BTC", label: "BTC/USD", decimals: 8 },
];

/// Derive the on-chain id once, here, so no other file ever hashes a label itself. Two places
/// computing the same id is two places to get it subtly wrong.
export const TOPICS: Topic[] = CONFIG.map((c) => ({ ...c, topicId: keccak256(toBytes(c.label)) }));

export function topicBySymbol(symbol: string): Topic {
  const found = TOPICS.find((t) => t.symbol === symbol);
  if (!found) throw new Error(`unknown topic symbol: ${symbol}`);
  return found;
}
