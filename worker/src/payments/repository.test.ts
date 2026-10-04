import { describe, it, expect, afterEach } from 'vitest';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import {
  getOrCreateUserBalance,
  getLatestSubscription,
  getEntitlements,
  trackSubscriptionExpiryIfNeeded,
} from './repository';
import { listAnalyticsEvents } from '../analytics/repository';
import { FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT } from './catalog';

const databases: ReturnType<typeof createSqliteD1>[] = [];
function createTestD1(): D1Database { const database = createSqliteD1(); databases.push(database); return database.db; }
afterEach(() => { databases.splice(0).forEach(({ sqlite }) => sqlite.close()); });

describe('getOrCreateUserBalance', () => {
  it('первый вызов для нового telegram_id создаёт строку с дефолтами из §2 ТЗ', async () => {
    const db = createTestD1();
    const row = await getOrCreateUserBalance(db, 'user-1');
    expect(row.telegram_id).toBe('user-1');
    expect(row.free_games_remaining).toBe(FREE_GAMES_DEFAULT);
    expect(row.free_ai_reviews_remaining).toBe(FREE_AI_REVIEWS_DEFAULT);
    expect(row.paid_games).toBe(0);
    expect(row.paid_ai_reviews).toBe(0);
  });

  it('повторный вызов для того же пользователя НЕ сбрасывает уже изменённый баланс (ON CONFLICT DO NOTHING, не UPDATE)', async () => {
    const db = createTestD1();
    await getOrCreateUserBalance(db, 'user-1');
    // Эмулируем "потратил бесплатную партию" прямой правкой строки — в
    // батче 1 функции списания ещё нет, это только проверка, что
    // getOrCreateUserBalance сам по себе не является скрытым источником
    // сброса баланса при каждом обращении (что было бы критичным багом:
    // например, GET /entitlements вызывается на каждое открытие "Мои
    // партии" и не должен возвращать бесплатные партии просто от чтения).
    await db.prepare('UPDATE user_balances SET free_games_remaining = ? WHERE telegram_id = ?').bind(0, 'user-1').run();

    const second = await getOrCreateUserBalance(db, 'user-1');
    expect(second.free_games_remaining).toBe(0);
  });

  it('разные telegram_id получают независимые строки', async () => {
    const db = createTestD1();
    await getOrCreateUserBalance(db, 'user-1');
    const other = await getOrCreateUserBalance(db, 'user-2');
    expect(other.free_games_remaining).toBe(FREE_GAMES_DEFAULT);
  });
});

describe('getLatestSubscription', () => {
  it('null, если подписки не было никогда', async () => {
    const db = createTestD1();
    expect(await getLatestSubscription(db, 'user-1')).toBeNull();
  });

  it('возвращает строку с максимальным period_end среди нескольких (защитное чтение, §20 ТЗ)', async () => {
    const db = createTestD1();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-old', 'user-1', 1000, 1, 100, 100)
      .run();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-new', 'user-1', 5000, 1, 200, 200)
      .run();

    const latest = await getLatestSubscription(db, 'user-1');
    expect(latest?.id).toBe('sub-new');
    expect(latest?.period_end).toBe(5000);
  });

  it('истёкшая подписка тоже возвращается (решение "активна ли" — не задача этого запроса)', async () => {
    const db = createTestD1();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-expired', 'user-1', 1, 1, 100, 100)
      .run();

    const latest = await getLatestSubscription(db, 'user-1');
    expect(latest?.id).toBe('sub-expired');
  });
});

describe('getEntitlements', () => {
  it('для нового пользователя — дефолты и отсутствие подписки', async () => {
    const db = createTestD1();
    const entitlements = await getEntitlements(db, 'user-1');
    expect(entitlements.freeGamesRemaining).toBe(FREE_GAMES_DEFAULT);
    expect(entitlements.freeAiReviewsRemaining).toBe(FREE_AI_REVIEWS_DEFAULT);
    expect(entitlements.subscription).toBeNull();
    expect(entitlements.canStartGame).toBe(true);
    expect(entitlements.canStartAiReview).toBe(true);
  });

  it('повторный вызов возвращает тот же результат (идемпотентное чтение)', async () => {
    const db = createTestD1();
    const first = await getEntitlements(db, 'user-1');
    const second = await getEntitlements(db, 'user-1');
    expect(second).toEqual(first);
  });
});


describe('trackSubscriptionExpiryIfNeeded (батч 5, §26 — subscription_expired)', () => {
  it('нет подписки вообще — ничего не логирует', async () => {
    const db = createTestD1();
    await trackSubscriptionExpiryIfNeeded(db, 'user-1');
    expect(await listAnalyticsEvents(db, 'user-1')).toHaveLength(0);
  });

  it('активная подписка (period_end в будущем) — не логирует', async () => {
    const db = createTestD1();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', 'user-1', Date.now() + 100000, 1, Date.now(), Date.now())
      .run();
    await trackSubscriptionExpiryIfNeeded(db, 'user-1');
    expect(await listAnalyticsEvents(db, 'user-1')).toHaveLength(0);
  });

  it('истёкшая подписка — логирует subscription_expired один раз', async () => {
    const db = createTestD1();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', 'user-1', Date.now() - 1000, 1, Date.now(), Date.now())
      .run();
    await trackSubscriptionExpiryIfNeeded(db, 'user-1');
    const events = await listAnalyticsEvents(db, 'user-1');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('subscription_expired');
  });

  it('повторный вызов для уже залогированной истёкшей подписки — не логирует снова', async () => {
    const db = createTestD1();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', 'user-1', Date.now() - 1000, 1, Date.now(), Date.now())
      .run();
    await trackSubscriptionExpiryIfNeeded(db, 'user-1');
    await trackSubscriptionExpiryIfNeeded(db, 'user-1');
    await trackSubscriptionExpiryIfNeeded(db, 'user-1');
    expect(await listAnalyticsEvents(db, 'user-1')).toHaveLength(1);
  });

  it('не влияет на сам расчёт entitlements — истёкшая подписка и так корректно неактивна независимо от флага', async () => {
    const db = createTestD1();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', 'user-1', Date.now() - 1000, 1, Date.now(), Date.now())
      .run();
    const before = await getEntitlements(db, 'user-1');
    await trackSubscriptionExpiryIfNeeded(db, 'user-1');
    const after = await getEntitlements(db, 'user-1');
    expect(before.subscription?.active).toBe(false);
    expect(after).toEqual(before);
  });
});
