import { describe, it, expect } from 'vitest';
import { PRODUCTS, getProduct, listProducts, FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT, SUBSCRIPTION_PERIOD_SECONDS } from './catalog';

describe('payments catalog', () => {
  it('содержит ровно 5 продуктов из ТЗ (§13)', () => {
    expect(Object.keys(PRODUCTS).sort()).toEqual(['ai_review_1', 'game_1', 'game_5', 'game_ai_combo', 'subscription_unlimited'].sort());
    expect(listProducts()).toHaveLength(5);
  });

  it('цены совпадают с таблицей тарифов из ТЗ', () => {
    expect(PRODUCTS.game_1.stars).toBe(79);
    expect(PRODUCTS.game_5.stars).toBe(299);
    expect(PRODUCTS.subscription_unlimited.stars).toBe(399);
    expect(PRODUCTS.ai_review_1.stars).toBe(99);
    expect(PRODUCTS.game_ai_combo.stars).toBe(149);
  });

  it('начисления (grant) соответствуют продукту', () => {
    expect(PRODUCTS.game_1.grant).toEqual({ games: 1, aiReviews: 0, subscriptionDays: 0 });
    expect(PRODUCTS.game_5.grant).toEqual({ games: 5, aiReviews: 0, subscriptionDays: 0 });
    expect(PRODUCTS.ai_review_1.grant).toEqual({ games: 0, aiReviews: 1, subscriptionDays: 0 });
    expect(PRODUCTS.game_ai_combo.grant).toEqual({ games: 1, aiReviews: 1, subscriptionDays: 0 });
    expect(PRODUCTS.subscription_unlimited.grant).toEqual({ games: 0, aiReviews: 0, subscriptionDays: 30 });
  });

  it('только subscription_unlimited помечен как подписка', () => {
    for (const product of listProducts()) {
      expect(product.isSubscription).toBe(product.id === 'subscription_unlimited');
    }
  });

  it('SUBSCRIPTION_PERIOD_SECONDS — ровно 30 дней в секундах (жёсткое требование Telegram Bot API)', () => {
    expect(SUBSCRIPTION_PERIOD_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it('getProduct находит по id и не путает с прототипными свойствами Object', () => {
    expect(getProduct('game_1')?.title).toBe('1 партия');
    expect(getProduct('toString')).toBeNull();
    expect(getProduct('constructor')).toBeNull();
    expect(getProduct('no-such-product')).toBeNull();
  });

  it('дефолты нового пользователя соответствуют §2 ТЗ', () => {
    expect(FREE_GAMES_DEFAULT).toBe(2);
    expect(FREE_AI_REVIEWS_DEFAULT).toBe(1);
  });
});
