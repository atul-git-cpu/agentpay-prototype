/**
 * Payout engine: turns each seller's settled ("available") balance into a payout.
 *
 *   1. Route    — the jurisdiction engine picks USDC, India partner, local rail or SWIFT.
 *   2. Economics — skip if below the seller's threshold, or if Gateway's withdrawal fee
 *                  would eat too much of it.
 *   3. Partner pre-validation (fiat routes) — fails BEFORE any money moves.
 *   4. Ledger   — `initiated` moves the gross from available to payout_in_flight.
 *   5. On-chain — a REAL Circle Gateway withdrawal on Arc Testnet: to the seller's own
 *                 wallet (USDC route) or to the partner's treasury (fiat routes).
 *   6. USDC route completes immediately; fiat routes wait for the (mock) partner's
 *      fiat leg — see `advance.ts`.
 *
 * On-chain calls are injected, so the same logic runs against Circle in `run.ts`
 * and against stubs in tests.
 */
import { formatUnits } from "viem";
import type { Database } from "../db/client.js";
import { createPayout, completePayout, failPayout, markProcessing } from "../db/payouts.js";
import { routeFor, PLATFORM_FEE_BPS, type Route } from "./jurisdiction.js";
import { partnerFor, newPartnerRef, type Partner, type Quote } from "./partners.js";
import { preflight } from "../compliance/screening.js";

/**
 * Gateway charges a fee per withdrawal (about $0.0035 on Arc at the time of writing),
 * taken from the Gateway balance on top of the amount. We reserve this much per payout
 * and pass it as `maxFee`; any unused part stays in the seller's Gateway balance.
 */
export const NETWORK_FEE_RESERVE = 4000n; // 0.004 USDC

export type SellerRow = {
  id: number;
  name: string;
  wallet_address: string;
  country: string;
  payout_preference: "usdc" | "fiat";
  purpose_code: string | null;
  bank_details: Record<string, unknown> | null;
  payout_threshold_atomic: string;
  available: string;
};

export type Plan =
  | { action: "skip"; seller: SellerRow; route: Route; reason: string }
  | {
      action: "pay";
      seller: SellerRow;
      route: Route;
      partner: Partner | null;
      gross: bigint;
      platformFee: bigint;
      networkFee: bigint;
      net: bigint;
      recipient: string;
      quote: Quote;
    };

const usdc = (a: bigint) => formatUnits(a, 6);

export function planPayout(seller: SellerRow, now: Date, env: Record<string, string | undefined> = process.env): Plan {
  const route = routeFor(seller.country, seller.payout_preference);
  const gross = BigInt(seller.available);
  const threshold = BigInt(seller.payout_threshold_atomic);

  if (gross <= 0n) return { action: "skip", seller, route, reason: "nothing available" };
  if (gross < threshold) {
    return { action: "skip", seller, route, reason: `available ${usdc(gross)} is below the payout threshold ${usdc(threshold)}` };
  }
  if (gross <= 2n * NETWORK_FEE_RESERVE) {
    return {
      action: "skip", seller, route,
      reason: `available ${usdc(gross)} too small: Gateway's ~${usdc(NETWORK_FEE_RESERVE)} withdrawal fee would take over half`,
    };
  }

  const platformFee = (gross * PLATFORM_FEE_BPS[route.method]) / 10000n;
  const networkFee = NETWORK_FEE_RESERVE;
  const net = gross - platformFee - networkFee;

  const partner = partnerFor(route.method, route.currency);
  const recipient = partner ? env[partner.treasuryEnv] : seller.wallet_address;
  if (!recipient) {
    return { action: "skip", seller, route, reason: `${partner?.treasuryEnv} not set — run \`npm run sellers:setup\`` };
  }

  const netUsdc = Number(usdc(net));
  const quote: Quote = partner
    ? partner.quote(netUsdc, now)
    : { currency: "USDC", fxRate: 1, amount: netUsdc, expectedAt: now, spreadPct: 0 };

  return { action: "pay", seller, route, partner, gross, platformFee, networkFee, net, recipient, quote };
}

export async function loadPayableSellers(db: Database): Promise<SellerRow[]> {
  return db.sql<SellerRow>(
    `SELECT s.id, s.name, s.wallet_address, s.country, s.payout_preference, s.purpose_code, s.bank_details,
            s.payout_threshold_atomic::text AS payout_threshold_atomic,
            COALESCE((SELECT SUM(amount_atomic) FROM ledger_entries
                      WHERE account = 'seller:' || s.id || ':available'), 0)::text AS available
     FROM sellers s
     WHERE NOT EXISTS (SELECT 1 FROM payouts p WHERE p.seller_id = s.id AND p.status = 'initiated')
     ORDER BY s.id`,
  );
}

/** What the engine needs from the chain, per seller. */
export type Onchain = {
  /** Seller's Gateway balance available to withdraw, or null if the seller's key isn't in this .env. */
  gatewayAvailable(seller: SellerRow): Promise<bigint | null>;
  /** Withdraws `amount` from the seller's Gateway balance to `recipient`. Returns the mint tx hash. */
  withdraw(seller: SellerRow, amount: bigint, recipient: string, maxFee: bigint): Promise<string>;
};

export type Outcome = {
  sellerId: number;
  seller: string;
  route: string;
  result: "skipped" | "dry-run" | "paid" | "processing" | "failed";
  detail: string;
  payoutId?: number;
  onchainTx?: string;
};

export async function runPayouts(
  db: Database, onchain: Onchain, opts: { dryRun?: boolean; now?: Date; log?: (s: string) => void } = {},
): Promise<Outcome[]> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const outcomes: Outcome[] = [];

  for (const seller of await loadPayableSellers(db)) {
    const plan = planPayout(seller, now);
    const base = { sellerId: seller.id, seller: seller.name, route: `${plan.route.method} → ${plan.route.rail}` };
    log(`\n#${seller.id} ${seller.name} [${seller.country}]`);
    for (const r of plan.route.reasons) log(`   · ${r}`);

    if (plan.action === "skip") {
      log(`   skip: ${plan.reason}`);
      outcomes.push({ ...base, result: "skipped", detail: plan.reason });
      continue;
    }

    // Keep the stored route in step with the engine's decision.
    await db.sql(`UPDATE sellers SET payout_method = $2, payout_currency = $3, payout_reason = $4 WHERE id = $1`,
      [seller.id, plan.route.method, plan.route.currency, plan.route.reasons.join(" | ")]);

    const fiat = plan.partner ? ` → ${plan.quote.currency} ${plan.quote.amount.toFixed(2)} @ ${plan.quote.fxRate.toFixed(4)}` : "";
    log(`   gross ${usdc(plan.gross)}  − platform fee ${usdc(plan.platformFee)}  − Gateway fee reserve ${usdc(plan.networkFee)}  = net ${usdc(plan.net)} USDC${fiat}`);
    log(`   on-chain recipient: ${plan.partner ? `${plan.partner.name} treasury` : "seller's own wallet"} ${plan.recipient}`);

    // Compliance preflight (mock KYB + sanctions screening): a hit holds the payout, nothing moves.
    const check = await preflight(db, seller);
    if (!check.ok) {
      log(`   HELD for compliance review: ${check.reasons.join("; ")}`);
      outcomes.push({ ...base, result: "skipped", detail: `held: ${check.reasons.join("; ")}` });
      continue;
    }
    log(`   compliance: KYB verified, ${check.walletsScreened} wallet(s) screened clear`);

    if (opts.dryRun) {
      outcomes.push({ ...base, result: "dry-run", detail: `would pay net ${usdc(plan.net)} USDC` });
      continue;
    }

    const payoutId = await createPayout(db, {
      sellerId: seller.id, method: plan.route.method, grossAtomic: plan.gross, platformFeeAtomic: plan.platformFee,
      networkFeeAtomic: plan.networkFee, payoutCurrency: plan.quote.currency, fxRate: plan.quote.fxRate,
      payoutAmount: plan.quote.amount, onchainRecipient: plan.recipient, partner: plan.partner?.id,
    });
    const fail = async (reason: string) => {
      await failPayout(db, payoutId, reason);
      log(`   FAILED (payout #${payoutId}): ${reason} — funds returned to available`);
      outcomes.push({ ...base, result: "failed", detail: reason, payoutId });
    };

    // 3. Partner pre-validation: nothing has moved on-chain yet.
    if (plan.partner) {
      const v = plan.partner.validate(seller.bank_details ?? {});
      if (!v.ok) { await fail(v.reason); continue; }
    }

    // 5. Real on-chain leg.
    const needed = plan.net + plan.networkFee;
    let onchainTx: string;
    try {
      const balance = await onchain.gatewayAvailable(seller);
      if (balance === null) { await fail("Seller's key is not in this .env, so its Gateway balance can't be withdrawn"); continue; }
      if (balance < needed) {
        await fail(`Gateway balance ${usdc(balance)} < ${usdc(needed)} needed (settled in the ledger but not yet credited by Gateway — retry later)`);
        continue;
      }
      onchainTx = await onchain.withdraw(seller, plan.net, plan.recipient, plan.networkFee);
    } catch (err) {
      await fail(`Gateway withdrawal failed: ${(err as Error).message}`);
      continue;
    }
    log(`   on-chain: Gateway withdrawal minted on Arc, tx ${onchainTx}`);

    if (!plan.partner) {
      await completePayout(db, payoutId, {
        onchainTx,
        document: {
          type: "USDC payout receipt",
          beneficiary: seller.name,
          wallet: plan.recipient,
          amount: `${usdc(plan.net)} USDC`,
          network: "Arc Testnet",
          transaction: onchainTx,
        },
      });
      log(`   PAID (payout #${payoutId}): ${usdc(plan.net)} USDC in the seller's wallet`);
      outcomes.push({ ...base, result: "paid", detail: `${usdc(plan.net)} USDC`, payoutId, onchainTx });
    } else {
      const partnerRef = newPartnerRef();
      await markProcessing(db, payoutId, { onchainTx, partnerRef, expectedAt: plan.quote.expectedAt });
      const eta = plan.quote.expectedAt.toISOString().slice(0, 16).replace("T", " ");
      log(`   PROCESSING (payout #${payoutId}): partner ref ${partnerRef}, fiat expected ${eta} UTC`);
      outcomes.push({ ...base, result: "processing", detail: `fiat leg expected ${eta} UTC`, payoutId, onchainTx });
    }
  }
  return outcomes;
}

type ProcessingRow = {
  id: number; seller_id: number; name: string; country: string; purpose_code: string | null;
  bank_details: Record<string, unknown> | null; method: string; payout_currency: string; fx_rate: string;
  payout_amount: string; net_atomic: string; onchain_tx: string; partner_ref: string; expected_at: Date | string;
  created_at: Date | string;
};

/** Completes fiat payouts whose (mock) partner leg is due, and writes their documents (e-FIRA, MT103, …). */
export async function advancePayouts(
  db: Database, opts: { fastForward?: boolean; now?: Date; log?: (s: string) => void } = {},
): Promise<{ completed: number; waiting: number }> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const rows = await db.sql<ProcessingRow>(
    `SELECT p.id, p.seller_id, s.name, s.country, s.purpose_code, s.bank_details, p.method, p.payout_currency,
            p.fx_rate::text AS fx_rate, p.payout_amount::text AS payout_amount, p.net_atomic::text AS net_atomic,
            p.onchain_tx, p.partner_ref, p.expected_at, p.created_at
     FROM payouts p JOIN sellers s ON s.id = p.seller_id
     WHERE p.status = 'processing' ORDER BY p.id`,
  );
  let completed = 0;
  let waiting = 0;
  for (const r of rows) {
    const expectedAt = new Date(r.expected_at);
    const partner = partnerFor(r.method, r.payout_currency);
    if (!partner) continue;
    if (expectedAt > now && !opts.fastForward) {
      log(`#${r.id} ${r.name}: waiting for ${partner.name} (due ${expectedAt.toISOString().slice(0, 16)} UTC)`);
      waiting++;
      continue;
    }
    const quote: Quote = {
      currency: r.payout_currency, fxRate: Number(r.fx_rate), amount: Number(r.payout_amount), expectedAt, spreadPct: 0,
    };
    const document = partner.document({
      payoutId: r.id,
      partnerRef: r.partner_ref,
      seller: { id: r.seller_id, name: r.name, country: r.country, purposeCode: r.purpose_code, bank: r.bank_details ?? {} },
      netUsdc: Number(formatUnits(BigInt(r.net_atomic), 6)),
      quote,
      onchainTx: r.onchain_tx,
      statementRef: `AgentPay statement seller-${r.seller_id}, calls settled up to ${new Date(r.created_at).toISOString().slice(0, 10)}`,
    });
    await completePayout(db, r.id, { document });
    log(`#${r.id} ${r.name}: PAID — ${document.type}${opts.fastForward && expectedAt > now ? " (fast-forwarded)" : ""}`);
    completed++;
  }
  return { completed, waiting };
}
