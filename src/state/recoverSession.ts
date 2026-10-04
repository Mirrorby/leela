import { getAccountFromServer, getGameFromServer, WorkerApiError } from '../api/workerClient';
import { setStorageOwner, getStorageOwner, getLegacyActiveGameId, clearLegacyActiveGameId } from '../storage/localStorage';
import { getActivePersistedGameId, loadPersistedGame, persistGame, removePersistedGame, setActivePersistedGameId, snapshotFromServer, resumeGameSnapshot } from './persistence';
import type { PersistedGame } from './persistence';

export function canUseOfflineCache(error: unknown): boolean {
  return error instanceof WorkerApiError && (error.status === 0 || error.status >= 500)
    && (error.body as { error?: string } | null)?.error !== 'invalid_response';
}

/** Confirmation precedes every cache read at startup. Cancellation fences
 * StrictMode/retry responses so they cannot switch the active cache owner. */
export async function recoverSession(
  isCurrent: () => boolean,
  api = { me: getAccountFromServer, game: getGameFromServer }
): Promise<{ record: PersistedGame | null; notice: string | null } | null> {
  setStorageOwner(null);
  const account = await api.me();
  if (!isCurrent()) return null;
  setStorageOwner(account.telegramId);
  const ownedId = getActivePersistedGameId();
  const legacyId = ownedId ? null : getLegacyActiveGameId();
  const id = ownedId ?? legacyId;
  if (!id) return { record: null, notice: null };
  const cached = ownedId ? loadPersistedGame(ownedId) : null;
  try {
    // Even a corrupt/missing local snapshot can be restored by its active ID.
    const game = await api.game(id);
    if (!isCurrent() || getStorageOwner() !== account.telegramId) return null;
    const record = resumeGameSnapshot(snapshotFromServer(game, cached));
    persistGame(record);
    setActivePersistedGameId(game.id);
    if (legacyId) clearLegacyActiveGameId();
    return { record, notice: null };
  } catch (error) {
    if (!isCurrent() || getStorageOwner() !== account.telegramId) return null;
    if (cached && canUseOfflineCache(error)) {
      return { record: resumeGameSnapshot(cached), notice: 'Нет связи с сервером — открыта сохранённая копия партии. Броски станут доступны после восстановления соединения.' };
    }
    if (error instanceof WorkerApiError && [401, 403, 404].includes(error.status)) {
      if (ownedId) removePersistedGame(ownedId);
      setActivePersistedGameId(null);
      if (legacyId) clearLegacyActiveGameId();
      if (error.status !== 404) setStorageOwner(null);
    }
    return { record: null, notice: error instanceof WorkerApiError && error.status === 404
      ? 'Эта партия недоступна. Остальные сохранённые партии можно открыть в «Мои партии».'
      : 'Не удалось восстановить партию. Повторите подключение или откройте «Мои партии».' };
  }
}
