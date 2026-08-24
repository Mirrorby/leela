import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleTelegramWebhook, verifyWebhookSecret } from './webhook';

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
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET);
    expect(res.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('на /start отвечает welcome-сообщением с кнопкой Mini App', async () => {
    const request = req(
      { update_id: 1, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: '/start' } },
      WEBHOOK_SECRET
    );
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET);
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
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET);
    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('на апдейт без message (например, edited_message) отвечает 200 и не падает', async () => {
    const request = req({ update_id: 3 }, WEBHOOK_SECRET);
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET);
    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('на некорректный JSON в теле отвечает 400, не роняя воркер', async () => {
    const request = new Request('https://leela-worker.example.workers.dev/telegram/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET, 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET);
    expect(res.status).toBe(400);
  });

  it('сбой отправки в Telegram (сеть/блокировка бота) не мешает ответить Telegram 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const request = req(
      { update_id: 4, message: { message_id: 4, chat: { id: 42 }, text: '/start' } },
      WEBHOOK_SECRET
    );
    const res = await handleTelegramWebhook(request, BOT_TOKEN, WEBHOOK_SECRET);
    expect(res.status).toBe(200);
  });
});
