/**
 * Phase 4 setup: turns the single Indian seller into a four-jurisdiction marketplace.
 *
 *  1. Creates testnet wallets for the US, EU (Portugal) and Kenya sellers, plus treasury
 *     addresses for the mock payout partners (India, SEPA, ACH, SWIFT) — saved to .env.
 *  2. Registers all four sellers in the ledger, with the route the jurisdiction engine picks.
 *  3. Sends each seller wallet a little USDC for gas: on Arc, USDC is the gas token, and
 *     a Gateway withdrawal (payout) is minted by a transaction from the seller's own wallet.
 * Safe to re-run: never overwrites keys, only tops up wallets that are low.
 */
import { readFile } from "node:fs/promises";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { config, CHAIN } from "../lib/config.js";
import { SELLERS } from "../lib/services.js";
import { loadEnvText, hasEnvValue, setEnvValue, saveEnvText } from "../lib/env-file.js";
import { getDatabase } from "../db/client.js";
import { upsertSeller } from "../db/ledger.js";
import { routeFor } from "../payouts/jurisdiction.js";
import { PARTNERS } from "../payouts/partners.js";

const GAS_TOPUP = "0.05"; // USDC per seller wallet
const GAS_MIN = parseUnits("0.02", 18); // native USDC on Arc has 18 decimals
const THRESHOLD = parseUnits("0.005", 6);

// 1. Keys and addresses
let env = loadEnvText();
const created: string[] = [];
const ensure = (name: string, make: () => Record<string, string>) => {
  if (hasEnvValue(env, name)) return;
  for (const [k, v] of Object.entries(make())) {
    env = setEnvValue(env, k, v);
    process.env[k] = v;
  }
  created.push(name);
};
for (const s of SELLERS) {
  ensure(s.addressEnv, () => {
    const key = generatePrivateKey();
    return { [s.keyEnv]: key, [s.addressEnv]: privateKeyToAccount(key).address };
  });
}
for (const p of Object.values(PARTNERS)) {
  // Only the address is kept: testnet USDC sent here stands in for the partner's treasury.
  ensure(p.treasuryEnv, () => ({ [p.treasuryEnv]: privateKeyToAccount(generatePrivateKey()).address }));
}
if (created.length) {
  saveEnvText(env);
  console.log(`Saved to .env: ${created.join(", ")}`);
} else {
  console.log("Wallets and partner treasuries already in .env");
}

// 2. Register sellers with the engine's route
const db = getDatabase();
await db.sql(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
console.log("\nJurisdiction engine decisions:");
for (const s of SELLERS) {
  const route = routeFor(s.country, s.payoutPreference);
  const id = await upsertSeller(db.sql, {
    name: s.name, walletAddress: process.env[s.addressEnv]!, country: s.country,
    payoutMethod: route.method, payoutCurrency: route.currency, payoutThresholdAtomic: THRESHOLD,
    purposeCode: s.purposeCode, payoutPreference: s.payoutPreference, bankDetails: s.bank,
    payoutReason: route.reasons.join(" | "),
  });
  console.log(`  #${id} ${s.name} [${s.country}, prefers ${s.payoutPreference}] → ${route.method} (${route.rail}, ${route.currency})`);
  for (const r of route.reasons) console.log(`       · ${r}`);
}
await db.close();

// 3. Gas for payouts
const funder = new GatewayClient({ chain: CHAIN, privateKey: config.buyerKey() });
console.log(`\nGas top-ups from the buyer wallet ${funder.account.address}:`);
for (const s of SELLERS) {
  const addr = process.env[s.addressEnv] as Address;
  const bal = await funder.publicClient.getBalance({ address: addr });
  if (bal >= GAS_MIN) {
    console.log(`  ${s.key.toUpperCase()} ${addr}: ${formatUnits(bal, 18)} USDC — enough`);
    continue;
  }
  const hash = await funder.walletClient.writeContract({
    address: funder.chainConfig.usdc, abi: erc20Abi, functionName: "transfer",
    args: [addr, parseUnits(GAS_TOPUP, 6)], chain: funder.chainConfig.chain, account: funder.account,
  });
  await funder.publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ${s.key.toUpperCase()} ${addr}: sent ${GAS_TOPUP} USDC (tx ${hash})`);
}
console.log("\nNext: restart the marketplace (`npm run seller`), then `npm run buy:all`.");
