// Навигация этапа 3 — без react-router, стек экранов держим сами в App.tsx.
// Здесь только типы: имена экранов, элемент стека, набор действий навигации.
//
// Редизайн (этап 7): DiceRoll, TurnResult, CellCard, TransitionEvent,
// ExtraRollPrompt и TripleSixReset больше не отдельные экраны стека — весь
// этот флоу теперь живёт внутри GameHome как модалка поверх доски (см.
// screens/GameHome.tsx). Из ScreenName их убрали намеренно: раз они больше
// никогда не пушатся в стек, лишний вариант в типе — источник опечаток.
// Старые сохранённые партии, где в localStorage мог остаться один из этих
// шести экранов как "текущий" (запись сделана до редизайна), нормализуются
// в GameHome при восстановлении — см. normalizeScreenName() в App.tsx.
export type ScreenName =
  | 'Splash'
  | 'MyGames'
  | 'Intro'
  | 'RequestInput'
  | 'DiceModeSelect'
  | 'GameHome'
  | 'History'
  | 'FinishScreen'
  | 'Summary';

export interface ScreenEntry {
  name: ScreenName;
  /** Необязательные параметры конкретного экрана (сейчас не используются, задел на будущее). */
  params?: Record<string, unknown>;
}

export interface NavigationActions {
  /** Положить новый экран поверх стека. */
  push: (name: ScreenName, params?: Record<string, unknown>) => void;
  /** Заменить верхний экран стека (не растит историю). */
  replace: (name: ScreenName, params?: Record<string, unknown>) => void;
  /** Вернуться на экран назад. */
  pop: () => void;
  /** Сбросить весь стек и начать заново с указанного экрана. */
  resetTo: (name: ScreenName, params?: Record<string, unknown>) => void;
}
