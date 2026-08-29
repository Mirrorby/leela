import { describe, it, expect } from 'vitest';
import { resolveGameScreen } from './resolveGameScreen';
import type { GameState } from '../types/game';

function makeGame(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'g1',
    rulesetId: 'classic-v1',
    rulesetVersion: 1,
    request: 'test',
    status: 'IN_PROGRESS',
    diceMode: 'virtual',
    currentCell: 14,
    isBorn: true,
    consecutiveSixes: 0,
    positionBeforeSixSeries: 0,
    currentTurnRolls: [],
    turns: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveGameScreen', () => {
  it('баг "Продолжить заводит новую партию": предыгровой экран (RequestInput), сохранённый для партии с прогрессом (не WAITING_FOR_BIRTH), подменяется на GameHome', () => {
    const game = makeGame({ status: 'IN_PROGRESS' });
    expect(resolveGameScreen('RequestInput', game)).toBe('GameHome');
    expect(resolveGameScreen('DiceModeSelect', game)).toBe('GameHome');
    expect(resolveGameScreen('Intro', game)).toBe('GameHome');
  });

  it('то же самое для завершённой партии (FINISHED тоже "есть прогресс")', () => {
    const game = makeGame({ status: 'FINISHED' });
    expect(resolveGameScreen('RequestInput', game)).toBe('GameHome');
  });

  it('партия ещё реально WAITING_FOR_BIRTH — предыгровой экран оставляем как есть (это не баг, а нормальное состояние)', () => {
    const game = makeGame({ status: 'WAITING_FOR_BIRTH', isBorn: false });
    expect(resolveGameScreen('RequestInput', game)).toBe('RequestInput');
    expect(resolveGameScreen('DiceModeSelect', game)).toBe('DiceModeSelect');
  });

  it('game отсутствует (null) — экран не трогаем (нечего сопоставлять с прогрессом)', () => {
    expect(resolveGameScreen('RequestInput', null)).toBe('RequestInput');
  });

  it('экраны вне "предыгровых" (GameHome, History, Summary, MyGames, Splash) никогда не подменяются', () => {
    const game = makeGame({ status: 'IN_PROGRESS' });
    expect(resolveGameScreen('GameHome', game)).toBe('GameHome');
    expect(resolveGameScreen('History', game)).toBe('History');
    expect(resolveGameScreen('Summary', game)).toBe('Summary');
    expect(resolveGameScreen('MyGames', game)).toBe('MyGames');
    expect(resolveGameScreen('Splash', game)).toBe('Splash');
  });
});
