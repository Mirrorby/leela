import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import worker, { type Env } from '../index';
import { handleTributeWebhook, listProductsWithTribute, type TributeEnv } from './tribute';
import { listProducts } from './catalog';
import { getEntitlements } from './repository';
import { reconcileTributePaymentAnalytics } from './paymentEvents';

const secret = 'test-tribute-key';
const mapping = JSON.stringify({
  123: { productId: 'game_5', amount: 49900, currency: 'RUB' },
  124: { productId: 'game_ai_combo', amount: 29900, currency: 'RUB' },
});
const payload = { product_id: 123, purchase_id: 789, transaction_id: 456, telegram_user_id: 111, amount: 49900, currency: 'rub' };

async function signedRequest(name = 'new_digital_product', fields: Record<string, unknown> = {}, raw?: string): Promise<Request> {
  const body = raw ?? JSON.stringify({ name, created_at: '2026-10-02T18:00:00Z', sent_at: '2026-10-02T18:00:01Z', payload: { ...payload, ...fields } });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return new Request('https://leela-worker.example/tribute/webhook', { method: 'POST', headers: { 'trbt-signature': hex }, body });
}

describe('Tribute payments', () => {
  let sqlite: DatabaseSync;
  let env: TributeEnv;

  beforeEach(() => {
    const database = createSqliteD1(); sqlite = database.sqlite;
    env = { DB: database.db, TRIBUTE_API_KEY: secret, TRIBUTE_PRODUCTS: mapping };
  });

  afterEach(() => { sqlite.close(); vi.restoreAllMocks(); });

  const send = async (name = 'new_digital_product', fields: Record<string, unknown> = {}) =>
    handleTributeWebhook(await signedRequest(name, fields), env);

  it('records confirmed purchases and refunds once despite concurrent retries', async () => {
    await Promise.all([send(), send(), send()]);
    const success = sqlite.prepare('SELECT * FROM analytics_events').all();
    expect(success).toHaveLength(1);
    expect(success[0]).toMatchObject({ id: 'payment:tribute:789:success', telegram_id: '111', event: 'payment_success' });
    expect(JSON.parse(success[0].payload as string)).toMatchObject({ provider: 'tribute', purchaseId: '789',
      transactionId: '456', productId: 'game_5', amount: 49900, currency: 'RUB', grant: { games: 5, aiReviews: 0 } });
    env.TRIBUTE_PRODUCTS = '{}';
    await Promise.all([send('digital_product_refunded'), send('digital_product_refunded')]);
    expect(sqlite.prepare('SELECT event FROM analytics_events ORDER BY event').all())
      .toEqual([{ event: 'payment_refunded' }, { event: 'payment_success' }]);
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(0);
    expect(sqlite.prepare('SELECT * FROM payment_event_outbox').all()).toHaveLength(0);
  });

  it('distinguishes AI purchases from combined purchases in confirmed analytics', async () => {
    env.TRIBUTE_PRODUCTS = JSON.stringify({ 125: { productId: 'ai_review_1', amount: 199, currency: 'USD' },
      124: { productId: 'game_ai_combo', amount: 29900, currency: 'RUB' } });
    await send('new_digital_product', { product_id: 125, amount: 199, currency: 'USD' });
    await send('new_digital_product', { product_id: 124, purchase_id: 790, transaction_id: 457, amount: 29900 });
    expect(sqlite.prepare('SELECT event FROM analytics_events ORDER BY id').all())
      .toEqual([{ event: 'ai_payment_success' }, { event: 'payment_success' }]);
    expect(await getEntitlements(env.DB, '111')).toMatchObject({ paidGames: 1, paidAiReviews: 2 });
  });

  it('keeps credited access and durable receipts during an analytics outage, then delivers once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    sqlite.exec("CREATE TRIGGER fail_analytics BEFORE INSERT ON analytics_events BEGIN SELECT RAISE(ABORT, 'outage'); END");
    expect((await send()).status).toBe(200);
    const receipt = sqlite.prepare('SELECT * FROM payment_event_outbox').get();
    expect(receipt).toBeTruthy();
    expect((await send()).status).toBe(200);
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(5);
    expect(sqlite.prepare('SELECT * FROM analytics_events').all()).toHaveLength(0);
    sqlite.exec('DROP TRIGGER fail_analytics');
    await Promise.all([reconcileTributePaymentAnalytics(env.DB), reconcileTributePaymentAnalytics(env.DB)]);
    expect(sqlite.prepare('SELECT * FROM analytics_events').all()).toHaveLength(1);
    expect(sqlite.prepare('SELECT created_at FROM analytics_events').get()?.created_at).toBe(receipt?.created_at);
    expect(sqlite.prepare('SELECT * FROM payment_event_outbox').all()).toHaveLength(0);
  });

  it('rolls back access if its durable receipt cannot be saved, and permits a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sqlite.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON payment_event_outbox BEGIN SELECT RAISE(ABORT, 'outage'); END");
    expect((await send()).status).toBe(500);
    expect(sqlite.prepare('SELECT * FROM tribute_purchases').all()).toHaveLength(0);
    expect(sqlite.prepare('SELECT * FROM user_balances').all()).toHaveLength(0);
    sqlite.exec('DROP TRIGGER fail_receipt');
    await send();
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(5);
    expect(sqlite.prepare('SELECT * FROM analytics_events').all()).toHaveLength(1);
  });

  it('repairs pre-rollout omissions without inventing a success for a refund-first tombstone', async () => {
    await send();
    sqlite.exec('DELETE FROM analytics_events');
    await send('digital_product_refunded', { purchase_id: 790, transaction_id: 457 });
    await reconcileTributePaymentAnalytics(env.DB);
    await reconcileTributePaymentAnalytics(env.DB);
    expect(sqlite.prepare('SELECT id FROM analytics_events ORDER BY id').all()).toEqual([
      { id: 'payment:tribute:789:success' }, { id: 'payment:tribute:790:refund' },
    ]);
    await send('new_digital_product', { purchase_id: 790, transaction_id: 457 });
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(5);
    expect(sqlite.prepare('SELECT * FROM analytics_events').all()).toHaveLength(2);
  });

  it('rolls back a refund when its receipt fails and reconciles it only once on retry', async () => {
    await send();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sqlite.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON payment_event_outbox BEGIN SELECT RAISE(ABORT, 'outage'); END");
    expect((await send('digital_product_refunded')).status).toBe(500);
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(5);
    expect(sqlite.prepare('SELECT status FROM tribute_purchases').get()?.status).toBe('successful');
    sqlite.exec('DROP TRIGGER fail_receipt');
    await send('digital_product_refunded'); await send('digital_product_refunded');
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(0);
    expect(sqlite.prepare("SELECT * FROM analytics_events WHERE event = 'payment_refunded'").all()).toHaveLength(1);
  });

  it('publishes checkout URLs and prices from the webhook mappings without exposing the key or changing grants', () => {
    env.TRIBUTE_PRODUCTS = JSON.stringify({
      161238: { productId: 'game_1', amount: 159, currency: 'USD' },
      161251: { productId: 'game_5', amount: 599, currency: 'USD' },
      161252: { productId: 'ai_review_1', amount: 199, currency: 'USD' },
      161253: { productId: 'game_ai_combo', amount: 299, currency: 'USD' },
    });
    const products = listProductsWithTribute(env);
    for (const [id, code, amount] of [
      ['game_1', 'FWC', 159], ['game_5', 'FWP', 599], ['ai_review_1', 'FWQ', 199], ['game_ai_combo', 'FWR', 299],
    ] as const) {
      expect(products.find((product) => product.id === id)?.tribute).toEqual({ url: `https://web.tribute.tg/p/${code}`, amount, currency: 'USD' });
    }
    expect(products.map((product) => product.id)).not.toContain('subscription_unlimited');
    expect(products.map(({ tribute: _tribute, ...product }) => product)).toEqual(listProducts());
    expect(listProducts().every((product) => !product.tribute)).toBe(true);
    expect(JSON.stringify(products)).not.toContain(secret);
    env.TRIBUTE_PRODUCTS = '{}';
    expect(listProductsWithTribute(env)).toEqual([]);
    delete env.TRIBUTE_API_KEY;
    expect(listProductsWithTribute(env)).toEqual([]);
  });

  it('routes signed payment through the Worker and credits the existing entitlements', async () => {
    const res = await worker.fetch(await signedRequest(), { ...env, BOT_TOKEN: '', WEBHOOK_SECRET: '', GEMINI_API_KEY: '' } as Env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    expect(await getEntitlements(env.DB, '111')).toMatchObject({ freeGamesRemaining: 1, paidGames: 5, freeAiReviewsRemaining: 1 });
    expect(sqlite.prepare('SELECT status, currency, amount FROM tribute_purchases').get()).toMatchObject({ status: 'successful', currency: 'RUB', amount: 49900 });
  });

  it('rejects absent, malformed, wrong and modified signatures without writing', async () => {
    for (const signature of [undefined, 'bad', '0'.repeat(64)]) {
      const req = new Request('https://example/tribute/webhook', { method: 'POST', headers: signature ? { 'trbt-signature': signature } : {}, body: '{}' });
      expect((await handleTributeWebhook(req, env)).status).toBe(401);
    }
    const original = await signedRequest();
    const modified = new Request(original.url, { method: 'POST', headers: original.headers, body: (await original.text()).replace('49900', '1') });
    expect((await handleTributeWebhook(modified, env)).status).toBe(401);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tribute_purchases').get()?.count).toBe(0);
  });

  it('verifies the exact raw body, including whitespace', async () => {
    const raw = JSON.stringify({ name: 'new_digital_product', payload }, null, 2);
    expect((await handleTributeWebhook(await signedRequest(undefined, {}, raw), env)).status).toBe(200);
  });

  it('retries are idempotent even when sent_at changes or mapping is removed', async () => {
    await send();
    const raw = JSON.stringify({ name: 'new_digital_product', sent_at: '2026-10-03T09:00:00Z', payload });
    env.TRIBUTE_PRODUCTS = '{}';
    expect(await (await handleTributeWebhook(await signedRequest(undefined, {}, raw), env)).json()).toMatchObject({ duplicate: true });
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(5);
  });

  it('distinct purchases of the same product add together and combo grants both credits', async () => {
    await send();
    await send('new_digital_product', { purchase_id: 790, transaction_id: 457 });
    await send('new_digital_product', { product_id: 124, purchase_id: 791, transaction_id: 458, amount: 29900 });
    expect(await getEntitlements(env.DB, '111')).toMatchObject({ paidGames: 11, paidAiReviews: 1 });
  });

  it('simultaneous deliveries read an absent purchase but grant only once', async () => {
    const responses = await Promise.all([send(), send(), send()]);
    expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(5);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tribute_purchases').get()?.count).toBe(1);
  });

  it('rejects incorrect price/currency and missing or unsafe Telegram IDs', async () => {
    expect((await send('new_digital_product', { amount: 1 })).status).toBe(409);
    expect((await send('new_digital_product', { currency: 'eur' })).status).toBe(409);
    for (const telegram_user_id of [undefined, null, 0, -1, '111', 2 ** 53]) {
      expect((await send('new_digital_product', { telegram_user_id })).status).toBe(422);
    }
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tribute_purchases').get()?.count).toBe(0);
  });

  it('does not silently accept old webhook samples without a purchase ID', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await send('new_digital_product', { purchase_id: undefined })).status).toBe(400);
    expect(log).toHaveBeenCalledWith('Tribute webhook rejected', { error: 'invalid_purchase', status: 400, stage: 'purchase_id' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tribute_purchases').get()?.count).toBe(0);
  });

  it('acknowledges signed connectivity envelopes without treating them as purchases', async () => {
    for (const raw of ['{}', '{"test":true}', '{"name":"test"}']) {
      expect(await (await handleTributeWebhook(await signedRequest(undefined, {}, raw), env)).json()).toEqual({ status: 'ignored' });
    }
    const unsigned = new Request('https://example/tribute/webhook', { method: 'POST', body: '{"test":true}' });
    expect((await handleTributeWebhook(unsigned, env)).status).toBe(401);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tribute_purchases').get()?.count).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_balances').get()?.count).toBe(0);
  });

  it('ignores the legacy documentation sample for an unrelated product without touching D1', async () => {
    const prepare = vi.spyOn(env.DB, 'prepare');
    // Tribute integration guide sample lacks purchase_id and transaction_id.
    const raw = JSON.stringify({ name: 'new_digital_product', payload: {
      product_id: 456, amount: 500, currency: 'usd', user_id: 31326, telegram_user_id: 12321321,
    } });
    expect(await (await handleTributeWebhook(await signedRequest(undefined, {}, raw), env)).json())
      .toEqual({ status: 'ignored', reason: 'unmapped_product' });
    expect(prepare).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tribute_purchases').get()?.count).toBe(0);
  });

  it('ignores unrelated products and subscription/donation events', async () => {
    expect(await (await send('new_digital_product', { product_id: 999 })).json()).toMatchObject({ status: 'ignored' });
    expect(await (await send('new_subscription')).json()).toMatchObject({ status: 'ignored' });
  });

  it('refunds once using the saved grants even after the mapping is removed', async () => {
    await send();
    env.TRIBUTE_PRODUCTS = '{}';
    expect((await send('digital_product_refunded')).status).toBe(200);
    expect(await (await send('digital_product_refunded')).json()).toMatchObject({ duplicate: true });
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(0);
    expect((await send()).status).toBe(200);
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(0);
  });

  it('refunds do not reset free credits or create a negative paid balance', async () => {
    await send();
    sqlite.exec("UPDATE user_balances SET free_games_remaining = 0, paid_games = 1 WHERE telegram_id = '111'");
    await send('digital_product_refunded');
    expect(await getEntitlements(env.DB, '111')).toMatchObject({ freeGamesRemaining: 0, paidGames: 0 });
  });

  it('refund delivered before purchase prevents a delayed grant', async () => {
    await send('digital_product_refunded');
    await send();
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(0);
    expect(sqlite.prepare('SELECT status FROM tribute_purchases').get()?.status).toBe('refunded');
  });

  it('refund without optional Telegram ID uses the stored purchase owner', async () => {
    await send();
    expect((await send('digital_product_refunded', { telegram_user_id: undefined })).status).toBe(200);
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(0);
  });

  it('rejects a purchase ID reused with a different customer or transaction', async () => {
    await send();
    expect((await send('new_digital_product', { telegram_user_id: 222 })).status).toBe(409);
    expect((await send('digital_product_refunded', { transaction_id: 999 })).status).toBe(409);
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(5);
  });

  it('rolls back ledger and balance if a SQL statement fails; retry grants once', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    sqlite.exec("CREATE TRIGGER fail_balance BEFORE UPDATE ON user_balances BEGIN SELECT RAISE(ABORT, 'simulated DB failure'); END");
    expect((await send()).status).toBe(500);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tribute_purchases').get()?.count).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_balances').get()?.count).toBe(0);
    sqlite.exec('DROP TRIGGER fail_balance');
    await send();
    await send();
    expect((await getEntitlements(env.DB, '111')).paidGames).toBe(5);
    expect(log).toHaveBeenCalled();
  });

  it('fails closed when unconfigured, invalid JSON, oversized body or recurring SKU', async () => {
    expect((await handleTributeWebhook(await signedRequest(), { DB: env.DB })).status).toBe(503);
    expect((await handleTributeWebhook(new Request('https://example', { method: 'GET' }), env)).status).toBe(405);
    expect((await handleTributeWebhook(await signedRequest(undefined, {}, '{'), env)).status).toBe(400);
    expect((await handleTributeWebhook(await signedRequest(undefined, {}, 'x'.repeat(65537)), env)).status).toBe(413);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    env.TRIBUTE_PRODUCTS = JSON.stringify({ 123: { productId: 'subscription_unlimited', amount: 49900, currency: 'RUB' } });
    expect((await send()).status).toBe(500);
  });
});
