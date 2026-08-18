import type { ScreenProps } from '../navigation/ScreenProps';
import { Board } from '../components/Board';
import { getBoardCoordinates, getBoardImageSrc } from '../game/boardCoordinates';
import { DiceIcon } from '../components/icons';

export function GameHome({ session, nav }: ScreenProps) {
  const { game, ruleset, lastMove, cellById } = session;

  if (!game) {
    return (
      <div className="screen screen-centered">
        <p>Партия ещё не создана.</p>
        <button className="primary" onClick={() => nav.resetTo('Splash')}>
          В начало
        </button>
      </div>
    );
  }

  const coordinates = getBoardCoordinates(game.rulesetId);
  const imageSrc = getBoardImageSrc(game.rulesetId);

  // Анимируем приезд фишки только когда lastMove реально закончился именно
  // в текущей клетке — а не при каждом заходе на GameHome (например, из
  // "Истории" и обратно).
  const hasFreshMove = lastMove !== null && lastMove.finalCell === game.currentCell;
  const fromCell = hasFreshMove ? lastMove.fromCell : undefined;
  const viaCell = hasFreshMove && lastMove.landedCell !== lastMove.finalCell ? lastMove.landedCell : undefined;

  const specialZone: [number, number] = [ruleset.board.finishCell + 1, ruleset.board.extendedFinishCell];

  // Краткая информация о текущей клетке для верхней плашки. До рождения
  // фишка физически не на поле — показываем статус ожидания вместо клетки.
  const currentCellContent = game.isBorn ? cellById(game.currentCell) : undefined;
  const topLabel = !game.isBorn
    ? 'Ждём рождения — нужна 6'
    : game.status === 'FINISHED'
      ? 'Путь пройден'
      : `Клетка ${game.currentCell}`;
  const topSnippet = currentCellContent?.shortDescription || currentCellContent?.name || game.request;

  return (
    <div className="screen screen-game-home">
      <div className="game-home-topbar">
        <button className="icon-button" aria-label="В меню" onClick={() => nav.resetTo('Splash')}>
          ☰
        </button>
        <div className="current-cell-info">
          <span className="cell-number">{topLabel}</span>
          {topSnippet && <span className="cell-snippet">{topSnippet}</span>}
        </div>
        <button className="icon-button" aria-label="Мои партии" onClick={() => nav.push('MyGames')}>
          ⋯
        </button>
      </div>

      <div className="game-home-board">
        <Board
          coordinates={coordinates}
          imageSrc={imageSrc}
          currentCell={game.currentCell}
          fromCell={fromCell}
          viaCell={viaCell}
          highlightRange={specialZone}
          onCellTap={(cellId) => nav.push('CellCard', { cellId, peek: true })}
        />
      </div>

      <div className="game-home-bottom">
        {game.status === 'FINISHED' ? (
          <button className="primary" onClick={() => nav.push('FinishScreen')}>
            К завершению
          </button>
        ) : (
          <button
            className="dice-fab"
            aria-label={!game.isBorn ? 'Бросить кубик на рождение' : 'Бросить кубик'}
            onClick={() => nav.push('DiceRoll')}
          >
            <DiceIcon />
          </button>
        )}
        <div className="game-home-links">
          <button onClick={() => nav.push('History')}>История ходов</button>
        </div>
      </div>
    </div>
  );
}
