import { useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { listPersistedGames, removePersistedGame, setActivePersistedGameId } from '../state/persistence';

const STATUS_LABELS: Record<string, string> = {
  WAITING_FOR_BIRTH: 'ждёт рождения',
  IN_PROGRESS: 'в игре',
  FINISHED: 'завершена',
  ARCHIVED: 'в архиве',
};

export function MyGames({ session, nav }: ScreenProps) {
  const [games, setGames] = useState(() => listPersistedGames());

  const refresh = () => setGames(listPersistedGames());

  const handleContinue = (id: string) => {
    const record = games.find((g) => g.id === id);
    if (!record) return;
    session.restore(record);
    nav.resetTo(record.screen);
  };

  const handleDelete = (id: string) => {
    const isActive = session.game?.id === id;
    const confirmed = window.confirm(
      isActive ? 'Удалить текущую партию без возможности восстановить?' : 'Удалить эту партию без возможности восстановить?'
    );
    if (!confirmed) return;

    removePersistedGame(id);
    if (isActive) {
      setActivePersistedGameId(null);
      session.reset();
    }
    refresh();
  };

  const handleNewGame = () => {
    if (session.game && session.game.status !== 'FINISHED') {
      const confirmed = window.confirm('Начать новую партию? Текущая останется сохранённой в этом списке.');
      if (!confirmed) return;
    }
    session.reset();
    nav.resetTo('Intro');
  };

  const sorted = [...games].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));

  return (
    <div className="screen screen-my-games">
      <h1>Мои партии</h1>
      {sorted.length === 0 && <p className="muted">Сохранённых партий пока нет.</p>}
      <ul className="game-list">
        {sorted.map((record) => (
          <li key={record.id} className="game-list-item">
            <div>
              <strong>{record.game.request || '(без запроса)'}</strong>
              <div className="muted">
                {STATUS_LABELS[record.game.status] ?? record.game.status} · клетка {record.game.currentCell}
              </div>
            </div>
            <div className="game-list-actions">
              <button onClick={() => handleContinue(record.id)}>Продолжить</button>
              <button className="danger" onClick={() => handleDelete(record.id)}>
                Удалить
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button onClick={handleNewGame}>Новая партия</button>
      <button onClick={() => nav.pop()}>Назад</button>
    </div>
  );
}
