/** Shows wallet and Gateway balances for the buyer and the seller. */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Address } from "viem";
import { config, CHAIN } from "../lib/config.js";

const buyer = new GatewayClient({ chain: CHAIN, privateKey: config.buyerKey() });
const sellerAddress = config.sellerAddress() as Address;

const [b, s] = await Promise.all([buyer.getBalances(), buyer.getBalances(sellerAddress)]);

console.log("Arc Testnet balances (USDC)\n");
console.log(`Buyer  ${buyer.address}`);
console.log(`  wallet:            ${b.wallet.formatted}`);
console.log(`  gateway available: ${b.gateway.formattedAvailable}\n`);
console.log(`Seller ${sellerAddress}`);
console.log(`  wallet:            ${s.wallet.formatted}`);
console.log(`  gateway available: ${s.gateway.formattedAvailable}`);
const agentAddress = process.env.AGENT_WALLET_ADDRESS as Address | undefined;
if (agentAddress) {
  const a = await buyer.getBalances(agentAddress);
  console.log(`\nAgent  ${agentAddress} (Circle-managed)`);
  console.log(`  wallet:            ${a.wallet.formatted}`);
  console.log(`  gateway available: ${a.gateway.formattedAvailable}`);
}
console.log("\n(Seller earnings land in its Gateway balance once Circle settles the batch.)");
