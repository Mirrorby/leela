import type { Ruleset } from '../types/game';
// Намеренно НЕ копия: импортируем ЕДИНСТВЕННЫЙ classic-v1.json из src/data,
// тот же файл, что использует клиент. Так правила не могут разъехаться
// между фронтендом и Worker'ом при следующей правке (см. памятку проекта).
// eslint-disable-next-line import/no-relative-parent-imports
import classicV1Raw from '../../../src/data/rulesets/classic-v1.json';

/**
 * classic-v1.json — данные, снятые вручную с физической доски (не схема,
 * не код) — ничто не мешает следующей правке (например, заполнение _todo)
 * случайно завести дубль `from` или цепочку змея→стрела/стрела→змея.
 * transitionEngine.resolveTransition() применяет переход РОВНО один раз
 * (не рекурсивно) — если бы в данных завелась цепочка, часть пути молча
 * потерялась бы, и ни один существующий тест этого не поймает: тесты
 * гоняют движок на своих фикстурах, а не сами продовые данные. Валидация
 * здесь — дешёвая защита: ошибка в данных ронять Worker при СЛЕДУЮЩЕМ
 * деплое (виден в логах/health-чеке сразу), а не тихо ломает партии в
 * проде через непредсказуемое количество ходов.
 */
export function validateRuleset(ruleset: Ruleset): void {
  const allTransitions = [
    ...ruleset.transitions.snakes.map((t) => ({ ...t, kind: 'snake' as const })),
    ...ruleset.transitions.arrows.map((t) => ({ ...t, kind: 'arrow' as const })),
  ];

  const seenFrom = new Map<number, 'snake' | 'arrow'>();
  const targetsByFrom = new Map<number, number>();
  for (const t of allTransitions) {
    if (seenFrom.has(t.from)) {
      throw new Error(
        `Ruleset ${ruleset.rulesetId}: клетка ${t.from} — начало сразу двух переходов ` +
          `(${seenFrom.get(t.from)} и ${t.kind}). Каждая клетка может быть началом максимум одного перехода.`
      );
    }
    seenFrom.set(t.from, t.kind);
    targetsByFrom.set(t.from, t.to);

    if (t.from < 1 || t.from > ruleset.board.extendedFinishCell) {
      throw new Error(`Ruleset ${ruleset.rulesetId}: переход из клетки ${t.from} вне границ доски (1..${ruleset.board.extendedFinishCell}).`);
    }
    if (t.to < 1 || t.to > ruleset.board.extendedFinishCell) {
      throw new Error(`Ruleset ${ruleset.rulesetId}: переход из ${t.from} ведёт на клетку ${t.to} вне границ доски.`);
    }
  }

  for (const t of allTransitions) {
    if (targetsByFrom.has(t.to)) {
      throw new Error(
        `Ruleset ${ruleset.rulesetId}: цепочка переходов ${t.from} → ${t.to} → ${targetsByFrom.get(t.to)} — ` +
          `resolveTransition применяет переход только один раз, такая цепочка даст неверный результат хода.`
      );
    }
  }
}

const rulesets: Record<string, Ruleset> = {
  'classic-v1': classicV1Raw as unknown as Ruleset,
};

for (const ruleset of Object.values(rulesets)) {
  validateRuleset(ruleset);
}

export function getRuleset(rulesetId: string): Ruleset | null {
  return rulesets[rulesetId] ?? null;
}
