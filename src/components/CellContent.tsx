import type { CellContent as CellContentData } from '../types/game';

export interface CellContentProps {
  cellId: number;
  cell?: CellContentData;
}

/**
 * CellContent — чистое отображение содержимого клетки. Раньше это была
 * половина экрана CellCard.tsx; после переноса броска в модалку (GameHome)
 * этот же блок используется в двух местах: после хода (внутри результата
 * броска) и при "подглядывании" произвольной клетки — оба раза без
 * дублирования разметки.
 */
export function CellContent({ cellId, cell }: CellContentProps) {
  if (!cell) {
    return (
      <>
        <h2>Клетка {cellId}</h2>
        <p className="muted">Контент для этой клетки ещё не заполнен (заглушка).</p>
      </>
    );
  }

  return (
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
  );
}
