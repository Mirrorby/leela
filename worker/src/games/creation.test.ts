import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../index';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import { buildSignedInitData, freshAuthDate, TEST_BOT_TOKEN } from '../testUtils/signInitData';
import { getOrCreateUserBalance } from '../payments/repository';
import { createNewGame } from '../game/gameEngine';
import { getRuleset } from '../game/rulesetLoader';
import { createGameWithCharge } from './repository';

describe('atomic game creation on real SQLite', () => {
  let database: ReturnType<typeof createSqliteD1>;
  let env: Env;
  let auth: string;
  beforeEach(async () => {
    database = createSqliteD1();
    env = { DB: database.db, BOT_TOKEN: TEST_BOT_TOKEN, WEBHOOK_SECRET: 'test', GEMINI_API_KEY: 'test' };
    auth = 'tma ' + await buildSignedInitData({ auth_date: freshAuthDate(), user: JSON.stringify({ id: 111 }) });
    await getOrCreateUserBalance(env.DB, '111');
  });
  afterEach(() => { vi.restoreAllMocks(); database.sqlite.close(); });
  const balance = () => database.sqlite.prepare('SELECT free_games_remaining, paid_games FROM user_balances').get();
  const count = () => database.sqlite.prepare('SELECT COUNT(*) AS n FROM games').get()?.n;
  const create = (id: string) => worker.fetch(new Request('https://example/api/v1/games', {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: 'test', diceMode: 'physical', clientRequestId: id }),
  }), env, {} as ExecutionContext);

  it('does not debit on an INSERT failure; the same key can be retried safely', async () => {
    database.sqlite.exec("CREATE TRIGGER fail_game BEFORE INSERT ON games BEGIN SELECT RAISE(ABORT, 'failed insert'); END");
    await expect(create('retry')).rejects.toThrow('failed insert');
    expect(balance()).toEqual({ free_games_remaining: 1, paid_games: 0 });
    expect(count()).toBe(0);
    database.sqlite.exec('DROP TRIGGER fail_game');
    expect((await create('retry')).status).toBe(201);
    expect((await create('retry')).status).toBe(200);
    expect(balance()).toEqual({ free_games_remaining: 0, paid_games: 0 });
    expect(count()).toBe(1);
  });

  it('rolls back the inserted game if the debit fails', async () => {
    database.sqlite.exec("CREATE TRIGGER fail_debit BEFORE UPDATE ON user_balances BEGIN SELECT RAISE(ABORT, 'failed debit'); END");
    await expect(create('debit')).rejects.toThrow('failed debit');
    expect(balance()).toEqual({ free_games_remaining: 1, paid_games: 0 });
    expect(count()).toBe(0);
    database.sqlite.exec('DROP TRIGGER fail_debit');
    expect((await create('debit')).status).toBe(201);
    expect(count()).toBe(1);
  });

  it('concurrent requests with the same key return one game and debit once', async () => {
    const responses = await Promise.all([create('parallel'), create('parallel'), create('parallel')]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const bodies = await Promise.all(responses.map((r) => r.json() as Promise<{ game: { id: string } }>));
    expect(new Set(bodies.map((r) => r.game.id)).size).toBe(1);
    expect(balance()).toEqual({ free_games_remaining: 0, paid_games: 0 });
    expect(count()).toBe(1);
  });

  it('a delayed request returns the other request\'s game without a second charge', async () => {
    // Initialize admission middleware before gating the actual game/debit
    // transaction; concurrent requests intentionally share schema setup.
    await worker.fetch(new Request('https://example/api/v1/me', { headers: { Authorization: auth } }), env, {} as ExecutionContext);
    const original = env.DB.batch.bind(env.DB);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
      entered(); await gate; return original(statements);
    });
    const first = create('delayed'); await reached;
    const second = await create('delayed'); release();
    expect(second.status).toBe(201);
    expect((await first).status).toBe(200);
    expect(balance()).toEqual({ free_games_remaining: 0, paid_games: 0 });
    expect(count()).toBe(1);
  });

  it('two different requests cannot spend the last paid credit twice', async () => {
    database.sqlite.exec('UPDATE user_balances SET free_games_remaining=0, paid_games=1');
    const responses = await Promise.all([create('a'), create('b')]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 402]);
    expect(balance()).toEqual({ free_games_remaining: 0, paid_games: 0 });
    expect(count()).toBe(1);
  });

  it('spends the last free credit without also spending a paid credit', async () => {
    database.sqlite.exec('UPDATE user_balances SET free_games_remaining=1, paid_games=3');
    expect((await create('free')).status).toBe(201);
    expect(balance()).toEqual({ free_games_remaining: 0, paid_games: 3 });
    expect((await create('paid')).status).toBe(201);
    expect(balance()).toEqual({ free_games_remaining: 0, paid_games: 2 });
  });

  it('returns an existing game even when no credits remain', async () => {
    database.sqlite.exec('UPDATE user_balances SET free_games_remaining=0, paid_games=1');
    expect((await create('last')).status).toBe(201);
    expect((await create('last')).status).toBe(200);
    expect(balance()).toEqual({ free_games_remaining: 0, paid_games: 0 });
  });

  it('preserves an already paid legacy period without spending free or paid credits', async () => {
    const now = Date.now();
    database.sqlite.prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('legacy', '111', now + 60000, 0, now, now);
    expect((await create('legacy-access')).status).toBe(201);
    expect(balance()).toEqual({ free_games_remaining: 1, paid_games: 0 });
  });

  it('does not debit twice even if an internal caller reuses the same UUID', async () => {
    const game = createNewGame({ id: 'fixed-id', ruleset: getRuleset('classic-v1')!, request: 'test', diceMode: 'physical' });
    expect((await createGameWithCharge(env.DB, game, '111', 'fixed-key')).created).toBe(true);
    expect((await createGameWithCharge(env.DB, game, '111', 'fixed-key')).created).toBe(false);
    expect(balance()).toEqual({ free_games_remaining: 0, paid_games: 0 });
  });
});
