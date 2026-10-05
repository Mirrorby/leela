import { getTransactionById, findTransactionByChargeId } from './repository';
import { ensurePaymentEvents, paymentEventStatement, flushPaymentAnalytics } from './paymentEvents';

export interface LegacyRefund {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
}

export async function hasLegacyRefund(db: D1Database, chargeId: string): Promise<boolean> {
  await ensurePaymentEvents(db);
  return Boolean(await db.prepare('SELECT charge_id FROM legacy_star_refunds WHERE charge_id = ?').bind(chargeId).first());
}

/** These are notifications about money ALREADY returned by Telegram, never
 * a request to issue a refund. Unattributed historical subscription periods
 * are recorded for review rather than cancelling other paid access. */
export async function applyLegacyRefund(db: D1Database, telegramId: string, refund: LegacyRefund): Promise<void> {
  if (refund.currency !== 'XTR' || !Number.isSafeInteger(refund.total_amount) || refund.total_amount <= 0
    || typeof refund.invoice_payload !== 'string' || !refund.invoice_payload || refund.invoice_payload.length > 128
    || typeof refund.telegram_payment_charge_id !== 'string' || !refund.telegram_payment_charge_id
    || refund.telegram_payment_charge_id.length > 512 || !/^[1-9]\d*$/.test(telegramId)) throw new Error('invalid legacy refund');
  await ensurePaymentEvents(db);
  const chargeId = refund.telegram_payment_charge_id;
  const prior = await db.prepare('SELECT * FROM legacy_star_refunds WHERE charge_id = ?')
    .bind(chargeId).first<{ telegram_id: string; invoice_payload: string; amount: number }>();
  if (prior) {
    if (prior.telegram_id !== telegramId || prior.invoice_payload !== refund.invoice_payload || prior.amount !== refund.total_amount) {
      throw new Error('legacy refund identity mismatch');
    }
    await flushPaymentAnalytics(db); return;
  }
  const transaction = await findTransactionByChargeId(db, chargeId) ?? await getTransactionById(db, refund.invoice_payload);
  const matches = transaction && transaction.telegram_id === telegramId && transaction.id === refund.invoice_payload
    && transaction.stars_amount === refund.total_amount;
  const attributable = matches && (transaction.telegram_payment_charge_id === chargeId
    || (!transaction.telegram_payment_charge_id && transaction.status === 'created'));
  const applied = attributable && transaction.granted_subscription_days === 0;
  const reason = !transaction ? 'unknown_invoice' : !matches ? 'invoice_mismatch'
    : !attributable ? 'unrecorded_charge' : !applied ? 'subscription_period_unattributed' : 'one_time_purchase';
  const now = Date.now();
  const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO legacy_star_refunds
    (charge_id, telegram_id, invoice_payload, amount, status, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(charge_id) DO NOTHING`)
    .bind(chargeId, telegramId, refund.invoice_payload, refund.total_amount, applied ? 'applied' : 'manual_review', reason, now)];
  if (applied && transaction.status !== 'refunded') {
    statements.push(
      db.prepare(`UPDATE user_balances SET
        paid_games = MAX(0, paid_games - (SELECT granted_games FROM transactions WHERE id = ?)),
        paid_ai_reviews = MAX(0, paid_ai_reviews - (SELECT granted_ai_reviews FROM transactions WHERE id = ?)),
        version = version + 1, updated_at = ?
        WHERE changes() = 1 AND telegram_id = ? AND EXISTS (SELECT 1 FROM transactions
          WHERE id = ? AND telegram_id = ? AND status = 'successful' AND telegram_payment_charge_id = ?)`)
        .bind(transaction.id, transaction.id, now, telegramId, transaction.id, telegramId, chargeId),
      db.prepare(`UPDATE transactions SET status = 'refunded', telegram_payment_charge_id = ?, updated_at = ?
        WHERE id = ? AND telegram_id = ? AND status != 'refunded'
          AND (telegram_payment_charge_id = ? OR (telegram_payment_charge_id IS NULL AND status = 'created'))
          AND EXISTS (SELECT 1 FROM legacy_star_refunds WHERE charge_id = ? AND telegram_id = ? AND status = 'applied')`)
        .bind(chargeId, now, transaction.id, telegramId, chargeId, chargeId, telegramId),
    );
  }
  statements.push(paymentEventStatement(db, `payment:telegram:${chargeId}:refund`, telegramId, 'payment_refunded',
    { provider: 'telegram_stars_legacy', purchaseId: chargeId, invoiceId: refund.invoice_payload,
      productId: matches ? transaction.product_id : null, amount: refund.total_amount, currency: 'XTR',
      accessAdjustment: applied ? 'reconciled' : 'manual_review', reason }, now));
  await db.batch(statements);
  await flushPaymentAnalytics(db);
}
