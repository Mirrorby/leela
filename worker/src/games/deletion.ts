export class GameDeletedError extends Error {
  constructor() { super('game_deleted'); }
}
export async function wasCreationDeleted(db: D1Database, owner: string, key: string): Promise<boolean> {
  return !!await db.prepare('SELECT game_id FROM game_deletions WHERE telegram_id = ? AND client_request_id = ?')
    .bind(owner, key).first();
}
/** Cancellation/refund serializes against AI settlement. Only an ID receipt remains. */
export async function deleteOwnedGame(db: D1Database, gameId: string, owner: string) {
  const now = Date.now();
  const result = await db.batch([
    db.prepare(`INSERT INTO game_deletions (game_id, telegram_id, client_request_id, deleted_at)
      SELECT id, telegram_id, client_request_id, ? FROM games WHERE id = ? AND telegram_id = ?
      ON CONFLICT(game_id) DO NOTHING`).bind(now, gameId, owner),
    db.prepare(`UPDATE user_balances SET
      free_ai_reviews_remaining = free_ai_reviews_remaining + CASE WHEN
        (SELECT charged_from FROM ai_reviews WHERE game_id = ? AND telegram_id = ? AND status = 'pending') = 'free' THEN 1 ELSE 0 END,
      paid_ai_reviews = paid_ai_reviews + CASE WHEN
        (SELECT charged_from FROM ai_reviews WHERE game_id = ? AND telegram_id = ? AND status = 'pending') = 'paid' THEN 1 ELSE 0 END,
      version = version + 1, updated_at = ?
      WHERE telegram_id = ? AND EXISTS (SELECT 1 FROM game_deletions WHERE game_id = ? AND telegram_id = ?)
        AND EXISTS (SELECT 1 FROM ai_reviews WHERE game_id = ? AND telegram_id = ? AND status = 'pending')`)
      .bind(gameId, owner, gameId, owner, now, owner, gameId, owner, gameId, owner),
    db.prepare(`DELETE FROM ai_reviews WHERE game_id = ? AND telegram_id = ?
      AND EXISTS (SELECT 1 FROM game_deletions WHERE game_id = ? AND telegram_id = ?)`)
      .bind(gameId, owner, gameId, owner),
    db.prepare(`DELETE FROM analytics_events WHERE telegram_id = ?
      AND event IN ('free_ai_used', 'ai_review_started', 'ai_review_completed')
      AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.gameId') ELSE NULL END = ?
      AND EXISTS (SELECT 1 FROM game_deletions WHERE game_id = ? AND telegram_id = ?)`)
      .bind(owner, gameId, gameId, owner),
    db.prepare('DELETE FROM games WHERE id = ? AND telegram_id = ?').bind(gameId, owner),
    db.prepare('SELECT client_request_id FROM game_deletions WHERE game_id = ? AND telegram_id = ?').bind(gameId, owner),
  ]);
  const receipt = result[5].results?.[0] as { client_request_id: string | null } | undefined;
  return receipt ? { deleted: true as const, clientRequestId: receipt.client_request_id } : null;
}
