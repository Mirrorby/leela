import { listGamesOnServer, type GamesPage } from '../api/workerClient';
import { getStorageOwner } from '../storage/localStorage';
import { getHiddenPersistedGameIds, listPersistedGames, persistGame, snapshotFromServer, type PersistedGame } from './persistence';
import { canUseOfflineCache } from './recoverSession';
import { SessionSupersededError } from './gameSessionController';
import type { GameState } from '../types/game';

export interface HistoryEntry { id: string; game: GameState; localRecord: PersistedGame | null; }

/** Local history is a fallback for connection failures of this verified
 * account, never for failed authentication or an invalid server response. */
export async function loadHistoryPage(
  options: { cursor?: string; limit?: number } = {},
  isCurrent = () => true,
  list = listGamesOnServer
): Promise<{ entries: HistoryEntry[]; nextCursor: string | null; offline: boolean }> {
  const owner = getStorageOwner();
  const current = () => isCurrent() && getStorageOwner() === owner;
  let page: GamesPage;
  try {
    page = await list(options);
  } catch (error) {
    if (!current()) throw new SessionSupersededError();
    if (!options.cursor && owner && canUseOfflineCache(error)) {
      const hidden = new Set(getHiddenPersistedGameIds());
      return { entries: listPersistedGames().filter((record) => !hidden.has(record.id))
        .map((record) => ({ id: record.id, game: record.game, localRecord: record })), nextCursor: null, offline: true };
    }
    throw error;
  }
  if (!current()) throw new SessionSupersededError();
  const cached = new Map(listPersistedGames().map((record) => [record.id, record]));
  const hidden = new Set(getHiddenPersistedGameIds());
  return {
    entries: page.games.filter((game) => !hidden.has(game.id)).map((game) => {
      const record = snapshotFromServer(game, cached.get(game.id) ?? null);
      persistGame(record);
      return { id: game.id, game, localRecord: record };
    }), nextCursor: page.nextCursor, offline: false,
  };
}
