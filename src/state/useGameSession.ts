import { useCallback, useState } from 'react';
import type { DiceMode, GameState, RollEvent } from '../types/game';
import { getRuleset, getContentPack } from '../game/ruleset';
import { createNewGame, processRoll } from '../game/gameEngine';
import { rollVirtualDice } from '../game/diceEngine';

// Этап 3 использует единственный ruleset/язык — как и было на этапах 1-2.
// Когда появится выбор ruleset'а в UI, эти константы станут параметрами.
const RULESET_ID = 'classic-v1';
const LANGUAGE = 'ru';

let clientEventCounter = 0;
function nextClientEventId(): string {
  clientEventCounter += 1;
  return `client-${Date.now()}-${clientEventCounter}`;
}

export interface LastMove {
  fromCell: number;
  /** Клетка, на которую фишка приземлилась ДО применения змеи/стрелы. */
  landedCell: number;
  /** Итоговая клетка ПОСЛЕ применения змеи/стрелы (если её не было — равна landedCell). */
  finalCell: number;
}

/**
 * useGameSession — единственная точка входа UI в Game Engine.
 * Экраны никогда не вызывают createNewGame/processRoll напрямую — только
 * через методы этого хука, чтобы вся логика идентификаторов бросков и
 * восстановления "что произошло" (LastMove) жила в одном месте.
 */
export function useGameSession() {
  const ruleset = getRuleset(RULESET_ID);
  const content = getContentPack(RULESET_ID, LANGUAGE);

  const [request, setRequest] = useState('');
  const [diceMode, setDiceMode] = useState<DiceMode>('virtual');
  const [game, setGame] = useState<GameState | null>(null);
  const [lastEvents, setLastEvents] = useState<RollEvent[]>([]);
  const [lastRollValue, setLastRollValue] = useState<number | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);

  // diceMode передаём явным overrides, а не читаем из состояния: setDiceMode
  // в React асинхронный, а DiceModeSelect зовёт setDiceMode(mode) и startGame()
  // в одном обработчике клика — без overrides startGame() увидел бы старое значение.
  const startGame = useCallback(
    (overrides?: { diceMode?: DiceMode }) => {
      const effectiveDiceMode = overrides?.diceMode ?? diceMode;
      const newGame = createNewGame({
        id: `game-${Date.now()}`,
        ruleset,
        request,
        diceMode: effectiveDiceMode,
      });
      setGame(newGame);
      setLastEvents([]);
      setLastRollValue(null);
      setLastMove(null);
      return newGame;
    },
    [ruleset, request, diceMode]
  );

  const roll = useCallback(
    (value?: number) => {
      if (!game) {
        throw new Error('roll() вызван до startGame()');
      }
      const diceValue = value ?? rollVirtualDice();
      const prevCell = game.currentCell;
      const result = processRoll(game, ruleset, diceValue, nextClientEventId());

      const moveEvent = result.events.find((e) => e.type === 'MOVE');
      const isOvershoot = moveEvent?.detail?.startsWith('overshoot') ?? false;
      const move: LastMove | null = moveEvent
        ? {
            fromCell: prevCell,
            landedCell: isOvershoot ? prevCell : prevCell + diceValue,
            finalCell: result.game.currentCell,
          }
        : null;

      setGame(result.game);
      setLastEvents(result.events);
      setLastRollValue(diceValue);
      setLastMove(move);

      return { game: result.game, events: result.events, value: diceValue };
    },
    [game, ruleset]
  );

  const reset = useCallback(() => {
    setRequest('');
    setDiceMode('virtual');
    setGame(null);
    setLastEvents([]);
    setLastRollValue(null);
    setLastMove(null);
  }, []);

  const cellById = useCallback((id: number) => content.cells.find((c) => c.id === id), [content]);

  return {
    ruleset,
    content,
    request,
    setRequest,
    diceMode,
    setDiceMode,
    game,
    lastEvents,
    lastRollValue,
    lastMove,
    startGame,
    roll,
    reset,
    cellById,
  };
}

export type GameSession = ReturnType<typeof useGameSession>;
