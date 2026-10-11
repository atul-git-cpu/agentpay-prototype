/**
 * Read-only queries for the dashboard. Uses DATABASE_URL — on Vercel this must be the
 * READ-ONLY login created by `npm run dashboard:setup` (DASHBOARD_DATABASE_URL in .env).
 * Results are cached for a few seconds per server instance to keep load on the database low.
 */
import "server-only";
import { formatUnits } from "viem";
import { getDatabase } from "../../src/db/client";
import { sellerBalances } from "../../src/db/ledger";
import { buildTrail, walletLabels } from "../../src/compliance/trail";
import { routeFor } from "../../src/payouts/jurisdiction";
import { SERVICES } from "../../src/lib/services";

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

export const usdc = (atomic: bigint | string | number) => formatUnits(BigInt(atomic), 6);
const db = () => getDatabase();

export type SellerView = {
  id: number; name: string; country: string; method: string; currency: string; reasons: string[];
  service: { title: string; price: string } | null;
  calls: number; earned: string; pending: string; available: string; inFlight: string; paidOut: string;
  lastPayout: { id: number; status: string; currency: string; amount: string | null; document: string | null; failure: string | null } | null;
};

export function getOverview() {
  return cached("overview", async () => {
    const sql = db().sql;
    const [balances, sellers, earned, lastPayouts, totals, accounts, recent, labels] = await Promise.all([
      sellerBalances(sql),
      sql<{ id: number; payout_currency: string; payout_preference: "usdc" | "fiat"; country: string; wallet_address: string }>(
        `SELECT id, payout_currency, payout_preference, country, wallet_address FROM sellers`),
      sql<{ seller_id: number; total: string }>(`SELECT seller_id, SUM(amount_atomic)::text AS total FROM payments WHERE status <> 'failed' GROUP BY 1`),
      sql<{ seller_id: number; id: number; status: string; payout_currency: string; payout_amount: string | null; doc: string | null; failure_reason: string | null }>(
        `SELECT DISTINCT ON (seller_id) seller_id, id, status, payout_currency, payout_amount::text AS payout_amount,
                document->>'type' AS doc, failure_reason
         FROM payouts ORDER BY seller_id, id DESC`),
      sql<{ calls: number; volume: string; payouts: number; agent_calls: number }>(
        `SELECT (SELECT COUNT(*)::int FROM payments WHERE status <> 'failed') AS calls,
                (SELECT COALESCE(SUM(amount_atomic), 0)::text FROM payments WHERE status <> 'failed') AS volume,
                (SELECT COUNT(*)::int FROM payouts WHERE status = 'paid') AS payouts,
                (SELECT COUNT(*)::int FROM payments p JOIN wallet_labels w ON w.address = p.payer WHERE w.kind = 'agent') AS agent_calls`),
      sql<{ account: string; total: string }>(
        `SELECT account, SUM(amount_atomic)::text AS total FROM ledger_entries
         WHERE account IN ('platform:fees', 'network:gateway_fees') GROUP BY 1`),
      sql<{ id: number; recorded_at: Date; payer: string; resource: string | null; amount_atomic: string; status: string; seller: string; country: string }>(
        `SELECT p.id, p.recorded_at, p.payer, p.resource, p.amount_atomic::text AS amount_atomic, p.status, s.name AS seller, s.country
         FROM payments p JOIN sellers s ON s.id = p.seller_id ORDER BY p.id DESC LIMIT 12`),
      walletLabels(sql),
    ]);
    const extra = new Map(sellers.map((s) => [s.id, s]));
    const earnedBy = new Map(earned.map((e) => [e.seller_id, e.total]));
    const lastBy = new Map(lastPayouts.map((p) => [p.seller_id, p]));
    const sellerViews: SellerView[] = balances.map((b) => {
      const lp = lastBy.get(b.sellerId);
      return {
        id: b.sellerId, name: b.name, country: b.country, method: b.payoutMethod,
        currency: extra.get(b.sellerId)?.payout_currency ?? "",
        reasons: routeFor(b.country, extra.get(b.sellerId)?.payout_preference ?? "fiat").reasons,
        service: (() => {
          const svc = SERVICES.find((x) => x.seller.country === b.country);
          return svc ? { title: svc.title, price: svc.price } : null;
        })(),
        calls: b.calls, earned: usdc(earnedBy.get(b.sellerId) ?? "0"), pending: usdc(b.pending), available: usdc(b.available),
        inFlight: usdc(b.inFlight), paidOut: usdc(b.paidOut),
        lastPayout: lp ? { id: lp.id, status: lp.status, currency: lp.payout_currency, amount: lp.payout_amount, document: lp.doc, failure: lp.failure_reason } : null,
      };
    });
    const acct = (n: string) => accounts.find((a) => a.account === n)?.total ?? "0";
    return {
      sellers: sellerViews,
      totals: {
        calls: totals[0].calls, volume: usdc(totals[0].volume), payouts: totals[0].payouts, agentCalls: totals[0].agent_calls,
        platformFees: usdc(acct("platform:fees")), gatewayFees: usdc(acct("network:gateway_fees")),
      },
      recent: recent.map((r) => ({ ...r, payerLabel: labels.get(r.payer) ?? null, amount: usdc(r.amount_atomic) })),
      updatedAt: new Date().toISOString(),
    };
  });
}

export function getPayouts() {
  return cached("payouts", () =>
    db().sql<{
      id: number; seller: string; country: string; method: string; status: string; gross: string; net: string;
      platform_fee: string; network_fee: string; payout_currency: string; payout_amount: string | null;
      onchain_tx: string | null; failure_reason: string | null; doc: string | null; created_at: Date; calls: number;
    }>(
      `SELECT p.id, s.name AS seller, s.country, p.method, p.status, p.gross_atomic::text AS gross, p.net_atomic::text AS net,
              p.platform_fee_atomic::text AS platform_fee, p.network_fee_atomic::text AS network_fee,
              p.payout_currency, p.payout_amount::text AS payout_amount, p.onchain_tx, p.failure_reason,
              p.document->>'type' AS doc, p.created_at,
              (SELECT COUNT(*)::int FROM payments x WHERE x.payout_id = p.id) AS calls
       FROM payouts p JOIN sellers s ON s.id = p.seller_id ORDER BY p.id DESC`,
    ),
  );
}

export function getTrail(id: number) {
  return cached(`trail:${id}`, () => buildTrail(db(), id));
}

export function getAgentRuns() {
  return cached("agent", async () => {
    const sql = db().sql;
    const runs = await sql<{
      id: number; started_at: Date; agent: string; model: string | null; task: string | null; paid_calls: number;
      spent_usdc: string | null; final_answer: string | null; events: { at: string; type: string; [k: string]: unknown }[];
    }>(`SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 20`);
    const nonces = runs.flatMap((r) => r.events.filter((e) => e.type === "payment").map((e) => String(e.nonce)));
    const settled = nonces.length
      ? await sql<{ nonce: string; status: string; seller: string; payout_id: number | null }>(
          `SELECT lower(p.nonce) AS nonce, p.status, s.name AS seller, p.payout_id FROM payments p
           JOIN sellers s ON s.id = p.seller_id WHERE lower(p.nonce) = ANY($1::text[])`,
          [nonces.map((n) => n.toLowerCase())],
        )
      : [];
    return { runs, payments: new Map(settled.map((s) => [s.nonce, s])) };
  });
}

