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

export async function validateInitData(initData: string, botToken: string): Promise<ValidatedInitData | null> {
  if (!initData || !botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.keys()]
    .sort()
    .map((key) => `${key}=${params.get(key)}`)
    .join('\n');

  const secretKey = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken);
  const expectedHash = toHex(await hmacSha256(secretKey, dataCheckString));

  if (expectedHash !== hash) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return null;
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > MAX_INIT_DATA_AGE_SECONDS || ageSeconds < -CLOCK_SKEW_TOLERANCE_SECONDS) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return null;
  }
  if (!user || typeof user.id !== 'number') return null;

  return { telegramId: String(user.id), user, authDate };
}

/** Достаёт initData из заголовка `Authorization: tma <initData>`. */
export function extractInitData(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;
  const match = header.match(/^tma\s+(.+)$/);
  return match ? match[1] : null;
}
