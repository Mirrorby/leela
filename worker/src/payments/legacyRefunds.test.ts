import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import { createPendingTransaction } from '../testUtils/legacyTransaction';
import { applySuccessfulPayment, getEntitlements, getTransactionById } from './repository';
import { applyLegacyRefund, type LegacyRefund } from './legacyRefunds';
import { handleTelegramWebhook } from '../telegram/webhook';

describe('historical Stars refund notifications', () => {
  let database: ReturnType<typeof createSqliteD1>;
  beforeEach(() => { database = createSqliteD1(); vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no live Telegram calls')); });
  afterEach(() => { database.sqlite.close(); vi.restoreAllMocks(); });

  async function purchase(product: 'game_5' | 'game_ai_combo' | 'subscription_unlimited' = 'game_ai_combo', paid = true) {
    const tx = await createPendingTransaction(database.db, '111', product);
    if (paid) await applySuccessfulPayment(database.db, tx, { telegramPaymentChargeId: 'charge-1', isRenewal: false, subscriptionExpirationDateSeconds: Math.floor(Date.now() / 1000) + 2592000 });
    const refund: LegacyRefund = { currency: 'XTR', total_amount: tx.stars_amount,
      invoice_payload: tx.id, telegram_payment_charge_id: 'charge-1' };
    return { tx, refund };
  }

  it('withdraws only the recorded grant once under concurrent repeated notifications', async () => {
    const { tx, refund } = await purchase();
    database.sqlite.exec("UPDATE user_balances SET paid_games = 8, paid_ai_reviews = 4, free_games_remaining = 0 WHERE telegram_id = '111'");
    await Promise.all([applyLegacyRefund(database.db, '111', refund), applyLegacyRefund(database.db, '111', refund)]);
    await applyLegacyRefund(database.db, '111', refund);
    expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 7, paidAiReviews: 3, freeGamesRemaining: 0 });
    expect((await getTransactionById(database.db, tx.id))?.status).toBe('refunded');
    expect(database.sqlite.prepare('SELECT status, reason FROM legacy_star_refunds').all())
      .toEqual([{ status: 'applied', reason: 'one_time_purchase' }]);
    const events = database.sqlite.prepare('SELECT * FROM analytics_events').all();
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload as string)).toMatchObject({ provider: 'telegram_stars_legacy',
      amount: 149, currency: 'XTR', purchaseId: 'charge-1', accessAdjustment: 'reconciled' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('clamps spent credits at zero without changing the free entitlement', async () => {
    const { refund } = await purchase('game_5');
    database.sqlite.exec("UPDATE user_balances SET paid_games = 1 WHERE telegram_id = '111'");
    await applyLegacyRefund(database.db, '111', refund);
    expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 0, freeGamesRemaining: 1 });
  });

  it.each([true, false])('fences simultaneous settlement and refund (settlement first: %s)', async (first) => {
    const { tx, refund } = await purchase('game_ai_combo', false);
    const settle = () => applySuccessfulPayment(database.db, tx, { telegramPaymentChargeId: 'charge-1', isRenewal: false });
    const reverse = () => applyLegacyRefund(database.db, '111', refund);
    await Promise.all(first ? [settle(), reverse()] : [reverse(), settle()]);
    expect((await getTransactionById(database.db, tx.id))?.status).toBe('refunded');
    expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 0, paidAiReviews: 0 });
  });

  it('a failure crediting a historical purchase rolls back settlement and permits a retry', async () => {
    const { tx } = await purchase('game_ai_combo', false);
    database.sqlite.exec("CREATE TRIGGER fail_credit BEFORE UPDATE ON user_balances BEGIN SELECT RAISE(ABORT, 'outage'); END");
    await expect(applySuccessfulPayment(database.db, tx, { telegramPaymentChargeId: 'charge-1', isRenewal: false })).rejects.toThrow('outage');
    expect((await getTransactionById(database.db, tx.id))?.status).toBe('created');
    database.sqlite.exec('DROP TRIGGER fail_credit');
    expect(await applySuccessfulPayment(database.db, tx, { telegramPaymentChargeId: 'charge-1', isRenewal: false })).toBe(true);
    expect(await applySuccessfulPayment(database.db, tx, { telegramPaymentChargeId: 'charge-1', isRenewal: false })).toBe(false);
    expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 1, paidAiReviews: 1 });
  });

  it('records a refund arriving before settlement and blocks a later successful-payment webhook', async () => {
    const { tx, refund } = await purchase('game_ai_combo', false);
    const notify = (field: string) => handleTelegramWebhook(new Request('https://example/telegram/webhook', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
      body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: 111 }, from: { id: 111 }, [field]: refund } }),
    }), 'test-token', 'secret', database.db);
    expect((await notify('refunded_payment')).status).toBe(200);
    expect((await notify('successful_payment')).status).toBe(200);
    expect((await getTransactionById(database.db, tx.id))?.status).toBe('refunded');
    expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 0, paidAiReviews: 0 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([{ total_amount: 1 }, { currency: 'USD' }, { owner: 222 }])('rejects an inconsistent old payment %j', async (fields) => {
    const { tx, refund } = await purchase('game_ai_combo', false);
    const owner = 'owner' in fields ? fields.owner : 111;
    await expect(handleTelegramWebhook(new Request('https://example/telegram/webhook', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
      body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: owner }, from: { id: owner },
        successful_payment: { ...refund, ...fields } } }),
    }), 'test-token', 'secret', database.db)).rejects.toThrow('invoice identity mismatch');
    expect((await getTransactionById(database.db, tx.id))?.status).toBe('created');
    expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 0, paidAiReviews: 0 });
  });

  it('rolls back the refund ledger and debit on SQL failure, then safely retries', async () => {
    const { tx, refund } = await purchase();
    database.sqlite.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON payment_event_outbox BEGIN SELECT RAISE(ABORT, 'outage'); END");
    await expect(applyLegacyRefund(database.db, '111', refund)).rejects.toThrow('outage');
    expect(database.sqlite.prepare('SELECT * FROM legacy_star_refunds').all()).toHaveLength(0);
    expect((await getTransactionById(database.db, tx.id))?.status).toBe('successful');
    expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 1, paidAiReviews: 1 });
    database.sqlite.exec('DROP TRIGGER fail_receipt');
    await applyLegacyRefund(database.db, '111', refund);
    expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 0, paidAiReviews: 0 });
  });

  it('records an ambiguous subscription refund for manual review and preserves its paid period', async () => {
    const { refund } = await purchase('subscription_unlimited');
    const before = database.sqlite.prepare('SELECT * FROM subscriptions').all();
    await applyLegacyRefund(database.db, '111', refund);
    expect(database.sqlite.prepare('SELECT * FROM subscriptions').all()).toEqual(before);
    expect(database.sqlite.prepare('SELECT status, reason FROM legacy_star_refunds').get())
      .toMatchObject({ status: 'manual_review', reason: 'subscription_period_unattributed' });
  });

  it.each(['unknown_invoice', 'invoice_mismatch', 'unrecorded_charge'])('records %s without touching another paid grant', async (reason) => {
    const { refund } = await purchase();
    if (reason === 'unknown_invoice') { refund.invoice_payload = 'missing'; refund.telegram_payment_charge_id = 'missing-charge'; }
    if (reason === 'invoice_mismatch') refund.total_amount++;
    if (reason === 'unrecorded_charge') refund.telegram_payment_charge_id = 'unrecorded';
    await applyLegacyRefund(database.db, '111', refund);
    expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 1, paidAiReviews: 1 });
    expect(database.sqlite.prepare('SELECT status, reason FROM legacy_star_refunds').get()).toMatchObject({ status: 'manual_review', reason });
  });

  it('rejects conflicting identities on a replay without a second debit', async () => {
    const { refund } = await purchase();
    await applyLegacyRefund(database.db, '111', refund);
    await expect(applyLegacyRefund(database.db, '222', refund)).rejects.toThrow('identity mismatch');
    await expect(applyLegacyRefund(database.db, '111', { ...refund, total_amount: 1 })).rejects.toThrow('identity mismatch');
    expect(database.sqlite.prepare('SELECT * FROM analytics_events').all()).toHaveLength(1);
  });

  it.each([{ currency: 'USD' }, { total_amount: -1 }, { total_amount: 1.5 }, { invoice_payload: '' }, { telegram_payment_charge_id: '' }])
    ('rejects malformed financial notifications %j', async (fields) => {
      const { refund } = await purchase();
      await expect(applyLegacyRefund(database.db, '111', { ...refund, ...fields })).rejects.toThrow('invalid legacy refund');
      expect(database.sqlite.prepare('SELECT * FROM legacy_star_refunds').all()).toHaveLength(0);
      expect(await getEntitlements(database.db, '111')).toMatchObject({ paidGames: 1, paidAiReviews: 1 });
    });
});
