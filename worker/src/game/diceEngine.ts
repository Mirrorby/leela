import type { DiceMode } from '../types/game';

/**
 * Возвращает значение броска.
 * - virtual: генерируется приложением (1..6)
 * - physical: значение вводит пользователь, эта функция в physical-режиме
 *   не вызывается для генерации — используется только для валидации.
 *
 * TODO (этап 2): валидация диапазона, подключение к gameEngine.
 */
export function rollVirtualDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function isValidDiceValue(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

export function requiresManualInput(mode: DiceMode): boolean {
  return mode === 'physical';
}
