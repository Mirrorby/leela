export interface AiReviewRow {
  game_id: string;
  telegram_id: string;
  status: 'pending' | 'ready' | 'failed';
  charged_from: 'free' | 'paid';
  content: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export async function getAiReview(db: D1Database, gameId: string): Promise<AiReviewRow | null> {
  const row = await db.prepare('SELECT * FROM ai_reviews WHERE game_id = ?').bind(gameId).first<AiReviewRow>();
  return row ?? null;
}

/**
 * Переводит разбор в 'pending' — INSERT для первого запроса, UPDATE для
 * повторной попытки после 'failed' (game_id — PRIMARY KEY, см.
 * 0009_create_ai_reviews.sql, поэтому upsert, а не всегда INSERT).
 * charged_from записывается ЗДЕСЬ (а не только в момент начисления/возврата)
 * — это единственное место, где известно, какой конкретно счётчик был
 * списан для ЭТОЙ попытки генерации (см. ai/index.ts:startAiReview,
 * который вызывает это сразу после chargeForAiReview).
 */
export async function upsertAiReviewPending(db: D1Database, gameId: string, telegramId: string, chargedFrom: 'free' | 'paid'): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO ai_reviews (game_id, telegram_id, status, charged_from, content, error, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, NULL, NULL, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET status = 'pending', charged_from = ?, error = NULL, updated_at = ?`
    )
    .bind(gameId, telegramId, chargedFrom, now, now, chargedFrom, now)
    .run();
}

export async function markAiReviewReady(db: D1Database, gameId: string, content: string): Promise<void> {
  await db
    .prepare(`UPDATE ai_reviews SET status = 'ready', content = ?, error = NULL, updated_at = ? WHERE game_id = ?`)
    .bind(content, Date.now(), gameId)
    .run();
}

export async function markAiReviewFailed(db: D1Database, gameId: string, error: string): Promise<void> {
  await db
    .prepare(`UPDATE ai_reviews SET status = 'failed', error = ?, updated_at = ? WHERE game_id = ?`)
    .bind(error, Date.now(), gameId)
    .run();
}
