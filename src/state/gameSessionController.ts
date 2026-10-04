import type { DiceMode, GameState, RollEvent } from '../types/game';
import { createGameOnServer, getGameFromServer, rollOnServer, WorkerApiError } from '../api/workerClient';
import { getStorageOwner, setStorageOwner } from '../storage/localStorage';
import { isSessionSnapshot, loadPersistedGame, persistGame, snapshotFromServer, removePersistedGame, setActivePersistedGameId, type PersistedGame } from './persistence';
import { canUseOfflineCache } from './recoverSession';

export interface LastMove { fromCell: number; landedCell: number; finalCell: number; }
export interface SessionSnapshot {
  request: string; diceMode: DiceMode; game: GameState | null;
  lastEvents: RollEvent[]; lastRollValue: number | null; lastMove: LastMove | null;
  isBusy: boolean; error: string | null;
}
const initial = (): SessionSnapshot => ({ request: '', diceMode: 'virtual', game: null, lastEvents: [], lastRollValue: null, lastMove: null, isBusy: false, error: null });
export class SessionSupersededError extends Error {
  constructor() { super('Session changed while request was running'); this.name = 'SessionSupersededError'; }
}
type SessionApi = { create: typeof createGameOnServer; roll: typeof rollOnServer; get: typeof getGameFromServer };

/** Keeps network lifetimes separate from React renders. A reset/restore
 * invalidates prior mutations and reads; one mutation can run at a time. */
export function createGameSessionController(api: SessionApi = { create: createGameOnServer, roll: rollOnServer, get: getGameFromServer }) {
  let snapshot = initial();
  const listeners = new Set<() => void>();
  let epoch = 0;
  let revision = 0;
  let pendingStart: { id: string; request: string; mode: DiceMode } | null = null;
  let pendingRoll: { gameId: string; id: string; value?: number; mode: DiceMode } | null = null;
  const id = () => crypto.randomUUID();
  function update(patch: Partial<SessionSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  }
  function token() { return { epoch, revision: ++revision, owner: getStorageOwner() }; }
  function current(operation: ReturnType<typeof token>) {
    return operation.epoch === epoch && operation.revision === revision && operation.owner === getStorageOwner();
  }
  function requireCurrent(operation: ReturnType<typeof token>) { if (!current(operation)) throw new SessionSupersededError(); }
  function message(error: unknown, fallback: string) { return error instanceof WorkerApiError ? error.message : fallback; }
  function clearHints(game: GameState) {
    update({ game, request: game.request, diceMode: game.diceMode, lastEvents: [], lastMove: null, lastRollValue: null });
  }
  function reset() {
    epoch++; revision++;
    pendingStart = pendingRoll = null;
    setActivePersistedGameId(null);
    snapshot = initial();
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setRequest(request: string) { update({ request }); },
    setDiceMode(mode: DiceMode) {
      if (snapshot.isBusy) return;
      revision++;
      update({ diceMode: mode, game: snapshot.game ? { ...snapshot.game, diceMode: mode } : null });
    },
    clearError() { update({ error: null }); },
    reset,
    restore(record: PersistedGame) {
      if (!isSessionSnapshot(record)) throw new Error('Некорректное сохранение партии');
      epoch++; revision++;
      pendingStart = pendingRoll = null;
      update({ game: record.game, request: record.game.request, diceMode: record.game.diceMode,
        lastEvents: record.lastEvents, lastRollValue: record.lastRollValue, lastMove: record.lastMove, isBusy: false, error: null });
    },
    cancelPending() {
      epoch++; revision++;
      update({ isBusy: false });
    },
    async openGame(gameId: string) {
      if (snapshot.isBusy) throw new Error('Дождитесь завершения текущего запроса');
      const operation = token();
      const cached = loadPersistedGame(gameId);
      update({ isBusy: true, error: null });
      try {
        let record: PersistedGame;
        try {
          const game = await api.get(gameId);
          requireCurrent(operation);
          record = snapshotFromServer(game, cached);
        } catch (error) {
          requireCurrent(operation);
          if (error instanceof WorkerApiError && [401, 403, 404].includes(error.status)) {
            removePersistedGame(gameId);
            if (snapshot.game?.id === gameId || error.status !== 404) reset();
            if (error.status !== 404) setStorageOwner(null);
            throw error;
          }
          if (!cached || !operation.owner || !canUseOfflineCache(error)) throw error;
          record = cached;
        }
        requireCurrent(operation);
        epoch++; revision++;
        pendingStart = pendingRoll = null;
        update({ game: record.game, request: record.game.request, diceMode: record.game.diceMode,
          lastEvents: record.lastEvents, lastRollValue: record.lastRollValue, lastMove: record.lastMove, isBusy: false, error: null });
        persistGame(record);
        setActivePersistedGameId(record.id);
        return record;
      } catch (error) {
        if (current(operation)) update({ error: message(error, 'Не удалось открыть партию — попробуйте обновить список.') });
        throw error;
      } finally { if (current(operation)) update({ isBusy: false }); }
    },
    async startGame(overrides?: { diceMode?: DiceMode }) {
      if (snapshot.isBusy) throw new Error('Запрос уже выполняется');
      // A retry preserves the original payload as well as its key.
      pendingStart ??= { id: id(), request: snapshot.request, mode: overrides?.diceMode ?? snapshot.diceMode };
      const request = pendingStart;
      const operation = token();
      update({ isBusy: true, error: null });
      try {
        const game = await api.create(request.request, request.mode, request.id);
        requireCurrent(operation);
        pendingStart = pendingRoll = null;
        clearHints(game);
        return game;
      } catch (error) {
        requireCurrent(operation);
        const isPaywall = error instanceof WorkerApiError && error.status === 402
          && (error.body as { error?: string } | null)?.error === 'games_limit_reached';
        if (error instanceof WorkerApiError && [401, 403].includes(error.status)) {
          reset();
          setStorageOwner(null);
          update({ error: 'Перезапустите игру через Telegram, чтобы подтвердить аккаунт.' });
          throw error;
        }
        if (!isPaywall) update({ error: message(error, 'Не удалось создать партию — проверьте соединение.') });
        throw error;
      } finally { if (current(operation)) update({ isBusy: false }); }
    },
    async roll(value?: number) {
      const game = snapshot.game;
      if (!game) throw new Error('Партия ещё не создана');
      if (snapshot.isBusy) throw new Error('Запрос уже выполняется');
      if (!pendingRoll || pendingRoll.gameId !== game.id) pendingRoll = { gameId: game.id, id: id(), value, mode: game.diceMode };
      const request = pendingRoll;
      const operation = token();
      update({ isBusy: true, error: null });
      try {
        const result = await api.roll(game.id, request.id, request.value, request.mode);
        requireCurrent(operation);
        const moveEvent = result.events.find((event) => event.type === 'MOVE');
        const base = result.events.some((event) => event.type === 'TRIPLE_SIX_RESET') ? game.positionBeforeSixSeries : game.currentCell;
        const move: LastMove | null = moveEvent ? {
          fromCell: base, landedCell: moveEvent.detail?.startsWith('overshoot') ? base : base + result.value, finalCell: result.game.currentCell,
        } : null;
        pendingRoll = null;
        update({ game: result.game, request: result.game.request, diceMode: result.game.diceMode,
          lastEvents: result.events, lastRollValue: result.value, lastMove: move });
        return { ...result, move };
      } catch (error) {
        requireCurrent(operation);
        if (error instanceof WorkerApiError && [401, 403, 404].includes(error.status)) {
          removePersistedGame(game.id);
          reset();
          if (error.status !== 404) setStorageOwner(null);
          update({ error: 'Партия недоступна. Откройте «Мои партии» или перезапустите игру через Telegram.' });
          throw error;
        }
        if (error instanceof WorkerApiError && error.status === 409
          && (error.body as { error?: string } | null)?.error === 'version_conflict') {
          // Resync finishes before the next roll is enabled. Its response is
          // fenced just like the failed mutation, including restore/reset.
          try {
            const fresh = await api.get(game.id);
            requireCurrent(operation);
            clearHints(fresh);
          } catch { requireCurrent(operation); }
        }
        update({ error: message(error, 'Не удалось отправить бросок — проверьте соединение.') });
        throw error;
      } finally { if (current(operation)) update({ isBusy: false }); }
    },
    async syncFromServer(gameId: string) {
      if (snapshot.game?.id !== gameId || snapshot.isBusy) return;
      const operation = { epoch, revision, owner: getStorageOwner() };
      try {
        const fresh = await api.get(gameId);
        if (!current(operation) || snapshot.game?.id !== gameId || snapshot.isBusy) return;
        if (JSON.stringify(fresh) !== JSON.stringify(snapshot.game)) clearHints(fresh);
      } catch (error) {
        if (!current(operation) || snapshot.game?.id !== gameId) return;
        if (error instanceof WorkerApiError && [401, 403, 404].includes(error.status)) {
          removePersistedGame(gameId);
          reset();
          if (error.status !== 404) setStorageOwner(null);
          update({ error: 'Партия недоступна. Откройте «Мои партии» или перезапустите игру через Telegram.' });
        }
      }
    },
  };
}
