import { OperationStorageError } from './state/pendingOperations';
import { tr, useLanguage } from './i18n/language';
import { useCallback, useEffect, useState } from 'react';
import { useGameSession } from './state/useGameSession';
import {
  persistGame,
  setActivePersistedGameId,
} from './state/persistence';
import { resolveGameScreen, gameResumeScreen } from './state/resolveGameScreen';
import { recoverSession } from './state/recoverSession';
import { WorkerApiError } from './api/workerClient';
import type { NavigationActions, ScreenEntry, ScreenName } from './navigation/types';
import { screens } from './screens';
import { captureInitData, initTelegramApp } from './telegram/telegramAdapter';
import { useTelegramTheme } from './telegram/useTelegramTheme';
import { useTelegramViewport } from './telegram/useTelegramViewport';
import { useTelegramBackButton } from './telegram/useTelegramBackButton';
import './App.css';

// On restart and Continue, resume the board or the completed game's
// summary. Global menus and History cannot be a game's root screen.
function App() {
  const language = useLanguage();
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const session = useGameSession();
  const [stack, setStack] = useState<ScreenEntry[]>([{ name: 'Splash' }]);
  const [hydrated, setHydrated] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);

  // Этап 6: Telegram Web App SDK. Вне Telegram все три хука — no-op, а
  // initTelegramApp()/captureInitData() просто не находят window.Telegram.
  useEffect(() => {
    initTelegramApp();
    captureInitData();
  }, []);
  useTelegramTheme();
  useTelegramViewport();

  // Never render a private snapshot until this launch's account is verified.
  useEffect(() => {
    let current = true;
    setHydrated(false);
    setRecoveryNotice(null);
    recoverSession(() => current)
      .then((result) => {
        if (!current || !result) return;
        if (result.record) {
          session.restore(result.record);
          setStack([{ name: gameResumeScreen(result.record.game) }]);
        } else {
          session.reset();
          setStack([{ name: 'Splash' }]);
        }
        setRecoveryNotice(result.notice);
      })
      .catch((error) => {
        if (!current) return;
        session.reset();
        setStack([{ name: 'Splash' }]);
        setRecoveryNotice(error instanceof OperationStorageError ? error.message : error instanceof WorkerApiError && [401, 403].includes(error.status)
          ? tr("Откройте игру через Telegram, чтобы получить доступ к своим партиям.")
          : tr("Не удалось подключиться к серверу. Повторите подключение, чтобы открыть сохранённые партии."));
      })
      .finally(() => { if (current) setHydrated(true); });
    return () => { current = false; };
  }, [recoveryAttempt, session.restore, session.reset]);

  const push = useCallback((name: ScreenName, params?: Record<string, unknown>) => {
    setStack((prev) => [...prev, { name, params }]);
  }, []);

  const replace = useCallback((name: ScreenName, params?: Record<string, unknown>) => {
    setStack((prev) => [...prev.slice(0, -1), { name, params }]);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const resetTo = useCallback((name: ScreenName, params?: Record<string, unknown>) => {
    setStack([{ name, params }]);
  }, []);

  const nav: NavigationActions = { push, replace, pop, resetTo };
  const current = stack[stack.length - 1];

  // Системная кнопка "назад" Telegram зеркалит тот же pop(), что и обычная
  // навигация в приложении — видна ровно когда есть куда возвращаться.
  useTelegramBackButton(stack.length > 1, pop);

  // Persist progress and roll hints while keeping navigation-only screens
  // out of the game snapshot. A restart confirms progress with the server.
  useEffect(() => {
    if (!hydrated || !session.game) return;
    persistGame({
      id: session.game.id,
      game: session.game,
      // resolveGameScreen: см. комментарий в state/resolveGameScreen.ts —
      // не даём предыгровому экрану (Intro/RequestInput/DiceModeSelect)
      // попасть в снимок партии, у которой уже есть реальный прогресс. Без
      // этого гонка между commit'ом setGame(newGame) в startGame() и
      // последующим nav.resetTo('GameHome') в DiceModeSelect.choose() могла
      // записать "текущий экран" как DiceModeSelect для уже начатой партии
      // — а следующее "Продолжить" из "Моих партий" вместо возврата в игру
      // заводило новую партию поверх старой (та оставалась недоступной
      // "сиротой").
      screen: resolveGameScreen(current.name, session.game),
      lastEvents: session.lastEvents,
      lastRollValue: session.lastRollValue,
      lastMove: session.lastMove,
      savedAt: new Date().toISOString(),
    });
    setActivePersistedGameId(session.game.id);
  }, [hydrated, session.game, session.lastEvents, session.lastRollValue, session.lastMove, current.name]);

  if (!hydrated) {
    return <div className="app-shell"><p className="muted">{tr("Подключаемся к игре…")}</p></div>;
  }

  const CurrentScreen = screens[current.name];

  return (
    <div className="app-shell">
      {recoveryNotice && <div role="status" className="screen-notice">
        <p>{recoveryNotice}</p>
        <button onClick={() => setRecoveryAttempt((attempt) => attempt + 1)}>{tr("Повторить подключение")}</button>
      </div>}
      <CurrentScreen session={session} nav={nav} params={current.params} />
    </div>
  );
}

export default App;
