import type { ReviewKind, ReviewLanguage } from './reviewFormat';
import type { GameState } from '../types/game';
import { getCellContent } from './reviewContentLoader';
import limits from '../../../src/data/limits.json';

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
  const detailed = game.turns.length <= limits.reviewDetailedTurns;
  const firstCount = limits.reviewDetailedTurns / 4;
  const lastStart = game.turns.length - (limits.reviewDetailedTurns - firstCount);
  const selected = detailed ? game.turns.map((turn, index) => ({ turn, index })) : [
    ...game.turns.slice(0, firstCount).map((turn, index) => ({ turn, index })),
    ...game.turns.slice(lastStart).map((turn, index) => ({ turn, index: lastStart + index })),
  ];
  const journeyLines = selected.map(({ turn, index }) => {
    const base = `${index + 1}. ${cellLabel(turn.startCell, language)} → ${cellLabel(turn.landedCell, language)}`;
    if (turn.landedCell !== turn.finalCell) {
      return `${base} → ${language === 'en' ? 'transition' : 'переход'} → ${cellLabel(turn.finalCell, language)}`;
    }
    return base;
  });

  if (!detailed) {
    const counts = new Map<number, number>();
    const transitions = new Map<string, number>();
    for (const turn of game.turns) {
      counts.set(turn.finalCell, (counts.get(turn.finalCell) ?? 0) + 1);
      if (turn.landedCell !== turn.finalCell) {
        const key = `${turn.landedCell}→${turn.finalCell}`;
        transitions.set(key, (transitions.get(key) ?? 0) + 1);
      }
    }
    // Counts include omitted turns; keep their absence explicit so the model
    // cannot invent the chronology of the middle segment. Storage is unchanged.
    const note = language === 'en'
      ? `Turns ${firstCount + 1}–${lastStart} omitted from the detailed excerpt. Total turns: ${game.turns.length}. Do not invent their order or events.`
      : `Ходы ${firstCount + 1}–${lastStart} не включены в подробный фрагмент. Всего ходов: ${game.turns.length}. Не выдумывай их порядок или события.`;
    journeyLines.splice(firstCount, 0, note);
    journeyLines.push(language === 'en' ? 'Final-square frequencies across ALL turns:' : 'Частоты конечных клеток по ВСЕМ ходам:');
    journeyLines.push([...counts].sort(([a], [b]) => a - b).map(([id, count]) => `${cellLabel(id, language)}: ${count}`).join('; '));
    journeyLines.push(language === 'en' ? 'Transition frequencies across ALL turns:' : 'Частоты переходов по ВСЕМ ходам:');
    journeyLines.push([...transitions].sort(([a], [b]) => a.localeCompare(b)).map(([path, count]) => `${path}: ${count}`).join('; '));
  }
  const intention = game.request.length <= limits.requestCharacters ? game.request
    : game.request.slice(0, limits.requestCharacters) + (language === 'en' ? ' [long intention excerpt]' : ' [фрагмент длинного запроса]');

  const finalCellContent = getCellContent(game.currentCell, language);

  if (language === 'en') return [
    'You are a thoughtful guide to Leela, the traditional 72-square game of self-discovery (a spiritual form of snakes and ladders).',
    kind === 'short'
      ? 'The player has completed a game. Write a SHORT review in English: 70–100 words, two notable themes from the journey and one reflection question. Do not analyse every transition in detail. Use a warm tone, without esoteric jargon or definite predictions.'
      : 'The player has completed a game. Write a coherent reflective review of the journey in English: 3–5 paragraphs, with a warm, thoughtful tone, without esoteric jargon or definite predictions.',
    'Use ONLY the actual journey below and the player’s original intention. Do not invent events.',
    '', `Player’s intention: "${intention}"`, '', 'Journey across the board:', ...journeyLines, '',
    `Final square: ${cellLabel(game.currentCell, language)}${finalCellContent ? ` — ${finalCellContent.shortDescription}` : ''}`, '',
    'Relate the journey to the original intention: themes, recurring patterns and what the final square may mean in this context. Do not give medical, legal or financial advice.',
  ].join('\n');
  return [
    'Ты — вдумчивый проводник в традиционной трансформационной игре «Лила» (духовный вариант «змей и лестниц» на 72 клетках).',
    kind === 'short' ? 'Игрок завершил партию. Напиши КРАТКИЙ разбор на русском языке: 70–100 слов, две заметные темы пути и один вопрос для размышления. Не делай подробный анализ всех переходов. Тёплый тон, без эзотерического жаргона и категоричных предсказаний.' : 'Игрок завершил партию. Напиши связный рефлексивный разбор его пути на русском языке — 3-5 абзацев, тёплый и вдумчивый тон, без эзотерического жаргона и категоричных предсказаний.',
    'Опирайся ТОЛЬКО на реальный путь ниже и на исходный запрос игрока — не выдумывай события, которых не было.',
    '',
    `Запрос игрока: "${intention}"`,
    '',
    'Путь фишки по клеткам:',
    ...journeyLines,
    '',
    `Финальная клетка: ${cellLabel(game.currentCell, language)}${finalCellContent ? ` — ${finalCellContent.shortDescription}` : ''}`,
    '',
    'В разборе свяжи путь с исходным запросом: какие темы/повторения заметны, что финальная клетка может значить именно в контексте этого запроса. Не давай медицинских, юридических или финансовых советов.',
  ].join('\n');
}
