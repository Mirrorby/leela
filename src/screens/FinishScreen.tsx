import type { ScreenProps } from '../navigation/ScreenProps';

export function FinishScreen({ nav }: ScreenProps) {
  return (
    <div className="screen screen-finish">
      <h1>Партия завершена</h1>
      <p>Фишка дошла до клетки 68 — путь пройден.</p>
      <button onClick={() => nav.push('Summary')}>Итог партии</button>
    </div>
  );
}
