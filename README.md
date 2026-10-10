# AgentPay prototype

**Per-call API payments for AI agents, with seller payouts that follow each seller's jurisdiction.**

Any buyer or AI agent pays per API call in USDC (Circle Gateway Nanopayments, x402).
Every call is metered and reconciled into a seller ledger. Each seller is then paid
out in the form their country allows: USDC where permitted, INR with an e-FIRA via a
licensed partner for India, a local rail, or SWIFT as the fallback.

> Testnet only. No real money moves. Wallets created by this repo hold testnet USDC.

## What's real and what's mocked

| Layer | Status | How |
|---|---|---|
| Per-call USDC payments (x402) | **Real** | Circle Gateway Nanopayments on Arc Testnet (`@circle-fin/x402-batching`) |
| Buyer deposit + balances | **Real** | Gateway Wallet contract + Gateway testnet API |
| Settlement + reconciliation by nonce | **Real** | Settle hooks + `searchTransfers` |
| USDC payout to permitted sellers | **Real** (Phase 4) | Gateway withdrawal |
| AI agent that decides and pays | **Real** (Phase 2) | Free model API (Gemini; Groq backup) via one adapter |
| Agent wallet | **Real** (Phase 2) | Circle developer-controlled wallet |
| Ledger + statements | **Real** (Phase 3) | Postgres (Neon) |
| GSTIN lookup | Mock data, real checksum | Format and check-digit validation are real |
| India payout (USD→INR, e-FIRA, purpose code, T+2) | **Mock** (Phase 4) | Stands in for a licensed partner such as Xflow |
| Local rail / SWIFT payouts | **Mock** (Phase 4) | Realistic delays, fees and failures |
| KYB / sanctions screening | **Mock** (Phase 5) | Same interface a real vendor would use |

## Build phases

1. **Payment rail** — paywalled seller API, buyer pays per call, reconciliation ← *you are here*
2. **AI agent** — model decides which calls to make and pays within a budget
3. **Ledger** — Postgres ledger, per-seller balances, fiat-denominated statements
4. **Jurisdiction engine + payouts** — USDC / India partner / local rail / SWIFT routing
5. **Compliance trail** — agent → payment → call → seller → invoice → settlement → bank
6. **Dashboard + public link** — Next.js UI on Vercel

---

## Phase 1: run it in GitHub Codespaces

### 1. Open a Codespace
On this repo's GitHub page: **Code → Codespaces → Create codespace on main**.
It installs Node 22 and the dependencies automatically.

### 2. Create two test wallets
```bash
npm run wallet:new
```
This writes a buyer and a seller wallet to `.env` (git-ignored) and prints their addresses.

### 3. Fund the buyer
Open **https://faucet.circle.com**, choose **Arc Testnet** and **USDC**, and paste the
**buyer** address. On Arc, USDC also pays gas, so this is the only funding needed.

### 4. Move USDC into Gateway (one-time, on-chain)
```bash
npm run deposit
```
After this, every API call is paid with an off-chain signature — no gas per call.

### 5. Start the seller API (terminal 1)
```bash
npm run seller
```

### 6. Pay per call (terminal 2 — click **+** in the terminal panel)
```bash
npm run buy
```
Expected output, roughly:
```
Seller says: GSTIN validation (India) at $0.002 per call
#1 36ABCPK1234F1Z6  paid 0.002 USDC  ->  VALID — Telangana, Individual / Proprietor
...
7 paid calls, 0.014 USDC spent.
```
Terminal 1 logs each settlement, and `data/settlements.jsonl` records it by nonce.

### 7. Reconcile and check balances
```bash
npm run reconcile   # matches each payment's nonce to Circle's transfer record
npm run balance     # buyer and seller balances
```
Settlement is batched, so statuses move `received → batched → confirmed → completed`
over time. Run `reconcile` again after a few minutes to see them progress.

## Scripts

| Command | What it does |
|---|---|
| `npm run wallet:new` | Creates testnet buyer and seller wallets in `.env` |
| `npm run deposit` | Deposits `DEPOSIT_USDC` (default 1) into Gateway |
| `npm run seller` | Starts the paid GSTIN API on port 3000 |
| `npm run buy` | Buyer pays per call, capped at `MAX_SPEND_USDC` |
| `npm run reconcile` | Matches recorded payments to Gateway transfers |
| `npm run balance` | Shows wallet and Gateway balances |
| `npm run typecheck` | TypeScript check |

## Troubleshooting

- **`Missing BUYER_PRIVATE_KEY`** — run `npm run wallet:new`.
- **Deposit says wallet has 0 USDC** — the faucet hasn't arrived yet; wait a minute.
- **Gateway balance still 0 after deposit** — indexing lag; wait ~30s, then `npm run balance`.
- **`fetch failed` on paid calls** — the seller can't reach `gateway-api-testnet.circle.com`; check your network.

## Security

- `.env` holds private keys and is git-ignored. Never commit it or paste keys into chat.
- These wallets are for testnet only. Never send real funds to them.
