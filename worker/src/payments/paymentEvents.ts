import type { AnalyticsEvent } from '../analytics/repository';

const initialized = new WeakMap<D1Database, Promise<void>>();
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS payment_event_outbox (
    id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, event TEXT NOT NULL,
    payload TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_payment_event_outbox_created ON payment_event_outbox(created_at, id)',
  `CREATE TABLE IF NOT EXISTS legacy_star_refunds (
    charge_id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, invoice_payload TEXT NOT NULL,
    amount INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_legacy_star_refunds_status ON legacy_star_refunds(status, created_at)',
];

/** Safe rollout without a manual SQL prerequisite; retry failed setup. */
export async function ensurePaymentEvents(db: D1Database): Promise<void> {
  let pending = initialized.get(db);
  if (!pending) {
    pending = db.batch(SCHEMA.map(sql => db.prepare(sql))).then(() => {});
    initialized.set(db, pending);
    pending.catch(() => { initialized.delete(db); });
  }
  await pending;
}

/** Append inside the same transaction as the payment transition, immediately
 * after its guarded write. The immutable receipt survives analytics outages. */
export function paymentEventStatement(db: D1Database, id: string, telegramId: string, event: AnalyticsEvent,
  payload: Record<string, unknown>, now: number): D1PreparedStatement {
  return db.prepare(`INSERT INTO payment_event_outbox (id, telegram_id, event, payload, created_at)
    SELECT ?, ?, ?, ?, ? WHERE changes() = 1 ON CONFLICT(id) DO NOTHING`)
    .bind(id, telegramId, event, JSON.stringify(payload), now);
}

/** Stable event IDs and transactional delivery/deletion make retries and
 * concurrent cron/webhook deliveries harmless. Analytics cannot undo access. */
export async function flushPaymentAnalytics(db: D1Database): Promise<void> {
  try {
    await ensurePaymentEvents(db);
    await db.batch([
      db.prepare(`INSERT INTO analytics_events (id, telegram_id, event, payload, created_at)
        SELECT id, telegram_id, event, payload, created_at FROM payment_event_outbox WHERE 1
        ORDER BY created_at, id LIMIT 50 ON CONFLICT(id) DO NOTHING`),
      db.prepare(`DELETE FROM payment_event_outbox WHERE EXISTS
        (SELECT 1 FROM analytics_events WHERE analytics_events.id = payment_event_outbox.id)`),
    ]);
  } catch {
    console.warn('Payment analytics delivery failed; will retry');
  }
}

/** Repair pre-rollout omissions from authoritative saved purchases. Refunded
 * tombstones prove a refund, but cannot prove that access was ever granted. */
export async function reconcileTributePaymentAnalytics(db: D1Database): Promise<void> {
  try {
    await ensurePaymentEvents(db);
    await db.prepare(`INSERT INTO payment_event_outbox (id, telegram_id, event, payload, created_at)
      SELECT 'payment:tribute:' || p.purchase_id || CASE WHEN p.status = 'successful' THEN ':success' ELSE ':refund' END,
        p.telegram_id,
        CASE WHEN p.status = 'refunded' THEN 'payment_refunded'
          WHEN p.granted_games = 0 AND p.granted_ai_reviews > 0 THEN 'ai_payment_success' ELSE 'payment_success' END,
        json_object('provider', 'tribute', 'purchaseId', p.purchase_id, 'transactionId', p.transaction_id,
          'productId', p.product_id, 'amount', p.amount, 'currency', p.currency,
          'grant', json_object('games', p.granted_games, 'aiReviews', p.granted_ai_reviews)),
        CASE WHEN p.status = 'successful' THEN p.created_at ELSE p.updated_at END
      FROM tribute_purchases p WHERE p.status IN ('successful', 'refunded')
        AND NOT EXISTS (SELECT 1 FROM analytics_events a WHERE a.id = 'payment:tribute:' || p.purchase_id ||
          CASE WHEN p.status = 'successful' THEN ':success' ELSE ':refund' END)
      ORDER BY p.created_at, p.purchase_id LIMIT 50 ON CONFLICT(id) DO NOTHING`).run();
  } catch {
    console.warn('Payment analytics reconciliation failed; will retry');
  }
  await flushPaymentAnalytics(db);
}
