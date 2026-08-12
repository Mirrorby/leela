import type { ScreenProps } from '../navigation/ScreenProps';
import type { GameStatus } from '../types/game';

const STATUS_LABELS: Record<GameStatus, string> = {
  WAITING_FOR_BIRTH: 'Ждём рождения (нужна 6)',
  IN_PROGRESS: 'В игре',
  FINISHED: 'Партия завершена',
  ARCHIVED: 'В архиве',
};

export function GameHome({ session, nav }: ScreenProps) {
  const { game } = session;

  if (!game) {
    return (
      <div className="screen screen-game-home">
        <p>Партия ещё не создана.</p>
        <button onClick={() => nav.resetTo('Splash')}>В начало</button>
      </div>
    );
  }

  return (
    <div className="screen screen-game-home">
      <h1>Лила</h1>
      <p className="muted">Запрос: {game.request}</p>
      <p>Статус: {STATUS_LABELS[game.status]}</p>
      <p>Клетка: {game.currentCell}</p>
      <p className="muted">Завершённых ходов: {game.turns.length}</p>

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
