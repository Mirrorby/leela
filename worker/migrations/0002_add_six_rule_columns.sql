-- 0002_add_six_rule_columns.sql
--
-- gameEngine.processRoll() требует consecutiveSixes и positionBeforeSixSeries
-- как часть GameState (см. src/types/game.ts) — без них правило "ровно 3
-- шестёрки подряд + не-шестёрка = откат, а 4-я шестёрка подряд отменяет
-- откат насовсем" невозможно надёжно восстановить из rolls_json/turns_json
-- между запросами к Worker'у (см. памятку по проекту). Этих колонок нет в
-- таблице, снятой в 0001_init.sql — добавляем здесь отдельной миграцией.
--
-- DEFAULT 0 для обеих колонок: consecutive_sixes=0 — нейтральное "серии
-- сейчас нет"; position_before_six_series=0 совпадает со startingArea в
-- classic-v1.json (нейтрально для партий, где поле ещё не использовалось).

ALTER TABLE games ADD COLUMN consecutive_sixes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN position_before_six_series INTEGER NOT NULL DEFAULT 0;
