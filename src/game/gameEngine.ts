import type { GameState, Ruleset, RollEvent, Roll, Turn } from '../types/game';
import { isValidDiceValue } from './diceEngine';
import { resolveTransition } from './transitionEngine';

/**
 * Game Engine — единственное место, где живёт игровая логика.
 * UI (экраны) и Storage (localStorage/backend) НИЧЕГО не знают о правилах
 * и обращаются сюда за любым решением: можно ли ходить, куда приземлились,
 * сработал ли переход, закончилась ли партия.
 *
 * Важно: движок НЕ ищет ruleset сам (не знает про реестр rulesetов) —
 * ruleset ему явно передаёт вызывающий код (UI/Storage слой). Это делает
 * движок чистым и легко тестируемым: любой тест может передать свой
 * собственный ruleset-фикстуру, не трогая продовые данные.
 *
 * Публичный API:
 *   - createNewGame(...)  — создать новую партию
 *   - canRoll(game)       — можно ли сейчас бросать кубик
 *   - processRoll(game, ruleset, value, clientEventId) — обработать один бросок
 */

export function createNewGame(params: {
  id: string;
  ruleset: Ruleset;
  request: string;
  diceMode: GameState['diceMode'];
}): GameState {
  const { ruleset } = params;
  const now = new Date().toISOString();

  return {
    id: params.id,
    rulesetId: ruleset.rulesetId,
    rulesetVersion: ruleset.version,
    request: params.request,
    status: 'WAITING_FOR_BIRTH',
    diceMode: params.diceMode,
    currentCell: ruleset.board.startingArea,
    isBorn: false,
    consecutiveSixes: 0,
    positionBeforeSixSeries: ruleset.board.startingArea,
    currentTurnRolls: [],
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function canRoll(game: GameState): boolean {
  return game.status === 'WAITING_FOR_BIRTH' || game.status === 'IN_PROGRESS';
}

function findProcessedRoll(game: GameState, clientEventId: string): boolean {
  const inOpenTurn = game.currentTurnRolls.some((r) => r.clientEventId === clientEventId);
  if (inOpenTurn) return true;
  return game.turns.some((t) => t.rolls.some((r) => r.clientEventId === clientEventId));
}

function closeCurrentTurn(game: GameState, startCell: number, landedCell: number, finalCell: number): void {
  if (game.currentTurnRolls.length === 0) return;
  const turn: Turn = {
    id: `turn-${game.turns.length + 1}`,
    clientEventId: game.currentTurnRolls[0].clientEventId,
    startCell,
    landedCell,
    finalCell,
    rolls: game.currentTurnRolls,
    createdAt: new Date().toISOString(),
  };
  game.turns.push(turn);
  game.currentTurnRolls = [];
}

let rollCounter = 0;
function nextRollId(): string {
  rollCounter += 1;
  return `roll-${rollCounter}`;
}

/**
 * Обрабатывает один бросок кубика и возвращает НОВОЕ состояние игры
 * (иммутабельно — исходный объект game не модифицируется) плюс список
 * событий, которые произошли в результате броска.
 */
export function processRoll(
  game: GameState,
  ruleset: Ruleset,
  value: number,
  clientEventId: string
): { game: GameState; events: RollEvent[] } {
  // Идемпотентность: повторный submit с тем же clientEventId не создаёт дубль.
  if (findProcessedRoll(game, clientEventId)) {
    return { game, events: [{ type: 'DUPLICATE_IGNORED' }] };
  }

  if (!canRoll(game)) {
    return { game, events: [{ type: 'REJECTED_GAME_FINISHED' }] };
  }

  if (!isValidDiceValue(value)) {
    return { game, events: [{ type: 'REJECTED_INVALID_ROLL' }] };
  }

  const next: GameState = {
    ...game,
    currentTurnRolls: [...game.currentTurnRolls],
    turns: [...game.turns],
  };
  const events: RollEvent[] = [];
  const roll: Roll = { id: nextRollId(), clientEventId, value, createdAt: new Date().toISOString() };
  const startCellOfTurn = next.currentTurnRolls.length === 0 ? next.currentCell : next.positionBeforeSixSeries;

  // Начало новой серии бросков (первый бросок хода) — запоминаем позицию для возможного сброса по тройной шестёрке.
  if (next.currentTurnRolls.length === 0) {
    next.positionBeforeSixSeries = next.currentCell;
  }
  next.currentTurnRolls.push(roll);

  // --- Ветка "рождения" ---
  if (!next.isBorn) {
    if (value === ruleset.birth.requiredValue) {
      next.isBorn = true;
      next.status = 'IN_PROGRESS';
      next.currentCell = ruleset.birth.entryCell;
      events.push({ type: 'BIRTH_SUCCESS' });

      // Рождение всегда закрывает свой ход как отдельный turn — даже если
      // шестёрка даёт доп. бросок, этот бросок открывает НОВУЮ серию.
      // Иначе тройная шестёрка сразу после рождения могла бы откатить
      // игрока обратно в состояние "ещё не родился", что не соответствует
      // ожидаемой семантике правила.
      closeCurrentTurn(next, startCellOfTurn, next.currentCell, next.currentCell);
      next.consecutiveSixes = 0;

      if (ruleset.sixRule.grantsExtraRoll) {
        events.push({ type: 'EXTRA_ROLL_GRANTED' });
      }
    } else {
      events.push({ type: 'BIRTH_FAILED' });
      next.consecutiveSixes = 0;
      closeCurrentTurn(next, startCellOfTurn, next.currentCell, next.currentCell);
    }
    next.updatedAt = new Date().toISOString();
    return { game: next, events };
  }

  // --- Обычный ход (фишка уже "родилась") ---
  const isSix = value === 6;

  if (isSix) {
    next.consecutiveSixes += 1;
  } else {
    next.consecutiveSixes = 0;
  }

  // Правило серии шестёрок: если подряд выпало consecutiveLimit шестёрок —
  // сброс к позиции до начала серии, фишка НЕ двигается по этому броску,
  // серия обнуляется, но ход не закрывается — следующий бросок будет
  // обработан как обычное движение от восстановленной позиции.
  if (isSix && next.consecutiveSixes >= ruleset.sixRule.consecutiveLimit) {
    events.push({ type: 'TRIPLE_SIX_RESET' });
    next.currentCell = next.positionBeforeSixSeries;
    next.consecutiveSixes = 0;
    next.updatedAt = new Date().toISOString();
    return { game: next, events };
  }

  const rawTarget = next.currentCell + value;
  let landedCell: number;
  let finalCell: number;

  if (rawTarget === ruleset.board.finishCell) {
    landedCell = rawTarget;
    finalCell = rawTarget;
    next.currentCell = rawTarget;
    next.status = 'FINISHED';
    events.push({ type: 'MOVE' }, { type: 'FINISH' });
    closeCurrentTurn(next, startCellOfTurn, landedCell, finalCell);
    next.updatedAt = new Date().toISOString();
    return { game: next, events };
  }

  if (rawTarget > ruleset.board.finishCell && rawTarget <= ruleset.board.extendedFinishCell) {
    // Диапазон 69–72: точное поведение не утверждено в ruleset (beyondFinish.rule === 'unknown').
    // Пока просто перемещаем фишку без завершения партии — уточнить при финальной сверке правил.
    landedCell = rawTarget;
    finalCell = rawTarget;
    next.currentCell = rawTarget;
    events.push({ type: 'MOVE' }, { type: 'BEYOND_FINISH', detail: 'beyondFinish rule not finalized in ruleset' });
    closeCurrentTurn(next, startCellOfTurn, landedCell, finalCell);
    next.updatedAt = new Date().toISOString();
    return { game: next, events };
  }

  if (rawTarget > ruleset.board.extendedFinishCell) {
    // Перелёт дальше доступного поля — ход "сгорает", фишка остаётся на месте
    // (стандартное для змей-и-лестниц правило "точного попадания"). Допущение,
    // требует подтверждения вместе с beyondFinish.rule.
    landedCell = next.currentCell;
    finalCell = next.currentCell;
    events.push({ type: 'MOVE', detail: 'overshoot: stayed in place' });
    if (isSix && ruleset.sixRule.grantsExtraRoll) {
      events.push({ type: 'EXTRA_ROLL_GRANTED' });
    } else {
      closeCurrentTurn(next, startCellOfTurn, landedCell, finalCell);
    }
    next.updatedAt = new Date().toISOString();
    return { game: next, events };
  }

  // Обычное движение в пределах доски.
  landedCell = rawTarget;
  events.push({ type: 'MOVE' });

  finalCell = resolveTransition(ruleset, landedCell);
  if (finalCell !== landedCell) {
    const isSnake = ruleset.transitions.snakes.some((t) => t.from === landedCell);
    events.push({ type: isSnake ? 'SNAKE' : 'ARROW' });
  }

  next.currentCell = finalCell;

  if (isSix && ruleset.sixRule.grantsExtraRoll) {
    events.push({ type: 'EXTRA_ROLL_GRANTED' });
  } else {
    closeCurrentTurn(next, startCellOfTurn, landedCell, finalCell);
  }

  next.updatedAt = new Date().toISOString();
  return { game: next, events };
}
