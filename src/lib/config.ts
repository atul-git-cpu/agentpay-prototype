import "dotenv/config";
import type { Hex } from "viem";

/** Arc Testnet: Circle's chain, where USDC is also the gas token. */
export const CHAIN = "arcTestnet" as const;
/** CAIP-2 id for Arc Testnet (chain id 5042002), used by the seller middleware. */
export const ARC_TESTNET_NETWORK = "eip155:5042002";
/** Circle Gateway testnet API (facilitator) — verifies and settles x402 payments. */
export const GATEWAY_TESTNET_URL = "https://gateway-api-testnet.circle.com";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name} in .env. See the README for which setup step creates it.`,
    );
  }
  return value;
}

export const config = {
  buyerKey: () => required("BUYER_PRIVATE_KEY") as Hex,
  sellerKey: () => required("SELLER_PRIVATE_KEY") as Hex,
  sellerAddress: () => required("SELLER_ADDRESS"),
  port: Number(process.env.PORT ?? 3000),
  sellerBaseUrl: process.env.SELLER_BASE_URL ?? "http://localhost:3000",
  pricePerCall: process.env.PRICE_PER_CALL ?? "$0.002",
  maxSpendUsdc: Number(process.env.MAX_SPEND_USDC ?? 0.05),
  depositUsdc: process.env.DEPOSIT_USDC ?? "1",

  // Phase 2: Circle developer-controlled wallet for the agent
  circleApiKey: () => required("CIRCLE_API_KEY"),
  circleEntitySecret: () => required("CIRCLE_ENTITY_SECRET"),
  agentWalletId: () => required("AGENT_WALLET_ID"),
  agentWalletAddress: () => required("AGENT_WALLET_ADDRESS"),
  agentFundUsdc: process.env.AGENT_FUND_USDC ?? "0.5",
  agentBudgetUsdc: Number(process.env.AGENT_BUDGET_USDC ?? 0.02),
  agentMaxCalls: Number(process.env.AGENT_MAX_CALLS ?? 10),

  // Phase 2: model used by the agent (any OpenAI-compatible chat API)
  llmApiKey: () => required("LLM_API_KEY"),
  llmBaseUrl:
    process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
  llmModel: process.env.LLM_MODEL ?? "gemini-3.8-flash",

  // Phase 3: ledger + statements
  /** Indicative USD→INR rate for statements only. The real rate comes from the payout partner (Phase 4). */
  usdInrRate: Number(process.env.USD_INR_RATE ?? 95),
};

/** Circle's blockchain identifier for Arc Testnet (developer-controlled wallets API). */
export const CIRCLE_BLOCKCHAIN = "ARC-TESTNET" as const;

/** Log of each agent run: reasoning, tool calls and payments. */
export const AGENT_RUNS_FILE = new URL("../../data/agent-runs.jsonl", import.meta.url);
/** Circle entity-secret recovery file — keep it; it's the only way to reset the secret. */
export const RECOVERY_FILE = new URL("../../data/circle-recovery-file.dat", import.meta.url);
/** Ledger file written by the seller as each payment settles. */
export const SETTLEMENTS_FILE = new URL("../../data/settlements.jsonl", import.meta.url);
