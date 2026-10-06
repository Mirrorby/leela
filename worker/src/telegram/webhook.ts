/**
 * Обработчик вебхука Telegram-бота.
 * Документация: https://core.telegram.org/bots/api#setwebhook
 *
 * Telegram подписывает КАЖДЫЙ запрос к вебхуку заголовком
 * X-Telegram-Bot-Api-Secret-Token — значением, которое мы сами укажем при
 * регистрации через setWebhook (secret_token). Без сверки этого заголовка
 * кто угодно мог бы слать сюда поддельные "апдейты" от имени бота.
 */

import {
  getTransactionById,
  findTransactionByChargeId,
  applySuccessfulPayment,
  markSubscriptionAutoRenewOff,
} from '../payments/repository';
import support from '../../../src/data/paymentSupport.json';
import { readBoundedText, BodyTooLargeError } from '../http/limits';
import { applyLegacyRefund, hasLegacyRefund, type LegacyRefund } from '../payments/legacyRefunds';
import { logAnalyticsEvent } from '../analytics/repository';
import { botLanguage } from './profile';

const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';
const MINI_APP_URL = 'https://mirrorby.github.io/leela/';

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { id: number; first_name?: string; language_code?: string };
  text?: string;
  successful_payment?: TelegramSuccessfulPayment;
  refunded_payment?: LegacyRefund;
}

/** Поля подтверждены официальным Bot API changelog (Bot API 8.0, 17 ноября
 * 2024 — "Added the fields subscription_expiration_date, is_recurring and
 * is_first_recurring to the class SuccessfulPayment"). subscription_expiration_date
 * — Unix-время В СЕКУНДАХ (как почти все date-поля Telegram), не миллисекунды —
 * конвертация в payments/repository.ts:applySuccessfulPayment. */
export interface TelegramSuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  subscription_expiration_date?: number;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
}

export interface TelegramPreCheckoutQuery {
  id: string;
  from: { id: number; language_code?: string };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

/** Historical subscription cancellation notification. The Bot API documents
 * user, invoice_payload and state (active/canceled/failed). Stars renewals
 * are retired; cancellation changes only auto_renew, never paid access.
 * https://core.telegram.org/bots/api#botsubscriptionupdated */
export interface TelegramSubscriptionUpdate {
  user?: { id: number };
  state?: string;
  invoice_payload?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  pre_checkout_query?: TelegramPreCheckoutQuery;
  subscription?: TelegramSubscriptionUpdate;
}

/** Сравнение без ранней остановки по несовпадению символа — не даёт узнать секрет по времени ответа. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function verifyWebhookSecret(request: Request, webhookSecret: string): boolean {
  const provided = request.headers.get(TELEGRAM_SECRET_HEADER);
  if (!provided || !webhookSecret) return false;
  return timingSafeEqual(provided, webhookSecret);
}

async function answerPreCheckoutQuery(botToken: string, preCheckoutQueryId: string, ok: boolean, errorMessage?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ pre_checkout_query_id: preCheckoutQueryId, ok, error_message: errorMessage }),
  });
}

/**
 * §14 ТЗ. Telegram требует ответ в течение 10 секунд — иначе платёж
 * автоматически считается отклонённым на стороне Telegram (деньги с
 * пользователя не списываются). Валидация здесь — до фактического списания
 * денег, поэтому ошибка (ok:false) абсолютно безопасна и обратима: платёж
 * просто не пройдёт, пользователь может попробовать снова.
 */
async function handlePreCheckoutQuery(botToken: string, _db: D1Database, query: TelegramPreCheckoutQuery): Promise<void> {
  await answerPreCheckoutQuery(botToken, query.id, false, botLanguage(query.from.language_code) === 'ru'
    ? 'Оплата Stars отключена. Откройте Лилу и выберите оплату через Tribute.'
    : 'Stars payments are disabled. Open Leela and choose a Tribute payment.');
}

async function handleSuccessfulPayment(db: D1Database, message: TelegramMessage): Promise<void> {
  const payment = message.successful_payment;
  if (!payment || !message.from) return;

  // Идемпотентность (§14 ТЗ) — Telegram может доставить этот update
  // повторно (сетевой ретрай на его стороне); если этот charge_id уже
  // записан, доступ уже начислен, повторно начислять НЕЛЬЗЯ.
  if (await hasLegacyRefund(db, payment.telegram_payment_charge_id)) return;
  const existing = await findTransactionByChargeId(db, payment.telegram_payment_charge_id);
  if (existing) return;

  const transaction = await getTransactionById(db, payment.invoice_payload);
  if (!transaction) {
    // Не должно случаться в норме (payload — наш же id транзакции), но join
    // сорвался бы молча, если не проверить явно.
    throw new Error(`successful_payment: транзакция ${payment.invoice_payload} не найдена`);
  }

  if (payment.currency !== 'XTR' || payment.total_amount !== transaction.stars_amount
    || transaction.telegram_id !== String(message.chat.id) || transaction.telegram_id !== String(message.from.id)) {
    throw new Error('successful_payment: invoice identity mismatch');
  }
  const isRenewal = payment.is_recurring === true && payment.is_first_recurring !== true;
  const applied = await applySuccessfulPayment(db, transaction, {
    telegramPaymentChargeId: payment.telegram_payment_charge_id,
    isRenewal,
    subscriptionExpirationDateSeconds: payment.subscription_expiration_date,
  });
  if (!applied) return;

  // §26 ТЗ: "для событий покупки сохранять тип продукта". Подписка (первая
  // оплата/продление) и ai_review_1 логируются отдельными событиями вместо
  // общего payment_success — см. комментарий в index.ts:handleCreateInvoice
  // про то же разделение на этапе payment_started/ai_payment_started.
  const payload = { productId: transaction.product_id, starsAmount: transaction.stars_amount };
  if (isRenewal) {
    await logAnalyticsEvent(db, transaction.telegram_id, 'subscription_renewed', payload);
  } else if (transaction.granted_subscription_days > 0) {
    await logAnalyticsEvent(db, transaction.telegram_id, 'subscription_started', payload);
  } else if (transaction.product_id === 'ai_review_1') {
    await logAnalyticsEvent(db, transaction.telegram_id, 'ai_payment_success', payload);
  } else {
    await logAnalyticsEvent(db, transaction.telegram_id, 'payment_success', payload);
  }
}

async function handleSubscriptionUpdate(db: D1Database, update: TelegramSubscriptionUpdate): Promise<void> {
  if (update.state !== 'canceled' || !update.user) return;
  await markSubscriptionAutoRenewOff(db, String(update.user.id));
  await logAnalyticsEvent(db, String(update.user.id), 'subscription_cancelled');
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
  replyMarkup?: unknown
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
    }),
  });
  // Ответ Telegram намеренно не проверяем на успех: даже если отправка
  // сообщения не удалась (например, пользователь заблокировал бота), сам
  // вебхук всё равно должен ответить Telegram 200 — иначе Telegram будет
  // повторять доставку этого апдейта.
}

function russian(message: TelegramMessage): boolean { return botLanguage(message.from?.language_code) === 'ru'; }

async function handleStartCommand(botToken: string, message: TelegramMessage): Promise<void> {
  const ru = russian(message);
  const welcome = ru
    ? 'Лила — игра самопознания. Сформулируй намерение, бросай кубик и исследуй смысл клеток на своём пути.\n\nДля новых аккаунтов: 1 бесплатная партия и 1 короткий ИИ-разбор. Дополнительные партии и полные ИИ-разборы доступны через Tribute.\n\nЯзык выбирается по настройке Telegram. В самой игре его можно переключить кнопкой с флагом.\n\nОткрой приложение кнопкой ниже. Помощь с оплатой: /paysupport.'
    : 'Leela is a game of self-discovery. Set an intention, roll the die and explore the meaning of each square along your journey.\n\nNew accounts receive 1 free game and 1 short AI review. Additional games and full AI reviews are available through Tribute.\n\nThe language follows your Telegram setting. You can change it inside the game using the flag button.\n\nOpen the app below. Payment help: /paysupport.';
  await sendTelegramMessage(botToken, message.chat.id, welcome, {
    inline_keyboard: [[{ text: ru ? 'Открыть Лилу' : 'Open Leela', web_app: { url: MINI_APP_URL } }]],
  });
}

async function handlePaySupport(botToken: string, message: TelegramMessage): Promise<void> {
  const ru = russian(message);
  let text = ru
    ? 'Помощь с оплатой Лилы\n\nЕсли оплата прошла, а партии или разборы не появились: вернись в игру, нажми «Обновить баланс после оплаты» и проверь, что в Tribute выбран тот же Telegram-аккаунт. Если это не помогло, напиши автору по кнопке ниже.\n\nУкажи ID покупки из чека Tribute, товар, дату, сумму и валюту. Для старой оплаты в Telegram можно приложить чек. Не отправляй полный номер карты или коды подтверждения.\n\nПо вопросам списания денег или возврата в Tribute обратись в поддержку Tribute. Возврат требует проверки покупки.'
    : 'Leela payment help\n\nIf payment succeeded but games or reviews have not appeared: return to the game, tap “Refresh balance after payment” and check that Tribute uses the same Telegram account. If this does not help, contact the creator below.\n\nInclude the purchase ID from your Tribute receipt, product, date, amount and currency. For an older Telegram payment, include its receipt. Do not send your full card number or verification codes.\n\nFor charges or refunds through Tribute, contact Tribute Support. Refunds require verification of the purchase.';
  // Account identifiers belong only in a private reply, never a group chat.
  if (message.from && message.chat.id === message.from.id) text += ru
    ? `\n\nТвой Telegram ID: ${message.from.id}` : `\n\nYour Telegram ID: ${message.from.id}`;
  await sendTelegramMessage(botToken, message.chat.id, text, { inline_keyboard: [
    [{ text: ru ? 'Написать автору' : 'Contact the creator', url: support.authorUrl }],
    [{ text: ru ? 'Поддержка Tribute' : 'Tribute Support', url: support.tributeUrl }],
    [{ text: ru ? 'Открыть Лилу' : 'Open Leela', web_app: { url: MINI_APP_URL } }],
  ] });
}

/** Financial notifications must commit before acknowledgement: database
 * failures propagate so Telegram retries. Command delivery is best effort;
 * malformed/oversized requests are rejected before processing. */
export async function handleTelegramWebhook(
  request: Request,
  botToken: string,
  webhookSecret: string,
  db: D1Database
): Promise<Response> {
  if (!verifyWebhookSecret(request, webhookSecret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = JSON.parse(await readBoundedText(request, 64 * 1024)) as TelegramUpdate;
    if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error('invalid update');
  } catch (error) {
    if (error instanceof BodyTooLargeError) return Response.json({ error: 'body_too_large' }, { status: 413 });
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const text = typeof update.message?.text === 'string' ? update.message.text.trim() : '';
  const command = /^\/(start|paysupport)(?:@[a-zA-Z0-9_]+)?(?:\s|$)/i.exec(text)?.[1].toLowerCase();
  if (update.message && command) {
    try {
      if (command === 'paysupport') await handlePaySupport(botToken, update.message);
      else await handleStartCommand(botToken, update.message);
    } catch {
      // Отправка сообщения обратно в Telegram может не удаться (сеть,
      // пользователь заблокировал бота и т.п.) — это НЕ повод ответить
      // Telegram ошибкой на сам вебхук: апдейт всё равно был успешно
      // получен и обработан с нашей стороны, повторная доставка того же
      // /start ничего не исправит, только продублирует попытку отправки.
    }
  }

  if (update.pre_checkout_query) {
    try {
      await handlePreCheckoutQuery(botToken, db, update.pre_checkout_query);
    } catch {
      // Сбой валидации/сети здесь безопасен и обратим — деньги ещё не
      // списаны (см. комментарий у handlePreCheckoutQuery), поэтому не
      // роняем весь вебхук; хуже, что случится — Telegram сам отклонит
      // платёж по таймауту (не получив ответ за 10с), пользователь
      // попробует снова.
    }
  }

  if (update.message?.refunded_payment) {
    // Durable reconciliation or review must precede acknowledging a refund.
    const owner = update.message.chat.id;
    if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('legacy refund requires a private payment chat');
    await applyLegacyRefund(db, String(owner), update.message.refunded_payment);
  }

  if (update.message?.successful_payment) {
    // НЕ в try/catch — см. комментарий у функции и у самого handleTelegramWebhook
    // выше: сбой здесь обязан вернуть не-200, чтобы Telegram повторил
    // доставку, а не тихо "потерял" уже полученные деньги.
    await handleSuccessfulPayment(db, update.message);
  }

  if (update.subscription) {
    try {
      await handleSubscriptionUpdate(db, update.subscription);
    } catch {
      // Некритично (см. TelegramSubscriptionUpdate) — влияет только на
      // отображение "автопродление выключено", не на сам доступ.
    }
  }

  return Response.json({ ok: true });
}
