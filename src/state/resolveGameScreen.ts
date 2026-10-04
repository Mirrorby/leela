import type { ScreenName } from '../navigation/types';
import type { GameState } from '../types/game';

/** A resumed game opens at its current playable state. Global menus and
 * pre-game screens belong to navigation, never to the game itself. */
export function gameResumeScreen(game: GameState): ScreenName {
  return game.status === 'FINISHED' || game.status === 'ARCHIVED' ? 'Summary' : 'GameHome';
}

/** History may be saved while browsing, but an unfinished game cannot use
 * Summary. Explicit Continue/restart uses gameResumeScreen regardless of
 * this browsing hint, so History never becomes a stack with no way back. */
export function resolveGameScreen(screen: ScreenName, game: GameState | null): ScreenName {
  if (!game) return screen;
  if (screen === 'History') return screen;
  return gameResumeScreen(game);
}

// Редизайн (этап 7): шесть экранов флоу броска (DiceRoll, TurnResult,
// CellCard, TransitionEvent, ExtraRollPrompt, TripleSixReset) убраны из
// ScreenName и больше никогда не пушатся в стек — но старая сохранённая
// партия в localStorage (или партия, у которой на сервере такой снимок
// экрана никогда и не было — просто GameState с сервера, см. MyGames.tsx)
// могла быть записана с одним из этих имён как "текущий экран". TS-тип на
// рантайм-значение из JSON.parse/сервера не влияет, поэтому
// normalizeScreenName проверяет имена в хранилище. Явное открытие партии
// использует gameResumeScreen и не возвращает старый экран навигации.
const KNOWN_SCREENS = new Set<ScreenName>([
  'Splash',
  'MyGames',
  'Intro',
  'HowToPlay',
  'RequestInput',
  'DiceModeSelect',
  'GameHome',
  'History',
  'Summary',
  'Paywall',
  'YourAccess',
]);

export function normalizeScreenName(name: string): ScreenName {
  // FinishScreen (п.8 правок): раньше отдельный промежуточный шаг "Партия
  // завершена". Убран из стека — сохранённая до этой правки партия,
  // ссылающаяся на 'FinishScreen', открывается прямо на Summary, а не на
  // GameHome, чтобы не откатывать человека на доску, если он уже дошёл до
  // конца пути.
  if (name === 'FinishScreen') return 'Summary';
  return KNOWN_SCREENS.has(name as ScreenName) ? (name as ScreenName) : 'GameHome';
}
