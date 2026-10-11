/** Display helpers shared by dashboard pages (no server-only imports). */
export const EXPLORER = "https://testnet.arcscan.app";
export const REPO = "https://github.com/atul-git-cpu/agentpay-prototype";

/** "0.017780" -> "0.01778", keeps at least 2 decimals. */
export function amt(v: string | number | null | undefined, min = 2): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = n.toFixed(6).replace(/0+$/, "");
  const [i, d = ""] = s.split(".");
  return `${i}.${d.padEnd(min, "0")}`;
}

export const SYMBOL: Record<string, string> = { INR: "₹", EUR: "€", USD: "$" };
export function fiat(currency: string, amount: string | number | null): string {
  if (amount === null) return "—";
  const n = Number(amount);
  const sym = SYMBOL[currency];
  const digits = n < 1 ? 4 : 2;
  return sym ? `${sym}${n.toFixed(digits)}` : `${n.toFixed(digits)} ${currency}`;
}

export const short = (s: string, a = 6, b = 4) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);
export const when = (d: Date | string) =>
  new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const COUNTRY: Record<string, string> = { IN: "India", US: "United States", PT: "Portugal", KE: "Kenya" };

/** Each payout route has its own line colour, used everywhere the route appears. */
export function route(method: string, currency: string) {
  if (method === "india_partner") return { key: "inr", label: "Licensed partner, INR", short: "INR via partner" };
  if (method === "usdc") return { key: "usdc", label: "USDC to the seller's wallet", short: "USDC direct" };
  if (method === "local_rail") {
    return currency === "EUR"
      ? { key: "sepa", label: "SEPA Instant, EUR", short: "SEPA" }
      : { key: "ach", label: "ACH, USD", short: "ACH" };
  }
  return { key: "swift", label: "SWIFT, USD (fallback)", short: "SWIFT" };
}

export function callPath(resource: string | null): string {
  if (!resource) return "—";
  try {
    return decodeURIComponent(new URL(resource, "http://x").pathname);
  } catch {
    return resource;
  }
}

/** The model writes light markdown; show it as plain text (keep line breaks, drop ** and table pipes' noise). */
export const plain = (t: string) => t.replace(/\*\*/g, "").replace(/^\|?[-| ]+\|?$/gm, "").trim();
