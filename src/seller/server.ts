/**
 * Seller API: an Indian GSTIN-validation service that charges per call.
 *
 * REAL:  payment verification + settlement via Circle Gateway (testnet) using
 *        Circle's x402 middleware. Unpaid calls get `402 Payment Required`.
 * MOCK:  the GSTIN lookup itself (format and checksum checks are real).
 *
 * Every settled payment is written to data/settlements.jsonl, keyed by the
 * payment nonce, and (when DATABASE_URL is set) recorded in the Postgres ledger.
 */
import express from "express";
import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { formatUnits } from "viem";
import { config, ARC_TESTNET_NETWORK, GATEWAY_TESTNET_URL, SETTLEMENTS_FILE } from "../lib/config.js";
import { validateGstin } from "../lib/gstin.js";
import { getDatabase, hasDatabase } from "../db/client.js";
import { recordPayment } from "../db/ledger.js";

type SettlementRecord = {
  event: "settled" | "settle_failed";
  at: string;
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

async function record(entry: SettlementRecord) {
  await appendFile(SETTLEMENTS_FILE, JSON.stringify(entry) + "\n");
}

function nonceOf(payload: { payload: Record<string, unknown> }): string | undefined {
  const auth = payload.payload?.authorization as { nonce?: string } | undefined;
  return auth?.nonce;
}

const sellerAddress = config.sellerAddress();

const gateway = createGatewayMiddleware({
  sellerAddress,
  facilitatorUrl: GATEWAY_TESTNET_URL,
  networks: [ARC_TESTNET_NETWORK],
  description: "GSTIN validation (India) — priced per call",
});

gateway
  .onAfterSettle(async ({ paymentPayload, requirements, result }) => {
    const entry: SettlementRecord = {
      event: "settled",
      at: new Date().toISOString(),
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
    let ledgerNote = "";
    if (hasDatabase() && entry.nonce && entry.payer) {
      try {
        const id = await recordPayment(getDatabase(), {
          nonce: entry.nonce, sellerAddress: entry.payTo, payer: entry.payer,
          amountAtomic: BigInt(entry.amountAtomic), network: entry.network, resource: entry.resource,
        });
        ledgerNote = id === null ? " [ledger: seller not registered — run db:migrate]" : ` [ledger #${id}: pending]`;
      } catch (err) {
        ledgerNote = ` [ledger error: ${(err as Error).message}]`; // never block the API response
      }
    }
    console.log(`  settled ${entry.amountUsdc} USDC from ${entry.payer} (nonce ${entry.nonce?.slice(0, 10)}…)${ledgerNote}`);
  })
  .onSettleFailure(async ({ paymentPayload, requirements, error }) => {
    await record({
      event: "settle_failed",
      at: new Date().toISOString(),
      nonce: nonceOf(paymentPayload),
      payTo: requirements.payTo,
      amountAtomic: requirements.amount,
      amountUsdc: formatUnits(BigInt(requirements.amount), 6),
      network: requirements.network,
      resource: paymentPayload.resource?.url,
      error: error.message,
    });
    console.error(`  settlement failed: ${error.message}`);
  });

const app = express();

// Free endpoints: health and price discovery.
app.get("/health", (_req, res) => {
  res.json({ ok: true, seller: sellerAddress, network: ARC_TESTNET_NETWORK });
});
app.get("/v1/pricing", (_req, res) => {
  res.json({
    service: "GSTIN validation (India)",
    pricePerCall: config.pricePerCall,
    currency: "USDC",
    network: ARC_TESTNET_NETWORK,
    paidEndpoint: "GET /v1/gstin/:gstin",
  });
});

// Paid endpoint: one call = one payment.
app.get("/v1/gstin/:gstin", gateway.require(config.pricePerCall), (req, res) => {
  const requestId = randomUUID();
  const result = validateGstin(String(req.params.gstin));
  res.json({ requestId, ...result });
});

app.listen(config.port, () => {
  console.log(`Seller API listening on ${config.sellerBaseUrl}`);
  console.log(`  Paid endpoint: GET /v1/gstin/:gstin at ${config.pricePerCall} per call`);
  console.log(`  Payments go to: ${sellerAddress} (Arc Testnet)`);
  console.log(`  Ledger: ${hasDatabase() ? "Postgres (DATABASE_URL)" : "off — set DATABASE_URL to enable"}`);
});
