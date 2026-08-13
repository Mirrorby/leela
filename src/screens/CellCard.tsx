import type { ScreenProps } from '../navigation/ScreenProps';
import { afterCellCard } from '../navigation/flow';

/**
 * CellCard работает в двух режимах:
 *  - обычный (после хода): показывает game.currentCell, кнопка "Далее" ведёт
 *    дальше по флоу партии (afterCellCard);
 *  - "подглядывание" (params.peek === true, params.cellId задан): открыт
 *    тапом по произвольной клетке на доске (GameHome). Показывает контент
 *    ЛЮБОЙ клетки, ничего не меняя в игре, кнопка — просто "Назад".
 */
export function CellCard({ session, nav, params }: ScreenProps) {
  const { game } = session;
  if (!game) return null;

  const isPeek = params?.peek === true && typeof params.cellId === 'number';
  const cellId = isPeek ? (params!.cellId as number) : game.currentCell;

  const cell = session.cellById(cellId);

  return (
    <div className="screen screen-cell-card">
      <h1>Клетка {cellId}</h1>
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

      {isPeek ? (
        <button onClick={() => nav.pop()}>Назад</button>
      ) : (
        <button onClick={() => nav.push(afterCellCard(session.lastEvents))}>Далее</button>
      )}
    </div>
  );
}
