/** Per-seller balances from the double-entry ledger, plus an integrity check. */
import { formatUnits } from "viem";
import { config } from "../lib/config.js";
import { getDatabase } from "../db/client.js";
import { sellerBalances, ledgerImbalance } from "../db/ledger.js";

const usd = (atomic: bigint) => formatUnits(atomic, 6);
const db = getDatabase();
const balances = await sellerBalances(db.sql);

console.log("Seller balances (USDC)\n");
for (const b of balances) {
  const total = b.pending + b.available + b.paidOut;
  console.log(`#${b.sellerId} ${b.name}  [${b.country}, payout: ${b.payoutMethod}]`);
  console.log(`   paid calls:  ${b.calls}`);
  console.log(`   pending:     ${usd(b.pending).padStart(10)}   (paid by buyers, awaiting Circle batch settlement)`);
  console.log(`   available:   ${usd(b.available).padStart(10)}   (settled, ready to pay out)`);
  console.log(`   paid out:    ${usd(b.paidOut).padStart(10)}   (Phase 4)`);
  console.log(`   total earned ${usd(total).padStart(10)}   ≈ ₹${(Number(usd(total)) * config.usdInrRate).toFixed(2)} at indicative ${config.usdInrRate}\n`);
}

const imbalance = await ledgerImbalance(db.sql);
console.log(`Ledger integrity: ${imbalance === 0n ? "OK (all entries sum to zero)" : `IMBALANCED by ${imbalance}`}`);
await db.close();
