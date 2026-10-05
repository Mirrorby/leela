-- Receipts prevent creation retries from restoring deleted content.
CREATE TABLE IF NOT EXISTS game_deletions (
  game_id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  client_request_id TEXT,
  deleted_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_deletions_request
  ON game_deletions(telegram_id, client_request_id);
