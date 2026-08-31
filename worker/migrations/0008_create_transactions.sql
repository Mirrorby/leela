-- 0008_create_transactions.sql
--
-- Полная история платежей (ТЗ §15, §16). Статусы — created/pending/successful/
-- failed/refunded (§16); начисление доступа (payments/repository.ts,
-- добавляется в батче 3) происходит ТОЛЬКО для successful.
--
-- Идемпотентность (§14) — тот же приём, что clientEventId у бросков кубика
-- (см. worker/src/game/gameEngine.ts:findRollByClientEventId): Telegram
-- может повторно доставить successful_payment (сетевой ретрай на его
-- стороне), UNIQUE на telegram_payment_charge_id гарантирует, что повторная
-- доставка не начислит доступ дважды — INSERT просто не пройдёт (см.
-- обработчик вебхука, батч 3), а не "начислили, потом заметили дубль и
-- откатили".
--
-- telegram_payment_charge_id NULL до момента реальной оплаты (сразу после
-- создания invoice знаем только свой сгенерированный payload, а не
-- charge_id Telegram) — UNIQUE-индекс сделан частичным (WHERE ... IS NOT
-- NULL), чтобы явно не участвовать в уникальности, пока платёж не завершён.
--
-- granted_* — СНИМОК того, что реально начислено этой конкретной покупкой
-- (не пересчитывается из текущего каталога — см. payments/catalog.ts и §28
-- ТЗ: смена тарифа не должна задевать уже выданные доступы).

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  stars_amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  telegram_payment_charge_id TEXT,
  is_subscription_renewal INTEGER NOT NULL DEFAULT 0,
  granted_games INTEGER NOT NULL DEFAULT 0,
  granted_ai_reviews INTEGER NOT NULL DEFAULT 0,
  granted_subscription_days INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_charge_id
  ON transactions(telegram_payment_charge_id)
  WHERE telegram_payment_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_telegram ON transactions(telegram_id, status, created_at DESC);
