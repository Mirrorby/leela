import type { Product, ProductId } from '../types/payments';

/**
 * Единственный источник правды по ценам и начислениям — тот же принцип, что
 * у classic-v1.json для правил игры (см. game/rulesetLoader.ts): фронт
 * получает каталог через GET /api/v1/products, а не хардкодит цены у себя,
 * иначе рано или поздно цена на экране разъедется с ценой, которую реально
 * спишет сервер.
 *
 * §28 ТЗ по монетизации: смена тарифа здесь НЕ должна задевать уже
 * выданные пользователям доступы — worker/migrations/0008_create_transactions.sql
 * хранит СНИМОК stars_amount/granted_* на момент конкретной покупки, а не
 * ссылку на текущий каталог, так что правка цифр ниже безопасна для
 * прошлых транзакций.
 */

/** §2 ТЗ: "каждый новый пользователь получает 2 бесплатные партии". */
export const FREE_GAMES_DEFAULT = 2;
/** §2 ТЗ / §8: "freeAiReviews = 1" для нового пользователя. */
export const FREE_AI_REVIEWS_DEFAULT = 1;

/**
 * Telegram Bot API (createInvoiceLink, параметр subscription_period)
 * принимает СТРОГО 2592000 секунд — не "любое количество дней", а именно
 * эту константу (проверено по официальной документации Bot API при
 * проектировании). §3.3 ТЗ ("30 дней") этому значению соответствует.
 */
export const SUBSCRIPTION_PERIOD_SECONDS = 2592000;

export const PRODUCTS: Record<ProductId, Product> = {
  game_1: {
    id: 'game_1',
    title: '1 партия',
    stars: 79,
    grant: { games: 1, aiReviews: 0, subscriptionDays: 0 },
    isSubscription: false,
  },
  game_5: {
    id: 'game_5',
    title: '5 партий',
    stars: 299,
    grant: { games: 5, aiReviews: 0, subscriptionDays: 0 },
    isSubscription: false,
  },
  subscription_unlimited: {
    id: 'subscription_unlimited',
    title: 'Безлимит на 30 дней',
    stars: 399,
    grant: { games: 0, aiReviews: 0, subscriptionDays: 30 },
    isSubscription: true,
  },
  ai_review_1: {
    id: 'ai_review_1',
    title: 'ИИ-разбор партии',
    stars: 99,
    grant: { games: 0, aiReviews: 1, subscriptionDays: 0 },
    isSubscription: false,
  },
  game_ai_combo: {
    id: 'game_ai_combo',
    title: 'Партия + ИИ-разбор',
    stars: 149,
    grant: { games: 1, aiReviews: 1, subscriptionDays: 0 },
    isSubscription: false,
  },
};

export function getProduct(id: string): Product | null {
  return Object.prototype.hasOwnProperty.call(PRODUCTS, id) ? PRODUCTS[id as ProductId] : null;
}

export function listProducts(): Product[] {
  return Object.values(PRODUCTS);
}
