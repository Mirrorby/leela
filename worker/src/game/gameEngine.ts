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

/**
 * Ищет уже сохранённый Roll с этим clientEventId (в открытом ходе или в
 * закрытых turns) и возвращает его целиком — не просто true/false. Нужен
 * вызывающему коду (worker/src/index.ts:handleRoll) ДО генерации значения
 * кубика и ДО применения diceMode: раньше повторный (дублирующийся) запрос
 * на бросок всё равно прогонял virtual-режим через rollVirtualDice() и
 * возвращал этот СВЕЖЕСГЕНЕРИРОВАННЫЙ (случайный, не тот, что реально
 * выпал и был сохранён) value в ответе — хотя состояние партии оставалось
 * от первого, настоящего броска. Клиент в этом случае показывал бы на
 * кубике грань, которая не соответствует тому, что реально произошло.
 */
export function findRollByClientEventId(game: GameState, clientEventId: string): Roll | undefined {
  const inOpenTurn = game.currentTurnRolls.find((r) => r.clientEventId === clientEventId);
  if (inOpenTurn) return inOpenTurn;
  for (const turn of game.turns) {
    const found = turn.rolls.find((r) => r.clientEventId === clientEventId);
    if (found) return found;
  }
  return undefined;
}

function findProcessedRoll(game: GameState, clientEventId: string): boolean {
  return findRollByClientEventId(game, clientEventId) !== undefined;
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

// ВАЖНО (правка перед переносом на сервер): раньше здесь был модульный
// mutable-счётчик (`let rollCounter = 0`) — в браузере он живёт, пока
// открыта вкладка, но в Cloudflare Worker гарантий на переиспользование
// изолята между запросами нет: счётчик может обнулиться посреди партии, и
// два разных броска получат одинаковый id ("roll-1" дважды). Считаем id
// из уже имеющегося состояния партии — детерминированно, без скрытого
// состояния модуля, и одинаково работает в браузере и в Worker'е.
function nextRollId(game: GameState): string {
  return `roll-${game.turns.length}-${game.currentTurnRolls.length + 1}`;
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
  const roll: Roll = { id: nextRollId(next), clientEventId, value, createdAt: new Date().toISOString() };
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

  // ПРАВИЛО ШЕСТЁРОК (уточнено по реальным правилам, см. памятку):
  // "Сгорание" касается СТРОГО комбинации из ровно N (по умолчанию 3)
  // шестёрок подряд, за которыми сразу следует НЕ шестёрка — тогда именно
  // эти N шестёрок отменяются целиком (фишка откатывается на позицию до
  // начала серии), и засчитывается только следующий (не-шестёрочный) бросок.
  // НО если вместо этого выпадает ЕЩЁ одна (N+1-я) шестёрка подряд —
  // сгорание отменяется насовсем для этой серии, и ВСЕ броски (включая уже
  // сделанные N шестёрок) считаются кумулятивно как обычное движение.
  // Пример из правил: 6-6-6-3 → откат, идёт только 3 клетки. Но
  // 6-6-6-6-4 → сгорания нет вообще, идёт все 28 клеток (6+6+6+6+4).
  // Поэтому проверяем НЕ "трижды подряд" (>=), а "ровно N до этого броска,
  // и вот прямо сейчас — не шестёрка" (===) — иначе четвёртая шестёрка
  // сама эту проверку не пережила бы.
  const priorConsecutiveSixes = next.consecutiveSixes;
  const burnsSixSeries = priorConsecutiveSixes === ruleset.sixRule.consecutiveLimit && !isSix;

  if (burnsSixSeries) {
    next.currentCell = next.positionBeforeSixSeries;
    events.push({ type: 'TRIPLE_SIX_RESET' });
  }
  next.consecutiveSixes = isSix ? priorConsecutiveSixes + 1 : 0;

  const rawTarget = next.currentCell + value;

  if (rawTarget > ruleset.board.extendedFinishCell) {
    // Перелёт дальше последней клетки доски (72) — ход "сгорает", фишка
    // остаётся на месте (правило "точного попадания"). Это же правило,
    // без каких-либо доп. условий, естественным образом ограничивает
    // клетки 69–71 малыми числами (см. beyondFinish в ruleset) — не нужно
    // отдельно проверять "с 69 можно только 1-2-3": любой больший бросок
    // просто закономерно превышает 72.
    events.push({ type: 'MOVE', detail: 'overshoot: stayed in place' });
    if (isSix && ruleset.sixRule.grantsExtraRoll) {
      events.push({ type: 'EXTRA_ROLL_GRANTED' });
    } else {
      closeCurrentTurn(next, startCellOfTurn, next.currentCell, next.currentCell);
    }
    next.updatedAt = new Date().toISOString();
    return { game: next, events };
  }

  // Обычное движение — включая заход в клетки 69–72 (зона "за 68, но
  // ещё на доске"): это НЕ особый случай, а такое же обычное движение,
  // только к нему применяются переходы ниже (в т.ч. клетка 72 — это и
  // есть "длинная змея", отправляющая обратно на 51 — обычная запись в
  // transitions.snakes, отдельного кода не требует).
  const landedCell = rawTarget;
  events.push({ type: 'MOVE' });
  if (landedCell > ruleset.board.finishCell) {
    events.push({ type: 'BEYOND_FINISH', detail: 'clarified: small-number correction zone before true finish' });
  }

  const finalCell = resolveTransition(ruleset, landedCell);
  if (finalCell !== landedCell) {
    const isSnake = ruleset.transitions.snakes.some((t) => t.from === landedCell);
    events.push({ type: isSnake ? 'SNAKE' : 'ARROW' });
  }

  next.currentCell = finalCell;

  // Финиш — если ИТОГОВАЯ клетка (после применения перехода, если он был)
  // равна финишной, партия завершена. Проверяем именно finalCell, а не
  // landedCell — так, чтобы попадание на финиш ЧЕРЕЗ стрелу/змею тоже
  // засчитывалось как победа (подтверждено: "если игрок становится на 68
  // даже по стреле — это в любом случае финиш"). Раньше здесь была
  // реальная ошибка: финиш проверялся только по прямому броску, до
  // применения перехода — из-за этого стрела 54→68 не завершала партию.
  if (finalCell === ruleset.board.finishCell) {
    next.status = 'FINISHED';
    events.push({ type: 'FINISH' });
    closeCurrentTurn(next, startCellOfTurn, landedCell, finalCell);
    next.updatedAt = new Date().toISOString();
    return { game: next, events };
  }

  if (isSix && ruleset.sixRule.grantsExtraRoll) {
    events.push({ type: 'EXTRA_ROLL_GRANTED' });
  } else {
    closeCurrentTurn(next, startCellOfTurn, landedCell, finalCell);
  }

  next.updatedAt = new Date().toISOString();
  return { game: next, events };
}
