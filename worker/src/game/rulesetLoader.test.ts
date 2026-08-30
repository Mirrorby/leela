import { describe, it, expect } from 'vitest';
import { getRuleset, validateRuleset } from './rulesetLoader';
import type { Ruleset } from '../types/game';

function baseRuleset(overrides: Partial<Ruleset['transitions']> = {}): Ruleset {
  return {
    rulesetId: 'test-fixture',
    version: 1,
    board: { size: 72, startingArea: 0, finishCell: 68, extendedFinishCell: 72 },
    birth: { requiredValue: 6, entryCell: 1, description: '' },
    sixRule: {
      grantsExtraRoll: true,
      consecutiveLimit: 3,
      onLimitReached: { action: 'resetToPositionBeforeSeries', thenRollAgain: true, description: '' },
    },
    transitionRule: { appliesOnlyOnExactLanding: true, description: '' },
    transitions: { snakes: [], arrows: [], ...overrides },
    beyondFinish: { range: [69, 70, 71], rule: '' },
  };
}

describe('rulesetLoader', () => {
  it('classic-v1 (реальные продовые данные) проходит валидацию как есть — регрессия на будущие правки _todo', () => {
    expect(() => getRuleset('classic-v1')).not.toThrow();
    const ruleset = getRuleset('classic-v1');
    expect(ruleset).not.toBeNull();
    expect(() => validateRuleset(ruleset!)).not.toThrow();
  });

  it('неизвестный rulesetId — null, а не исключение', () => {
    expect(getRuleset('no-such-ruleset')).toBeNull();
  });

  it('валидный набор без пересечений проходит', () => {
    const ruleset = baseRuleset({
      snakes: [{ from: 10, to: 4 }],
      arrows: [{ from: 20, to: 40 }],
    });
    expect(() => validateRuleset(ruleset)).not.toThrow();
  });

  it('падает на дублирующемся from между змеёй и стрелой', () => {
    const ruleset = baseRuleset({
      snakes: [{ from: 10, to: 4 }],
      arrows: [{ from: 10, to: 40 }],
    });
    expect(() => validateRuleset(ruleset)).toThrow(/сразу двух переходов/);
  });

  it('падает на цепочке переходов (to одного — from другого)', () => {
    const ruleset = baseRuleset({
      snakes: [{ from: 10, to: 20 }],
      arrows: [{ from: 20, to: 40 }],
    });
    expect(() => validateRuleset(ruleset)).toThrow(/цепочка переходов/);
  });

  it('падает на клетке вне границ доски', () => {
    const ruleset = baseRuleset({ snakes: [{ from: 10, to: 200 }] });
    expect(() => validateRuleset(ruleset)).toThrow(/вне границ доски/);
  });
});
