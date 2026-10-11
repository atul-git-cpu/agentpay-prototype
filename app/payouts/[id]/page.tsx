import { Fragment } from "react";
import { notFound } from "next/navigation";
import { getTrail, usdc } from "../../_lib/data";
import { amt, fiat, route, when, short, callPath, plain, EXPLORER, COUNTRY } from "../../_lib/format";
import { DbError } from "../../_components/db-error";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = {
  inr: "var(--r-inr)", usdc: "var(--r-usdc)", sepa: "var(--r-sepa)", ach: "var(--r-ach)", swift: "var(--r-swift)",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Payout #${(await params).id} compliance trail — AgentPay` };
}

export default async function TrailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  let t;
  try {
    t = await getTrail(id);
  } catch (err) {
    if (err instanceof Error && /not found/.test(err.message)) notFound();
    return <DbError error={err} />;
  }
  const p = t.payout;
  const r = route(p.method, p.payout_currency);
  const doc = (p.document ?? null) as Record<string, unknown> | null;
  const passed = t.checks.filter((c) => c.ok).length;
  const allOk = passed === t.checks.length;
  const payers = new Map<string, number>();
  for (const c of t.calls) payers.set(c.payerLabel, (payers.get(c.payerLabel) ?? 0) + 1);
  const runs = new Map<string, typeof t.calls>();
  for (const c of t.calls) if (c.agent) runs.set(c.agent.runStartedAt, [...(runs.get(c.agent.runStartedAt) ?? []), c]);

  return (
    <>
      <p className="small"><a href="/payouts">All payouts</a></p>
      <h1>Payout #{p.id}: {String(p.seller_name).replace(" (sample)", "")}</h1>
      <p className="lede">
        {usdc(p.net)} USDC net{p.payout_currency !== "USDC" ? `, paid as ${fiat(p.payout_currency, p.payout_amount)}` : ""} via{" "}
        <span className={`route r-${r.key}`}>{r.label}</span>. Status: <span className={`status ${p.status}`}>{p.status}</span>.
      </p>
      <p className={`verdict ${allOk ? "pass" : "fail"}`}>{passed} of {t.checks.length} compliance checks passed</p>
      <p className="note">
        This is the evidence pack a bank or auditor asks for: from who decided to pay, through each paid call and Circle&apos;s
        settlement, to the money reaching the seller. On-chain legs are real (Arc Testnet); the bank leg, KYB and screening are mocks.
      </p>

      <ol className="chain" style={{ ["--c" as string]: COLOR[r.key] }}>
        <li>
          <h3>Why this route</h3>
          <div className="body">
            <p className="small">Seller asked for {p.payout_preference === "usdc" ? "USDC" : "local currency"}; seller is in {COUNTRY[p.country] ?? p.country}.</p>
            <ul>{String(p.payout_reason ?? "").split(" | ").filter(Boolean).map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </li>

        <li>
          <h3>Who was checked</h3>
          <div className="body">
            <ul className="checks">
              {t.screenings.map((s) => (
                <li key={s.subject_type + s.subject} className={s.result === "clear" || s.result === "verified" ? "pass" : "fail"}>
                  {s.subject_type === "business"
                    ? `Seller business verified with ${(s.detail?.documents ?? []).join(", ")}`
                    : `${s.detail?.role === "seller" ? "Seller" : "Payer"} wallet ${short(s.subject)}: ${s.result}`}
                  <span className="line2 small">{s.provider}, {when(s.screened_at)}</span>
                </li>
              ))}
              {t.screenings.length === 0 && <li className="fail">No screening on record</li>}
            </ul>
          </div>
        </li>

        <li>
          <h3>Who decided to pay</h3>
          <div className="body">
            <ul>{[...payers].map(([who, n]) => <li key={who}>{who}: {n} call{n === 1 ? "" : "s"}</li>)}</ul>
            {[...runs].map(([at, cs]) => {
              const a = cs[0].agent!;
              const reasons = [...new Set(cs.map((c) => c.agent!.reasoning).filter(Boolean))] as string[];
              return (
                <div key={at} className="run">
                  <h3>AI agent run, {when(at)}</h3>
                  <p className="small">Model {a.model}. {a.runPaidCalls} paid calls in this run.</p>
                  <p className="task"><b>Task given to the agent:</b> {a.task}</p>
                  {reasons.map((x) => <blockquote key={x} className="said">{plain(x)}</blockquote>)}
                  <p>Paid for: {cs.map((c) => <code key={c.id} style={{ marginRight: 8 }}>{c.agent!.input}</code>)}</p>
                </div>
              );
            })}
          </div>
        </li>

        <li>
          <h3>Every paid call, settled by Circle</h3>
          <div className="body table-wrap">
            <table>
              <thead><tr><th>Call</th><th>Paid by</th><th className="num">USDC</th><th>Payment nonce</th><th>Gateway transfer</th><th>Status</th></tr></thead>
              <tbody>
                {t.calls.map((c) => (
                  <tr key={c.id}>
                    <td><code>{callPath(c.resource)}</code><span className="line2">{when(c.recorded_at)}</span></td>
                    <td>{c.payerLabel}</td>
                    <td className="num">{amt(usdc(c.amount_atomic), 3)}</td>
                    <td className="hash nowrap">{short(c.nonce, 8, 4)}</td>
                    <td className="hash nowrap">{c.gateway_transfer_id ? short(c.gateway_transfer_id, 8, 4) : "—"}</td>
                    <td><span className={`status ${c.status}`}>{c.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </li>

        <li>
          <h3>Payout and fees</h3>
          <div className="body">
            {t.earlierAttempts.map((e) => (
              <p key={e.id} className="note">Earlier attempt #{e.id} failed on {when(e.created_at)}: {e.failure_reason}. No money moved; the balance went back to the seller.</p>
            ))}
            <dl className="kv">
              <dt>Earned from {t.calls.length} calls</dt><dd>{usdc(p.gross)} USDC</dd>
              <dt>Platform fee</dt><dd>{usdc(p.platform_fee)} USDC</dd>
              <dt>Circle withdrawal fee reserve</dt><dd>{usdc(p.network_fee)} USDC</dd>
              <dt>Sent on-chain</dt><dd><b>{usdc(p.net)} USDC</b></dd>
              <dt>To</dt><dd><code>{p.onchain_recipient}</code> {p.partner ? "(payout partner's treasury)" : "(seller's own wallet)"}</dd>
              <dt>On-chain transaction</dt>
              <dd>{p.onchain_tx ? <a className="hash" href={`${EXPLORER}/tx/${p.onchain_tx}`}>{p.onchain_tx}</a> : "—"}</dd>
              {p.partner && <><dt>Partner reference</dt><dd className="hash">{p.partner_ref ?? "—"}</dd></>}
              {p.partner && <><dt>Exchange rate</dt><dd>{Number(p.fx_rate).toFixed(4)} {p.payout_currency} per USD</dd></>}
              {p.partner && <><dt>Seller receives</dt><dd><b>{fiat(p.payout_currency, p.payout_amount)}</b></dd></>}
            </dl>
          </div>
        </li>

        <li>
          <h3>{doc ? String(doc.type) : "Bank document"}</h3>
          <div className="body">
            {doc ? (
              <dl className="kv">
                {Object.entries(doc).filter(([k]) => k !== "type").map(([k, v]) => (
                  <Fragment key={k}><dt>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt><dd>{String(v)}</dd></Fragment>
                ))}
              </dl>
            ) : (
              <p className="small">Not issued yet{p.expected_at ? ` — expected ${when(p.expected_at)}` : ""}.</p>
            )}
          </div>
        </li>

        <li>
          <h3>Checks</h3>
          <div className="body">
            <ul className="checks">
              {t.checks.map((c) => <li key={c.text} className={c.ok ? "pass" : "fail"}>{c.text}</li>)}
            </ul>
            <p className="small">
              Ledger: {t.ledger.length} entries across the calls and this payout, all summing to zero.
            </p>
          </div>
        </li>
      </ol>
    </>
  );
}
