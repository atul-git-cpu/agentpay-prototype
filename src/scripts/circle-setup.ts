/**
 * One-time Circle setup for the AI agent's wallet (developer-controlled wallets).
 *
 *   1. Generates and registers an Entity Secret (Circle's key-encryption secret)
 *      and saves the recovery file to data/ (git-ignored).
 *   2. Creates a wallet set.
 *   3. Creates one EOA wallet on Arc Testnet for the agent.
 *
 * Safe to re-run: each step is skipped if its value is already in .env.
 * Requires CIRCLE_API_KEY in .env (a testnet key from console.circle.com).
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";
import { config, CIRCLE_BLOCKCHAIN, RECOVERY_FILE } from "../lib/config.js";
import { loadEnvText, hasEnvValue, setEnvValue, saveEnvText } from "../lib/env-file.js";

const apiKey = config.circleApiKey();
let env = loadEnvText();
const save = (name: string, value: string) => {
  env = setEnvValue(env, name, value);
  saveEnvText(env);
  process.env[name] = value;
};

// 1. Entity secret
if (hasEnvValue(env, "CIRCLE_ENTITY_SECRET")) {
  console.log("1/3 Entity secret: already in .env — skipping.");
} else {
  const entitySecret = randomBytes(32).toString("hex");
  save("CIRCLE_ENTITY_SECRET", entitySecret); // save first so it can never be lost
  console.log("1/3 Registering a new entity secret with Circle…");
  try {
    const res = await registerEntitySecretCiphertext({ apiKey, entitySecret });
    writeFileSync(RECOVERY_FILE, res.data?.recoveryFile ?? "");
    console.log("    Registered. Recovery file saved to data/circle-recovery-file.dat");
    console.log("    Download it from the Codespace and keep it safe — it's the only way to reset the secret.");
  } catch (err) {
    env = setEnvValue(env, "CIRCLE_ENTITY_SECRET", "");
    saveEnvText(env);
    console.error(`    Registration failed: ${(err as Error).message}`);
    console.error(
      "    If your Circle account already has an entity secret registered, put that secret in\n" +
        "    CIRCLE_ENTITY_SECRET in .env and re-run. Otherwise check that CIRCLE_API_KEY is a valid testnet key.",
    );
    process.exit(1);
  }
}

const circle = initiateDeveloperControlledWalletsClient({
  apiKey,
  entitySecret: config.circleEntitySecret(),
});

// 2. Wallet set
let walletSetId = process.env.CIRCLE_WALLET_SET_ID;
if (walletSetId) {
  console.log("2/3 Wallet set: already in .env — skipping.");
} else {
  const res = await circle.createWalletSet({ name: "AgentPay prototype" });
  walletSetId = res.data?.walletSet?.id;
  if (!walletSetId) throw new Error("Circle did not return a wallet set id");
  save("CIRCLE_WALLET_SET_ID", walletSetId);
  console.log(`2/3 Created wallet set ${walletSetId}`);
}

// 3. Agent wallet (EOA: required, since Gateway verifies payment signatures with ecrecover)
if (process.env.AGENT_WALLET_ID && process.env.AGENT_WALLET_ADDRESS) {
  console.log(`3/3 Agent wallet: already in .env (${process.env.AGENT_WALLET_ADDRESS}) — skipping.`);
} else {
  const res = await circle.createWallets({
    walletSetId,
    blockchains: [CIRCLE_BLOCKCHAIN],
    count: 1,
    accountType: "EOA",
    metadata: [{ name: "GSTIN research agent" }],
  });
  const wallet = res.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) throw new Error("Circle did not return a wallet");
  save("AGENT_WALLET_ID", wallet.id);
  save("AGENT_WALLET_ADDRESS", wallet.address);
  console.log(`3/3 Created agent wallet ${wallet.address} (Circle-managed, EOA, Arc Testnet)`);
}

console.log("\nDone. Next: `npm run agent:fund` to give the agent a Gateway balance.");
