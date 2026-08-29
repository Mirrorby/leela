import { useCallback, useEffect, useState } from 'react';
import { useGameSession } from './state/useGameSession';
import {
  getActivePersistedGameId,
  loadPersistedGame,
  persistGame,
  setActivePersistedGameId,
} from './state/persistence';
import { resolveGameScreen } from './state/resolveGameScreen';
import type { NavigationActions, ScreenEntry, ScreenName } from './navigation/types';
import { screens } from './screens';
import { captureInitData, initTelegramApp } from './telegram/telegramAdapter';
import { useTelegramTheme } from './telegram/useTelegramTheme';
import { useTelegramViewport } from './telegram/useTelegramViewport';
import { useTelegramBackButton } from './telegram/useTelegramBackButton';
import './App.css';

// Редизайн (этап 7): шесть экранов флоу броска (DiceRoll, TurnResult,
// CellCard, TransitionEvent, ExtraRollPrompt, TripleSixReset) убраны из
// ScreenName и больше никогда не пушатся в стек — но старая сохранённая
// партия в localStorage могла быть записана ДО редизайна с одним из этих
// имён как "текущий экран". TS-тип на рантайм-значение из JSON.parse не
// влияет, поэтому normalizeScreenName подстраховывает восстановление:
// любое незнакомое имя экрана превращается в GameHome — экран партии,
// который теперь и так вмещает в себя весь этот флоу.
// Восстановление старых сохранённых партий: незнакомое имя экрана
// превращается в GameHome — экран партии, который теперь и так вмещает в
// себя весь этот флоу.
//
// FinishScreen (п.8 правок): раньше отдельный промежуточный шаг "Партия
// завершена" с кнопкой на итог партии. Убран из стека совсем — теперь при
// завершении партии сразу показываем сам итог (см. GameHome.tsx). Но
// сохранённая на диске партия старого пользователя может ссылаться именно
// на 'FinishScreen' как на текущий экран (запись сделана до этой правки) —
// такую партию открываем прямо на Summary, а не на GameHome, чтобы не
// откатывать человека на доску, если он уже дошёл до конца пути.
const KNOWN_SCREENS = new Set<ScreenName>(['Splash', 'MyGames', 'Intro', 'RequestInput', 'DiceModeSelect', 'GameHome', 'History', 'Summary']);

function normalizeScreenName(name: string): ScreenName {
  if (name === 'FinishScreen') return 'Summary';
  return KNOWN_SCREENS.has(name as ScreenName) ? (name as ScreenName) : 'GameHome';
}

// Этап 3: минимальный UI-каркас, собственный стек экранов (react-router
// сознательно не используется). Этап 4: партия переживает закрытие вкладки —
// на каждое изменение сессии/экрана пишем снимок в localStorage, при
// загрузке приложения восстанавливаем ровно тот экран, на котором
// остановились (не всегда на Splash).
function App() {
  const session = useGameSession();
  const [stack, setStack] = useState<ScreenEntry[]>([{ name: 'Splash' }]);
  const [hydrated, setHydrated] = useState(false);

  // Этап 6: Telegram Web App SDK. Вне Telegram все три хука — no-op, а
  // initTelegramApp()/captureInitData() просто не находят window.Telegram.
  useEffect(() => {
    initTelegramApp();
    captureInitData();
  }, []);
  useTelegramTheme();
  useTelegramViewport();

  // Восстановление активной партии. Выполняется один раз при монтировании —
  // до этого момента ничего не рендерим, чтобы не мигнуть Splash перед
  // переходом на восстановленный экран.
  useEffect(() => {
    const activeId = getActivePersistedGameId();
    if (activeId) {
      const record = loadPersistedGame(activeId);
      if (record) {
        session.restore(record);
        // resolveGameScreen — самолечение записей, испорченных найденным
        // багом "Продолжить заводит новую партию" (см. комментарий в
        // state/resolveGameScreen.ts): если экран сохранён предыгровым, а у
        // партии уже есть реальный прогресс, открываем сразу GameHome.
        setStack([{ name: resolveGameScreen(normalizeScreenName(record.screen), record.game) }]);
      } else {
        // activeGameId ссылается на запись, которой больше нет (удалена
        // вручную или JSON повреждён) — просто забываем про неё.
        setActivePersistedGameId(null);
      }
    }
    setHydrated(true);
    // Намеренно один раз при монтировании — session.restore стабилен (useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Снимок сессии на каждое изменение партии/экрана/результата броска — это
  // и есть "закрыл вкладку посреди хода — восстановилось точно там же":
  // сохраняется не только GameState, но и текущий экран с последним броском.
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
    return <div className="app-shell" />;
  }

  const CurrentScreen = screens[current.name];

  return (
    <div className="app-shell">
      <CurrentScreen session={session} nav={nav} params={current.params} />
    </div>
  );
}

export default App;
