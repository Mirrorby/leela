import { describe, it, expect } from 'vitest';
import { createFakeD1 } from '../testUtils/fakeD1';
import {
  getOrCreateUserBalance,
  getLatestSubscription,
  getEntitlements,
  chargeForAiReview,
  refundAiReviewCharge,
  trackSubscriptionExpiryIfNeeded,
  InsufficientBalanceError,
} from './repository';
import { listAnalyticsEvents } from '../analytics/repository';
import { FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT } from './catalog';

describe('getOrCreateUserBalance', () => {
  it('первый вызов для нового telegram_id создаёт строку с дефолтами из §2 ТЗ', async () => {
    const db = createFakeD1();
    const row = await getOrCreateUserBalance(db, 'user-1');
    expect(row.telegram_id).toBe('user-1');
    expect(row.free_games_remaining).toBe(FREE_GAMES_DEFAULT);
    expect(row.free_ai_reviews_remaining).toBe(FREE_AI_REVIEWS_DEFAULT);
    expect(row.paid_games).toBe(0);
    expect(row.paid_ai_reviews).toBe(0);
  });

  it('повторный вызов для того же пользователя НЕ сбрасывает уже изменённый баланс (ON CONFLICT DO NOTHING, не UPDATE)', async () => {
    const db = createFakeD1();
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
    const db = createFakeD1();
    await getOrCreateUserBalance(db, 'user-1');
    const other = await getOrCreateUserBalance(db, 'user-2');
    expect(other.free_games_remaining).toBe(FREE_GAMES_DEFAULT);
  });
});

describe('getLatestSubscription', () => {
  it('null, если подписки не было никогда', async () => {
    const db = createFakeD1();
    expect(await getLatestSubscription(db, 'user-1')).toBeNull();
  });

  it('возвращает строку с максимальным period_end среди нескольких (защитное чтение, §20 ТЗ)', async () => {
    const db = createFakeD1();
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
    const db = createFakeD1();
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
    const db = createFakeD1();
    const entitlements = await getEntitlements(db, 'user-1');
    expect(entitlements.freeGamesRemaining).toBe(FREE_GAMES_DEFAULT);
    expect(entitlements.freeAiReviewsRemaining).toBe(FREE_AI_REVIEWS_DEFAULT);
    expect(entitlements.subscription).toBeNull();
    expect(entitlements.canStartGame).toBe(true);
    expect(entitlements.canStartAiReview).toBe(true);
  });

  it('повторный вызов возвращает тот же результат (идемпотентное чтение)', async () => {
    const db = createFakeD1();
    const first = await getEntitlements(db, 'user-1');
    const second = await getEntitlements(db, 'user-1');
    expect(second).toEqual(first);
  });
});

describe('chargeForAiReview / refundAiReviewCharge (батч 4)', () => {
  it('первое списание берётся из бесплатного разбора', async () => {
    const db = createFakeD1();
    await getOrCreateUserBalance(db, 'user-1'); // free_ai_reviews_remaining = 1
    const result = await chargeForAiReview(db, 'user-1');
    expect(result.source).toBe('free');
    const balance = await getOrCreateUserBalance(db, 'user-1');
    expect(balance.free_ai_reviews_remaining).toBe(0);
  });

  it('после исчерпания бесплатного — списывается платный', async () => {
    const db = createFakeD1();
    await getOrCreateUserBalance(db, 'user-1');
    await chargeForAiReview(db, 'user-1'); // тратим бесплатный
    await db.prepare('UPDATE user_balances SET paid_ai_reviews = ? WHERE telegram_id = ?').bind(3, 'user-1').run();

    const result = await chargeForAiReview(db, 'user-1');
    expect(result.source).toBe('paid');
    const balance = await getOrCreateUserBalance(db, 'user-1');
    expect(balance.paid_ai_reviews).toBe(2);
  });

  it('нет ни бесплатных, ни платных разборов — InsufficientBalanceError', async () => {
    const db = createFakeD1();
    await getOrCreateUserBalance(db, 'user-1');
    await chargeForAiReview(db, 'user-1'); // тратим единственный бесплатный
    await expect(chargeForAiReview(db, 'user-1')).rejects.toThrow(InsufficientBalanceError);
  });

  it('§3.3 ТЗ: активная подписка НЕ покрывает ИИ-разборы — списание всё равно идёт с баланса разборов', async () => {
    const db = createFakeD1();
    await getOrCreateUserBalance(db, 'user-1');
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', 'user-1', Date.now() + 100000, 1, Date.now(), Date.now())
      .run();
    const result = await chargeForAiReview(db, 'user-1');
    expect(result.source).toBe('free'); // не 'subscription' — такого варианта не существует для разборов
  });

  it('refundAiReviewCharge("free") возвращает именно бесплатный счётчик', async () => {
    const db = createFakeD1();
    await getOrCreateUserBalance(db, 'user-1');
    await chargeForAiReview(db, 'user-1');
    expect((await getOrCreateUserBalance(db, 'user-1')).free_ai_reviews_remaining).toBe(0);

    await refundAiReviewCharge(db, 'user-1', 'free');
    expect((await getOrCreateUserBalance(db, 'user-1')).free_ai_reviews_remaining).toBe(1);
  });

  it('refundAiReviewCharge("paid") возвращает именно платный счётчик, не трогая бесплатный', async () => {
    const db = createFakeD1();
    await getOrCreateUserBalance(db, 'user-1');
    await refundAiReviewCharge(db, 'user-1', 'paid');
    const balance = await getOrCreateUserBalance(db, 'user-1');
    expect(balance.paid_ai_reviews).toBe(1);
    expect(balance.free_ai_reviews_remaining).toBe(FREE_AI_REVIEWS_DEFAULT); // не тронут
  });
});

describe('trackSubscriptionExpiryIfNeeded (батч 5, §26 — subscription_expired)', () => {
  it('нет подписки вообще — ничего не логирует', async () => {
    const db = createFakeD1();
    await trackSubscriptionExpiryIfNeeded(db, 'user-1');
    expect(await listAnalyticsEvents(db, 'user-1')).toHaveLength(0);
  });

  it('активная подписка (period_end в будущем) — не логирует', async () => {
    const db = createFakeD1();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', 'user-1', Date.now() + 100000, 1, Date.now(), Date.now())
      .run();
    await trackSubscriptionExpiryIfNeeded(db, 'user-1');
    expect(await listAnalyticsEvents(db, 'user-1')).toHaveLength(0);
  });

  it('истёкшая подписка — логирует subscription_expired один раз', async () => {
    const db = createFakeD1();
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
    const db = createFakeD1();
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
    const db = createFakeD1();
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
