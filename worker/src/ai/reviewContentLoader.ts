import type { CellContent, ContentPack } from '../types/game';
// Тот же принцип, что у game/rulesetLoader.ts: импортируем соответствующий
// языковой файл контента клеток из src/data, тот же, что использует клиент для
// текстов на экранах партии — чтобы ИИ-разбор описывал клетки теми же
// названиями/формулировками, что видит игрок, а не рассинхронизированной
// копией.
// eslint-disable-next-line import/no-relative-parent-imports
import ruCellsRaw from '../../../src/data/content/ru/cells.json';

import enCellsRaw from '../../../src/data/content/en/cells.json';
import type { ReviewLanguage } from './reviewFormat';
const packs = { ru: ruCellsRaw as ContentPack, en: enCellsRaw as ContentPack };
const maps = { ru: new Map(packs.ru.cells.map(c => [c.id, c])), en: new Map(packs.en.cells.map(c => [c.id, c])) };
export function getReviewContentPack(language: ReviewLanguage = 'ru'): ContentPack { return packs[language]; }
export function getCellContent(id: number, language: ReviewLanguage = 'ru'): CellContent | undefined { return maps[language].get(id); }
