import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import { buildSignedInitData, freshAuthDate, TEST_BOT_TOKEN } from '../testUtils/signInitData';
import { createNewGame, processRoll } from '../game/gameEngine';
import { getRuleset } from '../game/rulesetLoader';
import { insertGame } from './repository';
import { getOrCreateUserBalance } from '../payments/repository';
import { isGameState } from '../../../src/game/validateGameState';
import type { GameState } from '../types/game';

describe('resume old stored games with an exhausted balance', () => {
  let database: ReturnType<typeof createSqliteD1>;
  let env: Env;
  let auth: string;
  const rules = getRuleset('classic-v1')!;
  const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
  beforeEach(async () => {
    database = createSqliteD1();
    env = { DB: database.db, BOT_TOKEN: TEST_BOT_TOKEN, WEBHOOK_SECRET: 'dummy', GEMINI_API_KEY: 'dummy' };
    auth = 'tma ' + await buildSignedInitData({ auth_date: freshAuthDate(), user: JSON.stringify({ id: 111 }) });
    await getOrCreateUserBalance(env.DB, '111');
    database.sqlite.exec("UPDATE user_balances SET free_games_remaining = 0, paid_games = 0 WHERE telegram_id = '111'");
  });
  afterEach(() => database.sqlite.close());
  const call = (path: string, body?: unknown) => worker.fetch(new Request('https://example/api/v1' + path, {
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  }), env, ctx);
  const balance = () => database.sqlite.prepare("SELECT * FROM user_balances WHERE telegram_id = '111'").get();
  function newGame(id: string) { return createNewGame({ id, ruleset: rules, request: 'old question', diceMode: 'physical' }); }

  it.each([null, 0])('opens an old unborn row with current_cell=%s and can birth it without buying a new game', async cell => {
    database.sqlite.prepare(`INSERT INTO games
      (id, telegram_id, status, ruleset_id, ruleset_version, dice_mode, current_cell, is_born, created_at, updated_at, request)
      VALUES ('old-unborn', '111', 'WAITING_FOR_BIRTH', 'classic-v1', '1', 'physical', ?, 0, ?, ?, 'old question')`)
      .run(cell, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-08-01T00:00:00Z'));
    const originalBalance = balance();
    const read = await call('/games/old-unborn'); expect(read.status).toBe(200);
    const game = ((await read.json()) as { game: GameState }).game;
    expect(isGameState(game)).toBe(true); expect(game.currentCell).toBe(0);
    const missed = await call('/games/old-unborn/rolls', { value: 2, diceMode: 'physical', clientEventId: 'miss' });
    expect(missed.status).toBe(200);
    expect(((await missed.json()) as { game: GameState }).game.status).toBe('WAITING_FOR_BIRTH');
    const born = await call('/games/old-unborn/rolls', { value: 6, diceMode: 'physical', clientEventId: 'born' });
    expect(born.status).toBe(200);
    const resumed = ((await born.json()) as { game: GameState }).game;
    expect(isGameState(resumed)).toBe(true);
    expect(resumed).toMatchObject({ id: 'old-unborn', status: 'IN_PROGRESS', isBorn: true, currentCell: 1 });
    expect(balance()).toEqual(originalBalance);
    expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM games').get()?.n).toBe(1);
  });

  it('lists and continues a four-six series alongside an unborn game without touching the balance', async () => {
    let game = newGame('old-series');
    for (let i = 0; i < 5; i++) game = processRoll(game, rules, 6, `six-${i}`).game;
    expect(game.consecutiveSixes).toBe(4);
    await insertGame(env.DB, game, '111'); await insertGame(env.DB, newGame('unborn'), '111');
    const originalBalance = balance();
    const page = await call('/games'); expect(page.status).toBe(200);
    const games = ((await page.json()) as { games: GameState[] }).games;
    expect(games).toHaveLength(2); expect(games.every(isGameState)).toBe(true);
    const response = await call('/games/old-series/rolls', { value: 4, diceMode: 'physical', clientEventId: 'continued' });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { game: GameState; events: { type: string }[] };
    expect(isGameState(result.game)).toBe(true);
    expect(result.game.id).toBe(game.id);
    expect(result.events.some(event => event.type === 'TRIPLE_SIX_RESET')).toBe(false);
    expect(result.game.currentTurnRolls).toHaveLength(0);
    expect(balance()).toEqual(originalBalance);
    expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM games').get()?.n).toBe(2);
  });
});
