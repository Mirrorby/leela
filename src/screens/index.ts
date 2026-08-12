import type { ComponentType } from 'react';
import type { ScreenName } from '../navigation/types';
import type { ScreenProps } from '../navigation/ScreenProps';

import { Splash } from './Splash';
import { Intro } from './Intro';
import { RequestInput } from './RequestInput';
import { DiceModeSelect } from './DiceModeSelect';
import { GameHome } from './GameHome';
import { DiceRoll } from './DiceRoll';
import { TurnResult } from './TurnResult';
import { CellCard } from './CellCard';
import { TransitionEvent } from './TransitionEvent';
import { ExtraRollPrompt } from './ExtraRollPrompt';
import { TripleSixReset } from './TripleSixReset';
import { History } from './History';
import { FinishScreen } from './FinishScreen';
import { Summary } from './Summary';

export const screens: Record<ScreenName, ComponentType<ScreenProps>> = {
  Splash,
  Intro,
  RequestInput,
  DiceModeSelect,
  GameHome,
  DiceRoll,
  TurnResult,
  CellCard,
  TransitionEvent,
  ExtraRollPrompt,
  TripleSixReset,
  History,
  FinishScreen,
  Summary,
};
