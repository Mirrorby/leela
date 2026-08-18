import type { ScreenProps } from '../navigation/ScreenProps';
import { listPersistedGames } from '../state/persistence';
import { getDisplayUser } from '../telegram/telegramAdapter';

export function Splash({ nav }: ScreenProps) {
  const hasSavedGames = listPersistedGames().length > 0;
  // Только для отображения (initDataUnsafe не проверен) — просто вежливое
  // приветствие по имени, если открыто внутри Telegram. Никаких решений о
  // доступе на этом не строится.
  const displayName = getDisplayUser()?.first_name;

  return (
    <div className="screen screen-centered">
      <h1>Лила</h1>
      <p>{displayName ? `С возвращением, ${displayName}!` : 'Познай истинного себя и найди ответы на свои вопросы'}</p>
      <button className="primary" onClick={() => nav.push('Intro')}>
        Новая партия
      </button>
      {hasSavedGames && <button onClick={() => nav.push('MyGames')}>Мои партии</button>}
    </div>
  );
}
