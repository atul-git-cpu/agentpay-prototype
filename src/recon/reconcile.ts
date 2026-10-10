/**
 * Reconciliation: match every payment the seller recorded (by nonce) against
 * Circle Gateway's transfer records, and report its settlement status.
 *
 * Status meaning (from Circle's guide): `confirmed` = safe to credit the seller,
 * `completed` = settled on-chain, `failed` = do not count it.
 */
import { readFile } from "node:fs/promises";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";
import { config, CHAIN, SETTLEMENTS_FILE } from "../lib/config.js";

type Row = { event: string; nonce?: string; amountUsdc: string; payer?: string; at: string };

let rows: Row[] = [];
try {
  rows = (await readFile(SETTLEMENTS_FILE, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
} catch {
  console.log("No settlements yet. Start the seller and run `npm run buy` first.");
  process.exit(0);
}

const seller = new GatewayClient({ chain: CHAIN, privateKey: config.sellerKey() });
const counts: Record<string, number> = {};
let creditable = 0;

console.log(`Reconciling ${rows.length} recorded payment(s) against Circle Gateway…\n`);
for (const row of rows) {
  if (row.event !== "settled" || !row.nonce) {
    counts["settle_failed (local)"] = (counts["settle_failed (local)"] ?? 0) + 1;
    continue;
  }
  let status = "not_found";
  let transferId = "-";
  try {
    const res = await seller.searchTransfers({ nonce: row.nonce as Hex });
    const transfer = res.transfers[0];
    if (transfer) {
      status = transfer.status;
      transferId = transfer.id;
    }
  } catch (err) {
    status = `lookup_error: ${(err as Error).message}`;
  }
  counts[status] = (counts[status] ?? 0) + 1;
  if (status === "confirmed" || status === "completed") creditable += Number(row.amountUsdc);
  console.log(`${row.nonce.slice(0, 12)}…  ${row.amountUsdc} USDC  ${status.padEnd(10)}  transfer ${transferId}`);
}

console.log("\nSummary:", counts);
console.log(`Creditable to seller (confirmed + completed): ${creditable.toFixed(6)} USDC`);
