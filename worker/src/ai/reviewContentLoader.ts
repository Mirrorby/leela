import type { CellContent, ContentPack } from '../types/game';
// Тот же принцип, что у game/rulesetLoader.ts: импортируем ЕДИНСТВЕННЫЙ
// файл контента клеток из src/data, тот же, что использует клиент для
// текстов на экранах партии — чтобы ИИ-разбор описывал клетки теми же
// названиями/формулировками, что видит игрок, а не рассинхронизированной
// копией.
// eslint-disable-next-line import/no-relative-parent-imports
import ruCellsRaw from '../../../src/data/content/ru/cells.json';

const content = ruCellsRaw as unknown as ContentPack;

const cellsById = new Map<number, CellContent>(content.cells.map((c) => [c.id, c]));

export function getReviewContentPack(): ContentPack {
  return content;
}

export function getCellContent(id: number): CellContent | undefined {
  return cellsById.get(id);
}
