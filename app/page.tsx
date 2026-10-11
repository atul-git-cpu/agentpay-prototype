import { getOverview } from "./_lib/data";
import { amt, fiat, route, when, callPath, COUNTRY, short, statusLabel, docTitle } from "./_lib/format";
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
  const india = sellers.find((s) => s.country === "IN" && s.lastPayout && s.lastPayout.status !== "failed");

  return (
    <>
      <h1>AI agents pay per API call in USDC. Sellers get paid the way their country allows.</h1>
      <p className="lede">
        Four small API businesses sell data for a fraction of a cent per call. Buyers, including an AI agent, pay each call in
        USDC through Circle. When a seller is paid out, the money goes the way their country allows: rupees through a licensed
        partner in India, USDC in the US, and a bank transfer elsewhere.
      </p>

      <ul className="start">
        {india?.lastPayout && (
          <li>
            <a href={`/payouts/${india.lastPayout.id}`}>Follow one payout to India</a>
            <span>From the AI agent&apos;s decision to rupees in the seller&apos;s bank, with every check along the way.</span>
          </li>
        )}
        <li>
          <a href="/agent">See what the AI agent paid for</a>
          <span>The task it was given, what it decided, and what each call cost.</span>
        </li>
        <li>
          <a href="/how">How it works</a>
          <span>The flow in six steps, and which parts are real and which are simulated.</span>
        </li>
      </ul>

      <ul className="figures" aria-label="Totals so far">
        <li><b>{totals.calls}</b><span>paid API calls</span></li>
        <li><b>{amt(totals.volume)}</b><span>USDC paid by buyers</span></li>
        <li><b>{totals.agentCalls}</b><span>of them paid by the AI agent</span></li>
        <li><b>{totals.payouts}</b><span>payouts to sellers</span></li>
      </ul>

      <figure className="map">
        <RouteMap sellers={sellers} calls={totals.calls} volume={totals.volume} />
        <RouteList sellers={sellers} />
        <figcaption className="small">
          Each coloured line is one seller&apos;s payout route. Click a seller to see its latest payout.
        </figcaption>
      </figure>

      <h2>Sellers</h2>
      <p className="sub">What each seller sells, how much they earned, and how they get paid. The payout route is decided by the seller&apos;s country, not chosen freely.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Seller</th><th>How they get paid</th><th className="num">Calls</th><th className="num">Earned (USDC)</th>
              <th className="num">Paid out (USDC)</th><th>Latest payout</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => {
              const r = route(s.method, s.currency);
              const lp = s.lastPayout;
              return (
                <tr key={s.id}>
                  <td>
                    <b className="name">{s.name.replace(" (sample)", "")}</b>
                    <span className="line2">{COUNTRY[s.country] ?? s.country}{s.service ? `. Sells ${s.service.title.replace(/ \(.*\)$/, "")}, ${s.service.price} a call` : ""}</span>
                  </td>
                  <td>
                    <span className={`route r-${r.key}`}>{r.label}</span>
                    <span className="line2">{s.reasons[0]}.</span>
                  </td>
                  <td className="num">{s.calls}</td>
                  <td className="num">{amt(s.earned)}</td>
                  <td className="num">{amt(s.paidOut)}</td>
                  <td>
                    {lp ? (
                      <>
                        <a href={`/payouts/${lp.id}`}>
                          {lp.status === "failed" ? "Failed" : lp.currency === "USDC" ? `${amt(s.paidOut)} USDC` : fiat(lp.currency, lp.amount)}
                        </a>
                        <span className="line2">{lp.status === "failed" ? "Money returned to balance" : lp.document ? docTitle(lp.document) : statusLabel(lp.status)}</span>
                      </>
                    ) : (
                      <span className="small">Not paid out yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small fees">
        The platform has earned {amt(totals.platformFees)} USDC in fees so far, and Circle has charged {amt(totals.gatewayFees)} USDC
        to withdraw the payouts. With test amounts this small, Circle&apos;s fee is larger than ours. That&apos;s why a real
        seller would only be paid out once their balance passes a minimum.
      </p>

      <h2>Latest paid calls</h2>
      <p className="sub">Every call is paid before the API answers. Circle groups the payments and settles them on-chain a few minutes later.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>When (IST)</th><th>Paid by</th><th>API call</th><th>Seller</th><th className="num">USDC</th><th>Status</th></tr>
          </thead>
          <tbody>
            {recent.map((c) => (
              <tr key={c.id}>
                <td className="nowrap">{when(c.recorded_at)}</td>
                <td>{c.payerLabel ?? <code>{short(c.payer)}</code>}</td>
                <td><code>{callPath(c.resource)}</code></td>
                <td>{c.seller.replace(" (sample)", "")}</td>
                <td className="num">{amt(c.amount, 3)}</td>
                <td><span className={`status ${c.status}`}>{statusLabel(c.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
