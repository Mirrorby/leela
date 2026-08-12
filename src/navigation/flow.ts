import type { RollEvent, RollEventType } from '../types/game';
import type { ScreenName } from './types';

// Вся "маршрутизация" после броска кубика собрана в одном месте, чтобы
// экраны не дублировали знание о событиях Game Engine — они просто зовут
// нужную функцию и переходят туда, куда она скажет.

function hasEvent(events: RollEvent[], type: RollEventType): boolean {
  return events.some((e) => e.type === type);
}

/** Куда идти после экрана TurnResult (общая сводка по броску). */
export function afterTurnResult(events: RollEvent[]): ScreenName {
  if (hasEvent(events, 'TRIPLE_SIX_RESET')) return 'TripleSixReset';
  if (hasEvent(events, 'BIRTH_FAILED')) return 'GameHome';
  if (
    hasEvent(events, 'REJECTED_GAME_FINISHED') ||
    hasEvent(events, 'REJECTED_INVALID_ROLL') ||
    hasEvent(events, 'DUPLICATE_IGNORED')
  ) {
    return 'GameHome';
  }
  // Если сработала змея/стрела — сперва показываем переход, карточку клетки
  // покажем уже для итоговой (после перехода) клетки.
  if (hasEvent(events, 'SNAKE') || hasEvent(events, 'ARROW')) return 'TransitionEvent';
  // Иначе (рождение, обычное движение, финиш, перелёт за 68) — сразу карточка клетки.
  return 'CellCard';
}

/** Куда идти после того, как показали переход (змея/стрела). */
export function afterTransitionEvent(): ScreenName {
  return 'CellCard';
}

/** Куда идти после карточки клетки. */
export function afterCellCard(events: RollEvent[]): ScreenName {
  if (hasEvent(events, 'FINISH')) return 'FinishScreen';
  if (hasEvent(events, 'EXTRA_ROLL_GRANTED')) return 'ExtraRollPrompt';
  return 'GameHome';
}
