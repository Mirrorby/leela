import { tr } from '../i18n/language';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { WorkerApiError } from '../api/workerClient';
import { loadHistoryPage, type HistoryEntry } from '../state/historyRecovery';
import { SessionSupersededError } from '../state/gameSessionController';
import { setStorageOwner } from '../storage/localStorage';
import {
  removePersistedGame,
  setActivePersistedGameId,
  hidePersistedGame,
} from '../state/persistence';
import { gameResumeScreen } from '../state/resolveGameScreen';

const STATUS_LABELS: Record<string, string> = {
  WAITING_FOR_BIRTH: "ждёт рождения",
  IN_PROGRESS: "в игре",
  FINISHED: "завершена",
  ARCHIVED: "в архиве",
};

const PAGE_SIZE = 20;


/**
 * Раньше этот экран целиком читал localStorage (listPersistedGames) — сервер
 * ни разу не опрашивался (найдено при ревью, п.1). Следствие: очистка
 * локального хранилища браузера/Telegram WebView (приватный режим, смена
 * устройства, переустановка) стирала список партий из UI, хотя все партии
 * оставались целы в D1 и были доступны через GET /api/v1/games. Заодно вся
 * проделанная работа над серверной keyset-пагинацией была мертва — клиент её
 * просто не вызывал. Теперь сервер — основной источник; локальный кэш служит
 * офлайн-фолбэком, если сервер недоступен. «Продолжить» открывает доску
 * незавершённой партии или итог завершённой, независимо от меню в кэше.
 */
export function MyGames({ session, nav }: ScreenProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [openingId, setOpeningId] = useState<string | null>(null);
  const generationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const { reset, cancelPending } = session;

  const accessDenied = useCallback((error: unknown) => {
    if (!(error instanceof WorkerApiError) || ![401, 403].includes(error.status)) return false;
    reset();
    setStorageOwner(null);
    setEntries([]);
    setNextCursor(null);
    setOffline(false);
    return true;
  }, [reset]);

  const loadFirstPage = useCallback(() => {
    const generation = ++generationRef.current;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setListError(null);
    loadHistoryPage({ limit: PAGE_SIZE }, () => generationRef.current === generation)
      .then((page) => {
        if (generationRef.current !== generation) return;
        setEntries(page.entries);
        setNextCursor(page.nextCursor);
        setOffline(page.offline);
      })
      .catch((error) => {
        if (generationRef.current !== generation) return;
        accessDenied(error);
        setEntries([]);
        setNextCursor(null);
        setListError(error instanceof WorkerApiError ? error.message : tr("Не удалось загрузить партии — попробуйте ещё раз."));
      })
      .finally(() => { if (generationRef.current === generation) setLoading(false); });
  }, [accessDenied]);

  useEffect(() => {
    loadFirstPage();
    return () => { generationRef.current++; cancelPending(); };
  }, [loadFirstPage, cancelPending]);

  const loadMore = () => {
    if (!nextCursor || loadingMoreRef.current || loading) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setListError(null);
    const generation = generationRef.current;
    loadHistoryPage({ limit: PAGE_SIZE, cursor: nextCursor }, () => generationRef.current === generation)
      .then((page) => {
        if (generationRef.current !== generation) return;
        setEntries((prev) => {
          const ids = new Set(prev.map((entry) => entry.id));
          return [...prev, ...page.entries.filter((entry) => !ids.has(entry.id))];
        });
        setNextCursor(page.nextCursor);
      })
      .catch((error) => {
        if (generationRef.current !== generation) return;
        accessDenied(error);
        setListError(error instanceof WorkerApiError ? error.message : tr("Не удалось загрузить ещё партии — проверьте соединение."));
      })
      .finally(() => {
        if (generationRef.current !== generation) return;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  };

  const handleContinue = async (entry: HistoryEntry) => {
    if (openingId || session.isBusy) return;
    const generation = generationRef.current;
    setOpeningId(entry.id);
    setListError(null);
    try {
      const record = await session.openGame(entry.id);
      if (generationRef.current === generation) nav.resetTo(gameResumeScreen(record.game));
    } catch (error) {
      if (generationRef.current !== generation || error instanceof SessionSupersededError) return;
      accessDenied(error);
      if (error instanceof WorkerApiError && error.status === 404) setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      setListError(tr("Не удалось открыть партию. Попробуйте обновить список или перезапустить игру через Telegram."));
    } finally {
      if (generationRef.current === generation) setOpeningId(null);
    }
  };

  const handleDelete = (entry: HistoryEntry) => {
    const isActive = session.game?.id === entry.id;
    // Честная формулировка (правка после ревью): сервер не поддерживает
    // удаление партии (DELETE /api/v1/games/:id не существует, запись
    // остаётся в D1) — раньше диалог обещал "без возможности восстановить",
    // что было неверно уже тогда (просто раньше это было не так заметно,
    // пока список читался только локально). "Удалить" здесь — скрыть на
    // этом устройстве.
    const confirmed = window.confirm(
      isActive
        ? tr("Скрыть текущую партию из этого списка на этом устройстве? Сама партия останется сохранённой на сервере.")
        : tr("Скрыть эту партию из списка на этом устройстве? Сама партия останется сохранённой на сервере.")
    );
    if (!confirmed) return;

    hidePersistedGame(entry.id);
    removePersistedGame(entry.id);
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    if (isActive) {
      setActivePersistedGameId(null);
      session.reset();
    }
  };

  const handleNewGame = () => {
    if (session.game && session.game.status !== 'FINISHED') {
      const confirmed = window.confirm(tr("Начать новую партию? Текущая останется сохранённой в этом списке."));
      if (!confirmed) return;
    }
    session.reset();
    nav.resetTo('Intro');
  };

  return (
    <div className="screen screen-my-games">
      <h1>{tr("Мои партии")}</h1>
      {offline && <p className="muted screen-notice">{tr("Нет связи с сервером — показаны партии, сохранённые на этом устройстве.")}</p>}
      {loading && entries.length === 0 && <p className="muted">{tr("Загрузка…")}</p>}
      {!loading && !listError && entries.length === 0 && <p className="muted">{tr("Сохранённых партий пока нет.")}</p>}
      <ul className="game-list">
        {entries.map((entry) => (
          <li key={entry.id} className="game-list-item">
            <div>
              <strong>{entry.game.request || tr("(без запроса)")}</strong>
              <div className="muted">
                {tr(STATUS_LABELS[entry.game.status] ?? entry.game.status)} {tr("· клетка")} {entry.game.currentCell}
              </div>
            </div>
            <div className="game-list-actions">
              <button onClick={() => { void handleContinue(entry); }} disabled={openingId !== null || session.isBusy}>
                {openingId === entry.id ? tr("Открываем…") : tr("Продолжить")}
              </button>
              <button className="danger" onClick={() => handleDelete(entry)} disabled={openingId !== null}>{tr("Удалить")} </button>
            </div>
          </li>
        ))}
      </ul>
      {listError && <p className="screen-error">{listError}</p>}
      <button onClick={loadFirstPage} disabled={loading || openingId !== null}>
        {loading ? tr("Обновляем…") : tr("Обновить список")}
      </button>
      {nextCursor && !offline && (
        <button onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? tr("Загрузка…") : tr("Загрузить ещё")}
        </button>
      )}
      <button onClick={handleNewGame}>{tr("Новая партия")}</button>
      {/* Батч 6 монетизации: единственная точка входа на экран "Ваш доступ"
          (§24 ТЗ) — MyGames уже служит своего рода аккаунт-хабом, отдельная
          иконка в topbar GameHome ради этого не заводилась. */}
      <button onClick={() => nav.push('YourAccess')}>{tr("Ваш доступ")}</button>
      <button onClick={() => nav.pop()}>{tr("Назад")}</button>
    </div>
  );
}
