/** Close renewal of historical Stars subscriptions while preserving the
 * already paid period. No invoices, charges or refunds are created here. */
export async function retireStarsRenewals(db: D1Database, botToken: string): Promise<void> {
  if (!botToken) throw new Error('BOT_TOKEN is required to retire historical subscriptions');
  const users = await db.prepare(`SELECT DISTINCT s.telegram_id FROM subscriptions s
    WHERE s.auto_renew = 1 AND EXISTS (SELECT 1 FROM transactions t WHERE t.telegram_id = s.telegram_id
      AND t.status = 'successful' AND t.granted_subscription_days > 0 AND t.is_subscription_renewal = 0
      AND t.telegram_payment_charge_id IS NOT NULL)
    ORDER BY s.updated_at, s.telegram_id LIMIT 20`).all<{ telegram_id: string }>();
  for (const user of users.results) {
    const charges = await db.prepare(`SELECT DISTINCT telegram_payment_charge_id FROM transactions
      WHERE telegram_id = ? AND status = 'successful' AND granted_subscription_days > 0
        AND is_subscription_renewal = 0 AND telegram_payment_charge_id IS NOT NULL`)
      .bind(user.telegram_id).all<{ telegram_payment_charge_id: string }>();
    if (!charges.results.length) {
      console.warn('Historical subscription has no recorded initial charge; manual reconciliation required');
      continue;
    }
    try {
      for (const charge of charges.results) {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/editUserStarSubscription`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ user_id: Number(user.telegram_id),
            telegram_payment_charge_id: charge.telegram_payment_charge_id, is_canceled: true }),
        });
        const data = await response.json() as { ok?: boolean; result?: boolean };
        if (!response.ok || data.ok !== true || data.result !== true) throw new Error('Subscription cancellation was not confirmed');
      }
      await db.prepare('UPDATE subscriptions SET auto_renew = 0, updated_at = ? WHERE telegram_id = ? AND auto_renew = 1')
        .bind(Date.now(), user.telegram_id).run();
    } catch {
      // Keep the local flag until Telegram confirms; the scheduled job retries.
      console.warn('Historical subscription cancellation failed; will retry');
      await db.prepare('UPDATE subscriptions SET updated_at = ? WHERE telegram_id = ? AND auto_renew = 1')
        .bind(Date.now(), user.telegram_id).run();
    }
  }
}
