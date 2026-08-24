import type { Ruleset } from '../types/game';
// Намеренно НЕ копия: импортируем ЕДИНСТВЕННЫЙ classic-v1.json из src/data,
// тот же файл, что использует клиент. Так правила не могут разъехаться
// между фронтендом и Worker'ом при следующей правке (см. памятку проекта).
// eslint-disable-next-line import/no-relative-parent-imports
import classicV1Raw from '../../../src/data/rulesets/classic-v1.json';

const rulesets: Record<string, Ruleset> = {
  'classic-v1': classicV1Raw as unknown as Ruleset,
};

export function getRuleset(rulesetId: string): Ruleset | null {
  return rulesets[rulesetId] ?? null;
}
