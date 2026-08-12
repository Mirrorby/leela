import type { GameState, RollEvent } from '../types/game';
import type { ScreenName } from '../navigation/types';
import type { LastMove } from './useGameSession';
import {
  saveGame,
  loadGame,
  listGames,
  deleteGame,
  getActiveGameId,
  setActiveGameId,
} from '../storage/localStorage';

/**
 * Полный снимок сессии одной партии — достаточный, чтобы восстановить не
 * просто GameState, а ТОЧНО тот экран, на котором пользователь остановился,
 * включая результат последнего броска (RollEvent из движка не хранит номера
 * клеток — их несёт LastMove, см. useGameSession).
 */
export interface PersistedGame {
  id: string;
  game: GameState;
  screen: ScreenName;
  lastEvents: RollEvent[];
  lastRollValue: number | null;
  lastMove: LastMove | null;
  savedAt: string;
}

export function persistGame(record: PersistedGame): boolean {
  return saveGame(record);
}

export function loadPersistedGame(id: string): PersistedGame | null {
  return loadGame<PersistedGame>(id);
}

export function listPersistedGames(): PersistedGame[] {
  return listGames<PersistedGame>();
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
