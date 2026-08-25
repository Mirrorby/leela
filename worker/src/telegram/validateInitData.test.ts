import { describe, it, expect } from 'vitest';
import { validateInitData, extractInitData } from './validateInitData';
import { buildSignedInitData, freshAuthDate, TEST_BOT_TOKEN as BOT_TOKEN } from '../testUtils/signInitData';

describe('validateInitData', () => {
  it('принимает корректно подписанный initData и возвращает telegramId/user', async () => {
    const initData = await buildSignedInitData({
      auth_date: freshAuthDate(),
      user: JSON.stringify({ id: 42, first_name: 'Никита', username: 'nikita' }),
      query_id: 'AAA123',
    });

    const result = await validateInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.telegramId).toBe('42');
      expect(result.user.username).toBe('nikita');
    }
  });

  it('отклоняет initData, подписанный ДРУГИМ токеном бота — reason: hash_mismatch', async () => {
    const initData = await buildSignedInitData(
      { auth_date: freshAuthDate(), user: JSON.stringify({ id: 42 }) },
      'wrong-token'
    );
    const result = await validateInitData(initData, BOT_TOKEN);
    expect(result).toEqual({ ok: false, reason: 'hash_mismatch' });
  });

  it('отклоняет initData с подделанным полем после подписи — reason: hash_mismatch', async () => {
    const initData = await buildSignedInitData({
      auth_date: freshAuthDate(),
      user: JSON.stringify({ id: 42 }),
    });
    // Подменяем user.id на чужой ПОСЛЕ подписи — классическая попытка угнать чужую партию.
    const tampered = initData.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":999'));
    const result = await validateInitData(tampered, BOT_TOKEN);
    expect(result).toEqual({ ok: false, reason: 'hash_mismatch' });
  });

  it('отклоняет initData без hash — reason: missing_hash', async () => {
    const params = new URLSearchParams({ auth_date: freshAuthDate(), user: JSON.stringify({ id: 1 }) });
    const result = await validateInitData(params.toString(), BOT_TOKEN);
    expect(result).toEqual({ ok: false, reason: 'missing_hash' });
  });

  it('отклоняет устаревший initData (auth_date старше 24 часов) — reason: stale_auth_date', async () => {
    const initData = await buildSignedInitData({
      auth_date: freshAuthDate(-25 * 60 * 60),
      user: JSON.stringify({ id: 42 }),
    });
    const result = await validateInitData(initData, BOT_TOKEN);
    expect(result).toEqual({ ok: false, reason: 'stale_auth_date' });
  });

  it('отклоняет initData без user — reason: missing_user', async () => {
    const initData = await buildSignedInitData({ auth_date: freshAuthDate() });
    const result = await validateInitData(initData, BOT_TOKEN);
    expect(result).toEqual({ ok: false, reason: 'missing_user' });
  });

  it('отклоняет пустой BOT_TOKEN — reason: missing_bot_token (сигнал, что секрет вообще не задан в Cloudflare)', async () => {
    const initData = await buildSignedInitData({ auth_date: freshAuthDate(), user: JSON.stringify({ id: 1 }) });
    const result = await validateInitData(initData, '');
    expect(result).toEqual({ ok: false, reason: 'missing_bot_token' });
  });

  it('extractInitData достаёт значение из заголовка "Authorization: tma <initData>"', () => {
    const req = new Request('https://example.com', { headers: { Authorization: 'tma foo=bar&hash=abc' } });
    expect(extractInitData(req)).toBe('foo=bar&hash=abc');
  });

  it('extractInitData возвращает null для отсутствующего или неверного заголовка', () => {
    expect(extractInitData(new Request('https://example.com'))).toBeNull();
    expect(
      extractInitData(new Request('https://example.com', { headers: { Authorization: 'Bearer xyz' } }))
    ).toBeNull();
  });
});
