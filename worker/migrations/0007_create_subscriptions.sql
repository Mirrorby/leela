-- 0007_create_subscriptions.sql
--
-- Безлимитная подписка (ТЗ §3.3, §17, §18, §20). Намеренно НЕТ отдельной
-- колонки status ('active'/'cancelled'/'expired') — это была бы вторая
-- копия одного и того же факта, которую пришлось бы синхронизировать со
-- временем вручную и которая рано или поздно разъедется с ним (типичный
-- источник багов). Вместо этого храним только:
--   period_end  — единственный источник правды по времени, ПРИСЫЛАЕТСЯ
--                 самим Telegram в каждом successful_payment
--                 (SuccessfulPayment.subscription_expiration_date) — не
--                 считаем "+30 дней" сами, доверяем авторитетному значению;
--   auto_renew  — включено ли автопродление (выключается апдейтом
--                 BotSubscriptionUpdated от Telegram, не из нашего UI —
--                 пользователь отменяет подписку в самом Telegram).
-- "Активна ли подписка" — ВСЕГДА производное: period_end > now (см.
-- payments/entitlements.ts:computeEntitlements), вычисляется на чтении, а
-- не хранится.
--
-- Продление (is_recurring=true в successful_payment, добавляется в батче 3)
-- — UPDATE этой же строки (новый period_end), НЕ новая строка и НЕ
-- начисление партий (§18: "Пользователь не должен получать отдельные
-- партии" при продлении).
--
-- Один telegram_id технически МОЖЕТ иметь несколько строк (защита от
-- параллельной покупки второй подписки — задача уровня приложения при
-- создании invoice, §20, а не ограничение схемы) — getLatestSubscription
-- читает защитно, беря строку с максимальным period_end.

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  period_end INTEGER NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_telegram ON subscriptions(telegram_id, period_end DESC);
