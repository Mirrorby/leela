import { describe, it, expect } from 'vitest';
import { createFakeD1 } from '../testUtils/fakeD1';
import { getOrCreateUserBalance, getLatestSubscription, getEntitlements } from './repository';
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
