// Минималистичные векторные иконки интерфейса. Никакой игровой логики —
// только отрисовка, как и полагается компонентам в components/.

export function DiceIcon({ value }: { value?: number }) {
  // Без value — обычная "иконка кубика" (три точки по диагонали, как в
  // референсном дизайне). С value — показывает конкретную грань 1..6,
  // используется на экране выбора значения при физическом кубике.
  const pipsByValue: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [
      [30, 30],
      [70, 70],
    ],
    3: [
      [30, 30],
      [50, 50],
      [70, 70],
    ],
    4: [
      [30, 30],
      [70, 30],
      [30, 70],
      [70, 70],
    ],
    5: [
      [30, 30],
      [70, 30],
      [50, 50],
      [30, 70],
      [70, 70],
    ],
    6: [
      [30, 25],
      [70, 25],
      [30, 50],
      [70, 50],
      [30, 75],
      [70, 75],
    ],
  };
  const pips = pipsByValue[value ?? 3] ?? pipsByValue[3];

  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="8" width="84" height="84" rx="20" stroke="currentColor" strokeWidth="6" />
      {pips.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="7" fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * Иконка "Мои партии" (п.4 правок). Раньше здесь были три точки "⋯" —
 * визуально это "ещё меню/опции", а не "список моих партий", и путалось с
 * тремя полосками "☰" слева, которые как раз и есть настоящее меню. Три
 * полоски слева (в меню) остаются как есть — их не трогаем. Здесь —
 * стопка карточек: каждая сохранённая партия в "Моих партиях" уже
 * визуально card-based список (game-list-item), так что стопка карточек
 * читается однозначно как "список моих партий", в отличие от точек.
 */
export function GamesListIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="3" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" opacity="0.55" />
      <rect x="3" y="7" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="currentColor" fillOpacity="0.08" />
    </svg>
  );
}
