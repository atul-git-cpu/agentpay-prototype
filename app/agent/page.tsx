import { getAgentRuns } from "../_lib/data";
import { amt, when, short, plain } from "../_lib/format";
import { DbError } from "../_components/db-error";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent runs — AgentPay" };

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
      <h1>Agent runs</h1>
      <p className="lede">
        An AI model (Gemini, through a free API) is given a task and a small USDC budget. It decides which paid calls are worth
        making, and each payment is signed by its Circle-managed wallet. The budget and call limits are enforced in code,
        not left to the model.
      </p>
      {runs.length === 0 && <p className="empty">No agent runs yet. Run <code>npm run agent</code>, then <code>npm run dashboard:setup</code>.</p>}
      {runs.map((r) => {
        const events = r.events as Ev[];
        const tools = events.filter((e) => e.type === "tool_call");
        const thoughts = events.filter((e) => e.type === "thought").map((e) => String(e.text));
        const paid = events.filter((e) => e.type === "payment");
        const reused = events.filter((e) => e.type === "cache_hit");
        return (
          <section key={r.id} className="run">
            <h2 style={{ marginTop: 0 }}>{when(r.started_at)}</h2>
            <p className="small">
              Model {r.model}. Wallet <code>{short(r.agent)}</code>. {r.paid_calls} paid call{r.paid_calls === 1 ? "" : "s"}
              {r.spent_usdc ? `, ${amt(r.spent_usdc, 3)} USDC spent` : ""}; {tools.length} tool calls in total.
              {reused.length ? ` ${reused.length} repeat${reused.length === 1 ? "" : "s"} answered from cache without paying.` : ""}
            </p>
            <h3>The task</h3>
            <p className="task">{r.task}</p>
            {thoughts.length > 0 && (
              <>
                <h3>What the agent said while working</h3>
                {thoughts.map((t, i) => <blockquote key={i} className="said">{plain(t)}</blockquote>)}
              </>
            )}
            <h3>What it paid for</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Input</th><th>Result</th><th className="num">USDC</th><th>Circle status</th><th>Paid out in</th></tr></thead>
                <tbody>
                  {paid.map((e) => {
                    const res = (e.result ?? {}) as Record<string, unknown>;
                    const p = payments.get(String(e.nonce).toLowerCase());
                    return (
                      <tr key={String(e.nonce)}>
                        <td><code>{String(e.gstin ?? e.input ?? "")}</code></td>
                        <td>{res.valid ? `Valid${res.state ? `, ${res.state}` : ""}` : `Invalid${res.reason ? `: ${res.reason}` : ""}`}</td>
                        <td className="num">{amt(String(e.amountUsdc ?? ""), 3)}</td>
                        <td>{p ? <span className={`status ${p.status}`}>{p.status}</span> : <span className="small">not in ledger</span>}</td>
                        <td>{p?.payout_id ? <a href={`/payouts/${p.payout_id}`}>Payout #{p.payout_id}</a> : <span className="small">not yet</span>}</td>
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
