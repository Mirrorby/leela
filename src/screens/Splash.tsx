import type { ScreenProps } from '../navigation/ScreenProps';
import { listPersistedGames } from '../state/persistence';

export function Splash({ session, nav }: ScreenProps) {
  const hasSavedGames = listPersistedGames().length > 0;

  return (
    <div className="screen screen-splash">
      <h1>Лила</h1>
      <p className="muted">
        Ruleset: {session.ruleset.rulesetId} v{session.ruleset.version} · клеток на поле:{' '}
        {session.ruleset.board.size} · контент загружен: {session.content.cells.length} клеток
      </p>
      <button onClick={() => nav.push('Intro')}>Новая партия</button>
      {hasSavedGames && <button onClick={() => nav.push('MyGames')}>Мои партии</button>}
    </div>
  );
}
