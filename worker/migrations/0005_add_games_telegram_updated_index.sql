-- 0005_add_games_telegram_updated_index.sql
--
-- listGamesByUser (worker/src/games/repository.ts) фильтрует по telegram_id
-- и сортирует по (updated_at DESC, id DESC) для keyset-пагинации — без
-- индекса под этот порядок SQLite/D1 обязан на каждый вызов делать полный
-- скан таблицы games (по ВСЕМ пользователям) с последующей сортировкой в
-- памяти. Индекс покрывает WHERE и ORDER BY одним проходом, стоимость
-- запроса перестаёт расти с общим числом партий в базе.
--
-- Сырой SQL для ручной вставки через Cloudflare Dashboard → D1 → Console
-- (wrangler CLI недоступен в среде разработки):

CREATE INDEX IF NOT EXISTS idx_games_telegram_updated
  ON games (telegram_id, updated_at DESC, id DESC);
