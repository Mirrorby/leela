import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameSessionController } from './gameSessionController';
import { recoverSession } from './recoverSession';
import { clearPendingOperation, loadPendingStart, loadPendingRoll, prepareStart, prepareRoll } from './pendingOperations';
import { getStorageOwner, setStorageOwner } from '../storage/localStorage';
import { getActivePersistedGameId, loadPersistedGame, persistGame, setActivePersistedGameId } from './persistence';
import { makeGame, makeSnapshot, memoryStorage, deferred } from '../testUtils/fixtures';
import { WorkerApiError, type RollResult } from '../api/workerClient';
import { processRoll } from '../game/gameEngine';
import { getRuleset } from '../game/ruleset';
import { setLanguagePreference } from '../i18n/language';

describe('durable game mutations', () => {
  let storage: ReturnType<typeof memoryStorage>;
  const offline = () => new WorkerApiError('lost response', 0, null);
  const me = async () => ({ telegramId: '111' });
  beforeEach(() => {
    storage = memoryStorage(); vi.stubGlobal('window', { localStorage: storage });
    setStorageOwner('111'); setLanguagePreference('ru');
  });
  afterEach(() => { setStorageOwner(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function creationServer() {
    const games = new Map<string, ReturnType<typeof makeGame>>(); let credits = 2; let lose = true;
    const create = vi.fn(async (request: string, diceMode: 'physical' | 'virtual', id: string) => {
      // The operation has to be durable before the first byte is sent.
      expect(loadPendingStart()).toMatchObject({ id, request, mode: diceMode });
      if (!games.has(id)) { games.set(id, makeGame({ id: 'created-' + id, request, diceMode })); credits--; }
      if (lose) { lose = false; throw offline(); }
      return games.get(id)!;
    });
    return { create, games, credits: () => credits };
  }
  it('recovers creation accepted before a lost response without a new game or debit', async () => {
    const server = creationServer();
    const first = createGameSessionController({ create: server.create, roll: vi.fn(), get: vi.fn() });
    first.setRequest('Original intention'); first.setDiceMode('physical');
    await expect(first.startGame()).rejects.toMatchObject({ status: 0 });
    const pending = loadPendingStart()!;
    first.cancelPending(); // The old controller is discarded during a reload.
    const recovered = await recoverSession(() => true, { me, game: vi.fn(), create: server.create });
    expect(server.create.mock.calls[1]).toEqual(server.create.mock.calls[0]);
    expect(server.games.size).toBe(1); expect(server.credits()).toBe(1);
    expect(recovered?.record?.game).toMatchObject({ request: 'Original intention', diceMode: 'physical' });
    expect(getActivePersistedGameId()).toBe(recovered?.record?.id);
    expect(loadPersistedGame(recovered!.record!.id)).not.toBeNull();
    expect(loadPendingStart()).toBeNull();
    const next = createGameSessionController({ create: server.create, roll: vi.fn(), get: vi.fn() });
    next.setRequest('A new intention'); await next.startGame();
    expect(server.create.mock.calls[2][2]).not.toBe(pending.id);
    expect(server.games.size).toBe(2); expect(server.credits()).toBe(0);
  });
  it('reset, edited text and a new controller cannot discard an unconfirmed creation', async () => {
    const server = creationServer();
    const first = createGameSessionController({ create: server.create, roll: vi.fn(), get: vi.fn() });
    first.setRequest('original'); await first.startGame().catch(() => {}); first.reset();
    const second = createGameSessionController({ create: server.create, roll: vi.fn(), get: vi.fn() });
    second.setRequest('edited'); await second.startGame({ diceMode: 'physical' });
    expect(server.create.mock.calls[1]).toEqual(server.create.mock.calls[0]);
    expect(second.getSnapshot().game?.request).toBe('original'); expect(server.credits()).toBe(1);
  });
  it('retries an interrupted recovery after another reload using the same journal', async () => {
    const pending = prepareStart('original', 'physical');
    const create = vi.fn().mockRejectedValueOnce(offline()).mockResolvedValue(makeGame());
    await expect(recoverSession(() => true, { me, game: vi.fn(), create })).rejects.toMatchObject({ status: 0 });
    expect(loadPendingStart()?.id).toBe(pending.id);
    await recoverSession(() => true, { me, game: vi.fn(), create });
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]); expect(loadPendingStart()).toBeNull();
  });
  it('keeps the original key after an acknowledgement if storing progress fails', async () => {
    const create = vi.fn().mockResolvedValue(makeGame());
    const controller = createGameSessionController({ create, roll: vi.fn(), get: vi.fn() });
    const write = storage.setItem;
    storage.setItem = (key, value) => { if (key.includes(':game:')) throw Error('quota'); write(key, value); };
    controller.setRequest('original'); await controller.startGame();
    expect(loadPendingStart()).not.toBeNull();
    storage.setItem = write;
    const recovered = await recoverSession(() => true, { me, game: vi.fn(), create });
    expect(recovered?.record?.id).toBe('g1'); expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    expect(loadPendingStart()).toBeNull();
  });
  it('keeps creation private until this launch’s account is verified', async () => {
    const pending = prepareStart('private', 'physical'); const account = deferred<{ telegramId: string }>();
    const create = vi.fn().mockResolvedValue(makeGame());
    const recovery = recoverSession(() => true, { me: () => account.promise, game: vi.fn(), create });
    expect(getStorageOwner()).toBeNull(); expect(create).not.toHaveBeenCalled();
    account.resolve({ telegramId: '222' }); await recovery;
    expect(create).not.toHaveBeenCalled(); setStorageOwner('111'); expect(loadPendingStart()?.id).toBe(pending.id);
  });
  it('a cancelled recovery cannot clear the journal or change active progress', async () => {
    const pending = prepareStart('original', 'physical'); const gate = deferred<ReturnType<typeof makeGame>>();
    let current = true;
    const recovery = recoverSession(() => current, { me, game: vi.fn(), create: () => gate.promise });
    await Promise.resolve(); current = false; gate.resolve(makeGame());
    expect(await recovery).toBeNull(); expect(loadPendingStart()?.id).toBe(pending.id);
    expect(getActivePersistedGameId()).toBeNull();
  });
  it('a stale response cannot remove a newer operation or another account’s operation', () => {
    const old = prepareStart('old', 'virtual'); clearPendingOperation(old);
    const newer = prepareStart('new', 'virtual'); expect(clearPendingOperation(old)).toBe(false);
    expect(loadPendingStart()?.id).toBe(newer.id);
    setStorageOwner('222'); const other = prepareStart('other', 'physical');
    expect(clearPendingOperation(newer)).toBe(false); expect(loadPendingStart()?.id).toBe(other.id);
  });
  it.each([400, 402])('retires a definitively rejected creation (%s) before a corrected request', async status => {
    const create = vi.fn().mockRejectedValueOnce(new WorkerApiError('rejected', status, { error: status === 402 ? 'games_limit_reached' : 'invalid_body' })).mockResolvedValue(makeGame());
    const controller = createGameSessionController({ create, roll: vi.fn(), get: vi.fn() });
    controller.setRequest('original'); await controller.startGame().catch(() => {});
    expect(loadPendingStart()).toBeNull(); controller.setRequest('corrected'); await controller.startGame();
    expect(create.mock.calls[1][0]).toBe('corrected'); expect(create.mock.calls[1][2]).not.toBe(create.mock.calls[0][2]);
  });
  it('does not send any mutation when journalling fails', async () => {
    storage.setItem = () => { throw Error('quota'); };
    const create = vi.fn(), roll = vi.fn();
    const controller = createGameSessionController({ create, roll, get: vi.fn() });
    await expect(controller.startGame()).rejects.toMatchObject({ name: 'OperationStorageError' });
    controller.restore(makeSnapshot()); await expect(controller.roll()).rejects.toMatchObject({ name: 'OperationStorageError' });
    expect(create).not.toHaveBeenCalled(); expect(roll).not.toHaveBeenCalled(); expect(controller.getSnapshot().isBusy).toBe(false);
  });
  it.each(['{}', 'null', 'not-json', '{"version":1,"owner":"222","kind":"start","id":"old","mode":"physical","request":"foreign"}'])('does not replace a corrupted or foreign journal with a new charged request: %s', raw => {
    storage.raw.set('leela:v2:user:111:pending:start', raw);
    expect(() => prepareStart('new', 'virtual')).toThrow();
    expect(storage.raw.get('leela:v2:user:111:pending:start')).toBe(raw);
  });
  it.each([2, 6])('replays an accepted physical roll (%s) after reload without another move', async value => {
    let game = makeGame({ diceMode: 'physical' }); let applied = 0; let lose = true;
    const results = new Map<string, RollResult>();
    const roll = vi.fn(async (_gameId: string, id: string, v?: number) => {
      if (!results.has(id)) { const next = processRoll(game, getRuleset('classic-v1'), v!, id); game = next.game; applied++; results.set(id, { ...next, value: v! }); }
      if (lose) { lose = false; throw offline(); }
      return results.get(id)!;
    });
    const first = createGameSessionController({ create: vi.fn(), roll, get: async () => game });
    first.restore(makeSnapshot(game)); persistGame(makeSnapshot(game)); setActivePersistedGameId(game.id);
    await first.roll(value).catch(() => {});
    const pending = loadPendingRoll(game.id)!; expect(pending.value).toBe(value);
    const recovered = await recoverSession(() => true, { me, game: async () => game, roll });
    expect(roll.mock.calls[1]).toEqual([game.id, pending.id, value, 'physical']);
    expect(applied).toBe(1); expect(recovered?.record?.game).toEqual(game); expect(loadPendingRoll(game.id)).toBeNull();
  });
  it('preserves physical payload when retrying in a new controller after a mode change', async () => {
    prepareRoll('g1', 'physical', 6);
    const roll = vi.fn().mockResolvedValue({ game: makeGame(), events: [], value: 6 });
    const controller = createGameSessionController({ create: vi.fn(), roll, get: vi.fn() });
    controller.restore(makeSnapshot()); controller.setDiceMode('virtual'); await controller.roll(2);
    expect(roll.mock.calls[0].slice(2)).toEqual([6, 'physical']);
  });
});
