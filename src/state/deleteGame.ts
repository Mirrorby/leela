import { deleteGameOnServer } from '../api/workerClient';
import { getStorageOwner } from '../storage/localStorage';
import { SessionSupersededError } from './gameSessionController';
import { removePersistedGame, hidePersistedGame, getActivePersistedGameId, setActivePersistedGameId } from './persistence';
import { loadPendingStart, loadPendingRoll, clearPendingOperation } from './pendingOperations';

/** A failed/unacknowledged deletion leaves the cache intact for safe retry. */
export async function deleteGameAndCache(gameId: string, remove = deleteGameOnServer): Promise<void> {
  const owner = getStorageOwner();
  if (!owner) throw new SessionSupersededError();
  const result = await remove(gameId);
  if (getStorageOwner() !== owner) throw new SessionSupersededError();
  hidePersistedGame(gameId);
  removePersistedGame(gameId);
  if (getActivePersistedGameId() === gameId) setActivePersistedGameId(null);
  try {
    const roll = loadPendingRoll(gameId);
    if (roll) clearPendingOperation(roll);
    const start = loadPendingStart();
    if (start && start.id === result.clientRequestId) clearPendingOperation(start);
  } catch { /* The server receipt still prevents replay if storage is unreadable. */ }
}
