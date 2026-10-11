/**
 * MOCK payout partners — the fiat leg of each payout.
 *
 * The USDC leg is real (Circle Gateway withdrawal to the partner's treasury address).
 * Everything after it — FX, bank transfer, compliance documents — is simulated here,
 * behind the interface a real partner integration (e.g. Xflow, a SEPA or SWIFT
 * off-ramp provider) would implement. Rates and timings are illustrative assumptions.
 */
import { randomUUID } from "node:crypto";

export type Quote = { currency: string; fxRate: number; amount: number; expectedAt: Date; spreadPct: number };
export type Validation = { ok: true } | { ok: false; reason: string };

export type PayoutContext = {
  payoutId: number;
  partnerRef: string;
  seller: { id: number; name: string; country: string; purposeCode: string | null; bank: Record<string, unknown> };
  netUsdc: number;
  quote: Quote;
  onchainTx: string;
  statementRef: string;
};

export type Partner = {
  id: string;
  name: string;
  treasuryEnv: string;
  validate(bank: Record<string, unknown>): Validation;
  quote(netUsdc: number, now: Date): Quote;
  document(ctx: PayoutContext): Record<string, unknown>;
};

const rate = (env: string, fallback: number) => Number(process.env[env] ?? fallback);

/** Adds n business days (skips Saturday and Sunday). */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

const bankOk = (bank: Record<string, unknown>): Validation =>
  bank?.valid === true ? { ok: true } : { ok: false, reason: "Beneficiary name does not match the account (partner pre-validation)" };

export const PARTNERS: Record<"india_partner" | "sepa" | "ach" | "swift", Partner> = {
  india_partner: {
    id: "india_partner",
    name: "India payout partner (mock of a licensed PA-CB route, e.g. Xflow)",
    treasuryEnv: "PARTNER_IN_TREASURY",
    validate: bankOk,
    quote(netUsdc, now) {
      const spreadPct = 0.3;
      const fxRate = rate("USD_INR_RATE", 95) * (1 - spreadPct / 100);
      return { currency: "INR", fxRate, amount: netUsdc * fxRate, expectedAt: addBusinessDays(now, 2), spreadPct };
    },
    document: (c) => ({
      type: "e-FIRA (mock)",
      firaNumber: `EFIRA-${new Date().getUTCFullYear()}-${String(c.payoutId).padStart(6, "0")}`,
      issuedBy: "AD Category-I bank (mock)",
      remitter: "Partner offshore collection entity (mock)",
      beneficiary: c.seller.name,
      beneficiaryAccount: c.seller.bank.account,
      purposeCode: c.seller.purposeCode ?? "to be set",
      foreignCurrencyAmount: `${c.netUsdc.toFixed(6)} USD`,
      exchangeRate: c.quote.fxRate.toFixed(4),
      inrCredited: `₹${c.quote.amount.toFixed(2)}`,
      valueDate: c.quote.expectedAt.toISOString().slice(0, 10),
      linkedStatement: c.statementRef,
      stablecoinLeg: `USDC received offshore by partner, Arc Testnet tx ${c.onchainTx}`,
      partnerReference: c.partnerRef,
      note: "Testnet prototype — no real funds. Purpose code to be confirmed with the AD bank.",
    }),
  },
  sepa: {
    id: "sepa",
    name: "SEPA off-ramp partner (mock)",
    treasuryEnv: "PARTNER_EU_TREASURY",
    validate: bankOk,
    quote(netUsdc, now) {
      const spreadPct = 0.2;
      const fxRate = rate("USD_EUR_RATE", 0.92) * (1 - spreadPct / 100);
      return { currency: "EUR", fxRate, amount: netUsdc * fxRate, expectedAt: new Date(now.getTime() + 60_000), spreadPct };
    },
    document: (c) => ({
      type: "SEPA Instant credit transfer (mock)",
      endToEndId: c.partnerRef,
      creditor: c.seller.name,
      creditorIban: c.seller.bank.iban,
      amount: `€${c.quote.amount.toFixed(2)}`,
      exchangeRate: c.quote.fxRate.toFixed(4),
      stablecoinLeg: `Arc Testnet tx ${c.onchainTx}`,
    }),
  },
  ach: {
    id: "ach",
    name: "ACH off-ramp partner (mock)",
    treasuryEnv: "PARTNER_US_TREASURY",
    validate: bankOk,
    quote: (netUsdc, now) => ({ currency: "USD", fxRate: 1, amount: netUsdc, expectedAt: addBusinessDays(now, 1), spreadPct: 0 }),
    document: (c) => ({
      type: "ACH credit (mock)",
      trace: c.partnerRef,
      beneficiary: c.seller.name,
      amount: `$${c.quote.amount.toFixed(2)}`,
      stablecoinLeg: `Arc Testnet tx ${c.onchainTx}`,
    }),
  },
  swift: {
    id: "swift",
    name: "SWIFT off-ramp partner (mock)",
    treasuryEnv: "PARTNER_SWIFT_TREASURY",
    validate: bankOk,
    quote: (netUsdc, now) => ({ currency: "USD", fxRate: 1, amount: netUsdc, expectedAt: addBusinessDays(now, 2), spreadPct: 0 }),
    document: (c) => ({
      type: "SWIFT MT103 (mock)",
      uetr: c.partnerRef,
      beneficiary: c.seller.name,
      beneficiaryBic: c.seller.bank.swift,
      amount: `USD ${c.quote.amount.toFixed(2)}`,
      charges: "SHA",
      stablecoinLeg: `Arc Testnet tx ${c.onchainTx}`,
    }),
  },
};

/** The partner used for a route. Local rail depends on the currency. */
export function partnerFor(method: string, currency: string): Partner | null {
  if (method === "india_partner") return PARTNERS.india_partner;
  if (method === "local_rail") return currency === "EUR" ? PARTNERS.sepa : PARTNERS.ach;
  if (method === "swift") return PARTNERS.swift;
  return null; // usdc: no partner
}

export const newPartnerRef = () => randomUUID();
