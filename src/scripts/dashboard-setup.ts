/**
 * Prepares the database for the public dashboard (Phase 6):
 *  1. Applies the schema and copies agent runs + wallet names into Postgres.
 *  2. Creates a READ-ONLY login `agentpay_dashboard` (SELECT only, read-only transactions),
 *     so the dashboard can never change data and your owner password never leaves the Codespace.
 *  3. Saves its connection string to .env as DASHBOARD_DATABASE_URL (not printed).
 * Re-running rotates the read-only password — update it in Vercel afterwards.
 */
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { getDatabase } from "../db/client.js";
import { syncAgentRuns, syncWalletLabels } from "../db/sync.js";
import { AGENT_RUNS_FILE } from "../lib/config.js";
import { loadEnvText, setEnvValue, saveEnvText } from "../lib/env-file.js";

const ROLE = "agentpay_dashboard";
const db = getDatabase();
await db.sql(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
const runs = await syncAgentRuns(db.sql, AGENT_RUNS_FILE);
const labels = await syncWalletLabels(db.sql);
console.log(`Synced ${runs} agent run(s) and ${labels} wallet name(s) into the database.`);

const password = randomBytes(24).toString("hex"); // hex only: safe to embed in SQL
const exists = (await db.sql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pg_roles WHERE rolname = $1`, [ROLE]))[0].n > 0;
await db.sql(exists ? `ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}'` : `CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${password}'`);
const dbName = (await db.sql<{ d: string }>(`SELECT current_database() AS d`))[0].d;
for (const stmt of [
  `GRANT CONNECT ON DATABASE "${dbName}" TO ${ROLE}`,
  `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
  `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLE}`,
  `ALTER ROLE ${ROLE} SET default_transaction_read_only = on`,
]) await db.sql(stmt);
await db.close();

const url = new URL(process.env.DATABASE_URL!.trim());
url.username = ROLE;
url.password = password;
saveEnvText(setEnvValue(loadEnvText(), "DASHBOARD_DATABASE_URL", url.toString()));
console.log(`Read-only login "${ROLE}" ${exists ? "updated (new password)" : "created"}: SELECT only, read-only transactions.`);
console.log("Its connection string is saved in .env as DASHBOARD_DATABASE_URL (open .env to copy it into Vercel).");
