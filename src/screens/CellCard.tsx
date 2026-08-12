import type { ScreenProps } from '../navigation/ScreenProps';
import { afterCellCard } from '../navigation/flow';

export function CellCard({ session, nav }: ScreenProps) {
  const { game } = session;
  if (!game) return null;

  const cell = session.cellById(game.currentCell);

  return (
    <div className="screen screen-cell-card">
      <h1>Клетка {game.currentCell}</h1>
      {cell ? (
        <>
          <h2>
            {cell.name} <em className="muted">({cell.sanskrit})</em>
          </h2>
          <p>{cell.shortDescription}</p>
          <p className="muted">{cell.fullDescription}</p>
          {cell.reflectionQuestions.length > 0 && (
            <div className="reflection">
              <h3>Вопрос для размышления</h3>
              <p>{cell.reflectionQuestions[0]}</p>
            </div>
          )}
        </>
      ) : (
        <p className="muted">Контент для этой клетки ещё не заполнен (заглушка).</p>
      )}
      <button onClick={() => nav.push(afterCellCard(session.lastEvents))}>Далее</button>
    </div>
  );
}
