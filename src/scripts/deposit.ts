/**
 * One-time, on-chain step: move the buyer's USDC into Circle Gateway.
 * After this, every API call is paid with an off-chain signature (no gas).
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { parseUnits } from "viem";
import { config, CHAIN } from "../lib/config.js";

const buyer = new GatewayClient({ chain: CHAIN, privateKey: config.buyerKey() });
const target = parseUnits(config.depositUsdc, 6);

const before = await buyer.getBalances();
console.log(`Buyer ${buyer.address}`);
console.log(`  wallet USDC: ${before.wallet.formatted} | gateway available: ${before.gateway.formattedAvailable}`);

if (before.gateway.available >= target) {
  console.log(`Gateway balance already ≥ ${config.depositUsdc} USDC — no deposit needed.`);
  process.exit(0);
}
if (before.wallet.balance < target) {
  console.error(
    `Wallet has ${before.wallet.formatted} USDC but ${config.depositUsdc} is needed.\n` +
      "Fund the buyer at https://faucet.circle.com (Arc Testnet) and try again.",
  );
  process.exit(1);
}

console.log(`Depositing ${config.depositUsdc} USDC into Gateway (on-chain, takes a few seconds)…`);
const result = await buyer.deposit(config.depositUsdc);
console.log(`  approval tx: ${result.approvalTxHash ?? "(not needed)"}`);
console.log(`  deposit tx:  ${result.depositTxHash}`);

const after = await buyer.getBalances();
console.log(`Done. Gateway available: ${after.gateway.formattedAvailable} USDC`);
console.log("(If it still shows 0, wait ~30s and run `npm run balance` — the deposit needs to be indexed.)");
