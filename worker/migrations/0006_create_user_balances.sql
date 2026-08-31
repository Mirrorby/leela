-- 0006_create_user_balances.sql
--
-- Начало реализации монетизации (см. ТЗ "leela_payments_spec.md", §2, §9).
-- Баланс партий/ИИ-разборов пользователя — бесплатные и купленные считаются
-- РАЗДЕЛЬНО (§9): нельзя схлопнуть в одно число "сколько партий доступно",
-- иначе, например, нельзя было бы корректно показать "Осталась 1 бесплатная
-- партия" отдельно от купленных (§24), и §12 ("вернуть 1 ИИ-разбор на баланс
-- при технической ошибке") требует знать, откуда именно списали — free или
-- paid, — чтобы вернуть туда же (см. ai_reviews.charged_from,
-- 0009_create_ai_reviews.sql).
--
-- Строка создаётся лениво при первом обращении к сущности пользователя
-- (payments/repository.ts:getOrCreateUserBalance) — отдельного эндпоинта
-- "регистрации" нет, DEFAULT 0 здесь используется только как fallback на
-- случай прямой вставки в обход приложения: реальный первый INSERT всегда
-- явно передаёт стартовые значения из payments/catalog.ts
-- (FREE_GAMES_DEFAULT/FREE_AI_REVIEWS_DEFAULT), а не полагается на эти
-- DEFAULT 0 в схеме.
--
-- version — тот же паттерн optimistic concurrency, что у games.version
-- (0004_add_version_column.sql): списание баланса — это read-modify-write
-- (прочитать остаток, решить откуда списывать по приоритету §3.3/§9,
-- записать назад), и без версии два одновременных "Начать партию" могли бы
-- списать бесплатную партию дважды, потеряв одно из двух списаний.

CREATE TABLE IF NOT EXISTS user_balances (
  telegram_id TEXT PRIMARY KEY,
  free_games_remaining INTEGER NOT NULL DEFAULT 0,
  free_ai_reviews_remaining INTEGER NOT NULL DEFAULT 0,
  paid_games INTEGER NOT NULL DEFAULT 0,
  paid_ai_reviews INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
