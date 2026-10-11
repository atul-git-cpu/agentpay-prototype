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
| Ledger + statements | **Real** (Phase 3) | Double-entry ledger in Postgres (Neon) |
| GSTIN lookup | Mock data, real checksum | Format and check-digit validation are real |
| India payout (USD→INR, e-FIRA, purpose code, T+2) | **Mock** (Phase 4) | Stands in for a licensed partner such as Xflow |
| Local rail / SWIFT payouts | **Mock** (Phase 4) | Realistic delays, fees and failures |
| KYB / sanctions screening | **Mock** (Phase 5) | Same interface a real vendor would use |

## Build phases

1. **Payment rail** — paywalled seller API, buyer pays per call, reconciliation ✅
2. **AI agent** — model decides which calls to make and pays within a budget ✅
3. **Ledger** — Postgres ledger, per-seller balances, fiat-denominated statements ✅
4. **Jurisdiction engine + payouts** — USDC / India partner / local rail / SWIFT routing ← *you are here*
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

---

## Phase 2: the AI agent

An AI agent gets a business task ("verify these vendors' GSTINs"), decides which calls are
worth paying for, and pays per call from a **Circle developer-controlled wallet**. The
wallet's key never leaves Circle: each payment is signed through Circle's `signTypedData` API.

Guardrails are enforced in code, not left to the model:
- hard spend budget (`AGENT_BUDGET_USDC`) and call cap (`AGENT_MAX_CALLS`)
- never pays twice for the same input (cached)

### 1. Add your keys to `.env`
Open `.env` in the Codespace editor and fill in:
```
CIRCLE_API_KEY=<your testnet key from console.circle.com>
LLM_API_KEY=<your Gemini key from aistudio.google.com>
```
Never commit `.env` or paste keys into chat.

### 2. Create the agent's Circle wallet (one-time)
```bash
npm run circle:setup
```
Registers an Entity Secret, creates a wallet set and an EOA wallet on Arc Testnet, and saves
the IDs to `.env`. **Download `data/circle-recovery-file.dat`** (right-click → Download) and keep it safe.

### 3. Fund the agent
```bash
npm run agent:fund
```
Deposits `AGENT_FUND_USDC` (default 0.5) from the Phase 1 buyer wallet into Gateway,
owned by the agent's address (`depositFor`). The agent needs no gas: it only signs.

### 4. Run the agent (seller must be running in another terminal)
```bash
npm run agent
# or your own task:
npm run agent -- "Check whether 27AAPFU0939F1ZV is a valid GSTIN"
```
You'll see its reasoning, each tool call, and each Circle-signed payment.
Then `npm run reconcile` shows the agent's payments settling like any other.

### Switching the model
The agent talks to any OpenAI-compatible chat API with tool calling. To use Groq instead of Gemini:
```
LLM_BASE_URL=https://api.groq.com/openai/v1/
LLM_MODEL=openai/gpt-oss-120b
LLM_API_KEY=<groq key>
```
If Gemini returns "model not found", set `LLM_MODEL` to a model id your key can use (listed in AI Studio).

---

## Phase 3: the ledger

Payments move from a text log into a **double-entry ledger in Postgres (Neon)**. Each seller
has three balances, matching how Circle actually settles:

| Balance | Meaning |
|---|---|
| **pending** | Buyer has paid; Circle hasn't settled the batch yet (`received` / `batched`) |
| **available** | Circle settled it (`confirmed` / `completed`); ready to pay out |
| **in flight** | Payout started; the partner's fiat leg isn't done yet (Phase 4) |
| **paid out** | Received by the seller, net of fees (Phase 4) |

Every event posts balanced entries, every posting is idempotent (re-running reconciliation
can't double-count), statuses never move backwards, and `npm run ledger` checks that all
entries sum to zero.

### 1. Add the database URL
In `.env`: `DATABASE_URL=<your Neon connection string, starting with postgresql://>`

### 2. Create the tables and register the seller
```bash
npm run db:migrate
```
Registers the Phase 1 seller as an **Indian** seller paid in **INR** via the licensed-partner
route, with RBI purpose code **P0807** (information/data services — confirm with the AD bank).

### 3. Import earlier payments and reconcile
```bash
npm run db:import    # the 11 payments from Phases 1-2 (idempotent)
npm run reconcile    # pulls status from Circle; settled payments move pending -> available
npm run ledger       # balances per seller + integrity check
```
**Restart the seller** (`Ctrl+C`, `npm run seller`) so new payments go straight into the ledger.

### 4. Generate a usage statement
```bash
npm run statement
npm run statement -- --seller 1 --from 2026-10-01 --to 2026-10-31
```
A fiat-denominated statement (USD + indicative INR, by buyer and by day, with the purpose code),
saved to `data/statements/`. This is what the INR payout in Phase 4 is matched against.

---

## Phase 4: jurisdiction engine + payouts

The marketplace grows to **four sellers in four jurisdictions**, and each is paid out the way
its country allows:

| Seller (sample) | Country | Prefers | Engine's route | On-chain leg (real) | Fiat leg (mock) |
|---|---|---|---|---|---|
| Hyderabad GST Data Services | IN | fiat | **India partner** (mandatory: stablecoins are VDAs) | USDC → partner treasury | INR, e-FIRA, purpose code P0807, T+2 |
| Austin TaxRate Labs | US | USDC | **USDC direct** | USDC → seller's wallet | — |
| Lisboa VAT Check Lda | PT | fiat | **Local rail: SEPA Instant** | USDC → SEPA partner treasury | EUR, ~1 minute |
| Nairobi KRA PIN Data Ltd | KE | fiat | **SWIFT fallback** (no rules / rail configured) | USDC → SWIFT partner treasury | USD MT103, T+2 |

Rules, in order: restricted + licensed partner → partner; permitted + prefers USDC → USDC;
local rail exists → local rail; otherwise SWIFT. Unknown countries never get stablecoin payouts.
See `src/payouts/jurisdiction.ts` (a simplified reading of each regime — not legal advice).

**Every payout moves real testnet USDC**: a Circle Gateway withdrawal on Arc, from the seller's
Gateway balance to either the seller's own wallet or the partner's treasury address. Only what
happens after the partner receives it (FX, bank credit, documents) is mocked.

Fees per payout: platform fee (USDC 0.1%, India partner 1%, local rail 0.5%, SWIFT 0.8%) plus a
**0.004 USDC reserve for Gateway's withdrawal fee** (about $0.0035 on Arc). That's why payouts are
batched behind a threshold — with real volumes the threshold should be ≥ $0.35 so the network fee
stays under 1%. The demo uses 0.005 so a few cents of traffic can pay out.

Ledger events: `initiated` (available → in flight), then `paid` (in flight → paid out + platform
fees + Gateway fees) or `failed` (back to available). The Kenya seller's bank details are
deliberately wrong, so its first payout **fails at partner pre-validation, before any money moves**.

### 1. Set up the sellers (one-time)
```bash
git pull && npm install
npm run db:migrate       # adds the payouts table
npm run sellers:setup    # wallets for US/EU/KE sellers + partner treasuries, registers all 4, gas top-ups
```
Then **restart the marketplace** (`Ctrl+C`, `npm run seller`) — it now lists four paid services.

### 2. Generate traffic and settle it
```bash
npm run buy:all          # ~16 paid calls across the US, EU and Kenya sellers
# wait ~1 minute for Gateway to batch-settle
npm run reconcile        # pending -> available
```

### 3. Pay out
```bash
npm run payouts -- --dry-run          # see routes, fees and amounts first
npm run payouts                       # real Gateway withdrawals
npm run payouts:advance -- --fast-forward   # complete the fiat legs now (skip T+2 in a demo)
npm run ledger -- --docs              # balances, payouts and documents (e-FIRA, MT103, ...)
```
Expected: US **paid** in USDC; India and EU **processing** then paid; Kenya **failed**. Fix it:
```bash
npm run sellers:fix-bank && npm run payouts && npm run payouts:advance -- --fast-forward
```

## Scripts

| Command | What it does |
|---|---|
| `npm run wallet:new` | Creates testnet buyer and seller wallets in `.env` |
| `npm run deposit` | Deposits `DEPOSIT_USDC` (default 1) into Gateway |
| `npm run seller` | Starts the paid GSTIN API on port 3000 |
| `npm run buy` | Buyer pays per call, capped at `MAX_SPEND_USDC` |
| `npm run reconcile` | Matches recorded payments to Gateway transfers |
| `npm run balance` | Shows wallet and Gateway balances |
| `npm run circle:setup` | Phase 2: entity secret + Circle wallet for the agent |
| `npm run agent:fund` | Phase 2: fund the agent's Gateway balance |
| `npm run agent` | Phase 2: run the AI agent |
| `npm run db:migrate` | Phase 3: create ledger tables, register the seller |
| `npm run db:import` | Phase 3: import payments from the Phase 1-2 log |
| `npm run ledger` | Seller balances, payouts, fees + integrity check (`-- --docs`) |
| `npm run statement` | Phase 3: fiat-denominated usage statement |
| `npm run sellers:setup` | Phase 4: US/EU/KE sellers, partner treasuries, gas top-ups |
| `npm run buy:all` | Phase 4: paid calls across the marketplace |
| `npm run payouts` | Phase 4: route + pay out settled balances (`-- --dry-run` to preview) |
| `npm run payouts:advance` | Phase 4: complete due fiat legs (`-- --fast-forward` for demos) |
| `npm run sellers:fix-bank` | Phase 4: correct the Kenya seller's bank details |
| `npm run typecheck` | TypeScript check |

## Troubleshooting

- **`Missing BUYER_PRIVATE_KEY`** — run `npm run wallet:new`.
- **Deposit says wallet has 0 USDC** — the faucet hasn't arrived yet; wait a minute.
- **Gateway balance still 0 after deposit** — indexing lag; wait ~30s, then `npm run balance`.
- **`fetch failed` on paid calls** — the seller can't reach `gateway-api-testnet.circle.com`; check your network.

## Security

- `.env` holds private keys and is git-ignored. Never commit it or paste keys into chat.
- These wallets are for testnet only. Never send real funds to them.
