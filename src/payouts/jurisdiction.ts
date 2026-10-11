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
  note: "EU: MiCA framework in force",
};

export const RULES: Record<string, Rule> = {
  IN: {
    stablecoin: "restricted",
    partner: { method: "india_partner", currency: "INR", label: "licensed PA-CB partner (Xflow-style)" },
    note: "India: stablecoins are VDAs, not valid export proceeds; INR must arrive via an AD bank with an e-FIRA",
  },
  US: {
    stablecoin: "permitted",
    localRail: { rail: "ACH", currency: "USD" },
    note: "US: payment stablecoins regulated under the GENIUS Act",
  },
  PT: EU_SEPA, DE: EU_SEPA, FR: EU_SEPA, ES: EU_SEPA, IT: EU_SEPA, NL: EU_SEPA, IE: EU_SEPA,
};

const DEFAULT_RULE: Rule = { stablecoin: "unknown", note: "No rules configured for this country: conservative default" };

export type Route = { method: PayoutMethod; currency: string; rail: string; reasons: string[] };

export function routeFor(country: string, preference: "usdc" | "fiat"): Route {
  const rule = RULES[country] ?? DEFAULT_RULE;
  const reasons = [rule.note];

  if (rule.stablecoin === "restricted" && rule.partner) {
    reasons.push(`Stablecoin payout not allowed -> ${rule.partner.label}, paid in ${rule.partner.currency}`);
    return { method: rule.partner.method, currency: rule.partner.currency, rail: rule.partner.label, reasons };
  }
  if (rule.stablecoin === "permitted" && preference === "usdc") {
    reasons.push("Stablecoins permitted and seller prefers USDC -> withdraw to seller's wallet");
    return { method: "usdc", currency: "USDC", rail: "Circle Gateway withdrawal (Arc)", reasons };
  }
  if (rule.localRail) {
    reasons.push(`Seller wants fiat -> local rail ${rule.localRail.rail} in ${rule.localRail.currency}`);
    return { method: "local_rail", currency: rule.localRail.currency, rail: rule.localRail.rail, reasons };
  }
  reasons.push("No partner or local rail for this country -> SWIFT in USD (fallback)");
  return { method: "swift", currency: "USD", rail: "SWIFT", reasons };
}

/** Platform fee on each payout, in basis points (from the business model). */
export const PLATFORM_FEE_BPS: Record<PayoutMethod, bigint> = {
  usdc: 10n,          // 0.1%
  india_partner: 100n, // 1.0% (compliance-heavy route)
  local_rail: 50n,    // 0.5%
  swift: 80n,         // 0.8%
};
