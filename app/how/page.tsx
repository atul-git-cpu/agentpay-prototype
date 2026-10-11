import { REPO } from "../_lib/format";

export const metadata = { title: "How it works | AgentPay" };

const STEPS = [
  ["A buyer or AI agent calls a paid API", "The API replies with its price. The caller signs a USDC payment and asks again, and Circle confirms the payment before the API answers. There's no blockchain fee per call, so a call can cost $0.002."],
  ["Circle settles the payments", "Circle groups many small payments together and settles them on its Arc test network every few minutes. We match every call to Circle's record of it."],
  ["Our ledger keeps each seller's balance", "Each call is first counted as pending, then as available once Circle settles it. The books are double-entry, so they always balance."],
  ["The seller's country decides how they're paid", "India doesn't let exporters receive stablecoins, so Indian sellers are paid in rupees through a licensed partner, with an e-FIRA. A US seller who wants USDC gets USDC. Others get a local bank transfer (SEPA, ACH) or SWIFT."],
  ["Checks run before any money moves", "We verify the seller's business and screen every wallet that paid them against sanctions lists. A bad bank account is caught by the partner before anything is sent."],
  ["The payout goes out", "USDC leaves Circle on the blockchain, either to the seller's wallet or to the payout partner. The partner pays the seller's bank and sends back a document (e-FIRA, SEPA confirmation or MT103), which we attach to the payout."],
] as const;

const PARTS = [
  ["Paying per call in USDC", true, "Circle Gateway Nanopayments on Arc testnet"],
  ["Deposits, balances and settlement", true, "Circle's Gateway contract and API"],
  ["The AI agent and its wallet", true, "Google Gemini, with a wallet managed by Circle"],
  ["Ledger, statements and payout records", true, "Postgres database"],
  ["USDC sent in each payout", true, "Withdrawal from Circle Gateway on Arc testnet"],
  ["Rupee payout with e-FIRA (India)", false, "Stands in for a licensed partner such as Xflow"],
  ["SEPA, ACH and SWIFT bank transfers", false, "Realistic timings, fees and one failure case"],
  ["Business verification and sanctions screening", false, "Built so a real provider can plug in"],
  ["The sellers' API answers", false, "GSTIN check digits and VAT and KRA PIN formats are really checked"],
] as const;

const TERMS = [
  ["USDC", "A digital dollar issued by Circle. 1 USDC is worth 1 US dollar."],
  ["Circle Gateway", "Circle's service that lets someone hold one USDC balance and make many tiny payments without a blockchain fee each time."],
  ["Arc", "Circle's blockchain. This prototype uses its test network, so no real money is involved."],
  ["Payout partner", "A licensed company that receives USDC and pays the seller in their own currency, through their bank."],
  ["e-FIRA", "The certificate an Indian bank issues when foreign money arrives. Exporters need it to show the earnings came from abroad."],
  ["Purpose code", "The code the Reserve Bank of India uses to record why money came in. P0807 covers information and data services."],
  ["SEPA, ACH, SWIFT", "Bank transfer systems: SEPA in Europe, ACH in the US, and SWIFT for international transfers everywhere else."],
] as const;

export default function How() {
  return (
    <>
      <h1>How it works</h1>
      <p className="lede">
        AI agents are starting to buy data one API call at a time. A card can&apos;t charge $0.002, but a stablecoin can. The
        catch is that many sellers, starting with those in India, can&apos;t legally receive their export earnings in
        stablecoins. So we use USDC where it works best, for paying per call, and pay each seller the way their country allows.
      </p>
      <ol className="chain" style={{ ["--c" as string]: "var(--r-trunk)" }}>
        {STEPS.map(([title, body]) => (
          <li key={title}><h3>{title}</h3><p className="body" style={{ margin: 0, maxWidth: "68ch" }}>{body}</p></li>
        ))}
      </ol>

      <h2>What&apos;s real and what&apos;s simulated</h2>
      <p className="sub">Everything runs on test networks, so no real money is involved anywhere.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Part</th><th>Real or simulated</th><th>How</th></tr></thead>
          <tbody>
            {PARTS.map(([part, real, how]) => (
              <tr key={part}><td>{part}</td><td><span className={`status ${real ? "paid" : "processing"}`}>{real ? "Real" : "Simulated"}</span></td><td>{how}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Terms used on this site</h2>
      <dl className="kv terms">
        {TERMS.map(([term, meaning]) => (
          <div key={term} style={{ display: "contents" }}><dt>{term}</dt><dd>{meaning}</dd></div>
        ))}
      </dl>

      <p className="note">
        The country rules here are a simplified reading of each regime for a prototype. They aren&apos;t legal advice, and
        the purpose code should be confirmed with the bank.
      </p>
      <p>The code and setup steps are on <a href={REPO}>GitHub</a>.</p>
    </>
  );
}
