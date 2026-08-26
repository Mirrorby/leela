import { useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { setActivePersistedGameId } from '../state/persistence';
import { MoveTile } from '../components/MoveTile';

/**
 * Итог партии (переоформлен — п.7 правок). Список ходов теперь тот же
 * MoveTile-компонент, что и в Истории (см. components/MoveTile.tsx) — не
 * дублируем вёрстку. Текст "Финальная клетка: ..." в конце списка убран:
 * последняя плитка списка и так заканчивается на финальной клетке с её
 * названием, отдельная строка после списка была чистым повтором той же
 * информации. Кнопка "Проанализировать ходы" — заглушка на будущее
 * (ИИ-разбор партии, п.9 общего списка правок, добавляется отдельно).
 */
export function Summary({ session, nav }: ScreenProps) {
  const { game } = session;
  const [analysisStub, setAnalysisStub] = useState(false);

  if (!game) return null;

  return (
    <div className="screen screen-summary">
      <h1>Итог партии</h1>
      <p className="muted">Запрос: {game.request}</p>
      <p className="muted">Ходов всего: {game.turns.length}</p>
      {game.turns.length > 0 && (
        <ol className="history-list">
          {game.turns.map((turn, i) => (
            <MoveTile key={turn.id} turn={turn} index={i} cellById={session.cellById} />
          ))}
        </ol>
      )}
      <button onClick={() => setAnalysisStub(true)} disabled={analysisStub}>
        {analysisStub ? 'Скоро — ИИ-разбор партии в разработке' : 'Проанализировать ходы'}
      </button>
      <button
        onClick={() => {
          setActivePersistedGameId(null);
          session.reset();
          nav.resetTo('Splash');
        }}
      >
        Начать заново
      </button>
    </div>
  );
}
