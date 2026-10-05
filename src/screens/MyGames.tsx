import { ScreenHeading } from '../components/ScreenHeading';
import { tr } from '../i18n/language';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { WorkerApiError } from '../api/workerClient';
import { loadHistoryPage, type HistoryEntry } from '../state/historyRecovery';
import { SessionSupersededError } from '../state/gameSessionController';
import { Modal } from '../components/Modal';
import { deleteGameAndCache } from '../state/deleteGame';
import { setStorageOwner } from '../storage/localStorage';
import { getHiddenPersistedGameIds } from '../state/persistence';
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
  const [includeHidden, setIncludeHidden] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [deleteEntry, setDeleteEntry] = useState<HistoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingRef = useRef(false);
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
    loadHistoryPage({ limit: PAGE_SIZE, includeHidden }, () => generationRef.current === generation)
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
  }, [accessDenied, includeHidden]);

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
    loadHistoryPage({ limit: PAGE_SIZE, cursor: nextCursor, includeHidden }, () => generationRef.current === generation)
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
    if (openingId || session.isBusy || deletingRef.current) return;
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

  const handleDelete = async () => {
    if (!deleteEntry || deletingRef.current || session.isBusy) return;
    const entry = deleteEntry;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    cancelPending();
    const generation = ++generationRef.current;
    try {
      await deleteGameAndCache(entry.id);
      if (session.getSnapshot().game?.id === entry.id) session.reset();
      if (generationRef.current !== generation) return;
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      setDeleteEntry(null);
    } catch (error) {
      if (generationRef.current !== generation || error instanceof SessionSupersededError) return;
      accessDenied(error);
      setDeleteError(error instanceof WorkerApiError ? error.message : tr("Не удалось удалить партию. Проверьте соединение и повторите."));
    } finally {
      deletingRef.current = false;
      if (generationRef.current === generation) setDeleting(false);
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
      <ScreenHeading>{tr("Мои партии")}</ScreenHeading>
      {offline && <p className="muted screen-notice">{tr("Нет связи с сервером — показаны партии, сохранённые на этом устройстве.")}</p>}
      {loading && entries.length === 0 && <p className="muted">{tr("Загрузка…")}</p>}
      {!loading && !listError && entries.length === 0 && <p className="muted">{tr("Сохранённых партий пока нет.")}</p>}
      {getHiddenPersistedGameIds().length > 0 && (
        <button onClick={() => setIncludeHidden(value => !value)} disabled={loading || loadingMore || openingId !== null || deleting}>
          {includeHidden ? tr("Не показывать ранее скрытые партии") : tr("Показать ранее скрытые партии")}
        </button>
      )}
      {includeHidden && <p className="muted">{tr("Раньше удаление только скрывало партию на устройстве. Теперь эти партии можно открыть и удалить с сервера.")}</p>}
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
              <button onClick={() => { void handleContinue(entry); }} disabled={openingId !== null || session.isBusy || deleting}>
                {openingId === entry.id ? tr("Открываем…") : tr("Продолжить")}
              </button>
              <button className="danger" onClick={() => { setDeleteEntry(entry); setDeleteError(null); }} disabled={openingId !== null || session.isBusy || loading || loadingMore || deleting}>{tr("Удалить")} </button>
            </div>
          </li>
        ))}
      </ul>
      {listError && <p className="screen-error">{listError}</p>}
      <button onClick={loadFirstPage} disabled={loading || openingId !== null || deleting}>
        {loading ? tr("Обновляем…") : tr("Обновить список")}
      </button>
      {nextCursor && !offline && (
        <button onClick={loadMore} disabled={loadingMore || deleting}>
          {loadingMore ? tr("Загрузка…") : tr("Загрузить ещё")}
        </button>
      )}
      <button onClick={handleNewGame} disabled={deleting}>{tr("Новая партия")}</button>
      {/* Батч 6 монетизации: единственная точка входа на экран "Ваш доступ"
          (§24 ТЗ) — MyGames уже служит своего рода аккаунт-хабом, отдельная
          иконка в topbar GameHome ради этого не заводилась. */}
      <button onClick={() => nav.push('YourAccess')}>{tr("Ваш доступ")}</button>
      <Modal open={deleteEntry !== null} title={tr("Удалить партию?")} onClose={deleting ? undefined : () => setDeleteEntry(null)}>
        <p>{tr("Намерение, ходы и ИИ-разборы этой партии будут удалены с сервера. Восстановить их нельзя.")}</p>
        <p className="muted">{tr("Сыгранная партия и готовый разбор не возвращаются на баланс. Если разбор ещё создаётся, его кредит вернётся. Покупки и баланс сохраняются.")}</p>
        <p className="muted">{tr("Удаление в Лиле не удаляет данные, уже переданные Gemini. На других устройствах список обновится при подключении к серверу.")}</p>
        {deleteError && <p className="screen-error" role="alert">{deleteError}</p>}
        <button onClick={() => setDeleteEntry(null)} disabled={deleting}>{tr("Отмена")}</button>
        <button className="danger" onClick={() => { void handleDelete(); }} disabled={deleting}>{deleting ? tr("Удаляем…") : tr("Удалить партию")}</button>
      </Modal>
      <button onClick={() => nav.pop()}>{tr("Назад")}</button>
    </div>
  );
}
