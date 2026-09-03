/**
 * §26 ТЗ — ровно тот список событий, что в файле, без реконструкции.
 * Для событий покупки (payment_success, ai_payment_success,
 * subscription_started/renewed) payload обязан нести productId (и
 * starsAmount — не требуется явно, но бесплатно вытекает из уже известного
 * значения в момент вызова, оставляю для полноты картины воронки).
 */
export type AnalyticsEvent =
  | 'paywall_opened'
  | 'product_selected'
  | 'payment_started'
  | 'payment_success'
  | 'payment_failed'
  | 'free_game_started'
  | 'paid_game_started'
  | 'subscription_game_started'
  | 'ai_offer_shown'
  | 'free_ai_used'
  | 'ai_payment_started'
  | 'ai_payment_success'
  | 'ai_review_started'
  | 'ai_review_completed'
  | 'subscription_started'
  | 'subscription_renewed'
  | 'subscription_cancelled'
  | 'subscription_expired';

export async function logAnalyticsEvent(
  db: D1Database,
  telegramId: string,
  event: AnalyticsEvent,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO analytics_events (id, telegram_id, event, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), telegramId, event, payload ? JSON.stringify(payload) : null, Date.now())
      .run();
  } catch {
    // Аналитика — вспомогательная, не должна ронять или замедлять основной
    // сценарий (создание партии, оплату и т.п.) своим сбоем. Тот же принцип,
    // что у отправки сообщений в Telegram (webhook.ts:handleStartCommand) —
    // сбой здесь проглатывается молча, не пробрасывается вызывающему коду.
  }
}

export interface AnalyticsEventRow {
  id: string;
  telegram_id: string;
  event: AnalyticsEvent;
  payload: string | null;
  created_at: number;
}

/** Для тестов и будущего экрана статистики — сам ТЗ не требует эндпоинта
 * чтения аналитики, но без функции чтения таблицу было бы нечем покрыть
 * тестами, кроме как через приватные детали fakeD1. */
export async function listAnalyticsEvents(db: D1Database, telegramId: string): Promise<AnalyticsEventRow[]> {
  const result = await db.prepare('SELECT * FROM analytics_events WHERE telegram_id = ?').bind(telegramId).all<AnalyticsEventRow>();
  return result.results;
}
