/**
 * Pays out every seller whose settled balance has reached its threshold.
 *   npm run payouts              real Gateway withdrawals on Arc Testnet
 *   npm run payouts -- --dry-run show the routing and amounts only
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { formatUnits, type Address, type Hex } from "viem";
import { CHAIN } from "../lib/config.js";
import { SELLERS } from "../lib/services.js";
import { getDatabase } from "../db/client.js";
import { runPayouts, type Onchain, type SellerRow } from "./engine.js";

const dryRun = process.argv.includes("--dry-run");
const clients = new Map<string, GatewayClient>();

/** The seller's Gateway client, found by matching its wallet address to a key in .env. */
function clientFor(seller: SellerRow): GatewayClient | null {
  const profile = SELLERS.find((p) => process.env[p.addressEnv]?.toLowerCase() === seller.wallet_address.toLowerCase());
  const key = profile && process.env[profile.keyEnv];
  if (!key) return null;
  if (!clients.has(key)) clients.set(key, new GatewayClient({ chain: CHAIN, privateKey: key as Hex }));
  return clients.get(key)!;
}

const onchain: Onchain = {
  async gatewayAvailable(seller) {
    const client = clientFor(seller);
    return client ? (await client.getBalances()).gateway.available : null;
  },
  async withdraw(seller, amount, recipient, maxFee) {
    const client = clientFor(seller);
    if (!client) throw new Error("no key for seller");
    const res = await client.withdraw(formatUnits(amount, 6), {
      recipient: recipient as Address,
      maxFee: formatUnits(maxFee, 6),
    });
    return res.mintTxHash;
  },
};

const db = getDatabase();
console.log(dryRun ? "Payout run — DRY RUN (nothing is moved)" : "Payout run — real Gateway withdrawals on Arc Testnet");
const outcomes = await runPayouts(db, onchain, { dryRun, log: (s) => console.log(s) });

const stale = await db.sql<{ id: number }>(`SELECT id FROM payouts WHERE status = 'initiated'`);
console.log("\nSummary");
for (const o of outcomes) console.log(`  ${o.result.padEnd(10)} #${o.sellerId} ${o.seller} — ${o.detail}`);
if (stale.length) {
  console.log(`  ⚠ payouts stuck in 'initiated' (interrupted run): ${stale.map((s) => `#${s.id}`).join(", ")} — check the tx before retrying`);
}
console.log("\nNext: `npm run payouts:advance` (fiat legs)  ·  `npm run ledger`");
await db.close();
