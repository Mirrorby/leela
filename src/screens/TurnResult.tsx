import { useEffect } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import type { RollEventType } from '../types/game';
import { afterTurnResult } from '../navigation/flow';
import { hapticImpact } from '../telegram/haptics';

const EVENT_LABELS: Record<RollEventType, string> = {
  BIRTH_SUCCESS: 'Фишка родилась!',
  BIRTH_FAILED: 'Не 6 — рождение не состоялось, попробуй ещё раз.',
  MOVE: 'Фишка передвинулась.',
  SNAKE: 'Змея утянула фишку вниз.',
  ARROW: 'Стрела подняла фишку вверх.',
  EXTRA_ROLL_GRANTED: 'Выпала 6 — доступен дополнительный бросок.',
  TRIPLE_SIX_RESET: 'Три шестёрки подряд — откат к позиции перед серией.',
  FINISH: 'Финиш! Партия завершена.',
  BEYOND_FINISH: 'Фишка вышла за пределы клетки 68 (правило уточняется).',
  REJECTED_GAME_FINISHED: 'Партия уже завершена, бросок не принят.',
  REJECTED_INVALID_ROLL: 'Некорректное значение броска.',
  DUPLICATE_IGNORED: 'Повторный бросок проигнорирован.',
};

export function TurnResult({ session, nav }: ScreenProps) {
  const { lastEvents, lastRollValue, lastMove } = session;

  // Фишка "приземлилась" — лёгкий отклик. Только на маунт экрана (не на
  // каждый ре-рендер), поэтому пустой массив зависимостей.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => hapticImpact('medium'), []);

  return (
    <div className="screen screen-turn-result">
      <h1>Результат броска</h1>
      <p>Выпало: {lastRollValue}</p>
      {lastMove && (
        <p className="muted">
          {lastMove.fromCell} → {lastMove.landedCell}
          {lastMove.landedCell !== lastMove.finalCell ? ` → ${lastMove.finalCell}` : ''}
        </p>
      )}
      <ul>
        {lastEvents.map((e, i) => (
          <li key={i}>
            {EVENT_LABELS[e.type]}
            {e.detail ? ` (${e.detail})` : ''}
          </li>
        ))}
      </ul>
      <button onClick={() => nav.push(afterTurnResult(lastEvents))}>Далее</button>
    </div>
  );
}
