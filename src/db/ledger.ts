/**
 * Double-entry ledger for per-call payments.
 *
 * Lifecycle of one payment (amounts in USDC atomic units):
 *   received  : +amt seller:<id>:pending     -amt clearing:gateway_in_transit
 *   settled   : -amt seller:<id>:pending     +amt seller:<id>:available      (Gateway confirmed/completed)
 *   failed    : -amt seller:<id>:pending     +amt clearing:gateway_in_transit
 *
 * Every posting is keyed by (event_id, account), so re-running reconciliation
 * can never double-count. All legs of all events always sum to zero.
 */
import type { Database, Sql } from "./client.js";

export type PaymentStatus = "received" | "batched" | "confirmed" | "completed" | "failed";
const SETTLED: PaymentStatus[] = ["confirmed", "completed"];
const RANK: Record<PaymentStatus, number> = { received: 0, batched: 1, confirmed: 2, completed: 3, failed: 3 };

export type NewSeller = {
  name: string;
  walletAddress: string;
  country: string;
  payoutMethod: "usdc" | "india_partner" | "local_rail" | "swift";
  payoutCurrency: string;
  payoutThresholdAtomic: bigint;
  purposeCode?: string;
  payoutPreference?: "usdc" | "fiat";
  bankDetails?: Record<string, unknown>;
  payoutReason?: string;
};

export async function upsertSeller(sql: Sql, s: NewSeller): Promise<number> {
  const rows = await sql<{ id: number }>(
    `INSERT INTO sellers (name, wallet_address, country, payout_method, payout_currency,
                          payout_threshold_atomic, purpose_code, payout_preference, bank_details, payout_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (wallet_address) DO UPDATE SET
       name = EXCLUDED.name, country = EXCLUDED.country, payout_method = EXCLUDED.payout_method,
       payout_currency = EXCLUDED.payout_currency,
       payout_threshold_atomic = EXCLUDED.payout_threshold_atomic, purpose_code = EXCLUDED.purpose_code,
       payout_preference = EXCLUDED.payout_preference,
       bank_details = COALESCE(sellers.bank_details, EXCLUDED.bank_details),
       payout_reason = EXCLUDED.payout_reason
     RETURNING id`,
    [s.name, s.walletAddress.toLowerCase(), s.country, s.payoutMethod, s.payoutCurrency,
     s.payoutThresholdAtomic.toString(), s.purposeCode ?? null, s.payoutPreference ?? "fiat",
     s.bankDetails ? JSON.stringify(s.bankDetails) : null, s.payoutReason ?? null],
  );
  return rows[0].id;
}

/** Posts one balanced ledger event. Idempotent per (event_id, account). Zero legs are skipped. */
export async function post(sql: Sql, eventId: string, paymentId: number | null, legs: [string, bigint][]) {
  const sum = legs.reduce((acc, [, amt]) => acc + amt, 0n);
  if (sum !== 0n) throw new Error(`Unbalanced ledger event ${eventId}`);
  for (const [account, amount] of legs) {
    if (amount === 0n) continue;
    await sql(
      `INSERT INTO ledger_entries (event_id, account, amount_atomic, payment_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (event_id, account) DO NOTHING`,
      [eventId, account, amount.toString(), paymentId],
    );
  }
}

export type NewPayment = {
  nonce: string;
  sellerAddress: string;
  payer: string;
  amountAtomic: bigint;
  network: string;
  resource?: string;
  recordedAt?: string;
};

/** Records a payment the seller accepted. Idempotent on nonce. Returns the payment id, or null if unknown seller. */
export async function recordPayment(db: Database, p: NewPayment): Promise<number | null> {
  return db.transaction(async (sql) => {
    const seller = await sql<{ id: number }>(`SELECT id FROM sellers WHERE wallet_address = $1`, [
      p.sellerAddress.toLowerCase(),
    ]);
    if (!seller[0]) return null;
    const sellerId = seller[0].id;

    const inserted = await sql<{ id: number }>(
      `INSERT INTO payments (nonce, seller_id, payer, amount_atomic, network, resource, status, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'received', COALESCE($7::timestamptz, now()))
       ON CONFLICT (nonce) DO NOTHING RETURNING id`,
      [p.nonce, sellerId, p.payer.toLowerCase(), p.amountAtomic.toString(), p.network, p.resource ?? null,
       p.recordedAt ?? null],
    );
    const id = inserted[0]?.id ?? (await sql<{ id: number }>(`SELECT id FROM payments WHERE nonce = $1`, [p.nonce]))[0].id;
    await post(sql, `payment:${id}:received`, id, [
      [`seller:${sellerId}:pending`, p.amountAtomic],
      ["clearing:gateway_in_transit", -p.amountAtomic],
    ]);
    return id;
  });
}

/** Applies a Gateway status. Never moves backwards; posts settle/fail events exactly once. */
export async function applyStatus(db: Database, paymentId: number, status: PaymentStatus, transferId?: string) {
  return db.transaction(async (sql) => {
    const rows = await sql<{ seller_id: number; amount_atomic: string; status: PaymentStatus }>(
      `SELECT seller_id, amount_atomic, status FROM payments WHERE id = $1 FOR UPDATE`,
      [paymentId],
    );
    const p = rows[0];
    if (!p) throw new Error(`Payment ${paymentId} not found`);
    const finalAlready = p.status === "completed" || p.status === "failed";
    if (finalAlready || RANK[status] < RANK[p.status]) return p.status;

    await sql(
      `UPDATE payments SET status = $2, gateway_transfer_id = COALESCE($3, gateway_transfer_id),
              status_updated_at = now() WHERE id = $1`,
      [paymentId, status, transferId ?? null],
    );
    const amt = BigInt(p.amount_atomic);
    if (SETTLED.includes(status)) {
      await post(sql, `payment:${paymentId}:settled`, paymentId, [
        [`seller:${p.seller_id}:pending`, -amt],
        [`seller:${p.seller_id}:available`, amt],
      ]);
    } else if (status === "failed") {
      await post(sql, `payment:${paymentId}:failed`, paymentId, [
        [`seller:${p.seller_id}:pending`, -amt],
        ["clearing:gateway_in_transit", amt],
      ]);
    }
    return status;
  });
}

export type SellerBalance = {
  sellerId: number;
  name: string;
  country: string;
  payoutMethod: string;
  pending: bigint;
  available: bigint;
  inFlight: bigint;
  paidOut: bigint;
  calls: number;
};

export async function sellerBalances(sql: Sql): Promise<SellerBalance[]> {
  const rows = await sql<{
    id: number; name: string; country: string; payout_method: string;
    pending: string; available: string; in_flight: string; paid_out: string; calls: string;
  }>(
    `SELECT s.id, s.name, s.country, s.payout_method,
       COALESCE((SELECT SUM(amount_atomic) FROM ledger_entries WHERE account = 'seller:' || s.id || ':pending'), 0)   AS pending,
       COALESCE((SELECT SUM(amount_atomic) FROM ledger_entries WHERE account = 'seller:' || s.id || ':available'), 0) AS available,
       COALESCE((SELECT SUM(amount_atomic) FROM ledger_entries WHERE account = 'seller:' || s.id || ':payout_in_flight'), 0) AS in_flight,
       COALESCE((SELECT SUM(amount_atomic) FROM ledger_entries WHERE account = 'seller:' || s.id || ':paid_out'), 0)  AS paid_out,
       (SELECT COUNT(*) FROM payments p WHERE p.seller_id = s.id AND p.status <> 'failed') AS calls
     FROM sellers s ORDER BY s.id`,
  );
  return rows.map((r) => ({
    sellerId: r.id, name: r.name, country: r.country, payoutMethod: r.payout_method,
    pending: BigInt(r.pending), available: BigInt(r.available), inFlight: BigInt(r.in_flight),
    paidOut: BigInt(r.paid_out), calls: Number(r.calls),
  }));
}

/** Integrity check: all ledger legs must sum to zero. */
export async function ledgerImbalance(sql: Sql): Promise<bigint> {
  const rows = await sql<{ total: string }>(`SELECT COALESCE(SUM(amount_atomic), 0) AS total FROM ledger_entries`);
  return BigInt(rows[0].total);
}
