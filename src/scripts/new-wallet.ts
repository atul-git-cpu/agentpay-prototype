/**
 * Creates two TESTNET-ONLY wallets (buyer + seller) and writes them to .env.
 * Refuses to overwrite existing keys, so it's safe to run twice.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadEnvText, hasEnvValue, setEnvValue, saveEnvText } from "../lib/env-file.js";

let env = loadEnvText();
const hasValue = (name: string) => hasEnvValue(env, name);
const setValue = (name: string, value: string) => {
  env = setEnvValue(env, name, value);
};

if (hasValue("BUYER_PRIVATE_KEY") && hasValue("SELLER_PRIVATE_KEY")) {
  console.log("Wallets already exist in .env — not overwriting. Run `npm run balance` to see them.");
  process.exit(0);
}

const buyerKey = generatePrivateKey();
const sellerKey = generatePrivateKey();
const buyer = privateKeyToAccount(buyerKey);
const seller = privateKeyToAccount(sellerKey);

setValue("BUYER_PRIVATE_KEY", buyerKey);
setValue("SELLER_PRIVATE_KEY", sellerKey);
setValue("SELLER_ADDRESS", seller.address);
saveEnvText(env);

console.log("Created two testnet-only wallets and saved them to .env (never commit this file).\n");
console.log(`  Buyer  (the agent that pays): ${buyer.address}`);
console.log(`  Seller (the Indian API):      ${seller.address}\n`);
console.log("Next: fund the BUYER at https://faucet.circle.com");
console.log("  -> choose Arc Testnet, token USDC, paste the buyer address above.");
console.log("  (On Arc, USDC also pays gas, so this is the only funding needed.)");
