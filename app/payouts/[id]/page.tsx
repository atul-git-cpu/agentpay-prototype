import { Fragment } from "react";
import { notFound } from "next/navigation";
import { getTrail, getPayouts, usdc } from "../../_lib/data";
import { amt, fiat, route, when, short, callPath, plain, tidy, docLabel, docTitle, statusLabel, EXPLORER, COUNTRY } from "../../_lib/format";
import { routeFor } from "../../../src/payouts/jurisdiction";
import { DbError } from "../../_components/db-error";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = {
  inr: "var(--r-inr)", usdc: "var(--r-usdc)", sepa: "var(--r-sepa)", ach: "var(--r-ach)", swift: "var(--r-swift)",
};
const HIDDEN_DOC_FIELDS = new Set(["type", "note"]);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Payout #${(await params).id} | AgentPay` };
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
  const failed = p.status === "failed";
  const seller = String(p.seller_name).replace(" (sample)", "");
  const reasons = routeFor(p.country, p.payout_preference).reasons;
  const payers = new Map<string, number>();
  for (const c of t.calls) payers.set(c.payerLabel, (payers.get(c.payerLabel) ?? 0) + 1);
  const runs = new Map<string, typeof t.calls>();
  for (const c of t.calls) if (c.agent) runs.set(c.agent.runStartedAt, [...(runs.get(c.agent.runStartedAt) ?? []), c]);
  if (failed) {
    const retry = (await getPayouts().catch(() => [])).find((x) => x.id > p.id && x.seller === p.seller_name && x.status !== "failed");
    return (
      <>
        <nav className="crumbs small" aria-label="Breadcrumb"><a href="/payouts">Payouts</a> / Payout #{p.id}</nav>
        <h1>Payout #{p.id} to {seller} was stopped</h1>
        <dl className="summary">
          <div><dt>Seller got</dt><dd>Nothing yet</dd></div>
          <div><dt>Route</dt><dd><span className={`route r-${r.key}`}>{r.label}</span></dd></div>
          <div><dt>Status</dt><dd><span className="status failed">Failed</span></dd></div>
        </dl>
        <p className="note">
          The payout partner rejected the seller&apos;s bank details: {tidy(String(p.failure_reason)).replace(/\s*\(partner pre-validation\)/, "")}.
          This check happens before any USDC is sent, so no money moved and the {usdc(p.gross)} USDC went back to the seller&apos;s balance.
        </p>
        {retry ? (
          <p>The seller corrected their bank details and was paid in <a href={`/payouts/${retry.id}`}>payout #{retry.id}</a>, which has the full record.</p>
        ) : (
          <p>Once the seller corrects their bank details, the next payout will include this balance.</p>
        )}
        <h2>What was planned</h2>
        <dl className="kv">
          <dt>Earned</dt><dd>{usdc(p.gross)} USDC</dd>
          <dt>Would have sent</dt><dd>{usdc(p.net)} USDC after fees</dd>
          <dt>To</dt><dd>{p.partner ? `The ${r.short} payout partner, to pay the seller's bank in ${p.payout_currency}` : "The seller's own wallet"}</dd>
          <dt>Why this route</dt><dd>{reasons.join(". ")}.</dd>
        </dl>
      </>
    );
  }
  const received = failed ? "Nothing" : p.payout_currency === "USDC" ? `${usdc(p.net)} USDC` : fiat(p.payout_currency, p.payout_amount);

  return (
    <>
      <nav className="crumbs small" aria-label="Breadcrumb"><a href="/payouts">Payouts</a> / Payout #{p.id}</nav>
      <h1>Payout #{p.id} to {seller}</h1>

      <dl className="summary">
        <div><dt>Seller got</dt><dd>{received}</dd></div>
        <div><dt>Route</dt><dd><span className={`route r-${r.key}`}>{r.label}</span></dd></div>
        <div><dt>Status</dt><dd><span className={`status ${p.status}`}>{statusLabel(p.status)}</span></dd></div>
        <div><dt>Checks</dt><dd className={allOk ? "ok" : "bad"}>{passed} of {t.checks.length} passed</dd></div>
      </dl>
      {failed && <p className="note">This payout was stopped: {tidy(String(p.failure_reason))}. No money moved, and the balance went back to the seller.</p>}
      <p className="sub">
        Below is everything behind this payout, in order: why it went this way, who was checked, who paid and for what, and
        how the money reached the seller. It&apos;s the record a bank or auditor would ask for.
      </p>

      <ol className="chain" style={{ ["--c" as string]: COLOR[r.key] }}>
        <li>
          <h3>Why it was paid this way</h3>
          <div className="body">
            <p>The seller is in {COUNTRY[p.country] ?? p.country} and asked to be paid in {p.payout_preference === "usdc" ? "USDC" : "local currency"}.</p>
            <ul>{reasons.map((x) => <li key={x}>{x}.</li>)}</ul>
          </div>
        </li>

        <li>
          <h3>Who was checked before paying</h3>
          <div className="body">
            <ul className="checks">
              {t.screenings.map((s) => (
                <li key={s.subject_type + s.subject} className={s.result === "clear" || s.result === "verified" ? "pass" : "fail"}>
                  {s.subject_type === "business"
                    ? `The seller's business documents (${(s.detail?.documents ?? []).join(", ")}) were verified`
                    : `${s.detail?.role === "seller" ? "Seller's" : "Buyer's"} wallet ${short(s.subject)} ${s.result === "clear" ? "is not on any sanctions list" : "is on a sanctions list"}`}
                  <span className="line2">Checked {when(s.screened_at)} (simulated check)</span>
                </li>
              ))}
              {t.screenings.length === 0 && <li className="fail">No checks on record</li>}
            </ul>
          </div>
        </li>

        <li>
          <h3>Who decided to pay</h3>
          <div className="body">
            <ul>{[...payers].map(([who, n]) => <li key={who}>{who}: {n} call{n === 1 ? "" : "s"}</li>)}</ul>
            {[...runs].map(([at, cs]) => {
              const a = cs[0].agent!;
              const thoughts = [...new Set(cs.map((c) => c.agent!.reasoning).filter(Boolean))] as string[];
              return (
                <div key={at} className="run">
                  <h3>The AI agent&apos;s run on {when(at)}</h3>
                  <p className="small">Model: {a.model}. It made {a.runPaidCalls} paid calls in this run.</p>
                  <p className="label">The task it was given</p>
                  <p className="task">{a.task}</p>
                  {thoughts.length > 0 && <p className="label">What it said before paying</p>}
                  {thoughts.map((x) => <blockquote key={x} className="said">{plain(x)}</blockquote>)}
                  <p>It paid for {cs.map((c, i) => <Fragment key={c.id}>{i ? ", " : ""}<code>{c.agent!.input}</code></Fragment>)}.</p>
                </div>
              );
            })}
          </div>
        </li>

        <li>
          <h3>The calls this payout covers</h3>
          <div className="body">
            <p className="small">Each call was paid separately and settled by Circle. The payment ID links a call to Circle&apos;s record of it.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>API call</th><th>Paid by</th><th className="num">USDC</th><th>Payment ID</th><th>Status</th></tr></thead>
                <tbody>
                  {t.calls.map((c) => (
                    <tr key={c.id}>
                      <td><code>{callPath(c.resource)}</code><span className="line2">{when(c.recorded_at)}</span></td>
                      <td>{c.payerLabel}</td>
                      <td className="num">{amt(usdc(c.amount_atomic), 3)}</td>
                      <td className="hash nowrap" title={c.nonce}>{short(c.nonce, 8, 4)}</td>
                      <td><span className={`status ${c.status}`}>{statusLabel(c.status)}</span></td>
                    </tr>
                  ))}
                  {t.calls.length === 0 && <tr><td colSpan={5} className="small">None. When a payout fails its calls go back to the seller&apos;s balance and are paid in the next payout.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </li>

        <li>
          <h3>The payout</h3>
          <div className="body">
            {t.earlierAttempts.map((e) => (
              <p key={e.id} className="note">
                An earlier attempt (<a href={`/payouts/${e.id}`}>payout #{e.id}</a>) failed on {when(e.created_at)}: {tidy(e.failure_reason)}. No money moved then.
              </p>
            ))}
            <dl className="kv">
              <dt>Earned</dt><dd>{usdc(p.gross)} USDC</dd>
              <dt>Platform fee</dt><dd>{usdc(p.platform_fee)} USDC</dd>
              <dt>Circle&apos;s withdrawal fee</dt><dd>{usdc(p.network_fee)} USDC (set aside)</dd>
              <dt>Sent</dt><dd><b>{usdc(p.net)} USDC</b></dd>
              <dt>Sent to</dt><dd>{p.partner ? "The payout partner, who pays the seller's bank" : "The seller's own wallet"}<span className="line2 hash">{p.onchain_recipient}</span></dd>
              <dt>Blockchain record</dt>
              <dd>{p.onchain_tx ? <a className="hash" href={`${EXPLORER}/tx/${p.onchain_tx}`} target="_blank" rel="noreferrer">{p.onchain_tx}</a> : "None"}</dd>
              {p.partner && !failed && <><dt>Exchange rate</dt><dd>{Number(p.fx_rate).toFixed(4)} {p.payout_currency} per USD</dd></>}
              {p.partner && !failed && <><dt>Seller got</dt><dd><b>{fiat(p.payout_currency, p.payout_amount)}</b></dd></>}
            </dl>
          </div>
        </li>

        <li>
          <h3>{doc ? docTitle(String(doc.type)) : "Bank document"}</h3>
          <div className="body">
            {p.country === "IN" && doc && (
              <p className="small">An e-FIRA is the bank&apos;s certificate that foreign money arrived. Indian exporters need it to prove export earnings.</p>
            )}
            {doc ? (
              <dl className="kv">
                {Object.entries(doc).filter(([k]) => !HIDDEN_DOC_FIELDS.has(k)).map(([k, v]) => (
                  <Fragment key={k}><dt>{docLabel(k)}</dt><dd>{tidy(String(v))}</dd></Fragment>
                ))}
              </dl>
            ) : (
              <p className="small">{failed ? "No document, because nothing was paid." : `Not issued yet${p.expected_at ? `. Expected ${when(p.expected_at)}` : ""}.`}</p>
            )}
            {doc && <p className="small">Simulated document. In production it comes from the payout partner&apos;s bank.</p>}
          </div>
        </li>

        <li>
          <h3>Final checks</h3>
          <div className="body">
            <ul className="checks">
              {t.checks.map((c) => <li key={c.text} className={c.ok ? "pass" : "fail"}>{c.text}</li>)}
            </ul>
          </div>
        </li>
      </ol>
    </>
  );
}
