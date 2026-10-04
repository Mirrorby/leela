import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import { ensureFreeGamePolicy } from './freeGamePolicy';
import { getOrCreateUserBalance } from './repository';
describe('one free game rollout', () => {
  let d: ReturnType<typeof createSqliteD1>;
  beforeEach(() => { d = createSqliteD1(); });
  afterEach(() => d.sqlite.close());
  const seed = (n: number) => d.db.prepare('INSERT INTO user_balances VALUES (?, ?, 1, 5, 3, 1, 0, 0)').bind(String(n), n).run();
  it('adjusts old allowances once and leaves paid credits and free review intact', async () => {
    for (const n of [0, 1, 2, 3]) await seed(n);
    d.sqlite.exec('DROP TABLE application_policies');
    await Promise.all([ensureFreeGamePolicy(d.db), ensureFreeGamePolicy(d.db)]);
    await ensureFreeGamePolicy(d.db);
    const rows = d.sqlite.prepare('SELECT * FROM user_balances ORDER BY telegram_id').all();
    expect(rows.map(r => r.free_games_remaining)).toEqual([0, 0, 1, 1]);
    for (const row of rows) expect(row).toMatchObject({ free_ai_reviews_remaining: 1, paid_games: 5, paid_ai_reviews: 3 });
    expect((await getOrCreateUserBalance(d.db, 'new')).free_games_remaining).toBe(1);
  });
  it('rolls back the marker on adjustment failure and retries safely', async () => {
    await seed(2);
    d.sqlite.exec("CREATE TRIGGER fail_policy BEFORE UPDATE ON user_balances BEGIN SELECT RAISE(ABORT, 'injected'); END");
    await expect(ensureFreeGamePolicy(d.db)).rejects.toThrow('injected');
    expect(d.sqlite.prepare('SELECT * FROM application_policies').all()).toEqual([]);
    d.sqlite.exec('DROP TRIGGER fail_policy');
    await ensureFreeGamePolicy(d.db);
    expect((await getOrCreateUserBalance(d.db, '2')).free_games_remaining).toBe(1);
  });
});
