/** Human-readable labels for payer addresses we know about. */
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export function payerLabels(): Map<string, string> {
  const labels = new Map<string, string>();
  const buyerKey = process.env.BUYER_PRIVATE_KEY as Hex | undefined;
  if (buyerKey) labels.set(privateKeyToAccount(buyerKey).address.toLowerCase(), "Script buyer (Phase 1)");
  const agent = process.env.AGENT_WALLET_ADDRESS;
  if (agent) labels.set(agent.toLowerCase(), "AI agent (Circle wallet)");
  return labels;
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
