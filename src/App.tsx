import { useCallback, useState } from 'react';
import { useGameSession } from './state/useGameSession';
import type { NavigationActions, ScreenEntry, ScreenName } from './navigation/types';
import { screens } from './screens';
import './App.css';

// Этап 3: минимальный UI-каркас. Навигация — собственный стек экранов
// (react-router сознательно не используется), состояние партии — в
// useGameSession. Цель этапа: прогнать весь пользовательский сценарий
// руками и убедиться, что Engine и UI стыкуются корректно.
function App() {
  const session = useGameSession();
  const [stack, setStack] = useState<ScreenEntry[]>([{ name: 'Splash' }]);

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
  const CurrentScreen = screens[current.name];

  return (
    <div className="app-shell">
      <CurrentScreen session={session} nav={nav} params={current.params} />
    </div>
  );
}

export default App;
