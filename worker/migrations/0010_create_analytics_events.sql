-- 0010_create_analytics_events.sql
--
-- Плоский лог событий монетизационной воронки (ТЗ §26) — paywall_opened,
-- payment_success и т.п. Осознанно БЕЗ строгой схемы под каждое поле:
-- payload — произвольный JSON (например, product_id для событий покупки,
-- §26: "для событий покупки сохранять тип продукта") — набор событий и их
-- полей будет расти, отдельная колонка на каждый вариант поля быстро стала
-- бы нечитаемой чередой ALTER TABLE.

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_telegram ON analytics_events(telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON analytics_events(event, created_at DESC);
