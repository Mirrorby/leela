CREATE TABLE IF NOT EXISTS payment_event_outbox (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_event_outbox_created ON payment_event_outbox(created_at, id);

CREATE TABLE IF NOT EXISTS legacy_star_refunds (
  charge_id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  invoice_payload TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_legacy_star_refunds_status ON legacy_star_refunds(status, created_at);
