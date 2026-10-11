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

-- ---- Phase 4: payouts ----
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS payout_preference TEXT NOT NULL DEFAULT 'fiat';
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS bank_details JSONB;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS payout_reason TEXT;      -- why the engine chose the route

-- One row per payout. Ledger events:
--   initiated : -gross seller:<id>:available      +gross seller:<id>:payout_in_flight
--   paid      : -gross seller:<id>:payout_in_flight +net seller:<id>:paid_out
--               +platform_fee platform:fees        +network_fee network:gateway_fees
--   failed    : -gross seller:<id>:payout_in_flight +gross seller:<id>:available
CREATE TABLE IF NOT EXISTS payouts (
  id                  SERIAL PRIMARY KEY,
  seller_id           INT NOT NULL REFERENCES sellers(id),
  method              TEXT NOT NULL CHECK (method IN ('usdc', 'india_partner', 'local_rail', 'swift')),
  gross_atomic        NUMERIC(38,0) NOT NULL CHECK (gross_atomic > 0),
  platform_fee_atomic NUMERIC(38,0) NOT NULL,
  network_fee_atomic  NUMERIC(38,0) NOT NULL,
  net_atomic          NUMERIC(38,0) NOT NULL,
  payout_currency     TEXT NOT NULL,
  fx_rate             NUMERIC(20,8),
  payout_amount       NUMERIC(24,6),
  onchain_recipient   TEXT,
  onchain_tx          TEXT,
  partner             TEXT,
  partner_ref         TEXT,
  status              TEXT NOT NULL CHECK (status IN ('initiated', 'processing', 'paid', 'failed')),
  failure_reason      TEXT,
  document            JSONB,
  expected_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payouts_seller_idx ON payouts (seller_id, created_at);
