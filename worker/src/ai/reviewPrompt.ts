import type { GameState } from '../types/game';
import { getCellContent } from './reviewContentLoader';

function cellLabel(id: number): string {
  const cell = getCellContent(id);
  return cell ? `№${id} «${cell.name}»` : `№${id}`;
}

/**
 * Собирает промпт из реального пути партии: для каждого хода — откуда
 * фишка пошла, куда легла, и если сработал переход (змея/стрела —
 * landedCell !== finalCell) — куда в итоге попала. Никакой информации,
 * которой нет в самой партии/контенте клеток, не добавляется — модель не
 * должна выдумывать детали пути.
 */
export function buildReviewPrompt(game: GameState): string {
  const journeyLines = game.turns.map((turn, index) => {
    const base = `${index + 1}. ${cellLabel(turn.startCell)} → ${cellLabel(turn.landedCell)}`;
    if (turn.landedCell !== turn.finalCell) {
      return `${base} → переход → ${cellLabel(turn.finalCell)}`;
    }
    return base;
  });

  const finalCellContent = getCellContent(game.currentCell);

  return [
    'Ты — вдумчивый проводник в традиционной трансформационной игре «Лила» (духовный вариант «змей и лестниц» на 72 клетках).',
    'Игрок завершил партию. Напиши связный рефлексивный разбор его пути на русском языке — 3-5 абзацев, тёплый и вдумчивый тон, без эзотерического жаргона и категоричных предсказаний.',
    'Опирайся ТОЛЬКО на реальный путь ниже и на исходный запрос игрока — не выдумывай события, которых не было.',
    '',
    `Запрос игрока: "${game.request}"`,
    '',
    'Путь фишки по клеткам:',
    ...journeyLines,
    '',
    `Финальная клетка: ${cellLabel(game.currentCell)}${finalCellContent ? ` — ${finalCellContent.shortDescription}` : ''}`,
    '',
    'В разборе свяжи путь с исходным запросом: какие темы/повторения заметны, что финальная клетка может значить именно в контексте этого запроса. Не давай медицинских, юридических или финансовых советов.',
  ].join('\n');
}
