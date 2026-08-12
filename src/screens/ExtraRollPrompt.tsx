import type { ScreenProps } from '../navigation/ScreenProps';

export function ExtraRollPrompt({ nav }: ScreenProps) {
  return (
    <div className="screen screen-extra-roll">
      <h1>Дополнительный бросок</h1>
      <p>Выпала 6 — можно бросить ещё раз.</p>
      <button onClick={() => nav.push('DiceRoll')}>Бросить ещё раз</button>
    </div>
  );
}
