/**
 * Creates the ledger tables in Postgres (Neon) and registers the Phase 1 seller
 * as an Indian seller paid out in INR via the licensed-partner route (Phase 4).
 * Safe to re-run.
 */
import { readFile } from "node:fs/promises";
import { parseUnits } from "viem";
import { config } from "../lib/config.js";
import { getDatabase } from "../db/client.js";
import { upsertSeller } from "../db/ledger.js";
import { SELLERS } from "../lib/services.js";
import { routeFor } from "../payouts/jurisdiction.js";

const db = getDatabase();
const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
await db.sql(schema);
console.log("Tables ready: sellers, payments, ledger_entries, payouts");

const sellerId = await upsertSeller(db.sql, {
  name: "Hyderabad GST Data Services (sample)",
  walletAddress: config.sellerAddress(),
  country: "IN",
  payoutMethod: "india_partner",
  payoutCurrency: "INR",
  payoutThresholdAtomic: parseUnits("0.01", 6), // low threshold so the demo can pay out
  purposeCode: "P0807", // information/data services export — confirm with the AD bank
  payoutPreference: "fiat",
  bankDetails: SELLERS[0].bank,
  payoutReason: routeFor("IN", "fiat").reasons.join(" | "),
});
console.log(`Seller registered (id ${sellerId}): India, paid out in INR via licensed partner, purpose code P0807`);
await db.close();
