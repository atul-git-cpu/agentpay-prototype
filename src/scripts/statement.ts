/**
 * Usage statement for one seller over a period, denominated in fiat.
 *
 * Stablecoins settle the payments, but exports are priced and documented in fiat:
 * the statement shows USD (USDC ≈ USD 1:1) and an indicative INR amount, plus the
 * RBI purpose code the INR remittance will carry. It's the document an Indian
 * seller's accountant needs, and what the payout (Phase 4) is matched against.
 *
 * Usage: npm run statement                       (first seller, current month)
 *        npm run statement -- --seller 1 --from 2026-10-01 --to 2026-10-31
 */
import { mkdir, writeFile } from "node:fs/promises";
import { formatUnits } from "viem";
import { config } from "../lib/config.js";
import { getDatabase } from "../db/client.js";
import { payerLabels, shortAddress } from "../lib/payers.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const now = new Date();
const from = arg("from") ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
const to = arg("to") ?? now.toISOString().slice(0, 10);

const db = getDatabase();
const sellers = await db.sql<{
  id: number; name: string; wallet_address: string; country: string; payout_method: string;
  payout_currency: string; purpose_code: string | null;
}>(`SELECT * FROM sellers ${arg("seller") ? "WHERE id = $1" : "ORDER BY id LIMIT 1"}`, arg("seller") ? [Number(arg("seller"))] : []);
const seller = sellers[0];
if (!seller) {
  console.error("Seller not found. Run `npm run db:migrate` first.");
  process.exit(1);
}

const rows = await db.sql<{ day: string; payer: string; status: string; calls: string; amount: string }>(
  `SELECT to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, payer, status,
          COUNT(*) AS calls, SUM(amount_atomic) AS amount
   FROM payments
   WHERE seller_id = $1 AND recorded_at >= $2::date AND recorded_at < ($3::date + 1) AND status <> 'failed'
   GROUP BY 1, 2, 3 ORDER BY 1, 2`,
  [seller.id, from, to],
);
await db.close();

const labels = payerLabels();
const usd = (atomic: bigint) => Number(formatUnits(atomic, 6));
const fmtUsd = (n: number) => `$${n.toFixed(6)}`;
const fmtInr = (n: number) => `₹${(n * config.usdInrRate).toFixed(2)}`;

let totalCalls = 0;
let gross = 0n;
let settled = 0n;
const byPayer = new Map<string, { calls: number; amount: bigint }>();
const byDay = new Map<string, { calls: number; amount: bigint }>();
for (const r of rows) {
  const calls = Number(r.calls);
  const amount = BigInt(r.amount);
  totalCalls += calls;
  gross += amount;
  if (r.status === "confirmed" || r.status === "completed") settled += amount;
  const p = byPayer.get(r.payer) ?? { calls: 0, amount: 0n };
  byPayer.set(r.payer, { calls: p.calls + calls, amount: p.amount + amount });
  const d = byDay.get(r.day) ?? { calls: 0, amount: 0n };
  byDay.set(r.day, { calls: d.calls + calls, amount: d.amount + amount });
}

const lines: string[] = [];
lines.push(`# Usage statement — ${seller.name}`);
lines.push("");
lines.push(`Period: ${from} to ${to} (UTC)  ·  Seller #${seller.id}  ·  Wallet ${seller.wallet_address}`);
lines.push(`Country: ${seller.country}  ·  Payout: ${seller.payout_method} in ${seller.payout_currency}` +
  (seller.purpose_code ? `  ·  RBI purpose code: ${seller.purpose_code}` : ""));
lines.push("");
lines.push("## Summary");
lines.push("");
lines.push("| | Calls | USD | INR (indicative) |");
lines.push("|---|---:|---:|---:|");
lines.push(`| Gross usage | ${totalCalls} | ${fmtUsd(usd(gross))} | ${fmtInr(usd(gross))} |`);
lines.push(`| Settled by Circle | | ${fmtUsd(usd(settled))} | ${fmtInr(usd(settled))} |`);
lines.push(`| Pending settlement | | ${fmtUsd(usd(gross - settled))} | ${fmtInr(usd(gross - settled))} |`);
lines.push("");
lines.push("## By buyer");
lines.push("");
lines.push("| Buyer | Calls | USD |");
lines.push("|---|---:|---:|");
for (const [payer, v] of byPayer) {
  lines.push(`| ${labels.get(payer) ?? "External buyer"} (${shortAddress(payer)}) | ${v.calls} | ${fmtUsd(usd(v.amount))} |`);
}
lines.push("");
lines.push("## By day");
lines.push("");
lines.push("| Day | Calls | USD |");
lines.push("|---|---:|---:|");
for (const [day, v] of byDay) lines.push(`| ${day} | ${v.calls} | ${fmtUsd(usd(v.amount))} |`);
lines.push("");
lines.push("## Notes");
lines.push("");
lines.push("- Payments were collected per call in USDC (Circle Gateway Nanopayments, Arc Testnet). USDC is treated as USD 1:1.");
lines.push(`- INR is indicative at ${config.usdInrRate} INR/USD. The actual rate is set by the licensed payout partner at conversion.`);
if (seller.country === "IN") {
  lines.push("- For India: the stablecoin leg stays offshore; the seller receives INR via an authorised dealer bank with an e-FIRA " +
    `carrying purpose code ${seller.purpose_code ?? "(to be set)"}. Testnet prototype — no real funds.`);
}

const text = lines.join("\n") + "\n";
console.log(text);
await mkdir(new URL("../../data/statements/", import.meta.url), { recursive: true });
const file = new URL(`../../data/statements/seller-${seller.id}_${from}_${to}.md`, import.meta.url);
await writeFile(file, text);
console.log(`Saved: data/statements/seller-${seller.id}_${from}_${to}.md`);
