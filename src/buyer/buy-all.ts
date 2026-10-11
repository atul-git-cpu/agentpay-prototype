/**
 * Buyer for the marketplace: calls the US, EU and Kenya sellers' paid APIs a few times each,
 * paying per call in USDC via Circle Gateway. (The Indian seller already has Phase 1-2 traffic;
 * add `-- --with-india` to include it.) Stops before total spend exceeds MAX_SPEND_USDC.
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { formatUnits, parseUnits } from "viem";
import { config, CHAIN } from "../lib/config.js";
import { SERVICES, pathFor } from "../lib/services.js";
import { SAMPLE_GSTINS } from "../lib/gstin.js";

const INPUTS: Record<string, string[]> = {
  in: SAMPLE_GSTINS.slice(0, 3),
  us: ["78701", "10001", "94105", "60601"],
  eu: ["PT123456789", "DE123456789", "FR12345678901", "ESB12345678", "NL123456789B01", "PT12345"],
  ke: ["A123456789Z", "P051234567K", "A12345", "P000111222Q", "B123456789Z", "A987654321M"],
};
const withIndia = process.argv.includes("--with-india");

const buyer = new GatewayClient({ chain: CHAIN, privateKey: config.buyerKey() });
const base = config.sellerBaseUrl.replace(/\/$/, "");
const budget = parseUnits(String(config.maxSpendUsdc), 6);

const catalog = (await fetch(`${base}/v1/catalog`).then((r) => r.json())) as { services: { path: string }[] };
const live = new Set(catalog.services.map((s) => s.path.replace("GET ", "")));
console.log(`Marketplace has ${live.size} paid services. Budget: ${config.maxSpendUsdc} USDC\n`);

let spent = 0n;
let calls = 0;
for (const service of SERVICES) {
  const key = service.seller.key;
  if (key === "in" && !withIndia) continue;
  if (!live.has(service.route)) {
    console.log(`(${service.title}: not live — run \`npm run sellers:setup\` and restart the seller)`);
    continue;
  }
  console.log(`${service.title} — ${service.seller.name} [${service.seller.country}], ${service.price}/call`);
  const price = parseUnits(service.price.replace("$", ""), 6);
  for (const input of INPUTS[key]) {
    if (spent + price > budget) { console.log("  stopping: budget reached"); break; }
    try {
      const r = await buyer.pay<Record<string, unknown>>(`${base}${pathFor(service, input)}`);
      spent += r.amount;
      calls++;
      const verdict = r.data.valid ? "valid" : `invalid (${r.data.reason})`;
      console.log(`  ${input.padEnd(16)} paid ${r.formattedAmount} USDC → ${verdict}`);
    } catch (err) {
      console.error(`  ${input}: failed — ${(err as Error).message}`);
    }
  }
}
console.log(`\n${calls} paid calls, ${formatUnits(spent, 6)} USDC spent.`);
console.log("Next: wait ~1 min for Gateway to batch-settle, then `npm run reconcile`, then `npm run payouts`.");
