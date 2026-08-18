import type { ScreenProps } from '../navigation/ScreenProps';
import type { DiceMode } from '../types/game';

export function DiceModeSelect({ session, nav }: ScreenProps) {
  const choose = (mode: DiceMode) => {
    session.setDiceMode(mode);
    session.startGame({ diceMode: mode });
    nav.resetTo('GameHome');
  };

  return (
    <div className="screen screen-centered">
      <h1>Кубик</h1>
      <p>Как будем бросать кубик в этой партии?</p>
      <button className="primary" onClick={() => choose('virtual')}>
        Виртуальный — приложение бросает само
      </button>
      <button onClick={() => choose('physical')}>Физический — я введу результат сам</button>
    </div>
  );
}
