import { describe, it, expect } from 'vitest';
import type { Ruleset } from '../types/game';
import { createNewGame, processRoll, canRoll } from './gameEngine';

// Тестовая ruleset-фикстура, полностью независимая от production
// classic-v1.json — так тесты не ломаются, когда финальный список змей/стрел
// будет утверждён и вставлен в реальный контент.
const testRuleset: Ruleset = {
  rulesetId: 'test-v1',
  version: 1,
  board: {
    size: 20,
    startingArea: 0,
    finishCell: 18,
    extendedFinishCell: 20,
  },
  birth: {
    requiredValue: 6,
    entryCell: 1,
    description: 'test',
  },
  sixRule: {
    grantsExtraRoll: true,
    consecutiveLimit: 3,
    onLimitReached: {
      action: 'resetToPositionBeforeSeries',
      thenRollAgain: true,
      description: 'test',
    },
  },
  transitionRule: {
    appliesOnlyOnExactLanding: true,
    description: 'test',
  },
  transitions: {
    snakes: [{ from: 10, to: 3 }],
    arrows: [{ from: 5, to: 9 }],
  },
  beyondFinish: {
    range: [19, 20],
    rule: 'unknown',
  },
};

function newGame() {
  return createNewGame({ id: 'g1', ruleset: testRuleset, request: 'test', diceMode: 'virtual' });
}

describe('Game Engine', () => {
  it('1. вход в игру: WAITING_FOR_BIRTH -> IN_PROGRESS по броску 6', () => {
    const game = newGame();
    expect(game.status).toBe('WAITING_FOR_BIRTH');

    const { game: after } = processRoll(game, testRuleset, 6, 'e1');
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.isBorn).toBe(true);
    expect(after.currentCell).toBe(testRuleset.birth.entryCell);
  });

  it('вход в игру: бросок не 6 не рождает фишку', () => {
    const game = newGame();
    const { game: after, events } = processRoll(game, testRuleset, 4, 'e1');
    expect(after.status).toBe('WAITING_FOR_BIRTH');
    expect(after.isBorn).toBe(false);
    expect(events.some((e) => e.type === 'BIRTH_FAILED')).toBe(true);
  });

  it('2. обычный ход без спецэффектов', () => {
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // birth -> cell 1, extra roll
    const { game: after, events } = processRoll(game, testRuleset, 2, 'e2');
    expect(after.currentCell).toBe(3); // 1 + 2, клетка 3 без перехода
    expect(events.some((e) => e.type === 'SNAKE' || e.type === 'ARROW')).toBe(false);
  });

  it('3. ход, заканчивающийся на змее (10 -> 3)', () => {
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // -> cell 1
    game = processRoll(game, testRuleset, 3, 'e2').game; // -> cell 4 (extra roll, т.к. 6 был)
    const { game: after, events } = processRoll(game, testRuleset, 6, 'e3'); // 4+6=10, шестёрка!
    // 6 -> шестёрка добавляет consecutiveSixes, но переход должен сработать независимо от этого
    expect(after.currentCell).toBe(3); // приземлились на 10, змея унесла на 3
    expect(events.some((e) => e.type === 'SNAKE')).toBe(true);
  });

  it('4. ход, заканчивающийся на стреле (5 -> 9)', () => {
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // -> cell 1, extra roll
    const { game: after, events } = processRoll(game, testRuleset, 4, 'e2'); // 1+4=5
    expect(after.currentCell).toBe(9);
    expect(events.some((e) => e.type === 'ARROW')).toBe(true);
  });

  it('5. проход мимо змеи/стрелы транзитом не должен срабатывать', () => {
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // -> cell 1, extra roll
    // Один бросок на 6 сразу перепрыгивает через клетку-стрелу 5, приземляясь на 7
    const { game: after, events } = processRoll(game, testRuleset, 6, 'e2'); // 1+6=7, тоже шестёрка
    expect(after.currentCell).toBe(7);
    expect(events.some((e) => e.type === 'ARROW' || e.type === 'SNAKE')).toBe(false);
  });

  it('6. серия из двух шестёрок: доп. бросок, без сброса', () => {
    let game = newGame();
    let res = processRoll(game, testRuleset, 6, 'e1'); // birth (свой отдельный ход), даёт доп. бросок
    expect(res.events.some((e) => e.type === 'EXTRA_ROLL_GRANTED')).toBe(true);
    game = res.game;
    res = processRoll(game, testRuleset, 6, 'e2'); // six #1 новой серии, 1+6=7
    expect(res.game.consecutiveSixes).toBe(1);
    res = processRoll(res.game, testRuleset, 6, 'e2b'); // six #2, 7+6=13
    expect(res.game.consecutiveSixes).toBe(2);
    expect(res.events.some((e) => e.type === 'TRIPLE_SIX_RESET')).toBe(false);
    expect(res.events.some((e) => e.type === 'EXTRA_ROLL_GRANTED')).toBe(true);
    expect(res.game.currentCell).toBe(13);
  });

  it('7. серия из трёх шестёрок: сброс к позиции до серии + результат 4-го броска', () => {
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // birth -> cell 1 (свой отдельный ход)
    const positionBeforeSeries = game.currentCell; // 1

    game = processRoll(game, testRuleset, 6, 'e2').game; // six #1 новой серии -> cell 7
    game = processRoll(game, testRuleset, 6, 'e3').game; // six #2 -> cell 13
    const res3 = processRoll(game, testRuleset, 6, 'e4'); // six #3 -> triple six reset
    expect(res3.events.some((e) => e.type === 'TRIPLE_SIX_RESET')).toBe(true);
    expect(res3.game.currentCell).toBe(positionBeforeSeries); // откат к позиции до серии (1), рождение не откатывается
    expect(res3.game.isBorn).toBe(true);
    expect(res3.game.status).toBe('IN_PROGRESS');
    expect(res3.game.consecutiveSixes).toBe(0);

    // 4-й бросок серии — обычное движение от восстановленной позиции
    const res4 = processRoll(res3.game, testRuleset, 3, 'e5');
    expect(res4.game.currentCell).toBe(positionBeforeSeries + 3);
  });

  it('8. точное попадание на finishCell — победа', () => {
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // -> cell 1, extra roll
    // Двигаемся не-шестёрками до 17, потом точно на 18 (finishCell)
    game = processRoll(game, testRuleset, 5, 'e2').game; // 1 -> 6, но 5 не 6-переход... смотрим клетку 6 (нет перехода)
    game = processRoll(game, testRuleset, 5, 'e3').game; // 6 -> 11 (нет перехода на 11)
    const res = processRoll(game, testRuleset, 5, 'e4'); // 11 -> 16
    game = res.game;
    const final = processRoll(game, testRuleset, 2, 'e5'); // 16 -> 18 == finishCell
    expect(final.game.status).toBe('FINISHED');
    expect(final.game.currentCell).toBe(18);
    expect(final.events.some((e) => e.type === 'FINISH')).toBe(true);
  });

  it('9. перелёт за finishCell в диапазон 69-72 (аналог) — особая логика, партия не завершена', () => {
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // -> cell 1
    game = processRoll(game, testRuleset, 5, 'e2').game; // -> 6
    game = processRoll(game, testRuleset, 5, 'e3').game; // -> 11
    game = processRoll(game, testRuleset, 5, 'e4').game; // -> 16
    const res = processRoll(game, testRuleset, 3, 'e5'); // 16+3=19 > finishCell(18), <= extendedFinishCell(20)
    expect(res.game.status).not.toBe('FINISHED');
    expect(res.game.currentCell).toBe(19);
    expect(res.events.some((e) => e.type === 'BEYOND_FINISH')).toBe(true);
  });

  it('10. попытка ходить в статусе FINISHED отклоняется', () => {
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game;
    game = processRoll(game, testRuleset, 5, 'e2').game; // -> 6
    game = processRoll(game, testRuleset, 5, 'e3').game; // -> 11
    game = processRoll(game, testRuleset, 5, 'e4').game; // -> 16
    game = processRoll(game, testRuleset, 2, 'e5').game; // -> 18, FINISHED
    expect(game.status).toBe('FINISHED');
    expect(canRoll(game)).toBe(false);

    const res = processRoll(game, testRuleset, 3, 'e6');
    expect(res.events).toEqual([{ type: 'REJECTED_GAME_FINISHED' }]);
    expect(res.game.currentCell).toBe(18); // состояние не изменилось
  });

  it('11. идемпотентность: повторный submit с тем же clientEventId не создаёт дубль', () => {
    let game = newGame();
    const first = processRoll(game, testRuleset, 6, 'same-id');
    const totalRollsAfterFirst =
      first.game.currentTurnRolls.length + first.game.turns.reduce((sum, t) => sum + t.rolls.length, 0);

    const second = processRoll(first.game, testRuleset, 6, 'same-id');
    const totalRollsAfterSecond =
      second.game.currentTurnRolls.length + second.game.turns.reduce((sum, t) => sum + t.rolls.length, 0);

    expect(second.events).toEqual([{ type: 'DUPLICATE_IGNORED' }]);
    expect(totalRollsAfterSecond).toBe(totalRollsAfterFirst);
    expect(second.game.currentCell).toBe(first.game.currentCell);
  });

  it('12. смена dice mode между ходами не влияет на логику движка', () => {
    let game = newGame();
    expect(game.diceMode).toBe('virtual');
    game = processRoll(game, testRuleset, 6, 'e1').game;

    // Переключение режима — забота UI/Storage слоя, движок это поле не читает
    // для принятия решений о движении, только сохраняет как есть.
    const switched = { ...game, diceMode: 'physical' as const };
    const res = processRoll(switched, testRuleset, 3, 'e2');
    expect(res.game.currentCell).toBe(switched.currentCell + 3);
    expect(res.events.some((e) => e.type === 'REJECTED_INVALID_ROLL')).toBe(false);
  });
});
