import type { GameSession } from '../state/useGameSession';
import type { NavigationActions, ScreenEntry } from './types';

/** Пропсы, которые получает любой из 15 экранов. */
export interface ScreenProps {
  session: GameSession;
  nav: NavigationActions;
  params?: ScreenEntry['params'];
}
