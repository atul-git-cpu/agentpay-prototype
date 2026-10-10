-- AgentPay ledger schema (Postgres). Safe to re-run.
-- Amounts are USDC atomic units (6 decimals): 0.002 USDC = 2000.

CREATE TABLE IF NOT EXISTS sellers (
  id                      SERIAL PRIMARY KEY,
  name                    TEXT NOT NULL,
  wallet_address          TEXT NOT NULL UNIQUE,           -- lowercase 0x address
  country                 TEXT NOT NULL,                  -- ISO 3166-1 alpha-2, e.g. IN, US, DE
  payout_method           TEXT NOT NULL
                          CHECK (payout_method IN ('usdc', 'india_partner', 'local_rail', 'swift')),
  payout_currency         TEXT NOT NULL,                  -- USDC, INR, EUR, ...
  payout_threshold_atomic NUMERIC(38,0) NOT NULL DEFAULT 0,
  purpose_code            TEXT,                           -- RBI purpose code for India sellers
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per per-call payment, keyed by the EIP-3009 nonce (unique per payment).
CREATE TABLE IF NOT EXISTS payments (
  id                  SERIAL PRIMARY KEY,
  nonce               TEXT NOT NULL UNIQUE,
  seller_id           INT NOT NULL REFERENCES sellers(id),
  payer               TEXT NOT NULL,                      -- lowercase 0x address
  amount_atomic       NUMERIC(38,0) NOT NULL CHECK (amount_atomic > 0),
  network             TEXT NOT NULL,
  resource            TEXT,
  gateway_transfer_id TEXT,
  status              TEXT NOT NULL
                      CHECK (status IN ('received', 'batched', 'confirmed', 'completed', 'failed')),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_seller_idx ON payments (seller_id, recorded_at);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);

-- Double-entry ledger: every event posts legs that sum to zero.
-- Accounts:  seller:<id>:pending | seller:<id>:available | seller:<id>:paid_out
--            clearing:gateway_in_transit
CREATE TABLE IF NOT EXISTS ledger_entries (
  id            SERIAL PRIMARY KEY,
  event_id      TEXT NOT NULL,                            -- e.g. payment:12:settled
  account       TEXT NOT NULL,
  amount_atomic NUMERIC(38,0) NOT NULL,                   -- signed
  payment_id    INT REFERENCES payments(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, account)                              -- makes every posting idempotent
);
CREATE INDEX IF NOT EXISTS ledger_account_idx ON ledger_entries (account);
