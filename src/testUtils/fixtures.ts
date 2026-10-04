import { createNewGame } from '../game/gameEngine';
import { getRuleset } from '../game/ruleset';
import type { GameState } from '../types/game';
import { snapshotFromServer } from '../state/persistence';
export function makeGame(overrides: Partial<GameState> = {}): GameState {
  return { ...createNewGame({ id: 'g1', ruleset: getRuleset('classic-v1'), request: 'test', diceMode: 'virtual' }), ...overrides };
}
export const makeSnapshot = (game = makeGame()) => snapshotFromServer(game);
export function memoryStorage() {
  const raw = new Map<string, string>();
  return { raw, getItem: (key: string) => raw.get(key) ?? null,
    setItem: (key: string, value: string) => { raw.set(key, value); }, removeItem: (key: string) => { raw.delete(key); } };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
