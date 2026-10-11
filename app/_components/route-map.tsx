import type { SellerView } from "../_lib/data";
import { amt, fiat, route, COUNTRY, docTitle } from "../_lib/format";

const COLOR: Record<string, string> = {
  inr: "var(--r-inr)", usdc: "var(--r-usdc)", sepa: "var(--r-sepa)", ach: "var(--r-ach)", swift: "var(--r-swift)",
};

export const shortDoc = (d: string) =>
  docTitle(d).replace("SEPA Instant transfer", "SEPA transfer").replace("SWIFT transfer (MT103)", "MT103")
    .replace("USDC payout receipt", "on-chain receipt");

/**
 * The money's route: buyers and the AI agent pay per call into Circle Gateway on Arc,
 * then each seller's balance leaves on its own line — drawn in the route's colour.
 */
/** Narrow screens: the same routes as a stacked list (the map's text would be too small to read). */
export function RouteList({ sellers }: { sellers: SellerView[] }) {
  return (
    <ul className="lanes">
      {sellers.map((s) => {
        const r = route(s.method, s.currency);
        const lp = s.lastPayout;
        return (
          <li key={s.id} className={`r-${r.key}${lp?.status === "failed" ? " failed" : ""}`}>
            <a href={lp ? `/payouts/${lp.id}` : "/payouts"}><b>{s.name.replace(" (sample)", "")}</b></a>, {COUNTRY[s.country] ?? s.country}
            <span>
              {r.label}.{" "}
              {lp && lp.status !== "failed"
                ? lp.currency === "USDC" ? `${amt(s.paidOut)} USDC paid out.` : `${fiat(lp.currency, lp.amount)} paid out${lp.document ? `, ${shortDoc(lp.document)}` : ""}.`
                : lp?.status === "failed" ? `Last payout failed: ${lp.failure}` : `${amt(s.available)} USDC waiting.`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function RouteMap({ sellers, calls, volume }: { sellers: SellerView[]; calls: number; volume: string }) {
  const W = 1000;
  const laneGap = 92;
  const top = 64;
  const H = top + Math.max(sellers.length - 1, 0) * laneGap + 70;
  const midY = top + ((sellers.length - 1) * laneGap) / 2;
  const srcX = 40, gwX = 330, splitX = 420, endX = 560;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="map-title map-desc">
      <title id="map-title">How payments flow from buyers to sellers</title>
      <desc id="map-desc">
        {`${calls} paid calls totalling ${volume} USDC went through Circle Gateway, then out to ${sellers.length} sellers by their own route.`}
      </desc>

      {/* Trunk: buyers -> Circle Gateway */}
      <line x1={srcX} y1={midY} x2={splitX} y2={midY} stroke="var(--r-trunk)" strokeWidth="8" strokeLinecap="round" />
      <line className="flow" x1={srcX + 10} y1={midY} x2={gwX - 10} y2={midY} stroke="#fff" strokeWidth="3" strokeLinecap="round" />

      {/* Branches: one line per seller */}
      {sellers.map((s, i) => {
        const y = top + i * laneGap;
        const r = route(s.method, s.currency);
        const c = COLOR[r.key];
        const failed = s.lastPayout?.status === "failed";
        const path = `M ${splitX} ${midY} C ${splitX + 70} ${midY}, ${endX - 90} ${y}, ${endX} ${y} L ${W - 30} ${y}`;
        const payout = s.lastPayout;
        const out =
          payout && payout.status !== "failed"
            ? payout.currency === "USDC"
              ? `${amt(s.paidOut)} USDC to their wallet`
              : `${fiat(payout.currency, payout.amount)} paid out${payout.document ? `, ${shortDoc(payout.document)}` : ""}`
            : failed
              ? "Last payout failed, money returned"
              : `${amt(s.available)} USDC waiting for payout`;
        return (
          <g key={s.id}>
            <path d={path} fill="none" stroke={c} strokeWidth="8" strokeLinecap="round" strokeDasharray={failed ? "14 10" : undefined} />
            <circle cx={W - 30} cy={y} r="9" fill="#fff" stroke={c} strokeWidth="5" />
            <a href={payout ? `/payouts/${payout.id}` : "/payouts"}>
              <text x={endX + 8} y={y - 16} className="lane-label">
                {s.name.replace(" (sample)", "")}, {COUNTRY[s.country] ?? s.country}
              </text>
            </a>
            <text x={endX + 8} y={y + 26} className="lane-sub">
              {r.short}: {out}
            </text>
          </g>
        );
      })}

      {/* Nodes */}
      <circle cx={srcX} cy={midY} r="12" fill="#fff" stroke="var(--r-trunk)" strokeWidth="5" />
      <text x={srcX - 12} y={midY - 26} className="node-label">Buyers and AI agents</text>
      <text x={srcX - 12} y={midY + 36} className="node-sub">{calls} calls, {amt(volume)} USDC</text>
      <rect x={gwX - 16} y={midY - 16} width="32" height="32" rx="6" fill="#fff" stroke="var(--r-trunk)" strokeWidth="5" />
      <text x={gwX - 40} y={midY - 30} className="node-label">Circle Gateway</text>
      <text x={gwX - 40} y={midY + 40} className="node-sub">settles on Arc</text>
    </svg>
  );
}
