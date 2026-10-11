/**
 * The marketplace: four sellers in four jurisdictions, each selling one paid API.
 * The lookups are mocks (format checks are real); the per-call payments are real.
 */
import { validateGstin } from "./gstin.js";

export type SellerProfile = {
  key: "in" | "us" | "eu" | "ke";
  name: string;
  country: string; // ISO 3166-1 alpha-2
  /** Seller's own preference; the jurisdiction engine decides what's allowed. */
  payoutPreference: "usdc" | "fiat";
  purposeCode?: string;
  addressEnv: string;
  keyEnv: string;
  /** Mock beneficiary bank details used by fiat payout partners. */
  bank: Record<string, string | boolean>;
};

export type Service = {
  seller: SellerProfile;
  title: string;
  route: string; // express route with one :param
  example: string;
  price: string;
  handler: (param: string) => Record<string, unknown>;
};

export const SELLERS: SellerProfile[] = [
  {
    key: "in", name: "Hyderabad GST Data Services (sample)", country: "IN", payoutPreference: "fiat",
    purposeCode: "P0807", addressEnv: "SELLER_ADDRESS", keyEnv: "SELLER_PRIVATE_KEY",
    bank: { accountName: "Hyderabad GST Data Services", ifsc: "MOCK0000123", account: "XXXXXX4521", valid: true },
  },
  {
    key: "us", name: "Austin TaxRate Labs (sample)", country: "US", payoutPreference: "usdc",
    addressEnv: "SELLER_US_ADDRESS", keyEnv: "SELLER_US_PRIVATE_KEY",
    bank: { accountName: "Austin TaxRate Labs", routing: "000000000", account: "XXXX7788", valid: true },
  },
  {
    key: "eu", name: "Lisboa VAT Check Lda (sample)", country: "PT", payoutPreference: "fiat",
    addressEnv: "SELLER_EU_ADDRESS", keyEnv: "SELLER_EU_PRIVATE_KEY",
    bank: { accountName: "Lisboa VAT Check Lda", iban: "PT50 0000 0000 0000 0000 0000 0", valid: true },
  },
  {
    key: "ke", name: "Nairobi KRA PIN Data Ltd (sample)", country: "KE", payoutPreference: "fiat",
    addressEnv: "SELLER_KE_ADDRESS", keyEnv: "SELLER_KE_PRIVATE_KEY",
    // Deliberately wrong account name: the SWIFT partner's pre-validation rejects it (failure demo).
    bank: { accountName: "Nairobi Data", swift: "MOCKKENAXXX", account: "XXXX3301", valid: false },
  },
];

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const EU_VAT_FORMATS: Record<string, RegExp> = {
  PT: /^PT\d{9}$/, DE: /^DE\d{9}$/, FR: /^FR[0-9A-Z]{2}\d{9}$/, ES: /^ES[0-9A-Z]\d{7}[0-9A-Z]$/,
  IT: /^IT\d{11}$/, NL: /^NL\d{9}B\d{2}$/, IE: /^IE\d{7}[A-Z]{1,2}$/,
};

export const SERVICES: Service[] = [
  {
    seller: SELLERS[0], title: "GSTIN validation (India)", route: "/v1/gstin/:gstin",
    example: "27AAPFU0939F1ZV", price: "$0.002",
    handler: (g) => validateGstin(g),
  },
  {
    seller: SELLERS[1], title: "US sales-tax rate by ZIP", route: "/v1/us/sales-tax/:zip",
    example: "78701", price: "$0.003",
    handler: (zip) =>
      /^\d{5}$/.test(zip)
        ? { zip, valid: true, combinedRatePct: Number((6 + (hash(zip) % 300) / 100).toFixed(2)), source: "mock" }
        : { zip, valid: false, reason: "ZIP must be 5 digits" },
  },
  {
    seller: SELLERS[2], title: "EU VAT number format check", route: "/v1/eu/vat/:vat",
    example: "PT123456789", price: "$0.002",
    handler: (raw) => {
      const vat = raw.toUpperCase().replace(/[\s.-]/g, "");
      const re = EU_VAT_FORMATS[vat.slice(0, 2)];
      if (!re) return { vat, valid: false, reason: "Unsupported or unknown country prefix" };
      return re.test(vat)
        ? { vat, valid: true, country: vat.slice(0, 2), source: "mock (VIES not called)" }
        : { vat, valid: false, reason: "Does not match the country's VAT format" };
    },
  },
  {
    seller: SELLERS[3], title: "Kenya KRA PIN format check", route: "/v1/ke/kra-pin/:pin",
    example: "A123456789Z", price: "$0.002",
    handler: (raw) => {
      const pin = raw.toUpperCase();
      return /^[AP]\d{9}[A-Z]$/.test(pin)
        ? { pin, valid: true, type: pin[0] === "A" ? "Individual" : "Non-individual", source: "mock" }
        : { pin, valid: false, reason: "KRA PIN is a letter (A/P), 9 digits, then a letter" };
    },
  },
];

/** Path a buyer calls for a service, with the parameter filled in. */
export const pathFor = (s: Service, param: string) => s.route.replace(/:[a-z]+$/, encodeURIComponent(param));
