/**
 * Compliance trail (evidence pack) for one payout.
 *   npm run trail                     latest payout
 *   npm run trail -- --payout 1       a specific payout
 *   npm run trail -- --payment 7      the payout that paid out call #7 (highlighted)
 *   npm run trail -- --all            one file per payout
 * Printed and saved to data/trails/payout-<id>.md
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { getDatabase } from "../db/client.js";
import { buildTrail, renderTrail } from "../compliance/trail.js";
import { screen } from "../compliance/screening.js";
import { syncAgentRuns, syncWalletLabels } from "../db/sync.js";
import { AGENT_RUNS_FILE } from "../lib/config.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const db = getDatabase();
// Agent runs and wallet names live locally; copy them in so the trail (and dashboard) can show them.
await syncAgentRuns(db.sql, AGENT_RUNS_FILE);
await syncWalletLabels(db.sql);

let ids: number[] = [];
let highlight: number | undefined;
if (process.argv.includes("--all")) {
  ids = (await db.sql<{ id: number }>(`SELECT id FROM payouts ORDER BY id`)).map((r) => r.id);
} else if (arg("payment")) {
  highlight = Number(arg("payment"));
  const r = await db.sql<{ payout_id: number | null }>(`SELECT payout_id FROM payments WHERE id = $1`, [highlight]);
  if (!r[0]) throw new Error(`Payment #${highlight} not found`);
  if (!r[0].payout_id) {
    console.log(`Payment #${highlight} hasn't been paid out yet (still pending or available). Run \`npm run payouts\`.`);
    process.exit(0);
  }
  ids = [r[0].payout_id];
} else if (arg("payout")) {
  ids = [Number(arg("payout"))];
} else {
  ids = (await db.sql<{ id: number }>(`SELECT id FROM payouts ORDER BY id DESC LIMIT 1`)).map((r) => r.id);
}
if (!ids.length) {
  console.log("No payouts yet. Run `npm run payouts` first.");
  process.exit(0);
}

await mkdir(new URL("../../data/trails/", import.meta.url), { recursive: true });
for (const id of ids) {
  // Payouts made before Phase 5 have no screening on record: screen now (the timestamp shows when).
  const s = (await db.sql<{ seller_id: number; country: string; wallet_address: string; screened: number }>(
    `SELECT p.seller_id, s.country, s.wallet_address,
            (SELECT COUNT(*)::int FROM screenings WHERE subject = 'seller:' || p.seller_id) AS screened
     FROM payouts p JOIN sellers s ON s.id = p.seller_id WHERE p.id = $1`, [id]))[0];
  if (s && !s.screened) {
    const payers = await db.sql<{ payer: string }>(`SELECT DISTINCT payer FROM payments WHERE payout_id = $1`, [id]);
    await screen(db, { id: s.seller_id, country: s.country, wallet_address: s.wallet_address }, payers.map((p) => p.payer));
  }
  const md = renderTrail(await buildTrail(db, id), highlight);
  const file = new URL(`../../data/trails/payout-${id}.md`, import.meta.url);
  await writeFile(file, md);
  if (ids.length === 1) console.log(md);
  console.log(`Saved: data/trails/payout-${id}.md`);
}
await db.close();
