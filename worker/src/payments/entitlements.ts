import type { Entitlements } from '../types/payments';

interface BalanceLike {
  free_games_remaining: number;
  free_ai_reviews_remaining: number;
  paid_games: number;
  paid_ai_reviews: number;
}

interface SubscriptionLike {
  period_end: number;
  auto_renew: number;
}

/**
 * Чистая функция (без обращений к D1) — даёт полностью детерминированный,
 * легко тестируемый расчёт, независимый от того, как строки лежат в базе.
 * `now` передаётся аргументом, а не берётся из Date.now() внутри — иначе
 * тесты на "подписка истекла ровно сейчас" зависели бы от момента запуска.
 *
 * Здесь только "можно ли начать" (§9 ТЗ) — САМ выбор, откуда списывать
 * (подписка → бесплатное → купленное, §3.3), и атомарное списание —
 * задача payments/repository.ts (батч 2), не этой функции.
 */
export function computeEntitlements(balance: BalanceLike, subscription: SubscriptionLike | null, now: number): Entitlements {
  const subscriptionActive = subscription != null && subscription.period_end > now;

  return {
    freeGamesRemaining: balance.free_games_remaining,
    paidGames: balance.paid_games,
    freeAiReviewsRemaining: balance.free_ai_reviews_remaining,
    paidAiReviews: balance.paid_ai_reviews,
    subscription: subscription
      ? {
          active: subscriptionActive,
          autoRenew: subscription.auto_renew === 1,
          periodEnd: subscription.period_end,
        }
      : null,
    canStartGame: subscriptionActive || balance.free_games_remaining > 0 || balance.paid_games > 0,
    // ИИ-разбор в подписку не входит (§3.3 ТЗ: "ИИ-разборы в стоимость
    // данной подписки не входят") — намеренно НЕ учитываем subscriptionActive
    // здесь, только free/paid счётчики разборов.
    canStartAiReview: balance.free_ai_reviews_remaining > 0 || balance.paid_ai_reviews > 0,
  };
}
