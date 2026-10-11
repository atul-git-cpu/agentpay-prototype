/**
 * MOCK compliance checks run before every payout:
 *   - KYB: is the seller a verified business? (stands in for a KYB vendor / registry lookup)
 *   - Sanctions screening of every wallet that paid the seller, and of the seller's wallet
 *     (stands in for a blockchain-analytics provider such as Chainalysis or TRM).
 *
 * The interface is what a real integration would implement; the results are deterministic
 * so the demo is repeatable. To demo a block, add an address to SANCTIONS_BLOCKLIST in .env.
 * Results are stored in `screenings` so the compliance trail can show them.
 */
import type { Database, Sql } from "../db/client.js";

export const SCREENING_PROVIDER = "Mock wallet screening (Chainalysis/TRM-style)";
export const KYB_PROVIDER = "Mock KYB (registry lookup)";

/** Business identifiers checked per country (illustrative). */
const KYB_DOCS: Record<string, string[]> = {
  IN: ["GSTIN", "IEC (Import Export Code)", "PAN"],
  US: ["EIN", "Secretary of State registration"],
  PT: ["NIPC", "EU VAT (VIES)"],
  KE: ["KRA PIN", "Certificate of Incorporation"],
};

const blocklist = () =>
  new Set((process.env.SANCTIONS_BLOCKLIST ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean));

async function store(sql: Sql, type: "wallet" | "business", subject: string, result: string, provider: string, detail: object) {
  await sql(
    `INSERT INTO screenings (subject_type, subject, result, provider, detail) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subject_type, subject) DO UPDATE SET result = EXCLUDED.result, provider = EXCLUDED.provider,
       detail = EXCLUDED.detail, screened_at = now()`,
    [type, subject, result, provider, JSON.stringify(detail)],
  );
}

export type Preflight = { ok: boolean; reasons: string[]; walletsScreened: number };

/** Runs KYB on the seller and screens the seller's wallet and every payer of the calls about to be paid out. */
export async function preflight(db: Database, seller: SellerRef): Promise<Preflight> {
  const payers = await db.sql<{ payer: string }>(
    `SELECT DISTINCT payer FROM payments WHERE seller_id = $1 AND payout_id IS NULL AND status IN ('confirmed', 'completed')`,
    [seller.id],
  );
  return screen(db, seller, payers.map((p) => p.payer));
}

type SellerRef = { id: number; country: string; wallet_address: string };

/** KYB for the seller + sanctions screening of the seller's wallet and the given payer wallets. */
export async function screen(db: Database, seller: SellerRef, payerWallets: string[]): Promise<Preflight> {
  const reasons: string[] = [];
  const blocked = blocklist();

  const docs = KYB_DOCS[seller.country];
  const kyb = docs ? "verified" : "unverified";
  await store(db.sql, "business", `seller:${seller.id}`, kyb, KYB_PROVIDER, {
    country: seller.country, documents: docs ?? [], note: docs ? "All documents matched (mock)" : "No KYB rules for this country",
  });
  if (!docs) reasons.push(`KYB: no verification rules for ${seller.country}`);

  const wallets = [seller.wallet_address.toLowerCase(), ...payerWallets.map((p) => p.toLowerCase())];
  for (const w of new Set(wallets)) {
    const hit = blocked.has(w);
    await store(db.sql, "wallet", w, hit ? "blocked" : "clear", SCREENING_PROVIDER, {
      role: w === seller.wallet_address.toLowerCase() ? "seller" : "payer",
      lists: ["OFAC SDN (mock)", "UN consolidated (mock)", "EU sanctions (mock)"],
      ...(hit ? { match: "SANCTIONS_BLOCKLIST" } : {}),
    });
    if (hit) reasons.push(`Sanctions: wallet ${w} is on the blocklist`);
  }
  return { ok: reasons.length === 0, reasons, walletsScreened: new Set(wallets).size };
}
