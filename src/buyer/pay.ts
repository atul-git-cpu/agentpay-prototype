/**
 * Buyer: calls the seller's paid GSTIN API once per sample input,
 * paying per call in USDC through Circle Gateway (off-chain signature, no gas).
 *
 * Guardrail: stops before total spend would exceed MAX_SPEND_USDC.
 * (Phase 2 replaces this script with an AI agent making the same calls.)
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { parseUnits, formatUnits } from "viem";
import { config, CHAIN } from "../lib/config.js";
import { SAMPLE_GSTINS } from "../lib/gstin.js";

const buyer = new GatewayClient({ chain: CHAIN, privateKey: config.buyerKey() });
const base = config.sellerBaseUrl.replace(/\/$/, "");
const budget = parseUnits(String(config.maxSpendUsdc), 6);

const pricing = await fetch(`${base}/v1/pricing`).then((r) => r.json());
console.log(`Seller says: ${pricing.service} at ${pricing.pricePerCall} per call\n`);

const start = await buyer.getBalances();
console.log(`Buyer gateway balance: ${start.gateway.formattedAvailable} USDC (budget for this run: ${config.maxSpendUsdc} USDC)\n`);
if (start.gateway.available === 0n) {
  console.error("Gateway balance is 0. Run `npm run deposit` first.");
  process.exit(1);
}

let spent = 0n;
let paidCalls = 0;
for (const gstin of SAMPLE_GSTINS) {
  const price = parseUnits(String(pricing.pricePerCall).replace("$", ""), 6);
  if (spent + price > budget) {
    console.log(`Stopping: next call would exceed the ${config.maxSpendUsdc} USDC budget.`);
    break;
  }
  try {
    const result = await buyer.pay<Record<string, unknown>>(`${base}/v1/gstin/${gstin}`);
    spent += result.amount;
    paidCalls++;
    const d = result.data;
    const verdict = d.valid ? `VALID — ${d.state}, ${d.entityType}` : `INVALID — ${d.reason}`;
    console.log(`#${paidCalls} ${gstin}  paid ${result.formattedAmount} USDC  ->  ${verdict}`);
  } catch (err) {
    console.error(`  ${gstin}: payment or call failed — ${(err as Error).message}`);
  }
}

const end = await buyer.getBalances();
console.log(`\n${paidCalls} paid calls, ${formatUnits(spent, 6)} USDC spent.`);
console.log(`Buyer gateway balance now: ${end.gateway.formattedAvailable} USDC`);
console.log("Seller-side settlement log: data/settlements.jsonl  |  Next: `npm run reconcile`");
