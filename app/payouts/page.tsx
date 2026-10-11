import { getPayouts, usdc } from "../_lib/data";
import { amt, fiat, route, when, short, EXPLORER, COUNTRY } from "../_lib/format";
import { DbError } from "../_components/db-error";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payouts — AgentPay" };

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
        Every payout moves real testnet USDC out of Circle Gateway on Arc — to the seller&apos;s wallet, or to a payout
        partner who pays the seller in local currency. Open one to see its full compliance trail.
      </p>
      {rows.length === 0 ? (
        <p className="empty">No payouts yet. Run <code>npm run payouts</code> in the Codespace.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 28 }}>
          <table>
            <thead>
              <tr>
                <th>#</th><th>Seller</th><th>Route</th><th className="num">Calls</th><th className="num">Gross</th>
                <th className="num">Fees</th><th className="num">Seller receives</th><th>Status</th><th>On-chain leg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const r = route(p.method, p.payout_currency === "USDC" ? "USDC" : p.payout_currency);
                const fees = usdc(BigInt(p.platform_fee) + BigInt(p.network_fee));
                return (
                  <tr key={p.id}>
                    <td><a href={`/payouts/${p.id}`}>#{p.id}</a></td>
                    <td>{p.seller.replace(" (sample)", "")}<span className="line2">{COUNTRY[p.country] ?? p.country}, {when(p.created_at)}</span></td>
                    <td><span className={`route r-${r.key}`}>{r.short}</span></td>
                    <td className="num">{p.calls || "—"}</td>
                    <td className="num">{amt(usdc(p.gross))}</td>
                    <td className="num">{amt(fees)}</td>
                    <td className="num">
                      {amt(usdc(p.net))} USDC
                      {p.payout_currency !== "USDC" && <span className="line2">{fiat(p.payout_currency, p.payout_amount)}</span>}
                    </td>
                    <td>
                      <span className={`status ${p.status}`}>{p.status}</span>
                      <span className="line2">{p.failure_reason ?? p.doc ?? ""}</span>
                    </td>
                    <td>
                      {p.onchain_tx ? <a className="hash" href={`${EXPLORER}/tx/${p.onchain_tx}`}>{short(p.onchain_tx, 8, 6)}</a> : <span className="small">none — stopped before any money moved</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
