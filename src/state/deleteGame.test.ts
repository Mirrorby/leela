import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteGameAndCache } from './deleteGame';
import { setStorageOwner } from '../storage/localStorage';
import { persistGame, loadPersistedGame, setActivePersistedGameId, getActivePersistedGameId } from './persistence';
import { prepareStart, prepareRoll, loadPendingStart, loadPendingRoll } from './pendingOperations';
import { makeSnapshot, memoryStorage, deferred } from '../testUtils/fixtures';

describe('acknowledged server deletion and device cache', () => {
  beforeEach(() => { vi.stubGlobal('window', { localStorage: memoryStorage() }); setStorageOwner('111'); persistGame(makeSnapshot()); setActivePersistedGameId('g1'); });
  afterEach(() => { setStorageOwner(null); vi.unstubAllGlobals(); });
  it('waits for acknowledgement, clears related operations and active cache only', async () => {
    const start = prepareStart('test', 'virtual'); prepareRoll('g1', 'virtual');
    const response = deferred<{ deleted: true; clientRequestId: string | null }>();
    const deletion = deleteGameAndCache('g1', () => response.promise);
    expect(loadPersistedGame('g1')).not.toBeNull();
    response.resolve({ deleted: true, clientRequestId: start.id }); await deletion;
    expect(loadPersistedGame('g1')).toBeNull(); expect(getActivePersistedGameId()).toBeNull();
    expect(loadPendingStart()).toBeNull(); expect(loadPendingRoll('g1')).toBeNull();
  });
  it('leaves the cache and journal intact after a network failure', async () => {
    prepareRoll('g1', 'virtual');
    await expect(deleteGameAndCache('g1', async () => { throw Error('offline'); })).rejects.toThrow('offline');
    expect(loadPersistedGame('g1')).not.toBeNull(); expect(getActivePersistedGameId()).toBe('g1'); expect(loadPendingRoll('g1')).not.toBeNull();
  });
  it('does not clear another game’s pending start or active pointer', async () => {
    const pending = prepareStart('another', 'virtual'); setActivePersistedGameId('g2');
    await deleteGameAndCache('g1', async () => ({ deleted:true, clientRequestId:'old-key' }));
    expect(loadPendingStart()?.id).toBe(pending.id); expect(getActivePersistedGameId()).toBe('g2');
  });
  it('fences acknowledgement after an account switch', async () => {
    const response = deferred<{ deleted: true; clientRequestId: string | null }>();
    const deletion = deleteGameAndCache('g1', () => response.promise);
    setStorageOwner('222'); persistGame(makeSnapshot()); setActivePersistedGameId('g1');
    response.resolve({ deleted:true, clientRequestId:null });
    await expect(deletion).rejects.toThrow();
    expect(loadPersistedGame('g1')).not.toBeNull(); expect(getActivePersistedGameId()).toBe('g1');
  });
});
