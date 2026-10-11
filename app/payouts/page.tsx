import { getPayouts, usdc } from "../_lib/data";
import { amt, fiat, route, when, short, EXPLORER, COUNTRY, statusLabel, docTitle, tidy } from "../_lib/format";
import { DbError } from "../_components/db-error";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payouts | AgentPay" };

export default async function Payouts() {
  let rows;
  try {
    rows = await getPayouts();
  } catch (err) {
    return <DbError error={err} />;
  }
  return (
    <>
      <h1>Payouts</h1>
      <p className="lede">
        A payout sends a seller what they&apos;ve earned. The USDC really moves on Circle&apos;s test network, either to the
        seller&apos;s own wallet or to a payout partner who pays them in local currency. Click a payout to see the full record
        behind it.
      </p>
      {rows.length === 0 ? (
        <p className="empty">No payouts yet. Run <code>npm run payouts</code> in the Codespace.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 28 }}>
          <table>
            <thead>
              <tr>
                <th>Payout</th><th>Seller</th><th>Route</th><th className="num">Earned</th>
                <th className="num">Fees</th><th className="num">Seller got</th><th>Status</th><th>Blockchain record</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const r = route(p.method, p.payout_currency);
                const fees = usdc(BigInt(p.platform_fee) + BigInt(p.network_fee));
                const failed = p.status === "failed";
                return (
                  <tr key={p.id}>
                    <td className="nowrap"><a href={`/payouts/${p.id}`}>Payout #{p.id}</a><span className="line2">{when(p.created_at)}</span></td>
                    <td>{p.seller.replace(" (sample)", "")}<span className="line2">{COUNTRY[p.country] ?? p.country}{p.calls ? `, ${p.calls} calls` : ""}</span></td>
                    <td><span className={`route r-${r.key}`}>{r.short}</span></td>
                    <td className="num">{amt(usdc(p.gross))}</td>
                    <td className="num">{failed ? "None" : amt(fees)}</td>
                    <td className="num">
                      {failed ? "Nothing sent" : p.payout_currency === "USDC" ? `${amt(usdc(p.net))} USDC` : fiat(p.payout_currency, p.payout_amount)}
                      {!failed && p.payout_currency !== "USDC" && <span className="line2">from {amt(usdc(p.net))} USDC</span>}
                    </td>
                    <td>
                      <span className={`status ${p.status}`}>{statusLabel(p.status)}</span>
                      <span className="line2">{p.failure_reason ? (/beneficiary|bank/i.test(p.failure_reason) ? "Bank details rejected" : tidy(p.failure_reason)) : p.doc ? docTitle(p.doc) : ""}</span>
                    </td>
                    <td>
                      {p.onchain_tx
                        ? <a className="hash" href={`${EXPLORER}/tx/${p.onchain_tx}`} target="_blank" rel="noreferrer">{short(p.onchain_tx, 8, 6)}</a>
                        : <span className="small">None. It stopped before any money moved.</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small">Fees are our platform fee plus the fee Circle charges to withdraw. Amounts are in USDC unless shown in another currency.</p>
    </>
  );
}
