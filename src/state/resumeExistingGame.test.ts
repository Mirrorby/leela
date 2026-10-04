import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame, makeSnapshot, memoryStorage } from '../testUtils/fixtures';
import { getRuleset } from '../game/ruleset';
import { processRoll } from '../game/gameEngine';
import { isGameState } from '../game/validateGameState';
import { listGamesOnServer, getGameFromServer, rollOnServer, WorkerApiError } from '../api/workerClient';
import { persistGame, loadPersistedGame, setActivePersistedGameId } from './persistence';
import { createGameSessionController } from './gameSessionController';
import { recoverSession } from './recoverSession';
import { resolveGameScreen } from './resolveGameScreen';
import { setStorageOwner } from '../storage/localStorage';
import type { ScreenName } from '../navigation/types';

const rules = getRuleset('classic-v1');
function fourSixes() {
  let game = makeGame({ id: 'six-series', diceMode: 'physical' });
  for (let i = 0; i < 5; i++) game = processRoll(game, rules, 6, `six-${i}`).game;
  return game;
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

describe('resume existing games instead of reopening saved navigation', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => { storage = memoryStorage(); vi.stubGlobal('window', { localStorage: storage }); setStorageOwner('111'); });
  afterEach(() => { setStorageOwner(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(['MyGames', 'Splash', 'YourAccess', 'Summary', 'HowToPlay'] as ScreenName[])(
    'repairs old unborn snapshot saved on %s', async screen => {
      const game = makeGame({ id: 'old-unborn', diceMode: 'physical', createdAt: '2026-08-01T00:00:00.000Z' });
      const record = { ...makeSnapshot(game), screen };
      // Raw old v2 data must be healed on read, even if new writes change.
      storage.raw.set('leela:v2:user:111:game:old-unborn', JSON.stringify({ ...record, schemaVersion: 2, ownerTelegramId: '111' }));
      const create = vi.fn(); const roll = vi.fn(); const get = vi.fn().mockResolvedValue(game);
      const controller = createGameSessionController({ create, roll, get });
      const opened = await controller.openGame(game.id);
      expect(resolveGameScreen(opened.screen, opened.game)).toBe('GameHome');
      expect(controller.getSnapshot().game).toEqual(game);
      expect(create).not.toHaveBeenCalled(); expect(roll).not.toHaveBeenCalled();
      expect(loadPersistedGame(game.id)?.screen).toBe('GameHome');
    });

  it('resumes the board from a saved root History, whose Back button has no previous screen', async () => {
    const game = processRoll(makeGame(), rules, 6, 'born').game;
    persistGame({ ...makeSnapshot(game), screen: 'History' });
    const controller = createGameSessionController({ create: vi.fn(), roll: vi.fn(), get: async () => game });
    const opened = await controller.openGame(game.id);
    expect(opened.screen).toBe('GameHome');
  });

  it.each(['WAITING_FOR_BIRTH', 'IN_PROGRESS'] as const)('restart restores %s to a playable screen', async status => {
    const game = status === 'IN_PROGRESS' ? processRoll(makeGame(), rules, 6, 'born').game : makeGame();
    persistGame({ ...makeSnapshot(game), screen: 'MyGames' }); setActivePersistedGameId(game.id);
    const recovered = await recoverSession(() => true, { me: async () => ({ telegramId: '111' }), game: async () => game });
    expect(recovered?.record?.screen).toBe('GameHome');
    expect(recovered?.record?.game.id).toBe(game.id);
  });

  it('offline Continue also opens the board, not a previously saved History screen', async () => {
    const game = makeGame(); persistGame({ ...makeSnapshot(game), screen: 'History' });
    const controller = createGameSessionController({ create: vi.fn(), roll: vi.fn(), get: async () => { throw new WorkerApiError('offline', 0, null); } });
    expect((await controller.openGame(game.id)).screen).toBe('GameHome');
  });

  it.each(['FINISHED', 'ARCHIVED'] as const)('opens %s at Summary regardless of its old menu screen', async status => {
    const game = makeGame({ status, isBorn: true, currentCell: 68 });
    persistGame({ ...makeSnapshot(game), screen: 'MyGames' });
    const controller = createGameSessionController({ create: vi.fn(), roll: vi.fn(), get: async () => game });
    expect((await controller.openGame(game.id)).screen).toBe('Summary');
  });

  it('restores an old shared active ID using only the owned server state', async () => {
    const game = makeGame({ id: 'old-unborn' });
    storage.raw.set('leela:v1:activeGameId', game.id);
    storage.raw.set('leela:v1:game:' + game.id, JSON.stringify({ ...makeSnapshot(game), screen: 'RequestInput' }));
    const recovered = await recoverSession(() => true, { me: async () => ({ telegramId: '111' }), game: async () => game });
    expect(recovered?.record).toMatchObject({ id: game.id, screen: 'GameHome', game: { status: 'WAITING_FOR_BIRTH' } });
    expect(loadPersistedGame(game.id)?.screen).toBe('GameHome');
  });

  it('accepts engine-produced four-six state in cache, game read, list and next roll response', async () => {
    const game = fourSixes(); expect(game.consecutiveSixes).toBe(4);
    expect(isGameState(game)).toBe(true); expect(persistGame(makeSnapshot(game))).toBe(true);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ games: [makeGame(), game], nextCursor: null }));
    expect((await listGamesOnServer()).games).toHaveLength(2);
    fetch.mockResolvedValue(json({ game })); expect(await getGameFromServer(game.id)).toEqual(game);
    fetch.mockResolvedValue(json({ game, events: [{ type: 'EXTRA_ROLL_GRANTED' }], value: 6 }));
    expect((await rollOnServer(game.id, 'roll')).game.consecutiveSixes).toBe(4);
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('still rejects an invalid six counter %s', consecutiveSixes => {
    expect(isGameState(makeGame({ consecutiveSixes }))).toBe(false);
  });

  it('accepts a longer six series produced by exact-landing overshoots', () => {
    let game = fourSixes();
    for (let i = 5; i < 15; i++) game = processRoll(game, rules, 6, `six-${i}`).game;
    expect(game.consecutiveSixes).toBe(14); expect(isGameState(game)).toBe(true);
  });

  it('preserves the open six series and finishes its next non-six roll without triple-six reset', async () => {
    const game = fourSixes();
    persistGame(makeSnapshot(game));
    const next = processRoll(game, rules, 4, 'next');
    const create = vi.fn(); const roll = vi.fn().mockResolvedValue({ ...next, value: 4 });
    const controller = createGameSessionController({ create, roll, get: async () => game });
    await controller.openGame(game.id); const result = await controller.roll(4);
    expect(result.events.some(event => event.type === 'TRIPLE_SIX_RESET')).toBe(false);
    expect(controller.getSnapshot().game).toEqual(next.game); expect(create).not.toHaveBeenCalled();
  });
});
