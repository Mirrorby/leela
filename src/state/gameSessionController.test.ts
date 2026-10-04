import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createGameSessionController } from './gameSessionController';
import { makeGame, makeSnapshot, memoryStorage, deferred } from '../testUtils/fixtures';
import { WorkerApiError, type RollResult } from '../api/workerClient';
import { setStorageOwner } from '../storage/localStorage';
describe('game session request fencing', () => {
  beforeEach(() => { vi.stubGlobal('window', { localStorage: memoryStorage() }); setStorageOwner('111'); });
  afterEach(() => { setStorageOwner(null); vi.unstubAllGlobals(); });
  function fixture() {
    const create = vi.fn().mockResolvedValue(makeGame());
    const roll = vi.fn().mockResolvedValue({ game: makeGame(), events: [], value: 1 });
    const get = vi.fn().mockResolvedValue(makeGame());
    const controller = createGameSessionController({ create, roll, get });
    return { create, roll, get, controller };
  }
  it('late creation cannot restore a reset session or release a newer request', async () => {
    const f = fixture(); const first = deferred<ReturnType<typeof makeGame>>(); const second = deferred<ReturnType<typeof makeGame>>();
    f.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const old = f.controller.startGame().catch(e => e); f.controller.reset();
    const fresh = f.controller.startGame(); first.resolve(makeGame({ id: 'old' }));
    expect(await old).toMatchObject({ name: 'SessionSupersededError' });
    expect(f.controller.getSnapshot()).toMatchObject({ game: null, isBusy: true });
    second.resolve(makeGame({ id: 'new' })); await fresh;
    expect(f.controller.getSnapshot().game?.id).toBe('new');
  });
  it('late roll cannot replace another restored game', async () => {
    const f = fixture(); f.controller.restore(makeSnapshot()); const gate = deferred<RollResult>(); f.roll.mockReturnValue(gate.promise);
    const pending = f.controller.roll().catch(e => e); f.controller.restore(makeSnapshot(makeGame({ id: 'other' })));
    gate.resolve({ game: makeGame({ currentCell: 7 }), events: [], value: 6 });
    expect(await pending).toMatchObject({ name: 'SessionSupersededError' }); expect(f.controller.getSnapshot().game?.id).toBe('other');
  });
  it('locks duplicate mutation and reuses original key and payload after a lost response', async () => {
    const f = fixture(); f.controller.setRequest('original'); const gate = deferred<ReturnType<typeof makeGame>>(); f.create.mockReturnValueOnce(gate.promise);
    const first = f.controller.startGame().catch(e => e);
    await expect(f.controller.startGame()).rejects.toThrow('уже выполняется');
    f.controller.setRequest('edited'); gate.reject(new WorkerApiError('offline', 0, null)); await first;
    await f.controller.startGame({ diceMode: 'physical' });
    expect(f.create.mock.calls[1]).toEqual(f.create.mock.calls[0]); expect(f.create.mock.calls[1][0]).toBe('original');
  });
  it('roll retry preserves physical value and event ID', async () => {
    const f = fixture(); f.controller.restore(makeSnapshot(makeGame({ diceMode: 'physical' })));
    f.roll.mockRejectedValueOnce(new WorkerApiError('offline', 0, null));
    await expect(f.controller.roll(6)).rejects.toMatchObject({ status: 0 }); await f.controller.roll(2);
    expect(f.roll.mock.calls[1]).toEqual(f.roll.mock.calls[0]); expect(f.roll.mock.calls[1][2]).toBe(6);
  });
  it('late sync cannot overwrite a newer roll', async () => {
    const f = fixture(); f.controller.restore(makeSnapshot()); const gate = deferred<ReturnType<typeof makeGame>>(); f.get.mockReturnValue(gate.promise);
    const sync = f.controller.syncFromServer('g1'); f.roll.mockResolvedValue({ game: makeGame({ currentCell: 7 }), events: [], value: 6 });
    await f.controller.roll(); gate.resolve(makeGame({ currentCell: 1 })); await sync;
    expect(f.controller.getSnapshot().game?.currentCell).toBe(7);
  });
  it('version conflict resync cannot resurrect a reset game', async () => {
    const f = fixture(); f.controller.restore(makeSnapshot()); const gate = deferred<ReturnType<typeof makeGame>>(); f.get.mockReturnValue(gate.promise);
    f.roll.mockRejectedValue(new WorkerApiError('conflict', 409, { error: 'version_conflict' }));
    const pending = f.controller.roll().catch(e => e); await Promise.resolve(); await Promise.resolve();
    f.controller.reset(); gate.resolve(makeGame());
    expect(await pending).toMatchObject({ name: 'SessionSupersededError' }); expect(f.controller.getSnapshot().game).toBeNull();
  });
  it('cancelled history open cannot restore its game', async () => {
    const f = fixture(); const gate = deferred<ReturnType<typeof makeGame>>(); f.get.mockReturnValue(gate.promise);
    const pending = f.controller.openGame('g1').catch(e => e); f.controller.reset(); gate.resolve(makeGame());
    expect(await pending).toMatchObject({ name: 'SessionSupersededError' }); expect(f.controller.getSnapshot().game).toBeNull();
  });
  it('unauthorized open never restores offline cache and clears current session', async () => {
    const f = fixture(); f.controller.restore(makeSnapshot()); f.get.mockRejectedValue(new WorkerApiError('auth', 401, null));
    await expect(f.controller.openGame('g1')).rejects.toMatchObject({ status: 401 }); expect(f.controller.getSnapshot().game).toBeNull();
  });
  it.each([401, 404])('clears inaccessible game on roll error %s', async status => {
    const f = fixture(); f.controller.restore(makeSnapshot()); f.roll.mockRejectedValue(new WorkerApiError('denied', status, null));
    await expect(f.controller.roll()).rejects.toMatchObject({ status });
    expect(f.controller.getSnapshot()).toMatchObject({ game: null, isBusy: false });
  });
});
