import type { Product, ProductId } from '../types/payments';

export const FREE_GAMES_DEFAULT = 1;
export const FREE_AI_REVIEWS_DEFAULT = 1;

// Prices and checkout links come exclusively from the Tribute mapping.
export const PRODUCTS: Record<ProductId, Product> = {
  game_1: { id: 'game_1', title: '1 партия', grant: { games: 1, aiReviews: 0, subscriptionDays: 0 }, isSubscription: false },
  game_5: { id: 'game_5', title: '5 партий', grant: { games: 5, aiReviews: 0, subscriptionDays: 0 }, isSubscription: false },
  ai_review_1: { id: 'ai_review_1', title: 'Полный ИИ-разбор партии', grant: { games: 0, aiReviews: 1, subscriptionDays: 0 }, isSubscription: false },
  game_ai_combo: { id: 'game_ai_combo', title: 'Партия + полный ИИ-разбор', grant: { games: 1, aiReviews: 1, subscriptionDays: 0 }, isSubscription: false },
};

export function getProduct(id: string): Product | null {
  return Object.prototype.hasOwnProperty.call(PRODUCTS, id) ? PRODUCTS[id as ProductId] : null;
}

export function listProducts(): Product[] { return Object.values(PRODUCTS); }
