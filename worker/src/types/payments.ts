// Типы монетизации. См. ТЗ "leela_payments_spec.md" (план обсуждён в чате,
// файл — финальный источник продуктовых правил, конфликты с более ранними
// решениями в чате разрешаются в пользу файла).

export type ProductId = 'game_1' | 'game_5' | 'ai_review_1' | 'game_ai_combo';

export type LegacyProductId = ProductId | 'subscription_unlimited';

export interface ProductGrant {
  games: number;
  aiReviews: number;
  /** Historical grant field; new products do not include subscriptions. */
  subscriptionDays: number;
}

export interface Product {
  id: ProductId;
  title: string;
  grant: ProductGrant;
  isSubscription: boolean;
  /** Public checkout details; amount is in minor currency units. */
  tribute?: { url: string; amount: number; currency: string };
}

export interface SubscriptionEntitlement {
  active: boolean;
  autoRenew: boolean;
  /** Unix ms — конец оплаченного периода, как прислал Telegram. */
  periodEnd: number;
}

export interface Entitlements {
  freeGamesRemaining: number;
  paidGames: number;
  freeAiReviewsRemaining: number;
  paidAiReviews: number;
  subscription: SubscriptionEntitlement | null;
  canStartGame: boolean;
  canStartAiReview: boolean;
}
