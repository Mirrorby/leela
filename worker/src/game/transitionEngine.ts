import type { Ruleset } from '../types/game';

/**
 * Проверяет, есть ли переход (змея/стрела) с клетки landedCell.
 * Срабатывает ТОЛЬКО если ход завершается ровно на этой клетке
 * (appliesOnlyOnExactLanding из ruleset), а не при проходе мимо.
 *
 * TODO (этап 2): реализовать полную логику + покрыть unit-тестами
 * (кейсы: змея, стрела, отсутствие перехода, клетка вне диапазона).
 */
export function resolveTransition(ruleset: Ruleset, landedCell: number): number {
  const snake = ruleset.transitions.snakes.find((t) => t.from === landedCell);
  if (snake) return snake.to;

  const arrow = ruleset.transitions.arrows.find((t) => t.from === landedCell);
  if (arrow) return arrow.to;

  return landedCell;
}
