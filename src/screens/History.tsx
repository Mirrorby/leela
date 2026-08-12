import type { ScreenProps } from '../navigation/ScreenProps';

export function History({ session, nav }: ScreenProps) {
  const { game } = session;
  if (!game) return null;

  return (
    <div className="screen screen-history">
      <h1>История ходов</h1>
      {game.turns.length === 0 && <p className="muted">Ходов пока не было.</p>}
      <ol>
        {game.turns.map((turn) => (
          <li key={turn.id}>
            {turn.startCell} → {turn.finalCell}
            <span className="muted"> (броски: {turn.rolls.map((r) => r.value).join(', ')})</span>
          </li>
        ))}
      </ol>
      <button onClick={() => nav.pop()}>Назад</button>
    </div>
  );
}
