import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_PROFILE, botLanguage, synchronizeBotProfile } from './profile';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import worker, { type Env } from '../index';

describe('Telegram profile localization', () => {
  let database: ReturnType<typeof createSqliteD1>;
  beforeEach(() => {
    database = createSqliteD1();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ ok: true, result: true }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); database.sqlite.close(); });

  it('installs English fallback, English and Russian metadata once, without sending messages', async () => {
    expect(await synchronizeBotProfile(database.db, '123:test-secret')).toBe(true);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(9);
    for (const language_code of ['', 'en', 'ru']) {
      const localized = calls.filter(([, init]) => JSON.parse(init!.body as string).language_code === language_code);
      expect(localized.map(([url]) => String(url).split('/').at(-1))).toEqual(['setMyDescription', 'setMyShortDescription', 'setMyCommands']);
      const copy = BOT_PROFILE[language_code === 'ru' ? 'ru' : 'en'];
      expect(JSON.parse(localized[0][1]!.body as string).description).toBe(copy.description);
      expect(JSON.parse(localized[1][1]!.body as string).short_description).toBe(copy.shortDescription);
      expect(JSON.parse(localized[2][1]!.body as string).commands).toEqual(copy.commands);
    }
    expect(database.sqlite.prepare('SELECT id FROM application_policies').get()?.id).not.toContain('test-secret');
    await synchronizeBotProfile(database.db, '123:rotated-secret');
    expect(fetch).toHaveBeenCalledTimes(9);
    await synchronizeBotProfile(database.db, '456:another-bot');
    expect(fetch).toHaveBeenCalledTimes(18);
  });

  it.each(['rejected', 'network', 'invalid-json', 'missing-result'])('retries a partial %s failure without recording success or leaking a token', async (failure) => {
    const mock = vi.mocked(fetch);
    mock.mockResolvedValueOnce(Response.json({ ok: true, result: true }));
    if (failure === 'network') mock.mockRejectedValueOnce(new Error('https://api.telegram.org/bot123:secret/setMyShortDescription'));
    else if (failure === 'invalid-json') mock.mockResolvedValueOnce(new Response('secret'));
    else mock.mockResolvedValueOnce(Response.json(failure === 'rejected' ? { ok: false, description: 'secret' } : { ok: true }, { status: failure === 'rejected' ? 400 : 200 }));
    expect(await synchronizeBotProfile(database.db, '123:secret')).toBe(false);
    expect(database.sqlite.prepare('SELECT * FROM application_policies').all()).toEqual([]);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('secret');
    expect(await synchronizeBotProfile(database.db, '123:secret')).toBe(true);
    expect(database.sqlite.prepare('SELECT * FROM application_policies').all()).toHaveLength(1);
  });

  it('keeps local cron isolated and installs metadata from production cron', async () => {
    await worker.scheduled({} as ScheduledController, { DB: database.db, BOT_TOKEN: '123:secret', ENVIRONMENT: 'development' } as Env);
    expect(fetch).not.toHaveBeenCalled();
    await worker.scheduled({} as ScheduledController, { DB: database.db, BOT_TOKEN: '123:secret', ENVIRONMENT: 'production' } as Env);
    expect(fetch).toHaveBeenCalledTimes(9);
    await worker.scheduled({} as ScheduledController, { DB: database.db, BOT_TOKEN: '123:secret', ENVIRONMENT: 'production' } as Env);
    expect(fetch).toHaveBeenCalledTimes(9);
  });

  it('fits Telegram description and command limits', () => {
    for (const copy of Object.values(BOT_PROFILE)) {
      expect([...copy.description].length).toBeLessThanOrEqual(512);
      expect([...copy.shortDescription].length).toBeLessThanOrEqual(120);
      for (const command of copy.commands) expect([...command.description].length).toBeLessThanOrEqual(256);
    }
  });

  it.each([
    ['ru', 'ru'], ['RU', 'ru'], ['ru-RU', 'ru'], [' ru_BY ', 'ru'],
    ['en', 'en'], ['en-US', 'en'], ['de', 'en'], ['russian', 'en'], ['', 'en'], [undefined, 'en'],
  ] as const)('resolves %s to %s', (code, expected) => expect(botLanguage(code)).toBe(expected));
});
