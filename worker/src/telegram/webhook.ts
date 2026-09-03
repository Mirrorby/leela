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
import { getProduct } from '../payments/catalog';
import { logAnalyticsEvent } from '../analytics/repository';

const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';
const MINI_APP_URL = 'https://mirrorby.github.io/leela/';

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { id: number; first_name?: string };
  text?: string;
  successful_payment?: TelegramSuccessfulPayment;
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
  from: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

/**
 * Update.subscription (BotSubscriptionUpdated, Bot API 10.2, добавлено
 * 14 июля 2026) — единственное место во всей интеграции, где официальную
 * секцию с полным списком полей достать не удалось (страница
 * core.telegram.org/bots/api#botsubscriptionupdated при разработке
 * возвращала только начало документа, не сам раздел). Подтверждено только
 * через сторонние обёртки API: есть строковое поле state, одно из значений
 * — 'canceled'. Реагируем МАКСИМАЛЬНО защищённо — только на этот конкретный
 * случай, любые другие/неизвестные состояния просто игнорируем, ничего не
 * трогая (см. markSubscriptionAutoRenewOff — эта ветка обновляет только
 * auto_renew, НИКОГДА не сокращает сам оплаченный период). Если это место
 * поведёт себя не так — первое, что проверить: реальную форму объекта
 * (см. ссылку выше в актуальной документации).
 */
export interface TelegramSubscriptionUpdate {
  user?: { id: number };
  state?: string;
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
async function handlePreCheckoutQuery(botToken: string, db: D1Database, query: TelegramPreCheckoutQuery): Promise<void> {
  const transaction = await getTransactionById(db, query.invoice_payload);
  if (!transaction) {
    await answerPreCheckoutQuery(botToken, query.id, false, 'Заказ не найден или устарел — попробуйте оформить покупку заново.');
    await logAnalyticsEvent(db, String(query.from.id), 'payment_failed', { reason: 'transaction_not_found' });
    return;
  }
  if (transaction.status !== 'created') {
    // Уже обработан (успешно/ошибка) или это повторная доставка того же
    // pre_checkout_query — отклоняем, не проваливаемся молча.
    await answerPreCheckoutQuery(botToken, query.id, false, 'Этот заказ уже обработан.');
    await logAnalyticsEvent(db, transaction.telegram_id, 'payment_failed', { productId: transaction.product_id, reason: 'already_processed' });
    return;
  }
  if (transaction.telegram_id !== String(query.from.id) || transaction.stars_amount !== query.total_amount) {
    // Расхождение суммы/пользователя с тем, что записано при создании
    // инвойса — верный признак подделки или сбоя, а не просто "не найдено".
    await answerPreCheckoutQuery(botToken, query.id, false, 'Данные заказа не совпадают.');
    await logAnalyticsEvent(db, transaction.telegram_id, 'payment_failed', { productId: transaction.product_id, reason: 'mismatch' });
    return;
  }
  await answerPreCheckoutQuery(botToken, query.id, true);
}

/**
 * §14/§15 ТЗ — деньги УЖЕ получены Telegram, эта функция обязана либо
 * успешно начислить доступ, либо (при сбое) дать вызывающему коду
 * прокинуть исключение дальше, чтобы вебхук ответил НЕ 200 — тогда Telegram
 * повторит доставку этого update (см. handleTelegramWebhook ниже: этот
 * путь единственный, где мы намеренно НЕ проглатываем ошибку в 200).
 * Молча проглотить сбой здесь означало бы принять деньги и не выдать
 * доступ — недопустимо, в отличие, например, от неудачной отправки
 * приветственного сообщения на /start.
 */
async function handleSuccessfulPayment(db: D1Database, message: TelegramMessage): Promise<void> {
  const payment = message.successful_payment;
  if (!payment || !message.from) return;

  // Идемпотентность (§14 ТЗ) — Telegram может доставить этот update
  // повторно (сетевой ретрай на его стороне); если этот charge_id уже
  // записан, доступ уже начислен, повторно начислять НЕЛЬЗЯ.
  const existing = await findTransactionByChargeId(db, payment.telegram_payment_charge_id);
  if (existing) return;

  const transaction = await getTransactionById(db, payment.invoice_payload);
  if (!transaction) {
    // Не должно случаться в норме (payload — наш же id транзакции), но join
    // сорвался бы молча, если не проверить явно.
    throw new Error(`successful_payment: транзакция ${payment.invoice_payload} не найдена`);
  }

  const isRenewal = payment.is_recurring === true && payment.is_first_recurring !== true;
  await applySuccessfulPayment(db, transaction, {
    telegramPaymentChargeId: payment.telegram_payment_charge_id,
    isRenewal,
    subscriptionExpirationDateSeconds: payment.subscription_expiration_date,
  });

  // §26 ТЗ: "для событий покупки сохранять тип продукта". Подписка (первая
  // оплата/продление) и ai_review_1 логируются отдельными событиями вместо
  // общего payment_success — см. комментарий в index.ts:handleCreateInvoice
  // про то же разделение на этапе payment_started/ai_payment_started.
  const product = getProduct(transaction.product_id);
  const payload = { productId: transaction.product_id, starsAmount: transaction.stars_amount };
  if (isRenewal) {
    await logAnalyticsEvent(db, transaction.telegram_id, 'subscription_renewed', payload);
  } else if (product?.isSubscription) {
    await logAnalyticsEvent(db, transaction.telegram_id, 'subscription_started', payload);
  } else if (transaction.product_id === 'ai_review_1') {
    await logAnalyticsEvent(db, transaction.telegram_id, 'ai_payment_success', payload);
  } else {
    await logAnalyticsEvent(db, transaction.telegram_id, 'payment_success', payload);
  }
}

/** См. TelegramSubscriptionUpdate выше — единственная неуверенная часть
 * интеграции, обработка предельно защищённая и не влияющая на сам доступ. */
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

const WELCOME_TEXT =
  'Лила — доска трансформации. Брось кубик, пройди путь фишки от рождения до финиша ' +
  'и загляни в смысл каждой клетки, на которой останавливаешься.\n\n' +
  'Открой приложение кнопкой ниже (или через меню бота), чтобы начать партию.';

async function handleStartCommand(botToken: string, message: TelegramMessage): Promise<void> {
  await sendTelegramMessage(botToken, message.chat.id, WELCOME_TEXT, {
    inline_keyboard: [[{ text: 'Открыть Лилу', web_app: { url: MINI_APP_URL } }]],
  });
}

/**
 * Всегда возвращает 200, если секрет верный, — ЗА ИСКЛЮЧЕНИЕМ обработки
 * successful_payment (см. handleSuccessfulPayment выше): это единственная
 * ветка, где сбой должен дать Telegram повод повторить доставку, потому что
 * деньги уже получены и просто "забыть" про них нельзя. Остальные типы
 * апдейтов (в т.ч. pre_checkout_query и subscription) — как и раньше,
 * ошибка внутри них не должна ронять ответ на весь вебхук не-200:
 * Telegram ретраит доставку, если вебхук ответил ошибкой; отвечать не-200
 * стоит ТОЛЬКО на реальный сбой, который стоит повторить, а не на "мы
 * просто не обрабатываем такой апдейт" или на некритичный сбой.
 */
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
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const text = update.message?.text?.trim();
  if (update.message && text?.startsWith('/start')) {
    try {
      await handleStartCommand(botToken, update.message);
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
