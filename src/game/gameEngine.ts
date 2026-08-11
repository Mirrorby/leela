import type { GameState, Ruleset } from '../types/game';
import { getRuleset } from './ruleset';

/**
 * Game Engine — единственное место, где живёт игровая логика.
 * UI (экраны) и Storage (localStorage/backend) НИЧЕГО не знают о правилах
 * и обращаются сюда за любым решением: можно ли ходить, куда приземлились,
 * сработал ли переход, закончилась ли партия.
 *
 * Этап 1 (сейчас): только контракт и заготовка структуры.
 * Этап 2: полная реализация state machine + 12 unit-тестов из ТЗ:
 *   - вход в игру (WAITING_FOR_BIRTH -> IN_PROGRESS по броску 6)
 *   - обычный ход без спецэффектов
 *   - ход, заканчивающийся на змее
 *   - ход, заканчивающийся на стреле
 *   - проход мимо змеи/стрелы транзитом (не должно сработать)
 *   - серия из двух шестёрок (доп. бросок, без сброса)
 *   - серия из трёх шестёрок (сброс к позиции до серии + результат 4-го броска)
 *   - точное попадание на клетку 68 (победа)
 *   - перелёт за 68 в диапазон 69-72 (особая логика)
 *   - попытка ходить в статусе FINISHED (должна отклоняться)
 *   - идемпотентность: повторный submit с тем же clientEventId не создаёт дубль
 *   - смена диапазона диапазона хода: physical <-> virtual между ходами
 */

export function createNewGame(params: {
  id: string;
  rulesetId: string;
  request: string;
  diceMode: GameState['diceMode'];
}): GameState {
  const ruleset: Ruleset = getRuleset(params.rulesetId);
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
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}

// TODO (этап 2): submitRoll(game, value, clientEventId) -> { game, events }
// TODO (этап 2): submitTurn(game, rolls[], clientEventId) -> { game, events }
// TODO (этап 2): canRoll(game): boolean
// TODO (этап 2): isGameFinished(game): boolean
