import { useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { hapticImpact } from '../telegram/haptics';
import { DiceIcon } from '../components/icons';

const ROLL_ANIMATION_MS = 500;

export function DiceRoll({ session, nav }: ScreenProps) {
  const { game } = session;
  const [selectedFace, setSelectedFace] = useState(6);
  const [rolling, setRolling] = useState(false);

  if (!game) {
    return (
      <div className="screen screen-centered">
        <p>Партия не найдена.</p>
        <button className="primary" onClick={() => nav.resetTo('Splash')}>
          В начало
        </button>
      </div>
    );
  }

  const isBirthRoll = !game.isBorn;

  const doRoll = (value?: number) => {
    hapticImpact('light');
    session.roll(value);
    nav.push('TurnResult');
  };

  const handleVirtualTap = () => {
    if (rolling) return;
    setRolling(true);
    hapticImpact('light');
    window.setTimeout(() => doRoll(), ROLL_ANIMATION_MS);
  };

  return (
    <div className="screen">
      <div className="dice-roll-stage">
        <h1>{isBirthRoll ? 'Бросок на рождение' : 'Бросок кубика'}</h1>
        <p className="muted">
          {isBirthRoll ? 'Нужна шестёрка, чтобы фишка появилась на поле.' : `Текущая клетка: ${game.currentCell}`}
        </p>

        {game.diceMode === 'virtual' ? (
          <button
            className={`dice-roll-die${rolling ? ' rolling' : ''}`}
            aria-label="Бросить кубик"
            disabled={rolling}
            onClick={handleVirtualTap}
          >
            <DiceIcon />
          </button>
        ) : (
          <div className="dice-faces">
            {[1, 2, 3, 4, 5, 6].map((v) => (
              <button
                key={v}
                className={`dice-face-button${selectedFace === v ? ' selected' : ''}`}
                aria-label={`Грань ${v}`}
                onClick={() => setSelectedFace(v)}
              >
                {v}
              </button>
            ))}
          </div>
        )}

        {game.diceMode === 'physical' && <button onClick={() => doRoll(selectedFace)}>Подтвердить бросок</button>}
      </div>
    </div>
  );
}
