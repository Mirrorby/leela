import type { ScreenProps } from '../navigation/ScreenProps';

export function TripleSixReset({ session, nav }: ScreenProps) {
  const { game } = session;

  return (
    <div className="screen screen-triple-six">
      <h1>Три шестёрки подряд</h1>
      <p>Серия сброшена — фишка возвращается на клетку {game?.currentCell}.</p>
      <button onClick={() => nav.push('DiceRoll')}>Бросить снова</button>
    </div>
  );
}
