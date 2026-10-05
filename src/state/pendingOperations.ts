import type { DiceMode, GameState } from '../types/game';
import { getStorageOwner } from '../storage/localStorage';
import { persistGame, snapshotFromServer, setActivePersistedGameId } from './persistence';
import { tr } from '../i18n/language';

interface OperationBase { version: 1; owner: string; id: string; mode: DiceMode; }
export interface PendingStart extends OperationBase { kind: 'start'; request: string; }
export interface PendingRoll extends OperationBase { kind: 'roll'; gameId: string; value?: number; }
export type PendingOperation = PendingStart | PendingRoll;
export class OperationStorageError extends Error {
  constructor() { super(tr('Не удалось сохранить запрос на устройстве. Освободите место или разрешите локальное хранилище и попробуйте снова.')); this.name = 'OperationStorageError'; }
}
function target() {
  const owner = getStorageOwner();
  try {
    if (!owner || typeof window === 'undefined' || !window.localStorage) throw new OperationStorageError();
    return { owner, storage: window.localStorage };
  } catch { throw new OperationStorageError(); }
}
function name(kind: 'start' | 'roll', gameId = '') { return kind === 'start' ? 'start' : `roll:${gameId}`; }
function key(owner: string, suffix: string) { return `leela:v2:user:${owner}:pending:${suffix}`; }
function load(kind: 'start' | 'roll', gameId = ''): PendingOperation | null {
  const { owner, storage } = target();
  try {
    const raw = storage.getItem(key(owner, name(kind, gameId)));
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || value.owner !== owner || value.kind !== kind
      || typeof value.id !== 'string' || !value.id || value.id.length > 200
      || !['physical', 'virtual'].includes(value.mode)
      || (kind === 'start' && typeof value.request !== 'string')
      || (kind === 'roll' && (value.gameId !== gameId || (value.value !== undefined
        && (!Number.isInteger(value.value) || value.value < 1 || value.value > 6))))) throw new OperationStorageError();
    return value;
  } catch { throw new OperationStorageError(); }
}
export const loadPendingStart = () => load('start') as PendingStart | null;
export const loadPendingRoll = (gameId: string) => load('roll', gameId) as PendingRoll | null;
function save<T extends PendingOperation>(operation: T): T {
  const { owner, storage } = target();
  if (operation.owner !== owner) throw new OperationStorageError();
  try {
    const entry = key(owner, name(operation.kind, operation.kind === 'roll' ? operation.gameId : ''));
    const raw = JSON.stringify(operation);
    storage.setItem(entry, raw);
    if (storage.getItem(entry) !== raw) throw new OperationStorageError();
    return operation;
  } catch { throw new OperationStorageError(); }
}
export function prepareStart(request: string, mode: DiceMode): PendingStart {
  return loadPendingStart() ?? save({ version: 1, owner: target().owner, kind: 'start', id: crypto.randomUUID(), request, mode });
}
export function prepareRoll(gameId: string, mode: DiceMode, value?: number): PendingRoll {
  return loadPendingRoll(gameId) ?? save({ version: 1, owner: target().owner, kind: 'roll', id: crypto.randomUUID(), gameId, mode, ...(value === undefined ? {} : { value }) });
}
/** A late response must not delete another account's or a newer operation. */
export function clearPendingOperation(operation: PendingOperation): boolean {
  if (getStorageOwner() !== operation.owner) return false;
  try {
    const existing = load(operation.kind, operation.kind === 'roll' ? operation.gameId : '');
    if (!existing || existing.id !== operation.id) return false;
    const { storage } = target();
    const entry = key(operation.owner, name(operation.kind, operation.kind === 'roll' ? operation.gameId : ''));
    storage.removeItem(entry);
    return storage.getItem(entry) === null;
  } catch { return false; }
}
/** Save the acknowledged progress and active pointer before retiring its
 * request ID. A crash or a failed cache write leaves the same safe retry. */
export function confirmPendingOperation(operation: PendingOperation, game: GameState): void {
  if (getStorageOwner() !== operation.owner) return;
  if (persistGame(snapshotFromServer(game)) && setActivePersistedGameId(game.id)) clearPendingOperation(operation);
}
