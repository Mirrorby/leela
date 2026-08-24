-- 0003_add_request_column.sql
--
-- GameState.request (см. src/types/game.ts) — текст запроса/намерения
-- игрока для партии — не имеет колонки в текущей таблице games (сверено
-- через PRAGMA table_info в 7.3: там его нет). Без этой колонки Worker не
-- сможет сохранить и вернуть это поле. Обнаружено при реализации слоя
-- персистентности (worker/src/games/repository.ts) в этапе 7.4.
--
-- DEFAULT '' — на случай будущих строк, вставленных в обход приложения;
-- в норме API всегда передаёт реальное значение при создании партии.

ALTER TABLE games ADD COLUMN request TEXT NOT NULL DEFAULT '';
