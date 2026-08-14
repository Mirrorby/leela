import { useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { hapticImpact } from '../telegram/haptics';

export function DiceRoll({ session, nav }: ScreenProps) {
  const { game } = session;
  const [manualValue, setManualValue] = useState(6);

  if (!game) {
    return (
      <div className="screen screen-dice-roll">
        <p>Партия не найдена.</p>
        <button onClick={() => nav.resetTo('Splash')}>В начало</button>
      </div>
    );
  }

  const isBirthRoll = !game.isBorn;

  const doRoll = (value?: number) => {
    hapticImpact('light');
    session.roll(value);
    nav.push('TurnResult');
  };

  return (
    <div className="screen screen-dice-roll">
      <h1>{isBirthRoll ? 'Бросок на рождение' : 'Бросок кубика'}</h1>
      <p className="muted">
        {isBirthRoll ? 'Нужна шестёрка, чтобы фишка появилась на поле.' : `Текущая клетка: ${game.currentCell}`}
      </p>

      {game.diceMode === 'virtual' ? (
        <button onClick={() => doRoll()}>Бросить кубик</button>
      ) : (
        <div className="dice-manual-input">
          <select value={manualValue} onChange={(e) => setManualValue(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <button onClick={() => doRoll(manualValue)}>Подтвердить бросок</button>
        </div>
      )}
    </div>
  );
}
