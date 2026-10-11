import { getOverview } from "./_lib/data";
import { amt, fiat, route, when, callPath, COUNTRY, short } from "./_lib/format";
import { RouteMap, RouteList } from "./_components/route-map";
import { DbError } from "./_components/db-error";

export const dynamic = "force-dynamic";

export default async function Overview() {
  let data;
  try {
    data = await getOverview();
  } catch (err) {
    return <DbError error={err} />;
  }
  const { sellers, totals, recent } = data;

  return (
    <>
      <h1>AI agents pay per API call in USDC. Each seller gets paid the way their country allows.</h1>
      <p className="lede">
        Buyers and an AI agent pay four API sellers fractions of a cent per call through Circle Gateway. Every payout is
        routed by the seller&apos;s jurisdiction: rupees through a licensed partner for India, USDC where stablecoins are
        permitted, a local bank rail or SWIFT everywhere else.
      </p>

      <ul className="figures" aria-label="Totals">
        <li><b>{totals.calls}</b><span>paid calls</span></li>
        <li><b>{amt(totals.volume)}</b><span>USDC paid by buyers</span></li>
        <li><b>{totals.agentCalls}</b><span>calls paid by the AI agent</span></li>
        <li><b>{totals.payouts}</b><span>payouts completed</span></li>
      </ul>

      <figure className="map">
        <RouteMap sellers={sellers} calls={totals.calls} volume={totals.volume} />
        <RouteList sellers={sellers} />
        <figcaption className="small">
          Live from the ledger. A dashed line means that seller&apos;s last payout failed and the money went back to their balance.
        </figcaption>
      </figure>

      <h2>Sellers</h2>
      <p className="sub">What each seller earned and how it left the platform. The route comes from the jurisdiction engine, not the seller.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Seller</th><th>Payout route</th><th className="num">Calls</th><th className="num">Earned (USDC)</th>
              <th className="num">Paid out (USDC)</th><th className="num">Waiting</th><th>Last payout</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => {
              const r = route(s.method, s.currency);
              const waiting = Number(s.pending) + Number(s.available) + Number(s.inFlight);
              const lp = s.lastPayout;
              return (
                <tr key={s.id}>
                  <td>{s.name.replace(" (sample)", "")}<span className="line2">{COUNTRY[s.country] ?? s.country}</span></td>
                  <td>
                    <span className={`route r-${r.key}`}>{r.label}</span>
                    <span className="line2">{s.reason.split(" | ")[0]}</span>
                  </td>
                  <td className="num">{s.calls}</td>
                  <td className="num">{amt(s.earned)}</td>
                  <td className="num">{amt(s.paidOut)}</td>
                  <td className="num">{amt(waiting)}</td>
                  <td>
                    {lp ? (
                      <a href={`/payouts/${lp.id}`}>
                        <span className={`status ${lp.status}`}>{lp.status}</span>{" "}
                        {lp.status === "failed" ? "" : lp.currency === "USDC" ? `${amt(s.paidOut)} USDC` : fiat(lp.currency, lp.amount)}
                      </a>
                    ) : (
                      <span className="small">none yet</span>
                    )}
                    {lp?.document && <span className="line2">{lp.document}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small">
        Platform fees earned: {amt(totals.platformFees)} USDC. Circle Gateway withdrawal fees: {amt(totals.gatewayFees)} USDC — at
        these tiny test amounts the network fee is bigger than the platform&apos;s, which is why real payouts wait for a minimum balance.
      </p>

      <h2>Latest paid calls</h2>
      <p className="sub">Each call is paid before the API answers. Circle batches them and settles on-chain; the ledger tracks each one by its payment nonce.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Time (IST)</th><th>Paid by</th><th>Call</th><th>Seller</th><th className="num">USDC</th><th>Circle status</th></tr>
          </thead>
          <tbody>
            {recent.map((c) => (
              <tr key={c.id}>
                <td>{when(c.recorded_at)}</td>
                <td>{c.payerLabel ?? <code>{short(c.payer)}</code>}</td>
                <td><code>{callPath(c.resource)}</code></td>
                <td>{c.seller.replace(" (sample)", "")}</td>
                <td className="num">{amt(c.amount, 3)}</td>
                <td><span className={`status ${c.status}`}>{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
