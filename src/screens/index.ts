import type { ComponentType } from 'react';
import type { ScreenName } from '../navigation/types';
import type { ScreenProps } from '../navigation/ScreenProps';

import { Splash } from './Splash';
import { MyGames } from './MyGames';
import { Intro } from './Intro';
import { RequestInput } from './RequestInput';
import { DiceModeSelect } from './DiceModeSelect';
import { GameHome } from './GameHome';
import { History } from './History';
import { FinishScreen } from './FinishScreen';
import { Summary } from './Summary';

// Редизайн (этап 7): DiceRoll, TurnResult, CellCard, TransitionEvent,
// ExtraRollPrompt, TripleSixReset здесь больше не регистрируются — их флоу
// переехал внутрь GameHome (модалка). Сами файлы экранов удалены из
// src/screens/ (их разметка — там, где ещё нужна, — либо переиспользована в
// components/CellContent.tsx, либо инлайнена прямо в GameHome.tsx).
export const screens: Record<ScreenName, ComponentType<ScreenProps>> = {
  Splash,
  MyGames,
  Intro,
  RequestInput,
  DiceModeSelect,
  GameHome,
  History,
  FinishScreen,
  Summary,
};
