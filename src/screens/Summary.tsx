import type { ScreenProps } from '../navigation/ScreenProps';

export function Summary({ session, nav }: ScreenProps) {
  const { game } = session;
  if (!game) return null;

  const finalCell = session.cellById(game.currentCell);

  return (
    <div className="screen screen-summary">
      <h1>Итог партии</h1>
      <p className="muted">Запрос: {game.request}</p>
      <p className="muted">Ходов всего: {game.turns.length}</p>
      <ol>
        {game.turns.map((turn) => (
          <li key={turn.id}>
            {turn.startCell} → {turn.finalCell}
          </li>
        ))}
      </ol>
      {finalCell && (
        <div className="reflection">
          <h2>Финальная клетка: {finalCell.name}</h2>
          <p>{finalCell.fullDescription}</p>
        </div>
      )}
      <button
        onClick={() => {
          session.reset();
          nav.resetTo('Splash');
        }}
      >
        Начать заново
      </button>
    </div>
  );
}
