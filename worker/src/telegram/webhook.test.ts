import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleTelegramWebhook, verifyWebhookSecret } from './webhook';
import { createFakeD1 } from '../testUtils/fakeD1';
import { createPendingTransaction, getTransactionById, getOrCreateUserBalance, getLatestSubscription } from '../payments/repository';
import { listAnalyticsEvents } from '../analytics/repository';

const BOT_TOKEN = 'test-bot-token';
const WEBHOOK_SECRET = 'test-webhook-secret';

function req(body: unknown, secretHeader?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secretHeader !== undefined) {
    headers['X-Telegram-Bot-Api-Secret-Token'] = secretHeader;
  }
  return new Request('https://leela-worker.example.workers.dev/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('verifyWebhookSecret', () => {
  it('принимает совпадающий секрет', () => {
    const request = req({}, WEBHOOK_SECRET);
    expect(verifyWebhookSecret(request, WEBHOOK_SECRET)).toBe(true);
  });

  it('отклоняет несовпадающий секрет', () => {
    const request = req({}, 'wrong-secret');
    expect(verifyWebhookSecret(request, WEBHOOK_SECRET)).toBe(false);
  });

  it('отклоняет отсутствующий заголовок', () => {
    const request = req({});
    expect(verifyWebhookSecret(request, WEBHOOK_SECRET)).toBe(false);
  });
});

describe('handleTelegramWebhook', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('отвечает 401 при неверном секрете и НЕ шлёт сообщение в Telegram', async () => {
    const request = req({ update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/start' } }, 'wrong');
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, createFakeD1());
    expect(res.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('на /start отвечает welcome-сообщением с кнопкой Mini App', async () => {
    const request = req(
      { update_id: 1, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: '/start' } },
      WEBHOOK_SECRET
    );
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, createFakeD1());
    expect(res.status).toBe(200);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.chat_id).toBe(42);
    expect(sentBody.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://mirrorby.github.io/leela/');
  });

  it('на произвольный текст (не /start) отвечает 200, но НЕ шлёт сообщение', async () => {
    const request = req(
      { update_id: 2, message: { message_id: 2, chat: { id: 42 }, text: 'привет' } },
      WEBHOOK_SECRET
    );
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, createFakeD1());
    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('на апдейт без message (например, edited_message) отвечает 200 и не падает', async () => {
    const request = req({ update_id: 3 }, WEBHOOK_SECRET);
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, createFakeD1());
    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('на некорректный JSON в теле отвечает 400, не роняя воркер', async () => {
    const request = new Request('https://leela-worker.example.workers.dev/telegram/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET, 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, createFakeD1());
    expect(res.status).toBe(400);
  });

  it('сбой отправки в Telegram (сеть/блокировка бота) не мешает ответить Telegram 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const request = req(
      { update_id: 4, message: { message_id: 4, chat: { id: 42 }, text: '/start' } },
      WEBHOOK_SECRET
    );
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, createFakeD1());
    expect(res.status).toBe(200);
  });
});

describe('handleTelegramWebhook — pre_checkout_query (батч 3)', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('валидный запрос — answerPreCheckoutQuery с ok:true', async () => {
    const db = createFakeD1();
    const tx = await createPendingTransaction(db, '555', 'game_1');

    const request = req(
      {
        update_id: 10,
        pre_checkout_query: { id: 'pcq-1', from: { id: 555 }, currency: 'XTR', total_amount: tx.stars_amount, invoice_payload: tx.id },
      },
      WEBHOOK_SECRET
    );
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    expect(res.status).toBe(200);

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`);
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.pre_checkout_query_id).toBe('pcq-1');
    expect(sentBody.ok).toBe(true);
  });

  it('неизвестный invoice_payload — ok:false, не 500', async () => {
    const db = createFakeD1();
    const request = req(
      {
        update_id: 11,
        pre_checkout_query: { id: 'pcq-2', from: { id: 555 }, currency: 'XTR', total_amount: 79, invoice_payload: 'no-such-tx' },
      },
      WEBHOOK_SECRET
    );
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    expect(res.status).toBe(200);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).ok).toBe(false);
  });

  it('сумма в запросе не совпадает со stars_amount транзакции — ok:false (защита от подделки)', async () => {
    const db = createFakeD1();
    const tx = await createPendingTransaction(db, '555', 'game_1');
    const request = req(
      {
        update_id: 12,
        pre_checkout_query: { id: 'pcq-3', from: { id: 555 }, currency: 'XTR', total_amount: 1, invoice_payload: tx.id },
      },
      WEBHOOK_SECRET
    );
    await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).ok).toBe(false);
  });
});

describe('handleTelegramWebhook — successful_payment (батч 3)', () => {
  it('обычная покупка партий — начисляет paid_games и помечает транзакцию successful', async () => {
    const db = createFakeD1();
    const tx = await createPendingTransaction(db, '600', 'game_5');

    const request = req(
      {
        update_id: 20,
        message: {
          message_id: 1,
          chat: { id: 600 },
          from: { id: 600 },
          successful_payment: {
            currency: 'XTR',
            total_amount: tx.stars_amount,
            invoice_payload: tx.id,
            telegram_payment_charge_id: 'charge-1',
          },
        },
      },
      WEBHOOK_SECRET
    );
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    expect(res.status).toBe(200);

    const balance = await getOrCreateUserBalance(db, '600');
    expect(balance.paid_games).toBe(5);

    const updated = await getTransactionById(db, tx.id);
    expect(updated?.status).toBe('successful');
    expect(updated?.telegram_payment_charge_id).toBe('charge-1');
  });

  it('повторная доставка того же charge_id — НЕ начисляет второй раз (идемпотентность, §14 ТЗ)', async () => {
    const db = createFakeD1();
    const tx = await createPendingTransaction(db, '601', 'game_5');
    const payment = {
      currency: 'XTR',
      total_amount: tx.stars_amount,
      invoice_payload: tx.id,
      telegram_payment_charge_id: 'charge-dup',
    };
    const makeRequest = () =>
      req(
        { update_id: 21, message: { message_id: 1, chat: { id: 601 }, from: { id: 601 }, successful_payment: payment } },
        WEBHOOK_SECRET
      );

    await handleTelegramWebhook(makeRequest(), BOT_TOKEN, WEBHOOK_SECRET, db);
    await handleTelegramWebhook(makeRequest(), BOT_TOKEN, WEBHOOK_SECRET, db);

    const balance = await getOrCreateUserBalance(db, '601');
    expect(balance.paid_games).toBe(5); // не 10
  });

  it('первая оплата подписки — создаёт subscriptions с period_end = subscription_expiration_date * 1000', async () => {
    const db = createFakeD1();
    const tx = await createPendingTransaction(db, '602', 'subscription_unlimited');
    const expirationSeconds = Math.floor(Date.now() / 1000) + 2592000;

    const request = req(
      {
        update_id: 22,
        message: {
          message_id: 1,
          chat: { id: 602 },
          from: { id: 602 },
          successful_payment: {
            currency: 'XTR',
            total_amount: tx.stars_amount,
            invoice_payload: tx.id,
            telegram_payment_charge_id: 'charge-sub-1',
            subscription_expiration_date: expirationSeconds,
            is_recurring: true,
            is_first_recurring: true,
          },
        },
      },
      WEBHOOK_SECRET
    );
    await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);

    const sub = await getLatestSubscription(db, '602');
    expect(sub?.period_end).toBe(expirationSeconds * 1000);
    expect(sub?.auto_renew).toBe(1);

    // Подписка НЕ начисляет партии/разборы (§3.3, §18 ТЗ).
    const balance = await getOrCreateUserBalance(db, '602');
    expect(balance.paid_games).toBe(0);
  });

  it('продление подписки (is_recurring, не is_first_recurring) — обновляет period_end существующей подписки, не создаёт новую и не начисляет партии', async () => {
    const db = createFakeD1();
    const now = Date.now();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-existing', '603', now + 1000, 1, now, now)
      .run();
    const tx = await createPendingTransaction(db, '603', 'subscription_unlimited');
    const newExpirationSeconds = Math.floor((now + 1000 * 60 * 60 * 24 * 30) / 1000);

    const request = req(
      {
        update_id: 23,
        message: {
          message_id: 1,
          chat: { id: 603 },
          from: { id: 603 },
          successful_payment: {
            currency: 'XTR',
            total_amount: tx.stars_amount,
            invoice_payload: tx.id,
            telegram_payment_charge_id: 'charge-sub-renew',
            subscription_expiration_date: newExpirationSeconds,
            is_recurring: true,
            is_first_recurring: false,
          },
        },
      },
      WEBHOOK_SECRET
    );
    await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);

    const sub = await getLatestSubscription(db, '603');
    expect(sub?.id).toBe('sub-existing'); // та же строка, не новая
    expect(sub?.period_end).toBe(newExpirationSeconds * 1000);
  });

  it('транзакция не найдена по invoice_payload — вебхук отвечает НЕ 200 (Telegram должен повторить доставку, деньги уже получены)', async () => {
    const db = createFakeD1();
    const request = req(
      {
        update_id: 24,
        message: {
          message_id: 1,
          chat: { id: 604 },
          from: { id: 604 },
          successful_payment: {
            currency: 'XTR',
            total_amount: 79,
            invoice_payload: 'ghost-transaction',
            telegram_payment_charge_id: 'charge-ghost',
          },
        },
      },
      WEBHOOK_SECRET
    );
    await expect(handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db)).rejects.toThrow();
  });
});

describe('handleTelegramWebhook — subscription update (батч 3, защищённая обработка)', () => {
  it('state: "canceled" выключает auto_renew, но НЕ трогает period_end (§17 ТЗ — доступ остаётся до конца периода)', async () => {
    const db = createFakeD1();
    const now = Date.now();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', '700', now + 100000, 1, now, now)
      .run();

    const request = req({ update_id: 30, subscription: { user: { id: 700 }, state: 'canceled' } }, WEBHOOK_SECRET);
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    expect(res.status).toBe(200);

    const sub = await getLatestSubscription(db, '700');
    expect(sub?.auto_renew).toBe(0);
    expect(sub?.period_end).toBe(now + 100000); // не изменился
  });

  it('неизвестное состояние подписки — игнорируется, не роняет вебхук', async () => {
    const db = createFakeD1();
    const request = req({ update_id: 31, subscription: { user: { id: 701 }, state: 'some_future_state' } }, WEBHOOK_SECRET);
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    expect(res.status).toBe(200);
  });
});

describe('handleTelegramWebhook — аналитика §26 (батч 5)', () => {
  it('обычная покупка (game_5) — логирует payment_success с productId/starsAmount', async () => {
    const db = createFakeD1();
    const tx = await createPendingTransaction(db, '800', 'game_5');
    const request = req(
      {
        update_id: 40,
        message: {
          message_id: 1,
          chat: { id: 800 },
          from: { id: 800 },
          successful_payment: { currency: 'XTR', total_amount: tx.stars_amount, invoice_payload: tx.id, telegram_payment_charge_id: 'charge-a1' },
        },
      },
      WEBHOOK_SECRET
    );
    await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    const events = await listAnalyticsEvents(db, '800');
    expect(events.map((e) => e.event)).toEqual(['payment_success']);
    expect(JSON.parse(events[0].payload!)).toMatchObject({ productId: 'game_5', starsAmount: 299 });
  });

  it('покупка ai_review_1 — логирует ai_payment_success, не общий payment_success', async () => {
    const db = createFakeD1();
    const tx = await createPendingTransaction(db, '801', 'ai_review_1');
    const request = req(
      {
        update_id: 41,
        message: {
          message_id: 1,
          chat: { id: 801 },
          from: { id: 801 },
          successful_payment: { currency: 'XTR', total_amount: tx.stars_amount, invoice_payload: tx.id, telegram_payment_charge_id: 'charge-a2' },
        },
      },
      WEBHOOK_SECRET
    );
    await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    const events = await listAnalyticsEvents(db, '801');
    expect(events.map((e) => e.event)).toEqual(['ai_payment_success']);
  });

  it('первая оплата подписки — логирует subscription_started', async () => {
    const db = createFakeD1();
    const tx = await createPendingTransaction(db, '802', 'subscription_unlimited');
    const request = req(
      {
        update_id: 42,
        message: {
          message_id: 1,
          chat: { id: 802 },
          from: { id: 802 },
          successful_payment: {
            currency: 'XTR',
            total_amount: tx.stars_amount,
            invoice_payload: tx.id,
            telegram_payment_charge_id: 'charge-a3',
            subscription_expiration_date: Math.floor(Date.now() / 1000) + 2592000,
            is_recurring: true,
            is_first_recurring: true,
          },
        },
      },
      WEBHOOK_SECRET
    );
    await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    const events = await listAnalyticsEvents(db, '802');
    expect(events.map((e) => e.event)).toEqual(['subscription_started']);
  });

  it('продление подписки — логирует subscription_renewed, не subscription_started', async () => {
    const db = createFakeD1();
    const now = Date.now();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-existing', '803', now + 1000, 1, now, now)
      .run();
    const tx = await createPendingTransaction(db, '803', 'subscription_unlimited');
    const request = req(
      {
        update_id: 43,
        message: {
          message_id: 1,
          chat: { id: 803 },
          from: { id: 803 },
          successful_payment: {
            currency: 'XTR',
            total_amount: tx.stars_amount,
            invoice_payload: tx.id,
            telegram_payment_charge_id: 'charge-a4',
            subscription_expiration_date: Math.floor((now + 2592000000) / 1000),
            is_recurring: true,
            is_first_recurring: false,
          },
        },
      },
      WEBHOOK_SECRET
    );
    await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    const events = await listAnalyticsEvents(db, '803');
    expect(events.map((e) => e.event)).toEqual(['subscription_renewed']);
  });

  it('pre_checkout_query отклонён (сумма не совпадает) — логирует payment_failed', async () => {
    const db = createFakeD1();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const tx = await createPendingTransaction(db, '804', 'game_1');
    const request = req(
      { update_id: 44, pre_checkout_query: { id: 'pcq-x', from: { id: 804 }, currency: 'XTR', total_amount: 1, invoice_payload: tx.id } },
      WEBHOOK_SECRET
    );
    await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    const events = await listAnalyticsEvents(db, '804');
    expect(events.map((e) => e.event)).toEqual(['payment_failed']);
  });

  it('state: "canceled" — логирует subscription_cancelled', async () => {
    const db = createFakeD1();
    const now = Date.now();
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', '805', now + 100000, 1, now, now)
      .run();
    const request = req({ update_id: 45, subscription: { user: { id: 805 }, state: 'canceled' } }, WEBHOOK_SECRET);
    await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET, db);
    const events = await listAnalyticsEvents(db, '805');
    expect(events.map((e) => e.event)).toEqual(['subscription_cancelled']);
  });
});
