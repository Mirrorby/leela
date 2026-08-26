import type { CellContent, Turn } from '../types/game';

/**
 * MoveTile — переиспользуемая карточка одного хода (п.6-7 правок). Раньше
 * это была разметка внутри History.tsx (карточка с номером хода в кружке,
 * переходом клетка→клетка и бейджем змеи/стрелы), выводившая голые номера
 * клеток без названий. Теперь:
 *  1) вынесена в отдельный компонент, чтобы Summary (см. screens/Summary.tsx)
 *     переиспользовал ровно ту же вёрстку, а не дублировал её — единый
 *     визуальный язык для "истории хода" в обоих местах;
 *  2) у каждого конца перехода показывается не только номер клетки, но и её
 *     название на русском (например "№4 Жадность", п.6): без этого номер
 *     ничего не говорит о смысле хода, приходилось открывать карточку клетки
 *     отдельно, чтобы вспомнить, что это была за клетка.
 *
 * Ход-рождение (startCell === 0, реальной "клетки 0" в правилах нет)
 * показывается без номера слева — просто "Рождение → №1 <название>".
 */
export function MoveTile({
  turn,
  index,
  cellById,
}: {
  turn: Turn;
  index: number;
  cellById: (id: number) => CellContent | undefined;
}) {
  const isBirth = turn.startCell === 0;
  const hasTransition = turn.landedCell !== turn.finalCell;
  const isSnake = hasTransition && turn.finalCell < turn.landedCell;
  const startName = cellById(turn.startCell)?.name;
  const finalName = cellById(turn.finalCell)?.name;

  return (
    <li className="history-row">
      <span className="history-index">{index + 1}</span>
      <div className="history-main">
        <div className="history-move">
          {isBirth ? (
            <span className="history-birth">Рождение</span>
          ) : (
            <span className="history-cell">
              №{turn.startCell}
              {startName && <span className="history-cell-name"> {startName}</span>}
            </span>
          )}
          <span className="history-arrow" aria-hidden="true">
            →
          </span>
          <span className="history-cell history-cell--final">
            №{turn.finalCell}
            {finalName && <span className="history-cell-name"> {finalName}</span>}
          </span>
          {hasTransition && (
            <span className={`history-transition-badge${isSnake ? ' snake' : ' arrow'}`}>
              {isSnake ? 'змея' : 'стрела'} · через {turn.landedCell}
            </span>
          )}
        </div>
        <div className="history-rolls">
          {turn.rolls.map((r) => (
            <span key={r.id} className="history-roll-pip">
              {r.value}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}
