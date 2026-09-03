import { useEffect, useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import type { GameState } from '../types/game';
import { listGamesOnServer, WorkerApiError } from '../api/workerClient';
import {
  listPersistedGames,
  removePersistedGame,
  setActivePersistedGameId,
  getHiddenPersistedGameIds,
  hidePersistedGame,
  type PersistedGame,
} from '../state/persistence';
import { resolveGameScreen, normalizeScreenName } from '../state/resolveGameScreen';

const STATUS_LABELS: Record<string, string> = {
  WAITING_FOR_BIRTH: 'ждёт рождения',
  IN_PROGRESS: 'в игре',
  FINISHED: 'завершена',
  ARCHIVED: 'в архиве',
};

const PAGE_SIZE = 20;

interface DisplayEntry {
  id: string;
  /** Состояние партии — ВСЕГДА с сервера, когда он доступен (сервер — источник
   * истины). localRecord ниже используется только для навигации при
   * "Продолжить" (какой экран открыть) и как офлайн-фолбэк для самого game. */
  game: GameState;
  localRecord: PersistedGame | null;
}

/**
 * Раньше этот экран целиком читал localStorage (listPersistedGames) — сервер
 * ни разу не опрашивался (найдено при ревью, п.1). Следствие: очистка
 * локального хранилища браузера/Telegram WebView (приватный режим, смена
 * устройства, переустановка) стирала список партий из UI, хотя все партии
 * оставались целы в D1 и были доступны через GET /api/v1/games. Заодно вся
 * проделанная работа над серверной keyset-пагинацией была мертва — клиент её
 * просто не вызывал. Теперь сервер — основной источник; локальный кэш служит
 * (а) подсказкой, на какой именно экран вести "Продолжить", и (б) офлайн-
 * фолбэком, если сервер недоступен.
 */
export function MyGames({ session, nav }: ScreenProps) {
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  function localRecordMap(): Map<string, PersistedGame> {
    return new Map(listPersistedGames().map((r) => [r.id, r]));
  }

  function toEntries(games: GameState[], hidden: Set<string>, localMap: Map<string, PersistedGame>): DisplayEntry[] {
    return games.filter((g) => !hidden.has(g.id)).map((g) => ({ id: g.id, game: g, localRecord: localMap.get(g.id) ?? null }));
  }

  const loadFirstPage = () => {
    setLoading(true);
    setListError(null);
    const hidden = new Set(getHiddenPersistedGameIds());
    listGamesOnServer({ limit: PAGE_SIZE })
      .then((page) => {
        setEntries(toEntries(page.games, hidden, localRecordMap()));
        setNextCursor(page.nextCursor);
        setOffline(false);
      })
      .catch(() => {
        // Сервер недоступен (офлайн, обрыв сети) — показываем то, что есть
        // локально на этом устройстве, а не пустой экран.
        const local = listPersistedGames().filter((r) => !hidden.has(r.id));
        setEntries(local.map((r) => ({ id: r.id, game: r.game, localRecord: r })));
        setNextCursor(null);
        setOffline(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(loadFirstPage, []);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setListError(null);
    const hidden = new Set(getHiddenPersistedGameIds());
    listGamesOnServer({ limit: PAGE_SIZE, cursor: nextCursor })
      .then((page) => {
        const localMap = localRecordMap();
        setEntries((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const added = toEntries(page.games, hidden, localMap).filter((e) => !existingIds.has(e.id));
          return [...prev, ...added];
        });
        setNextCursor(page.nextCursor);
      })
      .catch((err) => {
        setListError(err instanceof WorkerApiError ? err.message : 'Не удалось загрузить ещё партии — проверь соединение.');
      })
      .finally(() => setLoadingMore(false));
  };

  const handleContinue = (entry: DisplayEntry) => {
    // Локальный снимок (если есть) знает, на каком именно экране партии
    // человек остановился; для партии, известной только с сервера (открыта
    // впервые на этом устройстве), ведём сразу на GameHome — resolveGameScreen
    // всё равно не пустит на предыгровые экраны для уже существующей партии
    // (см. resolveGameScreen.ts), так что это безопасный дефолт.
    const savedScreen = entry.localRecord ? normalizeScreenName(entry.localRecord.screen) : 'GameHome';
    const record: PersistedGame = entry.localRecord
      ? { ...entry.localRecord, game: entry.game }
      : {
          id: entry.game.id,
          game: entry.game,
          screen: 'GameHome',
          lastEvents: [],
          lastRollValue: null,
          lastMove: null,
          savedAt: entry.game.updatedAt,
        };
    session.restore(record);
    nav.resetTo(resolveGameScreen(savedScreen, entry.game));
    // Фоновый ресинк (см. useGameSession.syncFromServer) — entry.game уже
    // актуален (только что с сервера), но на офлайн-фолбэке это могла быть
    // устаревшая локальная копия; безвредный лишний запрос в обычном случае.
    void session.syncFromServer(entry.game.id);
  };

  const handleDelete = (entry: DisplayEntry) => {
    const isActive = session.game?.id === entry.id;
    // Честная формулировка (правка после ревью): сервер не поддерживает
    // удаление партии (DELETE /api/v1/games/:id не существует, запись
    // остаётся в D1) — раньше диалог обещал "без возможности восстановить",
    // что было неверно уже тогда (просто раньше это было не так заметно,
    // пока список читался только локально). "Удалить" здесь — скрыть на
    // этом устройстве.
    const confirmed = window.confirm(
      isActive
        ? 'Скрыть текущую партию из этого списка на этом устройстве? Сама партия останется сохранённой на сервере.'
        : 'Скрыть эту партию из списка на этом устройстве? Сама партия останется сохранённой на сервере.'
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
      const confirmed = window.confirm('Начать новую партию? Текущая останется сохранённой в этом списке.');
      if (!confirmed) return;
    }
    session.reset();
    nav.resetTo('Intro');
  };

  return (
    <div className="screen screen-my-games">
      <h1>Мои партии</h1>
      {offline && <p className="muted screen-notice">Нет связи с сервером — показаны партии, сохранённые на этом устройстве.</p>}
      {loading && entries.length === 0 && <p className="muted">Загрузка…</p>}
      {!loading && entries.length === 0 && <p className="muted">Сохранённых партий пока нет.</p>}
      <ul className="game-list">
        {entries.map((entry) => (
          <li key={entry.id} className="game-list-item">
            <div>
              <strong>{entry.game.request || '(без запроса)'}</strong>
              <div className="muted">
                {STATUS_LABELS[entry.game.status] ?? entry.game.status} · клетка {entry.game.currentCell}
              </div>
            </div>
            <div className="game-list-actions">
              <button onClick={() => handleContinue(entry)}>Продолжить</button>
              <button className="danger" onClick={() => handleDelete(entry)}>
                Удалить
              </button>
            </div>
          </li>
        ))}
      </ul>
      {listError && <p className="screen-error">{listError}</p>}
      {nextCursor && !offline && (
        <button onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Загрузка…' : 'Загрузить ещё'}
        </button>
      )}
      <button onClick={handleNewGame}>Новая партия</button>
      {/* Батч 6 монетизации: единственная точка входа на экран "Ваш доступ"
          (§24 ТЗ) — MyGames уже служит своего рода аккаунт-хабом, отдельная
          иконка в topbar GameHome ради этого не заводилась. */}
      <button onClick={() => nav.push('YourAccess')}>Ваш доступ</button>
      <button onClick={() => nav.pop()}>Назад</button>
    </div>
  );
}
