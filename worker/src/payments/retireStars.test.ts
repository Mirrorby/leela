import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import { createPendingTransaction } from '../testUtils/legacyTransaction';
import { applySuccessfulPayment, getOrCreateUserBalance } from './repository';
import { retireStarsRenewals } from './retireStars';
import worker, { type Env } from '../index';

describe('historical Stars renewal retirement', () => {
  let database: ReturnType<typeof createSqliteD1>;
  const subscription = () => database.sqlite.prepare('SELECT * FROM subscriptions').get();
  beforeEach(async () => {
    database = createSqliteD1();
    await getOrCreateUserBalance(database.db, '111');
    const tx = await createPendingTransaction(database.db, '111', 'subscription_unlimited');
    await applySuccessfulPayment(database.db, tx, {
      telegramPaymentChargeId: 'original-charge', isRenewal: false,
      subscriptionExpirationDateSeconds: Math.floor(Date.now() / 1000) + 86400,
    });
  });
  afterEach(() => { vi.restoreAllMocks(); database.sqlite.close(); });

  it('cancels future renewal without shortening access or changing credits; the cron then becomes a no-op', async () => {
    const before = subscription();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true })));
    await worker.scheduled({} as ScheduledController, { DB: database.db, BOT_TOKEN: 'test-token' } as Env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/editUserStarSubscription');
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ user_id: 111, telegram_payment_charge_id: 'original-charge', is_canceled: true });
    expect(subscription()).toMatchObject({ auto_renew: 0, period_end: before!.period_end });
    expect(await getOrCreateUserBalance(database.db, '111')).toMatchObject({ free_games_remaining: 2, paid_games: 0 });
    await retireStarsRenewals(database.db, 'test-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not mark cancellation confirmed on a failed Telegram response and retries safely', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 400 }));
    const period = subscription()!.period_end;
    await retireStarsRenewals(database.db, 'test-token');
    expect(subscription()).toMatchObject({ auto_renew: 1, period_end: period });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: true })));
    await retireStarsRenewals(database.db, 'test-token');
    expect(subscription()).toMatchObject({ auto_renew: 0, period_end: period });
  });

  it('cannot cancel an unrelated subscription without an initial charge in its ledger', async () => {
    database.sqlite.exec("DELETE FROM transactions");
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await retireStarsRenewals(database.db, 'test-token');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(subscription()?.auto_renew).toBe(1);
  });
});
