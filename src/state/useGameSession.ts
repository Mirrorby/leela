import { useCallback, useState } from 'react';
import type { DiceMode, GameState, RollEvent } from '../types/game';
import { getRuleset, getContentPack } from '../game/ruleset';
import { createGameOnServer, rollOnServer, WorkerApiError } from '../api/workerClient';
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

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof WorkerApiError ? err.message : fallback;
}

/**
 * useGameSession — единственная точка входа UI в игру.
 * Экраны никогда не обращаются к Worker API напрямую — только через методы
 * этого хука, чтобы вся логика идентификаторов бросков и восстановления
 * "что произошло" (LastMove) жила в одном месте.
 *
 * Этап 7.5: startGame/roll стали сетевыми запросами к Worker'у — сам движок
 * (gameEngine.processRoll) здесь больше не вызывается, партию считает и
 * сохраняет сервер (тонкий клиент, решение зафиксировано в 7.4). ruleset/
 * content ниже нужны ТОЛЬКО для отображения (тексты клеток, доска) — не для
 * расчёта ходов.
 */
export function useGameSession() {
  const [request, setRequest] = useState('');
  const [diceMode, setDiceModeState] = useState<DiceMode>('virtual');
  const [game, setGame] = useState<GameState | null>(null);
  const [lastEvents, setLastEvents] = useState<RollEvent[]>([]);
  const [lastRollValue, setLastRollValue] = useState<number | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ruleset активной партии, а не константа — см. комментарий у RULESET_ID.
  const activeRulesetId = game?.rulesetId ?? RULESET_ID;
  const ruleset = getRuleset(activeRulesetId);
  const content = getContentPack(activeRulesetId, LANGUAGE);

  // setDiceMode обслуживает два разных момента:
  //  - ДО создания партии (экран DiceModeSelect) — там game ещё null,
  //    startGame() ниже подхватит значение из diceMode-состояния;
  //  - В ЛЮБОЙ момент во время партии (переключатель на GameHome) — тогда
  //    нужно также переписать game.diceMode, иначе следующий бросок
  //    продолжит использовать старый режим. ВАЖНО: это только ЛОКАЛЬНОЕ
  //    отображаемое состояние — партия на сервере узнает о новом diceMode
  //    из САМОГО следующего запроса на бросок (см. roll() ниже), отдельного
  //    запроса на смену режима нет.
  const setDiceMode = useCallback((mode: DiceMode) => {
    setDiceModeState(mode);
    setGame((prev) => (prev ? { ...prev, diceMode: mode, updatedAt: new Date().toISOString() } : prev));
  }, []);

  // diceMode передаём явным overrides, а не читаем из состояния: setDiceMode
  // в React асинхронный, а DiceModeSelect зовёт setDiceMode(mode) и startGame()
  // в одном обработчике клика — без overrides startGame() увидел бы старое значение.
  //
  // Сетевой запрос: POST /api/v1/games. Партию (включая id) создаёт и
  // возвращает Worker — клиент больше не изобретает id сам. Может бросить
  // WorkerApiError — вызывающий код (DiceModeSelect) обязан это обработать
  // (например, не переходить на GameHome при ошибке).
  const startGame = useCallback(
    async (overrides?: { diceMode?: DiceMode }) => {
      const effectiveDiceMode = overrides?.diceMode ?? diceMode;
      setIsBusy(true);
      setError(null);
      try {
        const newGame = await createGameOnServer(request, effectiveDiceMode);
        setGame(newGame);
        setLastEvents([]);
        setLastRollValue(null);
        setLastMove(null);
        return newGame;
      } catch (err) {
        setError(errorMessage(err, 'Не удалось создать партию — проверь соединение.'));
        throw err;
      } finally {
        setIsBusy(false);
      }
    },
    [request, diceMode]
  );

  // Сетевой запрос: POST /api/v1/games/:id/rolls. value передаётся ТОЛЬКО
  // для physical-режима (ввод человека) — для virtual сервер сам бросает
  // кубик и возвращает результат (см. workerClient.rollOnServer): клиент не
  // может и не должен пытаться угадать его заранее.
  const roll = useCallback(
    async (value?: number) => {
      if (!game) {
        throw new Error('roll() вызван до startGame()');
      }
      setIsBusy(true);
      setError(null);
      try {
        const result = await rollOnServer(game.id, nextClientEventId(), value, game.diceMode);
        const { game: nextGame, events, value: diceValue } = result;

        const moveEvent = events.find((e) => e.type === 'MOVE');
        const isOvershoot = moveEvent?.detail?.startsWith('overshoot') ?? false;
        // ВАЖНО (баг, найден при сверке правила сгорания трёх шестёрок,
        // актуально и для сетевого ответа): точка, ОТКУДА реально считается
        // это движение, — НЕ обязательно «где фишка визуально стояла до
        // броска» (game.currentCell, ещё локальное значение ДО этого
        // запроса). Если этим самым броском сгорела серия из трёх шестёрок,
        // сервер внутри себя откатывает позицию к positionBeforeSixSeries и
        // считает landedCell уже ОТТУДА.
        const burnedSixSeries = events.some((e) => e.type === 'TRIPLE_SIX_RESET');
        const moveBaseCell = burnedSixSeries ? game.positionBeforeSixSeries : game.currentCell;
        const move: LastMove | null = moveEvent
          ? {
              fromCell: moveBaseCell,
              landedCell: isOvershoot ? moveBaseCell : moveBaseCell + diceValue,
              finalCell: nextGame.currentCell,
            }
          : null;

        setGame(nextGame);
        setLastEvents(events);
        setLastRollValue(diceValue);
        setLastMove(move);

        // move возвращается синхронно (а не только через lastMove-состояние),
        // чтобы вызывающий код (оркестрация модалки в GameHome) мог сразу же,
        // без ожидания ре-рендера, узнать, был ли "перелёт" по змее/стреле —
        // от этого зависит, сколько фаз анимации доски нужно проиграть.
        return { game: nextGame, events, value: diceValue, move };
      } catch (err) {
        setError(errorMessage(err, 'Не удалось отправить бросок — проверь соединение.'));
        throw err;
      } finally {
        setIsBusy(false);
      }
    },
    [game]
  );

  // Восстанавливает сессию из сохранённого снимка (App.tsx вызывает это при
  // старте, если есть активная партия, или экран "Мои партии" — при выборе
  // другой сохранённой партии). ruleset/content подтянутся автоматически на
  // следующем рендере, т.к. они вычисляются из game.rulesetId выше.
  // Снимок — локальный кэш последнего известного состояния с сервера (не
  // источник истины): следующий roll() всё равно уйдёт на сервер и вернёт
  // актуальное состояние.
  const restore = useCallback((record: PersistedGame) => {
    setRequest(record.game.request);
    setDiceMode(record.game.diceMode);
    setGame(record.game);
    setLastEvents(record.lastEvents);
    setLastRollValue(record.lastRollValue);
    setLastMove(record.lastMove);
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setRequest('');
    setDiceMode('virtual');
    setGame(null);
    setLastEvents([]);
    setLastRollValue(null);
    setLastMove(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

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
    isBusy,
    error,
    clearError,
    startGame,
    roll,
    restore,
    reset,
    cellById,
  };
}

export type GameSession = ReturnType<typeof useGameSession>;
