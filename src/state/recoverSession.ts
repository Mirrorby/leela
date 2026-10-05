import { loadPendingStart, loadPendingRoll, confirmPendingOperation, clearPendingOperation } from './pendingOperations';
import { tr } from '../i18n/language';
import { getAccountFromServer, getGameFromServer, createGameOnServer, rollOnServer, WorkerApiError } from '../api/workerClient';
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
  api: { me: typeof getAccountFromServer; game: typeof getGameFromServer; create?: typeof createGameOnServer; roll?: typeof rollOnServer } = { me: getAccountFromServer, game: getGameFromServer }
): Promise<{ record: PersistedGame | null; notice: string | null } | null> {
  setStorageOwner(null);
  const account = await api.me();
  if (!isCurrent()) return null;
  setStorageOwner(account.telegramId);
  const start = loadPendingStart();
  if (start) {
    try {
      // POST reuses the original ID and payload. The server returns an already
      // created game before checking credits; an unreceived request resumes it.
      const game = await (api.create ?? createGameOnServer)(start.request, start.mode, start.id);
      if (!isCurrent() || getStorageOwner() !== account.telegramId) return null;
      const record = resumeGameSnapshot(snapshotFromServer(game));
      confirmPendingOperation(start, game);
      return { record, notice: null };
    } catch (error) {
      if (!isCurrent() || getStorageOwner() !== account.telegramId) return null;
      if (error instanceof WorkerApiError && [400, 402, 413].includes(error.status)) {
        clearPendingOperation(start);
        return { record: null, notice: error.message };
      }
      if (error instanceof WorkerApiError && [401, 403].includes(error.status)) setStorageOwner(null);
      // Keep the journal until an acknowledgement is saved. A new Start also
      // retries this same operation, even after navigation or another reload.
      throw error;
    }
  }
  const ownedId = getActivePersistedGameId();
  const legacyId = ownedId ? null : getLegacyActiveGameId();
  const id = ownedId ?? legacyId;
  if (!id) return { record: null, notice: null };
  const cached = ownedId ? loadPersistedGame(ownedId) : null;
  try {
    // Even a corrupt/missing local snapshot can be restored by its active ID.
    let game = await api.game(id);
    if (!isCurrent() || getStorageOwner() !== account.telegramId) return null;
    const roll = loadPendingRoll(id);
    if (roll) {
      try {
        const result = await (api.roll ?? rollOnServer)(id, roll.id, roll.value, roll.mode);
        if (!isCurrent() || getStorageOwner() !== account.telegramId) return null;
        game = result.game;
        confirmPendingOperation(roll, game);
      } catch (error) {
        if (!isCurrent() || getStorageOwner() !== account.telegramId) return null;
        if (error instanceof WorkerApiError && ([400, 404, 413].includes(error.status) ||
          (error.status === 409 && (error.body as { error?: string } | null)?.error === 'game_finished'))) clearPendingOperation(roll);
        else if (canUseOfflineCache(error) || (error instanceof WorkerApiError && [409, 429].includes(error.status))) {
          const record = resumeGameSnapshot(snapshotFromServer(game, cached));
          persistGame(record);
          return { record, notice: error instanceof WorkerApiError && error.status === 429 ? error.message : tr('Не удалось подтвердить последний бросок. Следующая попытка повторит тот же запрос.') };
        }
        else throw error;
      }
    }
    if (!isCurrent() || getStorageOwner() !== account.telegramId) return null;
    const record = resumeGameSnapshot(snapshotFromServer(game, cached));
    persistGame(record);
    setActivePersistedGameId(game.id);
    if (legacyId) clearLegacyActiveGameId();
    return { record, notice: null };
  } catch (error) {
    if (!isCurrent() || getStorageOwner() !== account.telegramId) return null;
    if (cached && canUseOfflineCache(error)) {
      return { record: resumeGameSnapshot(cached), notice: tr("Нет связи с сервером — открыта сохранённая копия партии. Броски станут доступны после восстановления соединения.") };
    }
    if (error instanceof WorkerApiError && [401, 403, 404].includes(error.status)) {
      if (ownedId) removePersistedGame(ownedId);
      setActivePersistedGameId(null);
      if (legacyId) clearLegacyActiveGameId();
      if (error.status !== 404) setStorageOwner(null);
    }
    return { record: null, notice: error instanceof WorkerApiError && error.status === 404
      ? tr("Эта партия недоступна. Остальные сохранённые партии можно открыть в «Мои партии».")
      : tr("Не удалось восстановить партию. Повторите подключение или откройте «Мои партии».") };
  }
}
