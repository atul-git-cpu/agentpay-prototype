import { REPO } from "../_lib/format";

export const metadata = { title: "How it works — AgentPay" };

const STEPS = [
  ["A buyer or AI agent calls a paid API", "The API answers 402 Payment Required with a price. The caller signs a USDC authorisation (x402) and retries; Circle Gateway verifies it and the API responds. No gas, no on-chain transaction per call."],
  ["Circle batches and settles", "Gateway nets thousands of tiny payments into periodic on-chain settlements on Arc. Reconciliation matches every call to Circle's transfer record by its payment nonce."],
  ["The ledger tracks each seller's money", "A double-entry ledger in Postgres moves each call from pending to available once Circle confirms it. Every posting is idempotent and the books always sum to zero."],
  ["The jurisdiction engine picks a route", "India restricts stablecoins as export proceeds, so Indian sellers are paid in rupees through a licensed partner with an e-FIRA and purpose code. US sellers who want USDC get USDC. Others get a local rail (SEPA, ACH) or SWIFT."],
  ["Compliance runs before money moves", "Seller KYB and sanctions screening of every paying wallet run before each payout. A hit holds the payout; a bad bank account fails at the partner before anything moves on-chain."],
  ["The payout leaves Circle Gateway", "A Gateway withdrawal sends USDC on Arc to the seller's wallet or the partner's treasury. The partner converts and pays the bank leg, and its document (e-FIRA, SEPA, MT103) is attached to the payout's trail."],
] as const;

const REAL = [
  ["Per-call USDC payments (x402)", "Real", "Circle Gateway Nanopayments, Arc Testnet"],
  ["Buyer deposits, balances, settlement status", "Real", "Gateway Wallet contract and Gateway API"],
  ["AI agent and its wallet", "Real", "Gemini (free API) with a Circle developer-controlled wallet"],
  ["Ledger, statements, compliance trail", "Real", "Postgres (Neon)"],
  ["USDC leg of every payout", "Real", "Gateway withdrawal on Arc Testnet"],
  ["India partner: FX, INR credit, e-FIRA", "Mock", "Stands in for a licensed cross-border partner such as Xflow"],
  ["SEPA, ACH, SWIFT bank legs", "Mock", "Realistic timing, fees and a failure case"],
  ["KYB and sanctions screening", "Mock", "Same interface a real vendor would plug into"],
  ["The sellers' API data", "Mock", "GSTIN check digits and VAT / KRA formats are validated for real"],
] as const;

export default function How() {
  return (
    <>
      <h1>How it works</h1>
      <p className="lede">
        AI agents are starting to buy data and tools one call at a time. Cards can&apos;t charge $0.002, and stablecoins solve
        that — but many sellers, India&apos;s first among them, can&apos;t legally receive export earnings in stablecoins. This
        prototype keeps the stablecoin where it works (the per-call payment) and pays each seller out the way their country allows.
      </p>
      <ol className="chain" style={{ ["--c" as string]: "var(--r-trunk)" }}>
        {STEPS.map(([title, body]) => (
          <li key={title}><h3>{title}</h3><p className="body" style={{ margin: 0, maxWidth: "68ch" }}>{body}</p></li>
        ))}
      </ol>

      <h2>What&apos;s real and what&apos;s mocked</h2>
      <p className="sub">Everything runs on testnets. Nothing here moves real money.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Part</th><th>Status</th><th>How</th></tr></thead>
          <tbody>
            {REAL.map(([part, status, how]) => (
              <tr key={part}><td>{part}</td><td><span className={`status ${status === "Real" ? "paid" : "processing"}`}>{status}</span></td><td>{how}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        The jurisdiction rules are a simplified reading of each country&apos;s regime for a prototype, not legal advice. The RBI
        purpose code (P0807) should be confirmed with the AD bank.
      </p>
      <p>Code, setup steps and the full build log are on <a href={REPO}>GitHub</a>.</p>
    </>
  );
}
