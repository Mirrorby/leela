import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerApiError } from '../api/workerClient';
import { setStorageOwner, getStorageOwner, hideGameId } from '../storage/localStorage';
import { makeGame, makeSnapshot, memoryStorage, deferred } from '../testUtils/fixtures';
import { loadPersistedGame, persistGame, setActivePersistedGameId, getActivePersistedGameId, snapshotFromServer } from './persistence';
import { recoverSession } from './recoverSession';
import { loadHistoryPage } from './historyRecovery';

describe('verified account history recovery', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    setStorageOwner('111');
  });
  afterEach(() => { setStorageOwner(null); vi.unstubAllGlobals(); });
  const cached = () => { persistGame(makeSnapshot()); setActivePersistedGameId('g1'); };
  const me = async () => ({ telegramId: '111' });
  it('keeps game, active pointer and hidden history private to each account', () => {
    cached(); hideGameId('g1'); setStorageOwner('222');
    expect(loadPersistedGame('g1')).toBeNull(); expect(getActivePersistedGameId()).toBeNull();
    setStorageOwner(null); expect(persistGame(makeSnapshot())).toBe(false);
    setStorageOwner('111'); expect(loadPersistedGame('g1')?.game.request).toBe('test');
  });
  it.each(['{}', 'null', '[]', '{"id":"g1","game":{}}'])('rejects valid JSON of the wrong shape: %s', raw => {
    cached(); storage.raw.set('leela:v2:user:111:game:g1', raw);
    expect(loadPersistedGame('g1')).toBeNull();
  });
  it.each(['owner', 'rules', 'turns', 'events', 'move', 'date'])('rejects corrupted %s in a snapshot', field => {
    cached(); const key = 'leela:v2:user:111:game:g1';
    const record = JSON.parse(storage.raw.get(key)!);
    if (field === 'owner') record.ownerTelegramId = '222';
    if (field === 'rules') record.game.rulesetId = 'missing';
    if (field === 'turns') record.game.turns = [null];
    if (field === 'events') record.lastEvents = [{ type: 'unknown' }];
    if (field === 'move') record.lastMove = { fromCell: -1, landedCell: 2, finalCell: 2 };
    if (field === 'date') record.game.updatedAt = 'invalid';
    storage.raw.set(key, JSON.stringify(record)); expect(loadPersistedGame('g1')).toBeNull();
  });
  it('verifies the account before reading private cache and recovers corrupt active data from the server', async () => {
    cached(); storage.raw.set('leela:v2:user:111:game:g1', '{}');
    const account = deferred<{ telegramId: string }>();
    const game = vi.fn().mockResolvedValue(makeGame());
    const promise = recoverSession(() => true, { me: () => account.promise, game });
    expect(getStorageOwner()).toBeNull(); expect(game).not.toHaveBeenCalled();
    account.resolve({ telegramId: '111' });
    expect((await promise)?.record?.id).toBe('g1'); expect(game).toHaveBeenCalledWith('g1');
  });
  it('uses legacy active ID only after server ownership verification, never the old snapshot', async () => {
    storage.raw.set('leela:v1:activeGameId', 'foreign');
    storage.raw.set('leela:v1:game:foreign', JSON.stringify(makeSnapshot(makeGame({ request: 'private' }))));
    const result = await recoverSession(() => true, { me, game: async () => { throw new WorkerApiError('not_found', 404, null); } });
    expect(result?.record).toBeNull(); expect(storage.raw.get('leela:v1:activeGameId')).toBeUndefined();
  });
  it.each([401, 403, 404, 502])('does not use cached data for auth/not-found/invalid-shape error %s', async status => {
    cached();
    const error = new WorkerApiError('bad', status, status === 502 ? { error: 'invalid_response' } : null);
    expect((await recoverSession(() => true, { me, game: async () => { throw error; } }))?.record).toBeNull();
  });
  it('permits offline recovery only after confirming the same account', async () => {
    cached();
    const result = await recoverSession(() => true, { me, game: async () => { throw new WorkerApiError('offline', 0, null); } });
    expect(result?.record?.id).toBe('g1'); expect(result?.notice).toContain('Нет связи');
  });
  it('cancels late account confirmation without switching cache owner', async () => {
    const gate = deferred<{ telegramId: string }>(); let current = true;
    const promise = recoverSession(() => current, { me: () => gate.promise, game: async () => makeGame() });
    current = false; setStorageOwner('222'); gate.resolve({ telegramId: '111' });
    expect(await promise).toBeNull(); expect(getStorageOwner()).toBe('222');
  });
  it('clears stale animation data after server progress changes', () => {
    const record = { ...makeSnapshot(), lastRollValue: 6, lastEvents: [{ type: 'MOVE' as const }], lastMove: { fromCell: 1, landedCell: 7, finalCell: 7 } };
    const fresh = snapshotFromServer(makeGame({ currentCell: 8 }), record);
    expect(fresh).toMatchObject({ lastEvents: [], lastMove: null, lastRollValue: null });
  });
  it('retrieves history on a device with no local snapshots', async () => {
    const page = await loadHistoryPage({}, () => true, async () => ({ games: [makeGame()], nextCursor: null }));
    expect(page.entries).toHaveLength(1); expect(loadPersistedGame('g1')).not.toBeNull();
  });
  it('does not fall back to local history when authentication fails', async () => {
    cached();
    await expect(loadHistoryPage({}, () => true, async () => { throw new WorkerApiError('auth', 401, null); })).rejects.toMatchObject({ status: 401 });
  });
  it('does not resurrect hidden rows or cache responses after account switching', async () => {
    const page = deferred<{ games: ReturnType<typeof makeGame>[]; nextCursor: null }>();
    const pending = loadHistoryPage({}, () => true, () => page.promise);
    hideGameId('g1'); page.resolve({ games: [makeGame()], nextCursor: null });
    expect((await pending).entries).toEqual([]);
    const switched = deferred<{ games: ReturnType<typeof makeGame>[]; nextCursor: null }>();
    const late = loadHistoryPage({}, () => true, () => switched.promise);
    setStorageOwner('222'); switched.resolve({ games: [makeGame()], nextCursor: null });
    await expect(late).rejects.toMatchObject({ name: 'SessionSupersededError' });
    expect(loadPersistedGame('g1')).toBeNull();
  });
});
