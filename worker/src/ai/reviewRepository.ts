import { FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT } from '../payments/catalog';
import { InsufficientBalanceError } from '../payments/repository';

// Longer than the provider timeout, including persistence. A killed Worker
// leaves a recoverable reservation rather than a permanently spent credit.
export const REVIEW_ATTEMPT_TIMEOUT_MS = 60_000;
export const REVIEW_FAILURE_MESSAGE = 'Не удалось создать разбор. Попытка возвращена на баланс — можно попробовать ещё раз.';

export interface AiReviewRow {
  game_id: string;
  telegram_id: string;
  status: 'pending' | 'ready' | 'failed';
  charged_from: 'free' | 'paid';
  content: string | null;
  error: string | null;
  created_at: number;
  // While pending, this timestamp is the immutable attempt token. Retries
  // increase it strictly, even within one millisecond or after clock rollback.
  updated_at: number;
}

export async function getAiReview(db: D1Database, gameId: string): Promise<AiReviewRow | null> {
  return db.prepare('SELECT * FROM ai_reviews WHERE game_id = ?').bind(gameId).first<AiReviewRow>();
}

/** Only the winning INSERT/failed->pending transition authorizes a debit.
 * Keep the debit directly after the upsert: changes() belongs to that write.
 * A pending/ready review is returned even when the balance is exhausted. */
export async function reserveAiReview(
  db: D1Database, gameId: string, telegramId: string
): Promise<{ review: AiReviewRow; started: boolean }> {
  const now = Date.now();
  const results = await db.batch([
    db.prepare(`INSERT INTO user_balances
      (telegram_id, free_games_remaining, free_ai_reviews_remaining, paid_games, paid_ai_reviews, version, created_at, updated_at)
      VALUES (?, ?, ?, 0, 0, 1, ?, ?) ON CONFLICT(telegram_id) DO NOTHING`)
      .bind(telegramId, FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT, now, now),
    db.prepare(`INSERT INTO ai_reviews
      (game_id, telegram_id, status, charged_from, content, error, created_at, updated_at)
      SELECT ?, ?, 'pending', CASE WHEN free_ai_reviews_remaining > 0 THEN 'free' ELSE 'paid' END,
        NULL, NULL, ?, ? FROM user_balances
      WHERE telegram_id = ? AND (free_ai_reviews_remaining > 0 OR paid_ai_reviews > 0)
      ON CONFLICT(game_id) DO UPDATE SET status = 'pending', charged_from = excluded.charged_from,
        content = NULL, error = NULL, updated_at = MAX(ai_reviews.updated_at + 1, excluded.updated_at)
      WHERE ai_reviews.status = 'failed' AND ai_reviews.telegram_id = excluded.telegram_id`)
      .bind(gameId, telegramId, now, now, telegramId),
    db.prepare(`UPDATE user_balances SET
      free_ai_reviews_remaining = free_ai_reviews_remaining - CASE WHEN free_ai_reviews_remaining > 0 THEN 1 ELSE 0 END,
      paid_ai_reviews = paid_ai_reviews - CASE WHEN free_ai_reviews_remaining = 0 THEN 1 ELSE 0 END,
      version = version + 1, updated_at = ?
      WHERE changes() = 1 AND telegram_id = ?`)
      .bind(now, telegramId),
    db.prepare('SELECT * FROM ai_reviews WHERE game_id = ? AND telegram_id = ?').bind(gameId, telegramId),
  ]);
  const review = results[3].results?.[0] as unknown as AiReviewRow | undefined;
  const started = (results[1].meta.changes ?? 0) > 0;
  if (!review || (!started && review.status === 'failed')) throw new InsufficientBalanceError();
  return { review, started };
}

export async function markAiReviewReady(db: D1Database, gameId: string, attempt: number, content: string): Promise<boolean> {
  const now = Date.now();
  const result = await db.prepare(`UPDATE ai_reviews SET status = 'ready', content = ?, error = NULL, updated_at = ?
    WHERE game_id = ? AND status = 'pending' AND updated_at = ? AND updated_at > ?`)
    .bind(content, now, gameId, attempt, now - REVIEW_ATTEMPT_TIMEOUT_MS).run();
  return (result.meta.changes ?? 0) > 0;
}

/** Failure and refund commit together and at most once for this attempt.
 * The row snapshot decides the refund source; stale callbacks cannot affect
 * a retry. Provider error bodies never become user-visible persisted data. */
export async function failAiReviewAndRefund(
  db: D1Database, gameId: string, attempt: number, expiredOnly = false
): Promise<boolean> {
  const now = Date.now();
  const results = await db.batch([
    db.prepare(`UPDATE ai_reviews SET status = 'failed', content = NULL, error = ?, updated_at = MAX(updated_at, ?)
      WHERE game_id = ? AND status = 'pending' AND updated_at = ?
        ${expiredOnly ? 'AND updated_at <= ?' : ''}`)
      .bind(REVIEW_FAILURE_MESSAGE, now, gameId, attempt, ...(expiredOnly ? [now - REVIEW_ATTEMPT_TIMEOUT_MS] : [])),
    db.prepare(`UPDATE user_balances SET
      free_ai_reviews_remaining = free_ai_reviews_remaining + CASE WHEN
        (SELECT charged_from FROM ai_reviews WHERE game_id = ?) = 'free' THEN 1 ELSE 0 END,
      paid_ai_reviews = paid_ai_reviews + CASE WHEN
        (SELECT charged_from FROM ai_reviews WHERE game_id = ?) = 'paid' THEN 1 ELSE 0 END,
      version = version + 1, updated_at = ?
      WHERE changes() = 1 AND telegram_id = (SELECT telegram_id FROM ai_reviews WHERE game_id = ?)`)
      .bind(gameId, gameId, now, gameId),
  ]);
  return (results[0].meta.changes ?? 0) > 0;
}

export async function getRecoverableAiReview(db: D1Database, gameId: string): Promise<AiReviewRow | null> {
  const review = await getAiReview(db, gameId);
  if (review?.status === 'pending' && review.updated_at <= Date.now() - REVIEW_ATTEMPT_TIMEOUT_MS) {
    await failAiReviewAndRefund(db, gameId, review.updated_at, true);
    return getAiReview(db, gameId);
  }
  return review;
}

/** Cron also recovers reservations whose clients never came back. */
export async function recoverExpiredAiReviews(db: D1Database): Promise<void> {
  const result = await db.prepare(`SELECT game_id, updated_at FROM ai_reviews
    WHERE status = 'pending' AND updated_at <= ? ORDER BY updated_at LIMIT 20`)
    .bind(Date.now() - REVIEW_ATTEMPT_TIMEOUT_MS).all<Pick<AiReviewRow, 'game_id' | 'updated_at'>>();
  for (const review of result.results ?? []) {
    await failAiReviewAndRefund(db, review.game_id, review.updated_at, true);
  }
}
