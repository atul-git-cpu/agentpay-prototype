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
      `Missing ${name} in .env. Run \`npm run wallet:new\` first (see README).`,
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
};

/** Ledger file written by the seller as each payment settles. */
export const SETTLEMENTS_FILE = new URL("../../data/settlements.jsonl", import.meta.url);
