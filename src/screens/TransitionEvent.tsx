import type { ScreenProps } from '../navigation/ScreenProps';
import { afterTransitionEvent } from '../navigation/flow';

export function TransitionEvent({ session, nav }: ScreenProps) {
  const { lastEvents, lastMove } = session;
  const isSnake = lastEvents.some((e) => e.type === 'SNAKE');

  return (
    <div className="screen screen-transition">
      <h1>{isSnake ? 'Змея' : 'Стрела'}</h1>
      {lastMove && (
        <p>
          Клетка {lastMove.landedCell} {isSnake ? 'утянула фишку вниз, на' : 'подняла фишку вверх, на'} клетку{' '}
          {lastMove.finalCell}.
        </p>
      )}
      <button onClick={() => nav.push(afterTransitionEvent())}>Далее</button>
    </div>
  );
}
