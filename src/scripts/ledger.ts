/** Per-seller balances, payouts and platform accounts from the double-entry ledger, plus an integrity check. */
import { formatUnits } from "viem";
import { config } from "../lib/config.js";
import { getDatabase } from "../db/client.js";
import { sellerBalances, ledgerImbalance } from "../db/ledger.js";

const usd = (atomic: bigint) => formatUnits(atomic, 6);
const pad = (atomic: bigint) => usd(atomic).padStart(10);
const showDocs = process.argv.includes("--docs");
const db = getDatabase();

const earned = new Map(
  (await db.sql<{ seller_id: number; total: string }>(
    `SELECT seller_id, COALESCE(SUM(amount_atomic), 0)::text AS total FROM payments WHERE status <> 'failed' GROUP BY 1`,
  )).map((r) => [r.seller_id, BigInt(r.total)]),
);
const fees = new Map(
  (await db.sql<{ seller_id: number; total: string }>(
    `SELECT seller_id, COALESCE(SUM(platform_fee_atomic + network_fee_atomic), 0)::text AS total
     FROM payouts WHERE status = 'paid' GROUP BY 1`,
  )).map((r) => [r.seller_id, BigInt(r.total)]),
);

console.log("Seller balances (USDC)\n");
for (const b of await sellerBalances(db.sql)) {
  const total = earned.get(b.sellerId) ?? 0n;
  console.log(`#${b.sellerId} ${b.name}  [${b.country}, payout: ${b.payoutMethod}]`);
  console.log(`   paid calls:  ${b.calls}   earned ${usd(total)} USDC ≈ ₹${(Number(usd(total)) * config.usdInrRate).toFixed(2)} (indicative ${config.usdInrRate})`);
  console.log(`   pending:   ${pad(b.pending)}   paid by buyers, awaiting Circle batch settlement`);
  console.log(`   available: ${pad(b.available)}   settled, ready to pay out`);
  console.log(`   in flight: ${pad(b.inFlight)}   payout started, partner's fiat leg not done yet`);
  console.log(`   paid out:  ${pad(b.paidOut)}   received by the seller (net of fees)`);
  console.log(`   fees:      ${pad(fees.get(b.sellerId) ?? 0n)}   platform fee + Gateway withdrawal fee\n`);
}

const accounts = await db.sql<{ account: string; total: string }>(
  `SELECT account, SUM(amount_atomic)::text AS total FROM ledger_entries
   WHERE account IN ('platform:fees', 'network:gateway_fees') GROUP BY 1`,
);
const acct = (name: string) => BigInt(accounts.find((a) => a.account === name)?.total ?? "0");
console.log(`Platform revenue (platform:fees):          ${usd(acct("platform:fees"))} USDC`);
console.log(`Gateway withdrawal fees (network:gateway_fees): ${usd(acct("network:gateway_fees"))} USDC (reserved per payout)\n`);

const payouts = await db.sql<{
  id: number; name: string; method: string; status: string; net_atomic: string; payout_currency: string;
  payout_amount: string | null; onchain_tx: string | null; failure_reason: string | null;
  document: Record<string, unknown> | null; expected_at: Date | null;
}>(
  `SELECT p.id, s.name, p.method, p.status, p.net_atomic::text AS net_atomic, p.payout_currency,
          p.payout_amount::text AS payout_amount, p.onchain_tx, p.failure_reason, p.document, p.expected_at
   FROM payouts p JOIN sellers s ON s.id = p.seller_id ORDER BY p.id`,
);
if (payouts.length) {
  console.log("Payouts");
  for (const p of payouts) {
    const fiat = p.payout_currency !== "USDC" && p.payout_amount ? ` → ${p.payout_currency} ${Number(p.payout_amount).toFixed(2)}` : "";
    console.log(`  #${p.id} ${p.status.toUpperCase().padEnd(10)} ${p.name} via ${p.method}: ${usd(BigInt(p.net_atomic))} USDC${fiat}`);
    if (p.onchain_tx) console.log(`       on-chain: ${p.onchain_tx}`);
    if (p.failure_reason) console.log(`       reason: ${p.failure_reason}`);
    if (p.status === "processing" && p.expected_at) console.log(`       fiat expected: ${new Date(p.expected_at).toISOString().slice(0, 16)} UTC`);
    if (p.document) {
      if (showDocs) {
        for (const [k, v] of Object.entries(p.document)) console.log(`       ${k}: ${v}`);
      } else {
        const id = p.document.firaNumber ?? p.document.uetr ?? p.document.endToEndId ?? p.document.trace ?? p.document.transaction;
        console.log(`       document: ${p.document.type}${id ? ` (${id})` : ""}   — add -- --docs for full details`);
      }
    }
  }
  console.log();
}

const imbalance = await ledgerImbalance(db.sql);
console.log(`Ledger integrity: ${imbalance === 0n ? "OK (all entries sum to zero)" : `IMBALANCED by ${imbalance}`}`);
await db.close();
