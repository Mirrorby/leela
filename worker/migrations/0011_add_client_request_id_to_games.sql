-- 0011_add_client_request_id_to_games.sql
--
-- Найденный баг (батч 2, при проектировании списания баланса за партию):
-- POST /api/v1/games никогда не принимал идемпотентность-ключ от клиента —
-- ровно тот класс проблемы, что уже чинили для бросков кубика
-- (clientEventId, см. worker/src/game/gameEngine.ts:findRollByClientEventId).
-- Раньше это было "просто" двойное создание партии при ретрае — неприятно,
-- но бесплатно. Теперь, когда создание партии СПИСЫВАЕТ баланс
-- (payments/repository.ts:chargeForGame), тот же ретрай без идемпотентности
-- списывал бы партию из баланса дважды за один реальный запуск.
--
-- client_request_id — тот же принцип, что telegram_payment_charge_id у
-- transactions (0008_create_transactions.sql): UNIQUE-индекс, повторный
-- INSERT с уже виденным (telegram_id, client_request_id) — ошибка на
-- уровне БД; в реальности до неё не доходит (обработчик сначала делает
-- SELECT по этой паре и возвращает существующую партию, не создавая
-- новую), индекс — подстраховка на случай гонки/бага в этой проверке, а
-- не основной механизм.
--
-- Уникальность именно (telegram_id, client_request_id), а не глобально по
-- client_request_id — id генерируется на клиенте (см. useGameSession.ts
-- этот же паттерн для бросков), коллизия между РАЗНЫМИ пользователями
-- физически возможна только как совпадение UUID (пренебрежимо), но
-- не хотим завязываться на глобальную уникальность там, где она не нужна
-- по смыслу.
--
-- NULL допустим (старые партии, созданные до этой миграции, и партии от ещё
-- не обновившегося клиента — см. index.ts:handleCreateGame, id
-- генерируется на сервере, если клиент его не прислал) — частичный индекс
-- по тому же принципу, что и у transactions.

ALTER TABLE games ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_client_request_id
  ON games(telegram_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
