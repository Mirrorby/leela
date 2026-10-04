import type { GameState, RollEvent } from '../types/game';
import type { ScreenName } from '../navigation/types';
import type { LastMove } from './gameSessionController';
import { isGameState, isObject, isDateString, isRollEvents } from '../game/validateGameState';
import { normalizeScreenName } from './resolveGameScreen';
import {
  saveGame,
  loadGame,
  listGames,
  deleteGame,
  getActiveGameId,
  setActiveGameId,
  getHiddenGameIds,
  hideGameId,
  getOnboardingSeen,
  setOnboardingSeen,
  getStorageOwner,
} from '../storage/localStorage';

/**
 * Полный снимок сессии одной партии — достаточный, чтобы восстановить не
 * просто GameState, а ТОЧНО тот экран, на котором пользователь остановился,
 * включая результат последнего броска (RollEvent из движка не хранит номера
 * клеток — их несёт LastMove, см. useGameSession).
 */
export interface PersistedGame {
  schemaVersion?: 2;
  ownerTelegramId?: string;
  id: string;
  game: GameState;
  screen: ScreenName;
  lastEvents: RollEvent[];
  lastRollValue: number | null;
  lastMove: LastMove | null;
  savedAt: string;
}

export function persistGame(record: PersistedGame): boolean {
  const owner = getStorageOwner();
  if (!owner || !isSessionSnapshot(record)) return false;
  return saveGame({ ...record, schemaVersion: 2, ownerTelegramId: owner, screen: normalizeScreenName(record.screen) });
}

export function loadPersistedGame(id: string): PersistedGame | null {
  const record = loadGame<PersistedGame>(id, isOwnedSnapshot);
  return record ? { ...record, screen: normalizeScreenName(record.screen) } : null;
}

export function listPersistedGames(): PersistedGame[] {
  return listGames<PersistedGame>(isOwnedSnapshot).map((record) => ({ ...record, screen: normalizeScreenName(record.screen) }));
}

export function isSessionSnapshot(value: unknown): value is PersistedGame {
  if (!isObject(value) || !isGameState(value.game) || value.id !== value.game.id
    || typeof value.screen !== 'string' || !isDateString(value.savedAt)
    || !(value.lastRollValue === null || (Number.isInteger(value.lastRollValue) && Number(value.lastRollValue) >= 1 && Number(value.lastRollValue) <= 6))
    || !isRollEvents(value.lastEvents)) return false;
  return value.lastMove === null || (isObject(value.lastMove)
    && ['fromCell', 'landedCell', 'finalCell'].every((key) => {
      const cell = value.lastMove as Record<string, unknown>;
      return typeof cell[key] === 'number' && Number.isInteger(cell[key]) && Number(cell[key]) >= 0 && Number(cell[key]) <= 72;
    }));
}

function isOwnedSnapshot(value: unknown): value is PersistedGame {
  return isSessionSnapshot(value) && value.schemaVersion === 2 && value.ownerTelegramId === getStorageOwner();
}

/** Server progress invalidates old animation hints; the selected screen
 * remains useful, but a move from another state must not be replayed. */
export function snapshotFromServer(game: GameState, cached: PersistedGame | null = null): PersistedGame {
  const unchanged = cached && JSON.stringify(cached.game) === JSON.stringify(game);
  return {
    id: game.id, game, screen: cached ? normalizeScreenName(cached.screen) : game.status === 'FINISHED' || game.status === 'ARCHIVED' ? 'Summary' : 'GameHome',
    lastEvents: unchanged ? cached.lastEvents : [],
    lastRollValue: unchanged ? cached.lastRollValue : null,
    lastMove: unchanged ? cached.lastMove : null,
    savedAt: new Date().toISOString(),
  };
}

export function removePersistedGame(id: string): void {
  deleteGame(id);
}

export function getActivePersistedGameId(): string | null {
  return getActiveGameId();
}

export function setActivePersistedGameId(id: string | null): void {
  setActiveGameId(id);
}

/** См. storage/localStorage.ts:hideGameId — "удалить" партию на сервере
 * сейчас невозможно (нет DELETE-эндпоинта), поэтому это локальное
 * сокрытие для этого устройства. */
export function getHiddenPersistedGameIds(): string[] {
  return getHiddenGameIds();
}

export function hidePersistedGame(id: string): void {
  hideGameId(id);
}

/** См. storage/localStorage.ts:getOnboardingSeen/setOnboardingSeen. */
export function hasSeenOnboarding(): boolean {
  return getOnboardingSeen();
}

export function markOnboardingSeen(): void {
  setOnboardingSeen();
}
