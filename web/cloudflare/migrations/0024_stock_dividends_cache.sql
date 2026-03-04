-- Dividend / corporate-action cache for Massive API data
CREATE TABLE IF NOT EXISTS stock_dividends (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  ticker             TEXT NOT NULL,
  ex_dividend_date   TEXT,
  pay_date           TEXT,
  declaration_date   TEXT,
  cash_amount        REAL,
  frequency          TEXT,
  dividend_type      TEXT,
  source             TEXT NOT NULL,
  fetched_at         TEXT NOT NULL,
  dedupe_key         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_div_dedupe  ON stock_dividends(user_id, dedupe_key);
CREATE INDEX  IF NOT EXISTS idx_stock_div_ticker ON stock_dividends(user_id, ticker, ex_dividend_date DESC);
