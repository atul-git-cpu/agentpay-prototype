import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./_components/nav";
import { REPO } from "./_lib/format";

export const metadata: Metadata = {
  title: "AgentPay — per-call payments, paid out by jurisdiction",
  description:
    "Prototype on Circle's testnet: AI agents pay per API call in USDC; each seller is paid out the way their country allows — INR via a licensed partner in India, USDC, SEPA or SWIFT elsewhere.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>
        <header className="top">
          <div className="wrap">
            <a className="brand" href="/">AgentPay<small>Circle testnet prototype</small></a>
            <Nav />
          </div>
        </header>
        <main>
          <div className="wrap">{children}</div>
        </main>
        <footer>
          <div className="wrap">
            <span>Testnet only — no real money moves. On-chain legs are real on Arc Testnet; bank legs, KYB and screening are mocks.</span>
            <a href={REPO}>Source on GitHub</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
