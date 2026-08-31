// Типы монетизации. См. ТЗ "leela_payments_spec.md" (план обсуждён в чате,
// файл — финальный источник продуктовых правил, конфликты с более ранними
// решениями в чате разрешаются в пользу файла).

export type ProductId = 'game_1' | 'game_5' | 'subscription_unlimited' | 'ai_review_1' | 'game_ai_combo';

export interface ProductGrant {
  games: number;
  aiReviews: number;
  /** Только для subscription_unlimited — описательное поле; реальный период
   * подписки в Telegram Bot API задаётся отдельной константой
   * SUBSCRIPTION_PERIOD_SECONDS (payments/catalog.ts), т.к. API принимает
   * там СТРОГО количество секунд, а не "количество дней". */
  subscriptionDays: number;
}

export interface Product {
  id: ProductId;
  title: string;
  stars: number;
  grant: ProductGrant;
  isSubscription: boolean;
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
