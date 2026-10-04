import type { ReviewKind, ReviewLanguage } from './reviewFormat';
import type { GameState } from '../types/game';
import { getCellContent } from './reviewContentLoader';

function cellLabel(id: number, language: ReviewLanguage): string {
  const cell = getCellContent(id, language);
  return cell ? `№${id} «${cell.name}»` : `№${id}`;
}

/**
 * Собирает промпт из реального пути партии: для каждого хода — откуда
 * фишка пошла, куда легла, и если сработал переход (змея/стрела —
 * landedCell !== finalCell) — куда в итоге попала. Никакой информации,
 * которой нет в самой партии/контенте клеток, не добавляется — модель не
 * должна выдумывать детали пути.
 */
export function buildReviewPrompt(game: GameState, kind: ReviewKind = 'full', language: ReviewLanguage = 'ru'): string {
  const journeyLines = game.turns.map((turn, index) => {
    const base = `${index + 1}. ${cellLabel(turn.startCell, language)} → ${cellLabel(turn.landedCell, language)}`;
    if (turn.landedCell !== turn.finalCell) {
      return `${base} → ${language === 'en' ? 'transition' : 'переход'} → ${cellLabel(turn.finalCell, language)}`;
    }
    return base;
  });

  const finalCellContent = getCellContent(game.currentCell, language);

  if (language === 'en') return [
    'You are a thoughtful guide to Leela, the traditional 72-square game of self-discovery (a spiritual form of snakes and ladders).',
    kind === 'short'
      ? 'The player has completed a game. Write a SHORT review in English: 70–100 words, two notable themes from the journey and one reflection question. Do not analyse every transition in detail. Use a warm tone, without esoteric jargon or definite predictions.'
      : 'The player has completed a game. Write a coherent reflective review of the journey in English: 3–5 paragraphs, with a warm, thoughtful tone, without esoteric jargon or definite predictions.',
    'Use ONLY the actual journey below and the player’s original intention. Do not invent events.',
    '', `Player’s intention: "${game.request}"`, '', 'Journey across the board:', ...journeyLines, '',
    `Final square: ${cellLabel(game.currentCell, language)}${finalCellContent ? ` — ${finalCellContent.shortDescription}` : ''}`, '',
    'Relate the journey to the original intention: themes, recurring patterns and what the final square may mean in this context. Do not give medical, legal or financial advice.',
  ].join('\n');
  return [
    'Ты — вдумчивый проводник в традиционной трансформационной игре «Лила» (духовный вариант «змей и лестниц» на 72 клетках).',
    kind === 'short' ? 'Игрок завершил партию. Напиши КРАТКИЙ разбор на русском языке: 70–100 слов, две заметные темы пути и один вопрос для размышления. Не делай подробный анализ всех переходов. Тёплый тон, без эзотерического жаргона и категоричных предсказаний.' : 'Игрок завершил партию. Напиши связный рефлексивный разбор его пути на русском языке — 3-5 абзацев, тёплый и вдумчивый тон, без эзотерического жаргона и категоричных предсказаний.',
    'Опирайся ТОЛЬКО на реальный путь ниже и на исходный запрос игрока — не выдумывай события, которых не было.',
    '',
    `Запрос игрока: "${game.request}"`,
    '',
    'Путь фишки по клеткам:',
    ...journeyLines,
    '',
    `Финальная клетка: ${cellLabel(game.currentCell, language)}${finalCellContent ? ` — ${finalCellContent.shortDescription}` : ''}`,
    '',
    'В разборе свяжи путь с исходным запросом: какие темы/повторения заметны, что финальная клетка может значить именно в контексте этого запроса. Не давай медицинских, юридических или финансовых советов.',
  ].join('\n');
}
