import type { LegacyProductId } from '../types/payments';
import type { TransactionRow } from '../payments/repository';

// Historical Stars snapshots used only to test settlement of old payments.
const LEGACY_PRODUCTS = {
  game_1: { stars: 79, grant: { games: 1, aiReviews: 0, subscriptionDays: 0 } },
  game_5: { stars: 299, grant: { games: 5, aiReviews: 0, subscriptionDays: 0 } },
  ai_review_1: { stars: 99, grant: { games: 0, aiReviews: 1, subscriptionDays: 0 } },
  game_ai_combo: { stars: 149, grant: { games: 1, aiReviews: 1, subscriptionDays: 0 } },
  subscription_unlimited: { stars: 399, grant: { games: 0, aiReviews: 0, subscriptionDays: 30 } },
};

export async function createPendingTransaction(
  db: D1Database,
  telegramId: string,
  productId: LegacyProductId
): Promise<TransactionRow> {
  const product = LEGACY_PRODUCTS[productId];
  if (!product) {
    throw new Error(`unknown productId: ${productId}`);
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO transactions (
        id, telegram_id, product_id, stars_amount, status, telegram_payment_charge_id,
        is_subscription_renewal, granted_games, granted_ai_reviews, granted_subscription_days,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'created', NULL, 0, ?, ?, ?, ?, ?)`
    )
    .bind(id, telegramId, productId, product.stars, product.grant.games, product.grant.aiReviews, product.grant.subscriptionDays, now, now)
    .run();

  return {
    id,
    telegram_id: telegramId,
    product_id: productId,
    stars_amount: product.stars,
    status: 'created',
    telegram_payment_charge_id: null,
    is_subscription_renewal: 0,
    granted_games: product.grant.games,
    granted_ai_reviews: product.grant.aiReviews,
    granted_subscription_days: product.grant.subscriptionDays,
    created_at: now,
    updated_at: now,
  };
}

