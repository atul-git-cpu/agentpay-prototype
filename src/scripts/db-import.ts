/**
 * Imports payments already recorded in data/settlements.jsonl (Phase 1-2) into the ledger.
 * Idempotent: payments are keyed by nonce, so running it twice changes nothing.
 */
import { readFile } from "node:fs/promises";
import { SETTLEMENTS_FILE } from "../lib/config.js";
import { getDatabase } from "../db/client.js";
import { recordPayment } from "../db/ledger.js";

type Row = { event: string; nonce?: string; payer?: string; payTo: string; amountAtomic: string;
             network: string; resource?: string; at: string };

let rows: Row[] = [];
try {
  rows = (await readFile(SETTLEMENTS_FILE, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
} catch {
  console.log("No data/settlements.jsonl found — nothing to import.");
  process.exit(0);
}

const db = getDatabase();
let imported = 0;
let skipped = 0;
for (const r of rows) {
  if (r.event !== "settled" || !r.nonce || !r.payer) { skipped++; continue; }
  const id = await recordPayment(db, {
    nonce: r.nonce, sellerAddress: r.payTo, payer: r.payer, amountAtomic: BigInt(r.amountAtomic),
    network: r.network, resource: r.resource, recordedAt: r.at,
  });
  if (id === null) { skipped++; console.log(`  skipped ${r.nonce.slice(0, 12)}… (seller ${r.payTo} not registered)`); }
  else imported++;
}
console.log(`Imported ${imported} payment(s) into the ledger (${skipped} skipped). Next: \`npm run reconcile\``);
await db.close();
