-- Separate provider ledger: Tribute amounts are cents/kopecks, never Stars.
-- Snapshots preserve grants and prices when the product mapping changes.
CREATE TABLE IF NOT EXISTS tribute_purchases (
  purchase_id INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL,
  tribute_product_id INTEGER NOT NULL,
  telegram_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'successful', 'refunded')),
  granted_games INTEGER NOT NULL DEFAULT 0,
  granted_ai_reviews INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tribute_purchases_user
  ON tribute_purchases(telegram_id, created_at DESC);
