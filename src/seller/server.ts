/**
 * Marketplace server: four sellers in four jurisdictions, each selling one API per call.
 *
 * REAL:  payment verification + settlement via Circle Gateway (testnet), using Circle's
 *        x402 middleware — one middleware per seller, so each is paid to its own address.
 * MOCK:  the lookups themselves (format/checksum checks are real).
 *
 * Every settled payment is written to data/settlements.jsonl (keyed by nonce) and, when
 * DATABASE_URL is set, recorded in the Postgres ledger as pending.
 * Sellers without an address in .env are skipped (run `npm run sellers:setup`).
 */
import express from "express";
import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { formatUnits } from "viem";
import { config, ARC_TESTNET_NETWORK, GATEWAY_TESTNET_URL, SETTLEMENTS_FILE } from "../lib/config.js";
import { SERVICES } from "../lib/services.js";
import { getDatabase, hasDatabase } from "../db/client.js";
import { recordPayment } from "../db/ledger.js";

type SettlementRecord = {
  event: "settled" | "settle_failed";
  at: string;
  seller: string;
  nonce?: string;
  payer?: string;
  payTo: string;
  amountAtomic: string;
  amountUsdc: string;
  network: string;
  transaction?: string;
  resource?: string;
  error?: string;
};

const record = (entry: SettlementRecord) => appendFile(SETTLEMENTS_FILE, JSON.stringify(entry) + "\n");
const nonceOf = (payload: { payload: Record<string, unknown> }) =>
  (payload.payload?.authorization as { nonce?: string } | undefined)?.nonce;

const app = express();
const live: { title: string; path: string; price: string; seller: string; country: string; payTo: string }[] = [];

for (const service of SERVICES) {
  const payTo = process.env[service.seller.addressEnv];
  if (!payTo) continue;

  const gateway = createGatewayMiddleware({
    sellerAddress: payTo,
    facilitatorUrl: GATEWAY_TESTNET_URL,
    networks: [ARC_TESTNET_NETWORK],
    description: `${service.title} — priced per call`,
  });

  gateway
    .onAfterSettle(async ({ paymentPayload, requirements, result }) => {
      const entry: SettlementRecord = {
        event: "settled",
        at: new Date().toISOString(),
        seller: service.seller.key,
        nonce: nonceOf(paymentPayload),
        payer: result.payer,
        payTo: requirements.payTo,
        amountAtomic: requirements.amount,
        amountUsdc: formatUnits(BigInt(requirements.amount), 6),
        network: result.network,
        transaction: result.transaction,
        resource: paymentPayload.resource?.url,
      };
      await record(entry);
      let note = "";
      if (hasDatabase() && entry.nonce && entry.payer) {
        try {
          const id = await recordPayment(getDatabase(), {
            nonce: entry.nonce, sellerAddress: entry.payTo, payer: entry.payer,
            amountAtomic: BigInt(entry.amountAtomic), network: entry.network, resource: entry.resource,
          });
          note = id === null ? " [ledger: seller not registered — run sellers:setup]" : ` [ledger #${id}: pending]`;
        } catch (err) {
          note = ` [ledger error: ${(err as Error).message}]`; // never block the API response
        }
      }
      console.log(`  [${service.seller.key}] settled ${entry.amountUsdc} USDC from ${entry.payer} (nonce ${entry.nonce?.slice(0, 10)}…)${note}`);
    })
    .onSettleFailure(async ({ paymentPayload, requirements, error }) => {
      await record({
        event: "settle_failed",
        at: new Date().toISOString(),
        seller: service.seller.key,
        nonce: nonceOf(paymentPayload),
        payTo: requirements.payTo,
        amountAtomic: requirements.amount,
        amountUsdc: formatUnits(BigInt(requirements.amount), 6),
        network: requirements.network,
        resource: paymentPayload.resource?.url,
        error: error.message,
      });
      console.error(`  [${service.seller.key}] settlement failed: ${error.message}`);
    });

  app.get(service.route, gateway.require(service.price), (req, res) => {
    const param = String(Object.values(req.params)[0] ?? "");
    res.json({ requestId: randomUUID(), service: service.title, seller: service.seller.name, ...service.handler(param) });
  });
  live.push({
    title: service.title, path: `GET ${service.route}`, price: service.price,
    seller: service.seller.name, country: service.seller.country, payTo,
  });
}

// Free endpoints: health, the catalogue, and (for Phase 1-2 scripts) the GSTIN price.
app.get("/health", (_req, res) => res.json({ ok: true, network: ARC_TESTNET_NETWORK, services: live.length }));
app.get("/v1/catalog", (_req, res) => res.json({ currency: "USDC", network: ARC_TESTNET_NETWORK, services: live }));
app.get("/v1/pricing", (_req, res) => {
  const gst = live.find((s) => s.path.includes("/v1/gstin/"));
  res.json({
    service: "GSTIN validation (India)",
    pricePerCall: gst?.price ?? config.pricePerCall,
    currency: "USDC",
    network: ARC_TESTNET_NETWORK,
    paidEndpoint: "GET /v1/gstin/:gstin",
  });
});

app.listen(config.port, (err?: Error) => {
  if (err) {
    const inUse = (err as NodeJS.ErrnoException).code === "EADDRINUSE";
    console.error(inUse
      ? `Port ${config.port} is already in use — the marketplace is probably still running in another terminal.\n` +
        "Stop it there with Ctrl+C, or run:  pkill -f src/seller/server.ts   then start again."
      : `Could not start the marketplace: ${err.message}`);
    process.exit(1);
  }
  console.log(`Marketplace listening on ${config.sellerBaseUrl}  (catalogue: GET /v1/catalog)`);
  for (const s of live) console.log(`  ${s.price.padEnd(7)} ${s.path.padEnd(28)} ${s.seller} [${s.country}]`);
  if (live.length < SERVICES.length) console.log("  (run `npm run sellers:setup` to add the US, EU and Kenya sellers)");
  console.log(`  Ledger: ${hasDatabase() ? "Postgres (DATABASE_URL)" : "off — set DATABASE_URL to enable"}`);
});
