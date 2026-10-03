import { describe, it, expect } from 'vitest';
import { PRODUCTS, getProduct, listProducts, FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT } from './catalog';

describe('payments catalog', () => {
  it('содержит ровно 4 продуктов из ТЗ (§13)', () => {
    expect(Object.keys(PRODUCTS).sort()).toEqual(['ai_review_1', 'game_1', 'game_5', 'game_ai_combo'].sort());
    expect(listProducts()).toHaveLength(4);
  });


  it('начисления (grant) соответствуют продукту', () => {
    expect(PRODUCTS.game_1.grant).toEqual({ games: 1, aiReviews: 0, subscriptionDays: 0 });
    expect(PRODUCTS.game_5.grant).toEqual({ games: 5, aiReviews: 0, subscriptionDays: 0 });
    expect(PRODUCTS.ai_review_1.grant).toEqual({ games: 0, aiReviews: 1, subscriptionDays: 0 });
    expect(PRODUCTS.game_ai_combo.grant).toEqual({ games: 1, aiReviews: 1, subscriptionDays: 0 });
  });

  it('не продаёт подписку и не публикует цены Stars', () => {
    expect(getProduct('subscription_unlimited')).toBeNull();
    expect(listProducts().every((p) => !p.isSubscription && !('stars' in p))).toBe(true);
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
