-- 0012_add_subscription_expired_notified.sql
--
-- §26 ТЗ требует событие subscription_expired — но, в отличие от всех
-- остальных 17 событий в списке, это НЕ действие пользователя (клик,
-- запрос, платёж), а пассивный переход состояния во времени (period_end
-- прошёл). Ничто не "вызывает" этот момент — нет ни вебхука от Telegram на
-- истечение, ни явного запроса пользователя. Единственный способ поймать
-- переход без отдельного Cron Trigger (излишняя инфраструктура ради одного
-- события) — лениво проверять при каждом обращении к балансу пользователя
-- (payments/repository.ts:trackSubscriptionExpiryIfNeeded, дергается из
-- GET /api/v1/entitlements) и залогировать РОВНО ОДИН раз.
--
-- expired_notified_at — флаг "уже залогировали" НЕПОСРЕДСТВЕННО в строке
-- подписки: UPDATE ... SET expired_notified_at = ? WHERE ... AND
-- expired_notified_at IS NULL атомарно защищает от повторного логирования
-- при гонке (два параллельных запроса одновременно видят NULL — выигрывает
-- только один UPDATE, только он логирует).

ALTER TABLE subscriptions ADD COLUMN expired_notified_at INTEGER;
