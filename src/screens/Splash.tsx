import type { ScreenProps } from '../navigation/ScreenProps';
import { listPersistedGames } from '../state/persistence';
import { getDisplayUser } from '../telegram/telegramAdapter';

export function Splash({ session, nav }: ScreenProps) {
  const hasSavedGames = listPersistedGames().length > 0;
  // Только для отображения (initDataUnsafe не проверен) — просто вежливое
  // приветствие по имени, если открыто внутри Telegram. Никаких решений о
  // доступе на этом не строится.
  const displayName = getDisplayUser()?.first_name;

  return (
    <div className="screen screen-splash">
      <h1>Лила</h1>
      {displayName && <p className="muted">С возвращением, {displayName}!</p>}
      <p className="muted">
        Ruleset: {session.ruleset.rulesetId} v{session.ruleset.version} · клеток на поле:{' '}
        {session.ruleset.board.size} · контент загружен: {session.content.cells.length} клеток
      </p>
      <button onClick={() => nav.push('Intro')}>Новая партия</button>
      {hasSavedGames && <button onClick={() => nav.push('MyGames')}>Мои партии</button>}
    </div>
  );
}
