import type { ScreenProps } from '../navigation/ScreenProps';
import { MoveTile } from '../components/MoveTile';

/**
 * История ходов (переоформлена — п.6 правок). Раньше это был голый <ol> со
 * строкой "27 → 23 (броски: 1)" — не читалось на фоне остального
 * интерфейса, а номера клеток без названий ничего не говорили о смысле
 * хода. Разметка одного хода теперь переиспользуемый MoveTile (см.
 * components/MoveTile.tsx) — тот же компонент использует и Summary
 * (screens/Summary.tsx), чтобы не дублировать вёрстку.
 *
 * Кнопка меню в шапке (справа от заголовка) — тот же переход "в меню"
 * (сброс стека на Splash), что и у иконки "☰" на GameHome, только здесь
 * своя строка-шапка (.screen-header-row), а не полноценный topbar с
 * плиткой партии — Истории отдельная плитка не нужна, только заголовок.
 */
export function History({ session, nav }: ScreenProps) {
  const { game, cellById } = session;
  if (!game) return null;

  return (
    <div className="screen screen-history">
      <div className="screen-header-row">
        <h1>История ходов</h1>
        <button className="icon-button" aria-label="В меню" onClick={() => nav.resetTo('Splash')}>
          ☰
        </button>
      </div>
      {game.turns.length === 0 ? (
        <p className="muted">Ходов пока не было — брось кубик, и они появятся здесь.</p>
      ) : (
        <>
          <p className="muted history-count">
            {game.turns.length} {turnsWord(game.turns.length)}
          </p>
          <ol className="history-list">
            {game.turns.map((turn, i) => (
              <MoveTile key={turn.id} turn={turn} index={i} cellById={cellById} />
            ))}
          </ol>
        </>
      )}
      <button onClick={() => nav.pop()}>Назад</button>
    </div>
  );
}

function turnsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ход';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'хода';
  return 'ходов';
}
