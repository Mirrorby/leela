import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import { cleanExpiredRateLimits, consumeRateLimit, RATE_LIMITS } from './rateLimit';

describe('persistent atomic rate limits', () => {
  const databases: ReturnType<typeof createSqliteD1>[] = [];
  function database() { const database = createSqliteD1(); databases.push(database); return database; }
  afterEach(() => { vi.restoreAllMocks(); databases.splice(0).forEach(({ sqlite }) => sqlite.close()); });

  it('shares one budget across concurrent requests and separate Worker binding objects', async () => {
    const { db, sqlite } = database();
    const otherIsolate = { ...db } as D1Database;
    const results = await Promise.all(Array.from({ length: RATE_LIMITS.create + 15 }, (_, index) =>
      consumeRateLimit(index % 2 ? db : otherIsolate, '111', 'create', 120_123)));
    expect(results.filter(result => result === null)).toHaveLength(RATE_LIMITS.create);
    expect(results.filter(result => result !== null)).toEqual(Array(15).fill(60));
    expect(sqlite.prepare('SELECT requests FROM api_rate_limits').get()).toMatchObject({ requests: RATE_LIMITS.create });
    expect(await consumeRateLimit(db, '222', 'create', 120_123)).toBeNull();
    expect(await consumeRateLimit(db, '111', 'roll', 120_123)).toBeNull();
  });

  it('resets at the next window while keeping one row and supplies the remaining wait time', async () => {
    const { db, sqlite } = database();
    for (let i = 0; i < RATE_LIMITS.analysis; i++) expect(await consumeRateLimit(db, '111', 'analysis', 120_000)).toBeNull();
    expect(await consumeRateLimit(db, '111', 'analysis', 179_100)).toBe(1);
    expect(await consumeRateLimit(db, '111', 'analysis', 180_000)).toBeNull();
    expect(sqlite.prepare('SELECT * FROM api_rate_limits').all()).toEqual([
      expect.objectContaining({ telegram_id: '111', requests: 1, window_start: 180_000 }),
    ]);
  });

  it('creates its rollout schema without a manually applied migration and retries failed initialization', async () => {
    const { db, sqlite } = database(); sqlite.exec('DROP TABLE api_rate_limits');
    vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('temporary outage'));
    await expect(consumeRateLimit(db, '111', 'api')).rejects.toThrow('temporary outage');
    expect(await consumeRateLimit(db, '111', 'api')).toBeNull();
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_api_rate_limits_expiry'").get()).toBeTruthy();
  });

  it('cron removes only expired counters', async () => {
    const { db, sqlite } = database();
    await consumeRateLimit(db, 'old', 'api', Date.now() - 2 * 86400_000);
    await consumeRateLimit(db, 'active', 'api'); await cleanExpiredRateLimits(db);
    expect(sqlite.prepare('SELECT telegram_id FROM api_rate_limits').all()).toEqual([{ telegram_id: 'active' }]);
  });
});
