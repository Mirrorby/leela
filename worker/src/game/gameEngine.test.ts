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
    // Добавлена { from: 17, to: 18 } специально для теста №13 ниже — стрела,
    // ведущая ТОЧНО на finishCell (18), чтобы проверить исправленный баг
    // "переход на финиш не завершал партию". На остальные тесты не влияет:
    // ни один из их маршрутов не проходит через клетку 17.
    arrows: [
      { from: 5, to: 9 },
      { from: 17, to: 18 },
    ],
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

  it('7. серия из трёх шестёрок подряд, затем НЕ шестёрка: сгорание всех трёх, откат к позиции до серии + результат следующего броска', () => {
    // Подтверждено по реальным правилам (см. памятку): сгорание — это
    // строго "ровно 3 шестёрки подряд, а следующий бросок — НЕ шестёрка".
    // Каждая из трёх шестёрок при этом ПРИМЕНЯЕТСЯ как обычное движение
    // (не блокируется заранее) — а сгорает (откатывается) только когда
    // становится ясно, что серия закончилась именно на тройке. Пример из
    // правил: 6-6-6-3 -> фишка идёт всего на 3 клетки от позиции до серии.
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // birth -> cell 1 (свой отдельный ход)
    const positionBeforeSeries = game.currentCell; // 1

    let res = processRoll(game, testRuleset, 6, 'e2'); // six #1 новой серии -> cell 7
    expect(res.game.currentCell).toBe(7);
    expect(res.game.consecutiveSixes).toBe(1);
    game = res.game;

    res = processRoll(game, testRuleset, 6, 'e3'); // six #2 -> cell 13
    expect(res.game.currentCell).toBe(13);
    expect(res.game.consecutiveSixes).toBe(2);
    game = res.game;

    res = processRoll(game, testRuleset, 6, 'e4'); // six #3 — движение ПРИМЕНЯЕТСЯ (13+6=19>18, значит перелёт "сгорает" по правилу границы доски — возьмём другой путь ниже, тут просто проверяем счётчик)
    expect(res.game.consecutiveSixes).toBe(3);
    game = res.game;
    const cellAfterThirdSix = game.currentCell;

    const res4 = processRoll(game, testRuleset, 3, 'e5'); // НЕ шестёрка сразу после ровно 3 шестёрок -> сгорание
    expect(res4.events.some((e) => e.type === 'TRIPLE_SIX_RESET')).toBe(true);
    expect(res4.game.currentCell).toBe(positionBeforeSeries + 3); // откат к позиции ДО серии, затем этот бросок применён с неё
    expect(res4.game.currentCell).not.toBe(cellAfterThirdSix + 3); // это НЕ продолжение от клетки после третьей шестёрки
    expect(res4.game.isBorn).toBe(true);
    expect(res4.game.status).toBe('IN_PROGRESS');
    expect(res4.game.consecutiveSixes).toBe(0);
  });

  it('7b. ЧЕТЫРЕ шестёрки подряд — сгорание отменяется, все броски считаются кумулятивно (6-6-6-6-4 = 28 клеток)', () => {
    // Ключевой пример из реальных правил: если после ровно трёх шестёрок
    // выпадает ЕЩЁ одна (четвёртая) шестёрка — откат отменяется насовсем
    // для этой серии, и весь путь (включая все четыре шестёрки) считается
    // как обычное кумулятивное движение.
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // birth -> cell 1 (start = 1)

    game = processRoll(game, testRuleset, 6, 'e2').game; // six #1 -> 7
    game = processRoll(game, testRuleset, 6, 'e3').game; // six #2 -> 13

    // Дальше по прямой (13+6=19) вышли бы за extendedFinishCell(20)? Нет,
    // 19<=20 — это "клетка за финишем" зона, движение не блокируется.
    const res3 = processRoll(game, testRuleset, 6, 'e4'); // six #3 -> 13+6=19
    expect(res3.game.consecutiveSixes).toBe(3);
    expect(res3.game.currentCell).toBe(19);
    game = res3.game;

    // six #4 подряд — сгорание НЕ срабатывает, движение кумулятивное дальше.
    // 19+6=25 > extendedFinishCell(20) -> перелёт, ход "сгорает" (фишка на
    // месте), но это уже другое правило (граница доски), не тройная
    // шестёрка — TRIPLE_SIX_RESET здесь быть не должно.
    const res4 = processRoll(game, testRuleset, 6, 'e5');
    expect(res4.events.some((e) => e.type === 'TRIPLE_SIX_RESET')).toBe(false);
    expect(res4.game.currentCell).toBe(19); // перелёт за доску -> осталась на месте, а не откатилась к 1
    expect(res4.game.consecutiveSixes).toBe(4);
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

  it('9. перелёт за finishCell в диапазон 69-72 (аналог) — не блокируется, обычное движение, партия не завершена', () => {
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

  it('13. переход (стрела/змея), приводящий ТОЧНО на finishCell, тоже завершает партию (исправленный баг)', () => {
    // Раньше здесь была реальная ошибка: финиш проверялся только по
    // прямому броску (rawTarget === finishCell), ДО применения перехода —
    // из-за этого стрела/змея, ведущая точно на финишную клетку, молча
    // перемещала фишку туда, но партия не завершалась. Подтверждено:
    // "если игрок становится на 68 даже по стреле — это в любом случае
    // финиш". В тестовой фикстуре для этого добавлена стрела 17 -> 18
    // (18 == finishCell).
    let game = newGame();
    game = processRoll(game, testRuleset, 6, 'e1').game; // birth -> 1
    game = processRoll(game, testRuleset, 2, 'e2').game; // 1 -> 3 (не 5 и не 10, без переходов)
    game = processRoll(game, testRuleset, 3, 'e3').game; // 3 -> 6
    game = processRoll(game, testRuleset, 3, 'e4').game; // 6 -> 9 (это "to" стрелы 5->9, но не "from" — переход не срабатывает)
    game = processRoll(game, testRuleset, 4, 'e5').game; // 9 -> 13

    // 13 -> 17 напрямую (это "from" стрелы 17->18) — переход срабатывает
    // СРАЗУ на этом же броске, телепортируя на 18 == finishCell.
    const final = processRoll(game, testRuleset, 4, 'e6');
    expect(final.game.currentCell).toBe(18);
    expect(final.game.status).toBe('FINISHED');
    expect(final.events.some((e) => e.type === 'ARROW')).toBe(true);
    expect(final.events.some((e) => e.type === 'FINISH')).toBe(true);
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
