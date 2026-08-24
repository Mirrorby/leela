/**
 * Обработчик вебхука Telegram-бота.
 * Документация: https://core.telegram.org/bots/api#setwebhook
 *
 * Telegram подписывает КАЖДЫЙ запрос к вебхуку заголовком
 * X-Telegram-Bot-Api-Secret-Token — значением, которое мы сами укажем при
 * регистрации через setWebhook (secret_token). Без сверки этого заголовка
 * кто угодно мог бы слать сюда поддельные "апдейты" от имени бота.
 */

const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';
const MINI_APP_URL = 'https://mirrorby.github.io/leela/';

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { id: number; first_name?: string };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
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
 * Всегда возвращает 200, если секрет верный, — даже для необработанных
 * типов апдейтов и команд. Telegram ретраит доставку, если вебхук ответил
 * ошибкой; отвечать не-200 стоит ТОЛЬКО на реальный сбой на нашей стороне,
 * а не на "мы просто не обрабатываем такой апдейт".
 */
export async function handleTelegramWebhook(
  request: Request,
  botToken: string,
  webhookSecret: string
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

  return Response.json({ ok: true });
}
