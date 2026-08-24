-- 0001_init.sql
--
-- Базовая миграция. Таблица games уже существует в продовой базе "leela" —
-- она была создана вручную через SQL-консоль Cloudflare (до того, как
-- появились миграции wrangler). Этот файл — не "создание с нуля", а точный
-- снимок существующей структуры (сверено через PRAGMA table_info(games)),
-- чтобы у схемы наконец появилась версия в репозитории.
--
-- CREATE TABLE IF NOT EXISTS — намеренно: применение этой миграции к уже
-- существующей продовой базе не должно упасть и не должно ничего менять.
-- Для новой (например, тестовой) базы она создаст таблицу с нуля.
--
-- Примечание: id объявлен как "TEXT PRIMARY KEY" без NOT NULL — это
-- сознательно повторяет реальное поведение (PRAGMA показал notnull=0 при
-- pk=1). Для НЕ-INTEGER PRIMARY KEY в SQLite/D1 это ожидаемо: PRIMARY KEY
-- сам по себе не подразумевает NOT NULL (известная особенность SQLite).

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  status TEXT NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  dice_mode TEXT NOT NULL,
  current_cell INTEGER,
  is_born INTEGER NOT NULL DEFAULT 0,
  rolls_json TEXT NOT NULL DEFAULT '[]',
  turns_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
