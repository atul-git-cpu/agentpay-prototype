/**
 * Demo of fixing a failed payout: the Kenya seller's bank name was rejected by the
 * SWIFT partner's pre-validation. This "corrects" it, so the next `npm run payouts` succeeds.
 *   npm run sellers:fix-bank            (fixes the Kenya seller)
 *   npm run sellers:fix-bank -- <id>    (fixes seller #id)
 */
import "dotenv/config";
import { getDatabase } from "../db/client.js";

const arg = process.argv[2];
const db = getDatabase();
const rows = await db.sql<{ id: number; name: string }>(
  arg
    ? `UPDATE sellers SET bank_details = COALESCE(bank_details, '{}'::jsonb) || '{"valid": true}'::jsonb WHERE id = $1 RETURNING id, name`
    : `UPDATE sellers SET bank_details = COALESCE(bank_details, '{}'::jsonb)
         || jsonb_build_object('valid', true, 'accountName', 'Nairobi KRA PIN Data Ltd')
       WHERE country = 'KE' RETURNING id, name`,
  arg ? [Number(arg)] : [],
);
if (!rows.length) console.log("No matching seller.");
for (const r of rows) console.log(`#${r.id} ${r.name}: beneficiary details corrected. Run \`npm run payouts\` again.`);
await db.close();
