/**
 * Compliance trail: everything behind one payout, end to end —
 *   who paid (and whether the payer was an AI agent, with its task and reasoning)
 *   → each paid call (Circle payment nonce, Gateway transfer, settlement status)
 *   → seller KYB and wallet screening
 *   → usage statement (fiat-denominated, purpose code)
 *   → payout (fees, on-chain USDC leg) → partner's fiat leg and document (e-FIRA, MT103, …)
 *   → the ledger events, plus automated consistency checks.
 *
 * `buildTrail` returns data (reused by the Phase 6 dashboard); `renderTrail` makes markdown.
 */
import { formatUnits } from "viem";
import type { Database, Sql } from "../db/client.js";

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const explorerTx = (hash: string) => `https://testnet.arcscan.app/tx/${hash}`;
const usd = (a: bigint | string) => formatUnits(BigInt(a), 6);

type AgentEvent = { at: string; type: string; [k: string]: unknown };
export type AgentContext = {
  runStartedAt: string;
  task: string;
  model: string;
  /** The agent's stated reasoning just before this payment. */
  reasoning: string | null;
  input: string;
  runPaidCalls: number;
  runSkipped: number;
};

/** Maps payment nonce -> the agent run that made it (from the agent_runs table). */
export async function agentIndex(sql: Sql, nonces?: string[]): Promise<Map<string, AgentContext>> {
  const map = new Map<string, AgentContext>();
  const rows = await sql<{ started_at: Date; task: string | null; model: string | null; paid_calls: number; events: AgentEvent[] }>(
    nonces
      ? `SELECT started_at, task, model, paid_calls, events FROM agent_runs r
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(r.events) e
                       WHERE e->>'type' = 'payment' AND lower(e->>'nonce') = ANY($1::text[]))`
      : `SELECT started_at, task, model, paid_calls, events FROM agent_runs`,
    nonces ? [nonces.map((n) => n.toLowerCase())] : [],
  );
  for (const r of rows) {
    const skipped = r.events.filter((e) => e.type === "cache_hit").length;
    let lastThought: string | null = null;
    for (const e of r.events) {
      if (e.type === "thought") lastThought = String(e.text);
      if (e.type === "payment" && typeof e.nonce === "string") {
        map.set(e.nonce.toLowerCase(), {
          runStartedAt: new Date(r.started_at).toISOString(),
          task: r.task ?? "",
          model: r.model ?? "",
          reasoning: lastThought,
          input: String(e.gstin ?? e.input ?? ""),
          runPaidCalls: r.paid_calls,
          runSkipped: skipped,
        });
      }
    }
  }
  return map;
}

export async function walletLabels(sql: Sql): Promise<Map<string, string>> {
  const rows = await sql<{ address: string; label: string }>(`SELECT address, label FROM wallet_labels`);
  return new Map(rows.map((r) => [r.address, r.label]));
}

export type Trail = Awaited<ReturnType<typeof buildTrail>>;

export async function buildTrail(db: Database, payoutId: number) {
  const payout = (await db.sql<Record<string, any>>(
    `SELECT p.*, p.gross_atomic::text AS gross, p.platform_fee_atomic::text AS platform_fee,
            p.network_fee_atomic::text AS network_fee, p.net_atomic::text AS net,
            s.name AS seller_name, s.country, s.wallet_address, s.purpose_code, s.payout_reason,
            s.payout_preference, s.bank_details
     FROM payouts p JOIN sellers s ON s.id = p.seller_id WHERE p.id = $1`,
    [payoutId],
  ))[0];
  if (!payout) throw new Error(`Payout #${payoutId} not found`);

  const calls = await db.sql<{
    id: number; nonce: string; payer: string; amount_atomic: string; resource: string | null; status: string;
    gateway_transfer_id: string | null; recorded_at: Date; status_updated_at: Date;
  }>(
    `SELECT id, nonce, payer, amount_atomic::text AS amount_atomic, resource, status, gateway_transfer_id,
            recorded_at, status_updated_at
     FROM payments WHERE payout_id = $1 ORDER BY id`,
    [payoutId],
  );
  const earlierAttempts = await db.sql<{ id: number; failure_reason: string; created_at: Date }>(
    `SELECT id, failure_reason, created_at FROM payouts
     WHERE seller_id = $1 AND status = 'failed' AND id < $2 ORDER BY id`,
    [payout.seller_id, payoutId],
  );
  const screenings = await db.sql<{ subject_type: string; subject: string; result: string; provider: string; detail: any; screened_at: Date }>(
    `SELECT subject_type, subject, result, provider, detail, screened_at FROM screenings
     WHERE subject = $1 OR subject = ANY($2::text[]) ORDER BY subject_type, subject`,
    [`seller:${payout.seller_id}`, [payout.wallet_address, ...calls.map((c) => c.payer)]],
  );
  const eventIds = [`payout:${payoutId}:initiated`, `payout:${payoutId}:paid`, `payout:${payoutId}:failed`];
  const ledger = await db.sql<{ event_id: string; account: string; amount_atomic: string; created_at: Date }>(
    `SELECT event_id, account, amount_atomic::text AS amount_atomic, created_at FROM ledger_entries
     WHERE event_id = ANY($1::text[]) OR payment_id = ANY($2::int[]) ORDER BY id`,
    [eventIds, calls.map((c) => c.id)],
  );

  const agents = await agentIndex(db.sql, calls.map((c) => c.nonce));
  const labels = await walletLabels(db.sql);
  const callRows = calls.map((c) => ({
    ...c,
    payerLabel: labels.get(c.payer.toLowerCase()) ?? shortAddress(c.payer),
    agent: agents.get(c.nonce.toLowerCase()) ?? null,
  }));

  // Consistency checks an auditor would run.
  const sumCalls = calls.reduce((a, c) => a + BigInt(c.amount_atomic), 0n);
  const gross = BigInt(payout.gross);
  const net = BigInt(payout.net);
  const checks: { ok: boolean; text: string }[] = [
    { ok: calls.length > 0 && sumCalls === gross, text: `The ${calls.length} paid calls add up to exactly what this payout covers (${usd(sumCalls)} USDC)` },
    { ok: calls.every((c) => ["confirmed", "completed"].includes(c.status)), text: "Circle had settled every call before the seller was paid" },
    { ok: calls.every((c) => c.gateway_transfer_id), text: "Every call matches a payment record at Circle" },
    { ok: gross - BigInt(payout.platform_fee) - BigInt(payout.network_fee) === net, text: "Earnings minus fees equal the amount sent" },
    { ok: Boolean(payout.onchain_tx), text: "The USDC transfer is recorded on the blockchain" },
    { ok: screenings.some((s) => s.subject_type === "business" && s.result === "verified"), text: "The seller is a verified business" },
    {
      ok: screenings.filter((s) => s.subject_type === "wallet").length > 0 && screenings.filter((s) => s.subject_type === "wallet").every((s) => s.result === "clear"),
      text: "The seller's and every buyer's wallet passed sanctions screening",
    },
    { ok: payout.status === "paid" && Boolean(payout.document), text: "The seller was paid and there is a document to prove it" },
    {
      ok: ledger.length > 0 && ledger.reduce((a, l) => a + BigInt(l.amount_atomic), 0n) === 0n,
      text: "The ledger balances for this payout and its calls",
    },
  ];
  if (payout.country === "IN") {
    const doc = (payout.document ?? {}) as Record<string, unknown>;
    checks.push(
      { ok: payout.method === "india_partner", text: "The Indian seller was paid in rupees through a licensed partner, not in stablecoin" },
      { ok: Boolean(payout.purpose_code) && doc.purposeCode === payout.purpose_code, text: `The e-FIRA carries RBI purpose code ${payout.purpose_code ?? "(missing)"}` },
      {
        ok: Math.abs(Number(usd(net)) * Number(payout.fx_rate) - Number(payout.payout_amount)) < 0.01,
        text: "Rupees credited match the USD amount at the partner's exchange rate",
      },
    );
  }

  return { payout, calls: callRows, earlierAttempts, screenings, ledger, checks };
}

/** Markdown evidence pack for one payout. `highlight` marks one payment (by id). */
export function renderTrail(t: Trail, highlight?: number): string {
  const p = t.payout;
  const L: string[] = [];
  const doc = (p.document ?? {}) as Record<string, unknown>;
  const first = t.calls[0]?.recorded_at;
  const last = t.calls.at(-1)?.recorded_at;
  const day = (d?: Date | string) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
  const time = (d: Date | string) => new Date(d).toISOString().slice(0, 19).replace("T", " ");

  L.push(`# Compliance trail — payout #${p.id}`);
  L.push(`${p.seller_name} [${p.country}] · ${p.method} · status **${String(p.status).toUpperCase()}** · generated ${time(new Date())} UTC`);
  L.push("", "> Testnet prototype. On-chain legs are real (Arc Testnet); partner fiat legs, KYB and screening are mocks.", "");

  L.push("## 1. Why this route");
  L.push(`Seller preference: ${p.payout_preference}. Jurisdiction engine:`);
  for (const r of String(p.payout_reason ?? "").split(" | ").filter(Boolean)) L.push(`- ${r}`);

  L.push("", "## 2. Seller and buyers screened");
  for (const s of t.screenings) {
    const who = s.subject_type === "business" ? `Seller business (${(s.detail?.documents ?? []).join(", ")})` : `${s.detail?.role ?? "wallet"} ${shortAddress(s.subject)}`;
    L.push(`- ${s.result === "clear" || s.result === "verified" ? "✅" : "❌"} ${who}: **${s.result}** — ${s.provider}, ${time(s.screened_at)} UTC`);
  }
  if (!t.screenings.length) L.push("- No screening on record (payout made before Phase 5 checks)");

  const agentCalls = t.calls.filter((c) => c.agent);
  L.push("", "## 3. Who decided to pay");
  const byPayer = new Map<string, number>();
  for (const c of t.calls) byPayer.set(c.payerLabel, (byPayer.get(c.payerLabel) ?? 0) + 1);
  for (const [who, n] of byPayer) L.push(`- ${who}: ${n} call(s)`);
  const runs = new Map<string, typeof agentCalls>();
  for (const c of agentCalls) runs.set(c.agent!.runStartedAt, [...(runs.get(c.agent!.runStartedAt) ?? []), c]);
  for (const [at, cs] of runs) {
    const a = cs[0].agent!;
    L.push("", `**AI agent run ${time(at)} UTC** (model ${a.model}): ${a.runPaidCalls} paid call(s)${a.runSkipped ? `, ${a.runSkipped} repeat(s) answered from cache without paying` : ""}`);
    L.push(`- Task: ${a.task.replace(/\s+/g, " ").slice(0, 300)}${a.task.length > 300 ? "…" : ""}`);
    const quote = (r: string) => `> ${r.replace(/\s+/g, " ").slice(0, 400)}${r.length > 400 ? "…" : ""}`;
    const reasons = [...new Set(cs.map((c) => c.agent!.reasoning).filter(Boolean))] as string[];
    if (reasons.length === 1) {
      L.push("- Agent's reasoning before paying:", "", quote(reasons[0]), "");
      L.push(`- Paid for: ${cs.map((c) => `\`${c.agent!.input}\``).join(", ")}`);
    } else {
      for (const c of cs) {
        L.push(`- Paid for \`${c.agent!.input}\``);
        if (c.agent!.reasoning) L.push("", quote(c.agent!.reasoning), "");
      }
    }
  }

  L.push("", "## 4. Paid calls and Circle settlement");
  L.push("| # | Time (UTC) | Payer | Call | USDC | Nonce | Gateway transfer | Status |", "|---|---|---|---|---|---|---|---|");
  for (const c of t.calls) {
    const call = c.resource ? new URL(c.resource, "http://x").pathname : "—";
    L.push(`| ${c.id === highlight ? "**► " + c.id + "**" : c.id} | ${time(c.recorded_at)} | ${c.payerLabel} | \`${call}\` | ${usd(c.amount_atomic)} | \`${c.nonce.slice(0, 10)}…\` | \`${c.gateway_transfer_id?.slice(0, 8) ?? "—"}…\` | ${c.status} |`);
  }

  const total = Number(usd(p.gross));
  L.push("", "## 5. Usage statement");
  L.push(`- Period: ${day(first)} to ${day(last)} · ${t.calls.length} calls · **USD ${total.toFixed(6)}** (USDC 1:1)`);
  if (p.country === "IN") L.push(`- Export of services, RBI purpose code **${p.purpose_code ?? "to be set"}** (confirm with the AD bank)`);

  L.push("", "## 6. Payout");
  if (t.earlierAttempts.length) {
    for (const e of t.earlierAttempts) L.push(`- Earlier attempt #${e.id} FAILED ${time(e.created_at)} UTC: ${e.failure_reason} (funds returned, no on-chain movement)`);
  }
  L.push(`- Gross ${usd(p.gross)} − platform fee ${usd(p.platform_fee)} − Gateway fee reserve ${usd(p.network_fee)} = **net ${usd(p.net)} USDC**`);
  if (p.onchain_tx) L.push(`- On-chain USDC leg (Circle Gateway withdrawal, Arc Testnet): [${p.onchain_tx}](${explorerTx(p.onchain_tx)})`);
  L.push(`- Recipient: ${p.onchain_recipient}${p.partner ? ` (${p.partner} treasury)` : " (seller's own wallet)"}`);
  if (p.partner) {
    L.push(`- Partner reference: ${p.partner_ref ?? "—"} · rate ${Number(p.fx_rate).toFixed(4)} · **${p.payout_currency} ${Number(p.payout_amount).toFixed(2)}**`);
  }

  L.push("", `## 7. ${doc.type ?? "Settlement document"}`);
  if (p.document) for (const [k, v] of Object.entries(doc)) L.push(`- ${k}: ${v}`);
  else L.push(`- Not issued yet (status ${p.status}${p.expected_at ? `, expected ${time(p.expected_at)} UTC` : ""})`);

  L.push("", "## 8. Ledger events");
  const byEvent = new Map<string, string[]>();
  for (const e of t.ledger) byEvent.set(e.event_id, [...(byEvent.get(e.event_id) ?? []), `${e.account} ${BigInt(e.amount_atomic) > 0n ? "+" : ""}${usd(e.amount_atomic)}`]);
  const payoutEvents = [...byEvent].filter(([k]) => k.startsWith("payout:"));
  L.push(`- ${byEvent.size - payoutEvents.length} payment events (received / settled) across ${t.calls.length} calls`);
  for (const [k, legs] of payoutEvents) L.push(`- \`${k}\`: ${legs.join(", ")}`);

  L.push("", "## 9. Checks");
  for (const c of t.checks) L.push(`- ${c.ok ? "✅" : "❌"} ${c.text}`);
  const passed = t.checks.filter((c) => c.ok).length;
  L.push("", `**${passed}/${t.checks.length} checks passed.**`);
  return L.join("\n") + "\n";
}
