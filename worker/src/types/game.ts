// Базовые типы игры «Лила». Заполняются/уточняются по мере реализации Game Engine (этап 2).

export type DiceMode = 'physical' | 'virtual';

export type GameStatus =
  | 'WAITING_FOR_BIRTH'
  | 'IN_PROGRESS'
  | 'FINISHED'
  | 'ARCHIVED';

export interface Transition {
  from: number;
  to: number;
}

export interface Ruleset {
  rulesetId: string;
  version: number;
  board: {
    size: number;
    startingArea: number;
    finishCell: number;
    extendedFinishCell: number;
  };
  birth: {
    requiredValue: number;
    entryCell: number;
    description: string;
  };
  sixRule: {
    grantsExtraRoll: boolean;
    consecutiveLimit: number;
    onLimitReached: {
      action: string;
      thenRollAgain: boolean;
      description: string;
    };
  };
  transitionRule: {
    appliesOnlyOnExactLanding: boolean;
    description: string;
  };
  transitions: {
    snakes: Transition[];
    arrows: Transition[];
  };
  beyondFinish: {
    range: number[];
    rule: string;
  };
}

export interface CellContent {
  id: number;
  name: string;
  sanskrit: string;
  shortDescription: string;
  fullDescription: string;
  reflectionQuestions: string[];
}

export interface ContentPack {
  contentId: string;
  rulesetId: string;
  language: string;
  cells: CellContent[];
}

export interface Roll {
  id: string;
  clientEventId: string;
  value: number;
  createdAt: string;
}

export interface Turn {
  id: string;
  clientEventId: string;
  startCell: number;
  landedCell: number;
  finalCell: number;
  rolls: Roll[];
  createdAt: string;
}

export type RollEventType =
  | 'BIRTH_SUCCESS'
  | 'BIRTH_FAILED'
  | 'MOVE'
  | 'SNAKE'
  | 'ARROW'
  | 'EXTRA_ROLL_GRANTED'
  | 'TRIPLE_SIX_RESET'
  | 'FINISH'
  | 'BEYOND_FINISH'
  | 'REJECTED_GAME_FINISHED'
  | 'REJECTED_INVALID_ROLL'
  | 'DUPLICATE_IGNORED';

export interface RollEvent {
  type: RollEventType;
  detail?: string;
}

export interface GameState {
  id: string;
  rulesetId: string;
  rulesetVersion: number;
  request: string;
  status: GameStatus;
  diceMode: DiceMode;
  currentCell: number;
  isBorn: boolean;
  consecutiveSixes: number;
  /** Позиция фишки на момент начала текущей серии шестёрок — нужна для сброса по правилу тройной шестёрки. */
  positionBeforeSixSeries: number;
  /** Броски текущего незакрытого хода (turn). Закрывается и переносится в turns, когда серия шестёрок обрывается. */
  currentTurnRolls: Roll[];
  turns: Turn[];
  createdAt: string;
  updatedAt: string;
}
