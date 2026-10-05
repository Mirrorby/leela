import { listGamesOnServer, type GamesPage } from '../api/workerClient';
import { getStorageOwner } from '../storage/localStorage';
import { getHiddenPersistedGameIds, listPersistedGames, persistGame, snapshotFromServer, removePersistedGame, getActivePersistedGameId, setActivePersistedGameId, type PersistedGame } from './persistence';
import { canUseOfflineCache } from './recoverSession';
import { SessionSupersededError } from './gameSessionController';
import type { GameState } from '../types/game';

export interface HistoryEntry { id: string; game: GameState; localRecord: PersistedGame | null; }

/** Local history is a fallback for connection failures of this verified
 * account, never for failed authentication or an invalid server response. */
export async function loadHistoryPage(
  options: { cursor?: string; limit?: number; includeHidden?: boolean } = {},
  isCurrent = () => true,
  list = listGamesOnServer
): Promise<{ entries: HistoryEntry[]; nextCursor: string | null; offline: boolean }> {
  const owner = getStorageOwner();
  const current = () => isCurrent() && getStorageOwner() === owner;
  const beforeRequest = new Map(listPersistedGames().map(record => [record.id, JSON.stringify(record)]));
  let page: GamesPage;
  try {
    page = await list(options);
  } catch (error) {
    if (!current()) throw new SessionSupersededError();
    if (!options.cursor && owner && canUseOfflineCache(error)) {
      const hidden = new Set(getHiddenPersistedGameIds());
      return { entries: listPersistedGames().filter((record) => (options.includeHidden || !hidden.has(record.id)))
        .map((record) => ({ id: record.id, game: record.game, localRecord: record })), nextCursor: null, offline: true };
    }
    throw error;
  }
  if (!current()) throw new SessionSupersededError();
  const cached = new Map(listPersistedGames().map((record) => [record.id, record]));
  // Absence proves deletion only when this is the complete first page.
  // Never discard older cached games based on a partial/cursor page.
  if (!options.cursor && page.nextCursor === null) {
    const present = new Set(page.games.map(game => game.id));
    for (const [id, record] of cached) if (!present.has(id) && beforeRequest.get(id) === JSON.stringify(record)) {
      removePersistedGame(id);
      if (getActivePersistedGameId() === id) setActivePersistedGameId(null);
    }
  }
  const hidden = new Set(getHiddenPersistedGameIds());
  return {
    entries: page.games.filter((game) => (options.includeHidden || !hidden.has(game.id))).map((game) => {
      const record = snapshotFromServer(game, cached.get(game.id) ?? null);
      persistGame(record);
      return { id: game.id, game, localRecord: record };
    }), nextCursor: page.nextCursor, offline: false,
  };
}
