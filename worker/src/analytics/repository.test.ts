import { describe, it, expect } from 'vitest';
import { createFakeD1 } from '../testUtils/fakeD1';
import { logAnalyticsEvent, listAnalyticsEvents } from './repository';

describe('logAnalyticsEvent / listAnalyticsEvents', () => {
  it('записывает событие без payload', async () => {
    const db = createFakeD1();
    await logAnalyticsEvent(db, 'user-1', 'paywall_opened');
    const events = await listAnalyticsEvents(db, 'user-1');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('paywall_opened');
    expect(events[0].payload).toBeNull();
  });

  it('записывает событие с payload как JSON-строку (§26: тип продукта для событий покупки)', async () => {
    const db = createFakeD1();
    await logAnalyticsEvent(db, 'user-1', 'payment_success', { productId: 'game_5', starsAmount: 299 });
    const events = await listAnalyticsEvents(db, 'user-1');
    expect(JSON.parse(events[0].payload!)).toEqual({ productId: 'game_5', starsAmount: 299 });
  });

  it('изолировано по telegram_id', async () => {
    const db = createFakeD1();
    await logAnalyticsEvent(db, 'user-1', 'paywall_opened');
    await logAnalyticsEvent(db, 'user-2', 'paywall_opened');
    expect(await listAnalyticsEvents(db, 'user-1')).toHaveLength(1);
    expect(await listAnalyticsEvents(db, 'user-2')).toHaveLength(1);
  });

  it('несколько событий для одного пользователя накапливаются', async () => {
    const db = createFakeD1();
    await logAnalyticsEvent(db, 'user-1', 'paywall_opened');
    await logAnalyticsEvent(db, 'user-1', 'product_selected', { productId: 'game_1' });
    await logAnalyticsEvent(db, 'user-1', 'payment_started', { productId: 'game_1' });
    expect(await listAnalyticsEvents(db, 'user-1')).toHaveLength(3);
  });

  it('сбой записи не бросает исключение — аналитика вспомогательная, не должна ронять основной сценарий', async () => {
    const brokenDb = {
      prepare() {
        throw new Error('D1 недоступна');
      },
    } as unknown as D1Database;
    await expect(logAnalyticsEvent(brokenDb, 'user-1', 'paywall_opened')).resolves.toBeUndefined();
  });
});
