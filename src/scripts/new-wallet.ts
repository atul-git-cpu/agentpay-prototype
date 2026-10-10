/**
 * Creates two TESTNET-ONLY wallets (buyer + seller) and writes them to .env.
 * Refuses to overwrite existing keys, so it's safe to run twice.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = new URL("../../.env", import.meta.url);
const examplePath = new URL("../../.env.example", import.meta.url);

let env = existsSync(envPath)
  ? readFileSync(envPath, "utf8")
  : readFileSync(examplePath, "utf8");

const hasValue = (name: string) => new RegExp(`^${name}=.+`, "m").test(env);
const setValue = (name: string, value: string) => {
  env = new RegExp(`^${name}=`, "m").test(env)
    ? env.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`)
    : `${env.trimEnd()}\n${name}=${value}\n`;
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
writeFileSync(envPath, env);

console.log("Created two testnet-only wallets and saved them to .env (never commit this file).\n");
console.log(`  Buyer  (the agent that pays): ${buyer.address}`);
console.log(`  Seller (the Indian API):      ${seller.address}\n`);
console.log("Next: fund the BUYER at https://faucet.circle.com");
console.log("  -> choose Arc Testnet, token USDC, paste the buyer address above.");
console.log("  (On Arc, USDC also pays gas, so this is the only funding needed.)");
