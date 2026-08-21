import type { ScreenProps } from '../navigation/ScreenProps';

/**
 * История ходов (переоформлена — п.6 правок после ревью). Раньше это был
 * голый <ol> со строкой "27 → 23 (броски: 1)" — не читалось на фоне
 * остального интерфейса. Теперь каждый ход — карточка в общем языке
 * приложения (те же pill/card паттерны, что и "Мои партии"): номер хода
 * в золотом кружке, крупный переход клетка→клетка, и если сработал
 * переход (змея тянет вниз / стрела поднимает вверх) — отдельная
 * подпись, потому что это самая интересная часть хода, её не должно быть
 * видно только по мелким циферкам бросков.
 */
export function History({ session, nav }: ScreenProps) {
  const { game } = session;
  if (!game) return null;

  return (
    <div className="screen screen-history">
      <h1>История ходов</h1>
      {game.turns.length === 0 ? (
        <p className="muted">Ходов пока не было — брось кубик, и они появятся здесь.</p>
      ) : (
        <>
          <p className="muted history-count">
            {game.turns.length} {turnsWord(game.turns.length)}
          </p>
          <ol className="history-list">
            {game.turns.map((turn, i) => {
              const isBirth = turn.startCell === 0;
              const hasTransition = turn.landedCell !== turn.finalCell;
              const isSnake = hasTransition && turn.finalCell < turn.landedCell;
              return (
                <li key={turn.id} className="history-row">
                  <span className="history-index">{i + 1}</span>
                  <div className="history-main">
                    <div className="history-move">
                      {isBirth ? (
                        <span className="history-birth">Рождение фишки</span>
                      ) : (
                        <>
                          <span className="history-cell">{turn.startCell}</span>
                          <span className="history-arrow" aria-hidden="true">
                            →
                          </span>
                          <span className="history-cell history-cell--final">{turn.finalCell}</span>
                        </>
                      )}
                      {hasTransition && (
                        <span className={`history-transition-badge${isSnake ? ' snake' : ' arrow'}`}>
                          {isSnake ? 'змея' : 'стрела'} · через {turn.landedCell}
                        </span>
                      )}
                    </div>
                    <div className="history-rolls">
                      {turn.rolls.map((r) => (
                        <span key={r.id} className="history-roll-pip">
                          {r.value}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
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
