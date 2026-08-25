/**
 * Проверка initData Telegram Mini App.
 * Алгоритм — из официальной документации:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key       = HMAC_SHA256(key = "WebAppData", data = botToken)
 *   data_check_string = все поля initData КРОМЕ hash, отсортированные по
 *                        ключу, в формате "key=value", объединённые "\n"
 *   ожидаемый hash    = HEX( HMAC_SHA256(key = secret_key, data = data_check_string) )
 *
 * Партия привязывается к telegram_id именно ОТСЮДА (user.id из initData),
 * а не из тела запроса — так нельзя дёрнуть чужую партию, подменив id в
 * JSON: подделать initData без знания BOT_TOKEN невозможно.
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ValidatedInitData {
  telegramId: string;
  user: TelegramUser;
  authDate: number;
}

/**
 * Причина отказа — НЕ секрет, безопасно показывать в ответе API как есть.
 * Не путать с самим BOT_TOKEN или содержимым initData — их сюда не кладём.
 * Ввёл после того, как единственным сигналом на проде было общее "invalid
 * or expired initData", по которому нельзя было отличить рассинхрон часов
 * от банально неверно скопированного секрета в Cloudflare — самая частая
 * причина именно hash_mismatch, а не что-то в самом алгоритме.
 */
export type InitDataFailureReason =
  | 'missing_bot_token'
  | 'unparseable'
  | 'missing_hash'
  | 'hash_mismatch'
  | 'missing_auth_date'
  | 'stale_auth_date'
  | 'missing_user'
  | 'malformed_user';

export type InitDataValidationResult =
  | ({ ok: true } & ValidatedInitData)
  | { ok: false; reason: InitDataFailureReason };

// initData Mini App выпускается заново при каждом открытии приложения —
// сутки с запасом достаточно, чтобы не мешать обычному использованию, но
// не принимать данные многодневной давности (например, слитые/залогированные).
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
// Небольшой запас на рассинхронизацию часов клиента/сервера в другую сторону.
const CLOCK_SKEW_TOLERANCE_SECONDS = 60;

async function hmacSha256(rawKey: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function validateInitData(initData: string, botToken: string): Promise<InitDataValidationResult> {
  if (!botToken) return { ok: false, reason: 'missing_bot_token' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };
  params.delete('hash');

  const dataCheckString = [...params.keys()]
    .sort()
    .map((key) => `${key}=${params.get(key)}`)
    .join('\n');

  const secretKey = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken);
  const expectedHash = toHex(await hmacSha256(secretKey, dataCheckString));

  if (expectedHash !== hash) return { ok: false, reason: 'hash_mismatch' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'missing_auth_date' };
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > MAX_INIT_DATA_AGE_SECONDS || ageSeconds < -CLOCK_SKEW_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale_auth_date' };
  }

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'missing_user' };

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return { ok: false, reason: 'malformed_user' };
  }
  if (!user || typeof user.id !== 'number') return { ok: false, reason: 'malformed_user' };

  return { ok: true, telegramId: String(user.id), user, authDate };
}

/** Достаёт initData из заголовка `Authorization: tma <initData>`. */
export function extractInitData(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;
  const match = header.match(/^tma\s+(.+)$/);
  return match ? match[1] : null;
}
