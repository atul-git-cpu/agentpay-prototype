/**
 * Mock GSTIN validator — the "Indian API" our seller charges for per call.
 *
 * Format and checksum validation are real (GSTIN check-digit algorithm);
 * the business details returned are synthetic, since the GST network's
 * own APIs are only open to licensed GST Suvidha Providers.
 */

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep",
  "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh",
};

const PAN_ENTITY: Record<string, string> = {
  C: "Company", P: "Individual / Proprietor", F: "Firm / LLP", H: "HUF",
  A: "Association of Persons", T: "Trust", B: "Body of Individuals",
  L: "Local Authority", J: "Artificial Juridical Person", G: "Government",
};

/** GSTIN check digit: weighted base-36 sum over the first 14 characters. */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export function makeGstin(stateCode: string, pan: string, entityNo = "1"): string {
  const first14 = `${stateCode}${pan}${entityNo}Z`;
  return first14 + gstinCheckDigit(first14);
}

export type GstinResult =
  | { gstin: string; valid: false; reason: string }
  | {
      gstin: string;
      valid: true;
      state: string;
      pan: string;
      entityType: string;
      registrationNumber: string;
      legalName: string;
      status: "Active";
      source: "mock";
    };

export function validateGstin(raw: string): GstinResult {
  const gstin = raw.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(gstin)) {
    return { gstin, valid: false, reason: "Format does not match GSTIN pattern" };
  }
  const state = STATES[gstin.slice(0, 2)];
  if (!state) return { gstin, valid: false, reason: "Unknown state code" };
  if (gstinCheckDigit(gstin.slice(0, 14)) !== gstin[14]) {
    return { gstin, valid: false, reason: "Checksum mismatch" };
  }
  const pan = gstin.slice(2, 12);
  return {
    gstin,
    valid: true,
    state,
    pan,
    entityType: PAN_ENTITY[pan[3]] ?? "Other",
    registrationNumber: gstin[12],
    legalName: `${pan.slice(0, 5)} Enterprises (sample)`,
    status: "Active",
    source: "mock",
  };
}

/** Sample inputs for the buyer: mostly valid, a couple deliberately invalid. */
export const SAMPLE_GSTINS = [
  makeGstin("36", "ABCPK1234F"), // Telangana
  makeGstin("29", "AAACM5678L"), // Karnataka
  makeGstin("27", "AABFR9012Q"), // Maharashtra
  makeGstin("07", "AAGCS3456K"), // Delhi
  makeGstin("33", "BBTPV7890M"), // Tamil Nadu
  "36ABCPK1234F1ZX",             // bad checksum
  "99ZZZZZ0000Z1Z5",             // unknown state
];
