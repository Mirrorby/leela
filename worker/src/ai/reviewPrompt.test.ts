import { describe, it, expect } from 'vitest';
import { buildReviewPrompt } from './reviewPrompt';
import { getCellContent } from './reviewContentLoader';
import type { GameState, Turn } from '../types/game';

function turn(startCell: number, landedCell: number, finalCell: number): Turn {
  return { id: 't', clientEventId: 'c', startCell, landedCell, finalCell, rolls: [], createdAt: '' };
}

function makeGame(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'game-1',
    rulesetId: 'classic-v1',
    rulesetVersion: 1,
    request: 'Хочу понять, как двигаться дальше в карьере',
    status: 'FINISHED',
    diceMode: 'virtual',
    currentCell: 4,
    isBorn: true,
    consecutiveSixes: 0,
    positionBeforeSixSeries: 0,
    currentTurnRolls: [],
    turns: [turn(0, 1, 1), turn(1, 6, 4)],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:10:00.000Z',
    ...overrides,
  };
}

describe('buildReviewPrompt', () => {
  it('включает исходный запрос игрока дословно', () => {
    const prompt = buildReviewPrompt(makeGame());
    expect(prompt).toContain('Хочу понять, как двигаться дальше в карьере');
  });

  it('включает названия клеток из реального контент-пака (не просто номера)', () => {
    const prompt = buildReviewPrompt(makeGame());
    const cell1 = getCellContent(1)!;
    expect(prompt).toContain(cell1.name);
    expect(prompt).toContain('№1');
  });

  it('ход без перехода (landedCell === finalCell) — без пометки "переход"', () => {
    const prompt = buildReviewPrompt(makeGame({ turns: [turn(0, 1, 1)] }));
    const lines = prompt.split('\n');
    const turnLine = lines.find((l) => l.startsWith('1. '))!;
    expect(turnLine).not.toContain('переход');
  });

  it('ход с переходом (landedCell !== finalCell) — явно помечен "→ переход →"', () => {
    const prompt = buildReviewPrompt(makeGame({ turns: [turn(1, 6, 4)] }));
    const lines = prompt.split('\n');
    const turnLine = lines.find((l) => l.startsWith('1. '))!;
    expect(turnLine).toContain('→ переход →');
    expect(turnLine).toContain('№6');
    expect(turnLine).toContain('№4');
  });

  it('включает финальную клетку с коротким описанием', () => {
    const prompt = buildReviewPrompt(makeGame({ currentCell: 1 }));
    const cell1 = getCellContent(1)!;
    expect(prompt).toContain(`Финальная клетка: №1 «${cell1.name}»`);
    expect(prompt).toContain(cell1.shortDescription);
  });

  it('несколько ходов нумеруются по порядку', () => {
    const prompt = buildReviewPrompt(makeGame({ turns: [turn(0, 1, 1), turn(1, 3, 3), turn(3, 6, 6)] }));
    expect(prompt).toContain('1. №0');
    expect(prompt).toContain('2. №1');
    expect(prompt).toContain('3. №3');
  });

  it('не даёт медицинских/юридических/финансовых советов — явная инструкция в промпте', () => {
    const prompt = buildReviewPrompt(makeGame());
    expect(prompt.toLowerCase()).toContain('медицинских');
  });
});
