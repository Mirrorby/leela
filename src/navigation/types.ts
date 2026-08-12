// Навигация этапа 3 — без react-router, стек экранов держим сами в App.tsx.
// Здесь только типы: имена экранов, элемент стека, набор действий навигации.

export type ScreenName =
  | 'Splash'
  | 'MyGames'
  | 'Intro'
  | 'RequestInput'
  | 'DiceModeSelect'
  | 'GameHome'
  | 'DiceRoll'
  | 'TurnResult'
  | 'CellCard'
  | 'TransitionEvent'
  | 'ExtraRollPrompt'
  | 'TripleSixReset'
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
