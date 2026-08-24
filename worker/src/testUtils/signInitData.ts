export const TEST_BOT_TOKEN = 'test-bot-token-123456:ABCDEF';

async function hmacSha256Hex(rawKey: BufferSource, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Собирает валидный (реально подписанный) initData — независимая от
 * production-кода (validateInitData.ts) реализация того же алгоритма
 * Telegram, чтобы тесты не могли "случайно совпасть" с багом в самой
 * проверке. Используется несколькими тестовыми файлами.
 */
export async function buildSignedInitData(
  fields: Record<string, string>,
  botToken: string = TEST_BOT_TOKEN
): Promise<string> {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  const secretKey = await crypto.subtle
    .importKey('raw', new TextEncoder().encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((key) => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(botToken)));

  const hash = await hmacSha256Hex(secretKey, dataCheckString);
  return new URLSearchParams({ ...fields, hash }).toString();
}

export function freshAuthDate(offsetSeconds = 0): string {
  return String(Math.floor(Date.now() / 1000) + offsetSeconds);
}
