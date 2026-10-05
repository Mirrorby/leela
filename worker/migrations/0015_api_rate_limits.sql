CREATE TABLE IF NOT EXISTS api_rate_limits (
  telegram_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  requests INTEGER NOT NULL,
  PRIMARY KEY (telegram_id, bucket)
);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expiry ON api_rate_limits(window_start);
