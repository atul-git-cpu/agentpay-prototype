import { getAgentRuns } from "../_lib/data";
import { amt, when, short, plain, statusLabel } from "../_lib/format";
import { DbError } from "../_components/db-error";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI agent | AgentPay" };

type Ev = { at: string; type: string; [k: string]: unknown };

export default async function AgentRuns() {
  let data;
  try {
    data = await getAgentRuns();
  } catch (err) {
    return <DbError error={err} />;
  }
  const { runs, payments } = data;
  return (
    <>
      <h1>What the AI agent paid for</h1>
      <p className="lede">
        We give an AI model (Google&apos;s Gemini) a task and a small budget in USDC. It decides which API calls are worth
        paying for, and its Circle wallet signs each payment. The spending limit is enforced by our code, so the agent
        can&apos;t go over it even if it tries.
      </p>
      {runs.length === 0 && <p className="empty">No agent runs yet. Run <code>npm run agent</code>, then <code>npm run dashboard:setup</code>.</p>}
      {runs.map((r) => {
        const events = r.events as Ev[];
        const thoughts = events.filter((e) => e.type === "thought").map((e) => String(e.text));
        const paid = events.filter((e) => e.type === "payment");
        const reused = events.filter((e) => e.type === "cache_hit").length;
        return (
          <section key={r.id} className="run">
            <h2 style={{ marginTop: 0 }}>Run on {when(r.started_at)}</h2>
            <p className="small">
              {r.paid_calls} paid call{r.paid_calls === 1 ? "" : "s"}{r.spent_usdc ? `, ${amt(r.spent_usdc, 3)} USDC spent` : ""}.
              {reused ? ` ${reused} repeated question${reused === 1 ? " was" : "s were"} answered from memory for free.` : ""} Model: {r.model}.
              Wallet <code>{short(r.agent)}</code>.
            </p>
            <p className="label">The task it was given</p>
            <p className="task">{r.task}</p>
            {thoughts.length > 0 && <p className="label">What it said along the way</p>}
            {thoughts.map((t, i) => <blockquote key={i} className="said">{plain(t)}</blockquote>)}
            <p className="label">What it paid for</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Checked</th><th>Answer</th><th className="num">Cost (USDC)</th><th>Payment</th><th>Seller paid in</th></tr></thead>
                <tbody>
                  {paid.map((e) => {
                    const res = (e.result ?? {}) as Record<string, unknown>;
                    const p = payments.get(String(e.nonce).toLowerCase());
                    return (
                      <tr key={String(e.nonce)}>
                        <td><code>{String(e.gstin ?? e.input ?? "")}</code></td>
                        <td>{res.valid ? `Valid${res.state ? `, registered in ${res.state}` : ""}` : `Not valid${res.reason ? `: ${String(res.reason).toLowerCase()}` : ""}`}</td>
                        <td className="num">{amt(String(e.amountUsdc ?? ""), 3)}</td>
                        <td>{p ? <span className={`status ${p.status}`}>{statusLabel(p.status)}</span> : <span className="small">Not recorded</span>}</td>
                        <td>{p?.payout_id ? <a href={`/payouts/${p.payout_id}`}>Payout #{p.payout_id}</a> : <span className="small">Not paid out yet</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
