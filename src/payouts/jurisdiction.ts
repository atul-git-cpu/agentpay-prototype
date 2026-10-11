/**
 * Jurisdiction engine: decides HOW each seller is paid out.
 *
 * Inputs: the seller's country and their own preference (USDC or fiat).
 * Rules, in order:
 *   1. Stablecoins restricted + licensed partner available  -> partner route (mandatory)
 *   2. Stablecoins permitted + seller prefers USDC          -> USDC to the seller's wallet
 *   3. A local-rail partner exists for the seller's country -> local rail in local currency
 *   4. Otherwise                                            -> SWIFT in USD (fallback)
 * Unknown countries are treated conservatively: no stablecoin payout.
 *
 * These rules are a prototype's simplified reading of each regime — not legal advice.
 */
export type PayoutMethod = "usdc" | "india_partner" | "local_rail" | "swift";

type Rule = {
  stablecoin: "permitted" | "restricted" | "unknown";
  partner?: { method: "india_partner"; currency: string; label: string };
  localRail?: { rail: string; currency: string };
  note: string;
};

const EU_SEPA: Rule = {
  stablecoin: "permitted",
  localRail: { rail: "SEPA Instant", currency: "EUR" },
  note: "Stablecoins are allowed in the EU under MiCA",
};

export const RULES: Record<string, Rule> = {
  IN: {
    stablecoin: "restricted",
    partner: { method: "india_partner", currency: "INR", label: "licensed cross-border payment partner" },
    note: "India treats stablecoins as virtual digital assets, so export earnings must arrive in rupees through an AD bank, with an e-FIRA",
  },
  US: {
    stablecoin: "permitted",
    localRail: { rail: "ACH", currency: "USD" },
    note: "Payment stablecoins are regulated in the US under the GENIUS Act",
  },
  PT: EU_SEPA, DE: EU_SEPA, FR: EU_SEPA, ES: EU_SEPA, IT: EU_SEPA, NL: EU_SEPA, IE: EU_SEPA,
};

const DEFAULT_RULE: Rule = { stablecoin: "unknown", note: "We have no stablecoin rules for this country yet, so we don't pay out in USDC" };

export type Route = { method: PayoutMethod; currency: string; rail: string; reasons: string[] };

export function routeFor(country: string, preference: "usdc" | "fiat"): Route {
  const rule = RULES[country] ?? DEFAULT_RULE;
  const reasons = [rule.note];

  if (rule.stablecoin === "restricted" && rule.partner) {
    reasons.push(`Paid in ${rule.partner.currency} through a ${rule.partner.label}`);
    return { method: rule.partner.method, currency: rule.partner.currency, rail: rule.partner.label, reasons };
  }
  if (rule.stablecoin === "permitted" && preference === "usdc") {
    reasons.push("The seller asked for USDC, so it goes straight to their wallet");
    return { method: "usdc", currency: "USDC", rail: "Circle Gateway withdrawal (Arc)", reasons };
  }
  if (rule.localRail) {
    reasons.push(`The seller asked for local currency, so it goes by ${rule.localRail.rail} in ${rule.localRail.currency}`);
    return { method: "local_rail", currency: rule.localRail.currency, rail: rule.localRail.rail, reasons };
  }
  reasons.push("There is no local partner or bank rail for this country, so it goes by SWIFT in USD");
  return { method: "swift", currency: "USD", rail: "SWIFT", reasons };
}

/** Platform fee on each payout, in basis points (from the business model). */
export const PLATFORM_FEE_BPS: Record<PayoutMethod, bigint> = {
  usdc: 10n,          // 0.1%
  india_partner: 100n, // 1.0% (compliance-heavy route)
  local_rail: 50n,    // 0.5%
  swift: 80n,         // 0.8%
};
