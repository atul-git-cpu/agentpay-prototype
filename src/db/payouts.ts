/** Payout records and their ledger events (see schema.sql for the event definitions). */
import type { Database } from "./client.js";
import { post } from "./ledger.js";

export type NewPayout = {
  sellerId: number;
  method: string;
  grossAtomic: bigint;
  platformFeeAtomic: bigint;
  networkFeeAtomic: bigint;
  payoutCurrency: string;
  fxRate?: number;
  payoutAmount?: number;
  onchainRecipient?: string;
  partner?: string;
};

export async function createPayout(db: Database, p: NewPayout): Promise<number> {
  const net = p.grossAtomic - p.platformFeeAtomic - p.networkFeeAtomic;
  if (net <= 0n) throw new Error("Payout net amount must be positive");
  return db.transaction(async (sql) => {
    const rows = await sql<{ id: number }>(
      `INSERT INTO payouts (seller_id, method, gross_atomic, platform_fee_atomic, network_fee_atomic, net_atomic,
                            payout_currency, fx_rate, payout_amount, onchain_recipient, partner, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'initiated') RETURNING id`,
      [p.sellerId, p.method, p.grossAtomic.toString(), p.platformFeeAtomic.toString(), p.networkFeeAtomic.toString(),
       net.toString(), p.payoutCurrency, p.fxRate ?? null, p.payoutAmount ?? null, p.onchainRecipient ?? null,
       p.partner ?? null],
    );
    const id = rows[0].id;
    await post(sql, `payout:${id}:initiated`, null, [
      [`seller:${p.sellerId}:available`, -p.grossAtomic],
      [`seller:${p.sellerId}:payout_in_flight`, p.grossAtomic],
    ]);
    return id;
  });
}

type PayoutRow = {
  seller_id: number; gross_atomic: string; platform_fee_atomic: string; network_fee_atomic: string;
  net_atomic: string; status: string;
};

export async function markProcessing(
  db: Database, id: number, f: { onchainTx: string; partnerRef: string; expectedAt: Date },
) {
  await db.sql(
    `UPDATE payouts SET status = 'processing', onchain_tx = $2, partner_ref = $3, expected_at = $4, updated_at = now()
     WHERE id = $1 AND status = 'initiated'`,
    [id, f.onchainTx, f.partnerRef, f.expectedAt.toISOString()],
  );
}

export async function completePayout(
  db: Database, id: number, f: { onchainTx?: string; partnerRef?: string; document: Record<string, unknown> },
) {
  return db.transaction(async (sql) => {
    const p = (await sql<PayoutRow>(`SELECT * FROM payouts WHERE id = $1 FOR UPDATE`, [id]))[0];
    if (!p) throw new Error(`Payout ${id} not found`);
    if (p.status === "paid" || p.status === "failed") return p.status;
    await sql(
      `UPDATE payouts SET status = 'paid', onchain_tx = COALESCE($2, onchain_tx), partner_ref = COALESCE($3, partner_ref),
              document = $4, updated_at = now() WHERE id = $1`,
      [id, f.onchainTx ?? null, f.partnerRef ?? null, JSON.stringify(f.document)],
    );
    const gross = BigInt(p.gross_atomic);
    await post(sql, `payout:${id}:paid`, null, [
      [`seller:${p.seller_id}:payout_in_flight`, -gross],
      [`seller:${p.seller_id}:paid_out`, BigInt(p.net_atomic)],
      ["platform:fees", BigInt(p.platform_fee_atomic)],
      ["network:gateway_fees", BigInt(p.network_fee_atomic)],
    ]);
    return "paid";
  });
}

export async function failPayout(db: Database, id: number, reason: string) {
  return db.transaction(async (sql) => {
    const p = (await sql<PayoutRow>(`SELECT * FROM payouts WHERE id = $1 FOR UPDATE`, [id]))[0];
    if (!p) throw new Error(`Payout ${id} not found`);
    if (p.status === "paid" || p.status === "failed") return p.status;
    await sql(`UPDATE payouts SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`, [id, reason]);
    const gross = BigInt(p.gross_atomic);
    await post(sql, `payout:${id}:failed`, null, [
      [`seller:${p.seller_id}:payout_in_flight`, -gross],
      [`seller:${p.seller_id}:available`, gross],
    ]);
    return "failed";
  });
}
