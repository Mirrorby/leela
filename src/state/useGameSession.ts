import { useCallback, useState } from 'react';
import type { DiceMode, GameState, RollEvent } from '../types/game';
import { getRuleset, getContentPack } from '../game/ruleset';
import { createNewGame, processRoll } from '../game/gameEngine';
import { rollVirtualDice } from '../game/diceEngine';
import type { PersistedGame } from './persistence';

// RULESET_ID — версия правил для НОВЫХ партий (используется до тех пор,
// пока игра не создана: экраны Splash/RequestInput/DiceModeSelect ещё не
// имеют game.rulesetId, откуда его брать). Как только партия создана или
// восстановлена, ruleset ниже берётся из game.rulesetId, а не из этой
// константы — это и есть защита от миграции правил (этап 4, п.4): старая
// партия всегда играет по своим правилам, даже если реестр пополнился новой
// версией.
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
  const [request, setRequest] = useState('');
  const [diceMode, setDiceModeState] = useState<DiceMode>('virtual');
  const [game, setGame] = useState<GameState | null>(null);
  const [lastEvents, setLastEvents] = useState<RollEvent[]>([]);
  const [lastRollValue, setLastRollValue] = useState<number | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);

  // Ruleset активной партии, а не константа — см. комментарий у RULESET_ID.
  const activeRulesetId = game?.rulesetId ?? RULESET_ID;
  const ruleset = getRuleset(activeRulesetId);
  const content = getContentPack(activeRulesetId, LANGUAGE);

  // setDiceMode обслуживает два разных момента:
  //  - ДО создания партии (экран DiceModeSelect) — там game ещё null,
  //    startGame() ниже подхватит значение из diceMode-состояния;
  //  - В ЛЮБОЙ момент во время партии (переключатель на GameHome, редизайн
  //    этапа 7) — тогда нужно также переписать game.diceMode, иначе
  //    следующий бросок продолжит использовать старый режим (значение
  //    хранится в самой GameState, а не только в этом хуке).
  const setDiceMode = useCallback((mode: DiceMode) => {
    setDiceModeState(mode);
    setGame((prev) => (prev ? { ...prev, diceMode: mode, updatedAt: new Date().toISOString() } : prev));
  }, []);

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

      // move возвращается синхронно (а не только через lastMove-состояние),
      // чтобы вызывающий код (оркестрация модалки в GameHome) мог сразу же,
      // без ожидания ре-рендера, узнать, был ли "перелёт" по змее/стреле —
      // от этого зависит, сколько фаз анимации доски нужно проиграть.
      return { game: result.game, events: result.events, value: diceValue, move };
    },
    [game, ruleset]
  );

  // Восстанавливает сессию из сохранённого снимка (App.tsx вызывает это при
  // старте, если есть активная партия, или экран "Мои партии" — при выборе
  // другой сохранённой партии). ruleset/content подтянутся автоматически на
  // следующем рендере, т.к. они вычисляются из game.rulesetId выше.
  const restore = useCallback((record: PersistedGame) => {
    setRequest(record.game.request);
    setDiceMode(record.game.diceMode);
    setGame(record.game);
    setLastEvents(record.lastEvents);
    setLastRollValue(record.lastRollValue);
    setLastMove(record.lastMove);
  }, []);

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
    restore,
    reset,
    cellById,
  };
}

export type GameSession = ReturnType<typeof useGameSession>;
