/** Copies local context the dashboard needs into Postgres: agent runs and wallet names. Idempotent. */
import { readFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { Sql } from "./client.js";
import { SELLERS } from "../lib/services.js";
import { PARTNERS } from "../payouts/partners.js";

type AgentEvent = { at: string; type: string; [k: string]: unknown };

/** Saves one agent run (array of events as logged by src/agent/run.ts). */
export async function saveAgentRun(sql: Sql, events: AgentEvent[]) {
  const start = events.find((e) => e.type === "start");
  const end = events.find((e) => e.type === "end");
  if (!start) return false;
  await sql(
    `INSERT INTO agent_runs (started_at, agent, model, task, paid_calls, spent_usdc, final_answer, events)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (started_at, agent) DO UPDATE SET events = EXCLUDED.events, paid_calls = EXCLUDED.paid_calls,
       spent_usdc = EXCLUDED.spent_usdc, final_answer = EXCLUDED.final_answer`,
    [start.at, String(start.agent ?? "").toLowerCase(), start.model ?? null, start.task ?? null,
     Number(end?.paidCalls ?? events.filter((e) => e.type === "payment").length), end?.spentUsdc ?? null,
     end?.finalAnswer ?? null, JSON.stringify(events)],
  );
  return true;
}

export async function syncAgentRuns(sql: Sql, file: URL): Promise<number> {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of text.split("\n").filter(Boolean)) {
    try {
      if (await saveAgentRun(sql, (JSON.parse(line) as { run: AgentEvent[] }).run)) n++;
    } catch {
      /* skip a malformed line */
    }
  }
  return n;
}

export async function syncWalletLabels(sql: Sql): Promise<number> {
  const labels: [string, string, string][] = [];
  const buyerKey = process.env.BUYER_PRIVATE_KEY as Hex | undefined;
  if (buyerKey) labels.push([privateKeyToAccount(buyerKey).address, "Script buyer", "buyer"]);
  if (process.env.AGENT_WALLET_ADDRESS) labels.push([process.env.AGENT_WALLET_ADDRESS, "AI agent (Circle wallet)", "agent"]);
  for (const s of SELLERS) {
    const a = process.env[s.addressEnv];
    if (a) labels.push([a, s.name, "seller"]);
  }
  for (const p of Object.values(PARTNERS)) {
    const a = process.env[p.treasuryEnv];
    if (a) labels.push([a, `${p.name} treasury`, "partner"]);
  }
  for (const [address, label, kind] of labels) {
    await sql(
      `INSERT INTO wallet_labels (address, label, kind) VALUES ($1, $2, $3)
       ON CONFLICT (address) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind`,
      [address.toLowerCase(), label, kind],
    );
  }
  return labels.length;
}
