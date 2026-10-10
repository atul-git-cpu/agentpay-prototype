/**
 * Funds the agent's Gateway balance from the Phase 1 buyer wallet.
 *
 * Uses Gateway's `depositFor`: the buyer's USDC goes into Gateway, but the
 * balance belongs to the agent's Circle-managed wallet. The agent then pays
 * per call by signing (no USDC or gas needed in the agent's own wallet).
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { parseUnits, type Address } from "viem";
import { config, CHAIN } from "../lib/config.js";

const funder = new GatewayClient({ chain: CHAIN, privateKey: config.buyerKey() });
const agent = config.agentWalletAddress() as Address;
const amount = config.agentFundUsdc;

const funderBal = await funder.getBalances();
if (funderBal.wallet.balance < parseUnits(amount, 6)) {
  console.error(
    `Funder wallet has ${funderBal.wallet.formatted} USDC; ${amount} needed. ` +
      "Top it up at https://faucet.circle.com (Arc Testnet).",
  );
  process.exit(1);
}

console.log(`Depositing ${amount} USDC into Gateway for the agent ${agent}…`);
const res = await funder.depositFor(amount, agent);
console.log(`  approval tx: ${res.approvalTxHash ?? "(not needed)"}`);
console.log(`  deposit tx:  ${res.depositTxHash}`);

const agentBal = await funder.getBalances(agent);
console.log(`Agent gateway available: ${agentBal.gateway.formattedAvailable} USDC`);
console.log("(If it shows 0, wait ~30s and run `npm run balance` — deposits take a moment to index.)");
