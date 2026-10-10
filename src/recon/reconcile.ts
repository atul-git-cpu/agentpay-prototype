/**
 * Reconciliation: match recorded payments (by nonce) against Circle Gateway's
 * transfer records and advance their status.
 *
 * With DATABASE_URL: updates the Postgres ledger — settled payments move from the
 * seller's `pending` to `available` balance exactly once.
 * Without it: read-only report from data/settlements.jsonl (Phase 1 behaviour).
 *
 * Status meaning (Circle): `confirmed` = safe to credit, `completed` = settled on-chain, `failed` = void.
 */
import { readFile } from "node:fs/promises";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { formatUnits, type Hex } from "viem";
import { config, CHAIN, SETTLEMENTS_FILE } from "../lib/config.js";
import { getDatabase, hasDatabase } from "../db/client.js";
import { applyStatus, ledgerImbalance, type PaymentStatus } from "../db/ledger.js";

const gateway = new GatewayClient({ chain: CHAIN, privateKey: config.sellerKey() });

async function lookup(nonce: string): Promise<{ status: string; transferId?: string }> {
  try {
    const res = await gateway.searchTransfers({ nonce: nonce as Hex });
    const t = res.transfers[0];
    return t ? { status: t.status, transferId: t.id } : { status: "not_found" };
  } catch (err) {
    return { status: `lookup_error: ${(err as Error).message}` };
  }
}

const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

if (hasDatabase()) {
  const db = getDatabase();
  const open = await db.sql<{ id: number; nonce: string; amount_atomic: string; status: string }>(
    `SELECT id, nonce, amount_atomic, status FROM payments
     WHERE status NOT IN ('completed', 'failed') ORDER BY id`,
  );
  console.log(`Reconciling ${open.length} open payment(s) in the ledger against Circle Gateway…\n`);
  for (const p of open) {
    const { status, transferId } = await lookup(p.nonce);
    const known = ["received", "batched", "confirmed", "completed", "failed"].includes(status);
    const now = known ? await applyStatus(db, p.id, status as PaymentStatus, transferId) : p.status;
    bump(known ? now : status);
    console.log(`#${p.id} ${p.nonce.slice(0, 12)}…  ${formatUnits(BigInt(p.amount_atomic), 6)} USDC  ${p.status} -> ${now}`);
  }
  const imbalance = await ledgerImbalance(db.sql);
  console.log("\nSummary:", Object.keys(counts).length ? counts : "nothing open");
  console.log(`Ledger integrity: ${imbalance === 0n ? "OK (all entries sum to zero)" : `IMBALANCED by ${imbalance}`}`);
  console.log("Balances: `npm run ledger`");
  await db.close();
} else {
  let rows: { event: string; nonce?: string; amountUsdc: string }[] = [];
  try {
    rows = (await readFile(SETTLEMENTS_FILE, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    console.log("No settlements yet. Start the seller and run `npm run buy` first.");
    process.exit(0);
  }
  let creditable = 0;
  console.log(`Reconciling ${rows.length} recorded payment(s) against Circle Gateway (no database)…\n`);
  for (const row of rows) {
    if (row.event !== "settled" || !row.nonce) { bump("settle_failed (local)"); continue; }
    const { status, transferId } = await lookup(row.nonce);
    bump(status);
    if (status === "confirmed" || status === "completed") creditable += Number(row.amountUsdc);
    console.log(`${row.nonce.slice(0, 12)}…  ${row.amountUsdc} USDC  ${status.padEnd(10)}  transfer ${transferId ?? "-"}`);
  }
  console.log("\nSummary:", counts);
  console.log(`Creditable to seller (confirmed + completed): ${creditable.toFixed(6)} USDC`);
}
