import type { BoardCoordinates } from '../types/board';
import classicV1Coordinates from '../data/board/classic-v1-coordinates.json';

// Реестр координатных раскладок — по одной на rulesetId, аналогично
// реестру ruleset'ов в game/ruleset.ts. Board.tsx сам ничего не резолвит,
// раскладку и путь к SVG-фону ему передаёт вызывающий экран.
const BOARD_COORDINATES: Record<string, BoardCoordinates> = {
  'classic-v1': classicV1Coordinates as BoardCoordinates,
};

// Путь к файлу с изображением доски. Лежит в /public, поэтому не импортится
// как модуль — собирается из BASE_URL, чтобы работать и на dev-сервере,
// и после деплоя на GitHub Pages (base: './' в vite.config.ts).
const BOARD_IMAGES: Record<string, string> = {
  'classic-v1': 'board/classic-v1-board.svg',
};

export function getBoardCoordinates(rulesetId: string): BoardCoordinates {
  const coords = BOARD_COORDINATES[rulesetId];
  if (!coords) {
    throw new Error(`Нет координатной раскладки доски для ruleset "${rulesetId}"`);
  }
  return coords;
}

export function getBoardImageSrc(rulesetId: string): string {
  const path = BOARD_IMAGES[rulesetId];
  if (!path) {
    throw new Error(`Нет изображения доски для ruleset "${rulesetId}"`);
  }
  return `${import.meta.env.BASE_URL}${path}`;
}
