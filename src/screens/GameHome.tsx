import type { ScreenProps } from '../navigation/ScreenProps';
import type { GameStatus } from '../types/game';
import { Board } from '../components/Board';
import { getBoardCoordinates, getBoardImageSrc } from '../game/boardCoordinates';

const STATUS_LABELS: Record<GameStatus, string> = {
  WAITING_FOR_BIRTH: 'Ждём рождения (нужна 6)',
  IN_PROGRESS: 'В игре',
  FINISHED: 'Партия завершена',
  ARCHIVED: 'В архиве',
};

export function GameHome({ session, nav }: ScreenProps) {
  const { game, ruleset, lastMove } = session;

  if (!game) {
    return (
      <div className="screen screen-game-home">
        <p>Партия ещё не создана.</p>
        <button onClick={() => nav.resetTo('Splash')}>В начало</button>
      </div>
    );
  }

  const coordinates = getBoardCoordinates(game.rulesetId);
  const imageSrc = getBoardImageSrc(game.rulesetId);

  // Анимируем приезд фишки только когда lastMove реально закончился именно
  // в текущей клетке (т.е. мы только что вернулись с брошенного хода) — а
  // не при каждом заходе на GameHome (например, из "Истории" и обратно).
  const hasFreshMove = lastMove !== null && lastMove.finalCell === game.currentCell;
  const fromCell = hasFreshMove ? lastMove.fromCell : undefined;
  const viaCell = hasFreshMove && lastMove.landedCell !== lastMove.finalCell ? lastMove.landedCell : undefined;

  const specialZone: [number, number] = [ruleset.board.finishCell + 1, ruleset.board.extendedFinishCell];

  return (
    <div className="screen screen-game-home">
      <h1>Лила</h1>
      <p className="muted">Запрос: {game.request}</p>
      <p>Статус: {STATUS_LABELS[game.status]}</p>
      <p className="muted">Завершённых ходов: {game.turns.length}</p>

      <Board
        coordinates={coordinates}
        imageSrc={imageSrc}
        currentCell={game.currentCell}
        fromCell={fromCell}
        viaCell={viaCell}
        highlightRange={specialZone}
        onCellTap={(cellId) => nav.push('CellCard', { cellId, peek: true })}
      />

      {game.status === 'FINISHED' ? (
        <button onClick={() => nav.push('FinishScreen')}>К завершению</button>
      ) : (
        <button onClick={() => nav.push('DiceRoll')}>Бросить кубик</button>
      )}
      <button onClick={() => nav.push('History')}>История ходов</button>
      <button onClick={() => nav.push('MyGames')}>Мои партии</button>
    </div>
  );
}
